import { evaluate, type Agent, type Decision, type Platform, type Policy, type Subject } from '@guardian/core';
import { applyHostsSection, currentHostsSection, renderHostsSection } from './hosts.js';
import type { Proc } from './processes.js';

export interface EnforcerDeps {
  platform: Platform;
  listProcesses(): Promise<Proc[]>;
  kill(pid: number): Promise<void>;
  readHosts(): Promise<string>;
  writeHosts(content: string): Promise<void>;
  /** host → IP para forzar SafeSearch (se resuelve una vez por hora). */
  resolveSafeSearch(): Promise<Record<string, string>>;
  now(): Date;
  /** Reloj monotónico en ms (no cambia si alguien mueve la hora del sistema). */
  monotonic(): number;
  log?(msg: string): void;
}

export interface Foreground {
  subject: Subject | null;
  idle: boolean;
}

/** Sujeto genérico para saber si "todo el equipo" está bloqueado (bloqueo total u horario de "todo"). */
export const DESKTOP_SUBJECT = (platform: Platform): Subject => ({ type: 'app', platform, id: '__desktop__', label: 'Computadora' });

/**
 * Aplica la política en la computadora:
 *  - cierra apps bloqueadas (sólo apps concretas; el bloqueo "de todo" lo hace la pantalla de bloqueo),
 *  - mantiene la sección de Guardián en el archivo hosts (sitios + SafeSearch),
 *  - cuenta el uso de la app en primer plano que reporta la app de sesión,
 *  - detecta manipulación: hosts editado, reloj movido, app de sesión cerrada.
 */
export class Enforcer {
  private running = new Set<string>();
  private lastHostsSection: string | null = null;
  private hostsTamperReported = false;
  private safeSearch: Record<string, string> = {};
  private safeSearchAt = 0;
  private lastWall = 0;
  private lastMono = 0;
  private foreground: Foreground = { subject: null, idle: true };
  private foregroundAt = 0;
  private sessionDownReported = false;

  constructor(
    private readonly agent: Agent,
    private readonly deps: EnforcerDeps,
  ) {}

  /** La app de sesión informa qué está en primer plano. Devuelve la decisión para mostrarla. */
  async reportForeground(fg: Foreground): Promise<{ foreground: Decision | null; desktop: Decision }> {
    const mono = this.deps.monotonic();
    const prev = this.foreground;
    if (prev.subject && !prev.idle && this.foregroundAt) {
      const delta = Math.min(mono - this.foregroundAt, 10_000);
      if (delta > 0) await this.agent.use(prev.subject, delta);
    }
    const changed = !prev.subject || !fg.subject || JSON.stringify(prev.subject) !== JSON.stringify(fg.subject);
    this.foreground = fg;
    this.foregroundAt = mono;
    if (this.sessionDownReported) {
      this.sessionDownReported = false;
      await this.agent.report('agent_started', { component: 'session' });
    }
    let decision: Decision | null = null;
    if (fg.subject) decision = changed ? await this.agent.open(fg.subject) : this.agent.check(fg.subject);
    return { foreground: decision, desktop: this.agent.check(DESKTOP_SUBJECT(this.deps.platform)) };
  }

  /** Política sin objetivos "todo el dispositivo" ni bloqueo total: sirve para decidir qué procesos cerrar. */
  private killPolicy(): Policy {
    const p = this.agent.policy();
    return {
      ...p,
      overrides: p.overrides.filter((o) => o.type !== 'lock'),
      rules: p.rules.map((r) => ({ ...r, targets: r.targets.filter((t) => t.kind !== 'all') })).filter((r) => r.targets.length > 0),
    };
  }

  async tick(): Promise<{ killed: Proc[] }> {
    const now = this.deps.now();
    const mono = this.deps.monotonic();
    await this.checkClock(now, mono);
    const killed = this.agent.hasAdminAccess() ? [] : await this.enforceProcesses();
    await this.enforceHosts(now);
    await this.checkSession(mono);
    return { killed };
  }

  private async enforceProcesses(): Promise<Proc[]> {
    const { platform } = this.deps;
    const procs = await this.deps.listProcesses();
    const policy = this.killPolicy();
    const usage = this.agent.usage();
    const now = this.deps.now();
    const killed: Proc[] = [];
    const nowRunning = new Set<string>();
    for (const p of procs) {
      const subject: Subject = { type: 'app', platform, id: p.id, label: p.name };
      const key = p.id.toLowerCase();
      const decision = evaluate(policy, usage, subject, now, this.agent.ctx);
      if (decision.blocked) {
        if (!this.running.has(key)) {
          // Se cuenta el intento una vez por lanzamiento, no por cada proceso hijo.
          await this.agent.open(subject);
          this.running.add(key);
        }
        nowRunning.add(key);
        await this.deps.kill(p.pid);
        killed.push(p);
      } else {
        nowRunning.add(key);
      }
    }
    this.running = nowRunning;
    if (killed.length) this.deps.log?.(`Cerrados: ${[...new Set(killed.map((k) => k.name))].join(', ')}`);
    return killed;
  }

  private async enforceHosts(now: Date): Promise<void> {
    const settings = this.agent.policy().settings;
    if (settings.enforceSafeSearch && now.getTime() - this.safeSearchAt > 3600_000) {
      try {
        this.safeSearch = await this.deps.resolveSafeSearch();
        this.safeSearchAt = now.getTime();
      } catch {
        /* sin red: se reintenta en el siguiente ciclo */
      }
    }
    const section = renderHostsSection(this.agent.webBlockList(), settings.enforceSafeSearch ? this.safeSearch : {});
    const content = await this.deps.readHosts();
    const current = currentHostsSection(content);
    if (current === section) return;
    // Si la sección no coincide con lo último que escribimos, alguien editó el archivo.
    if (this.lastHostsSection !== null && current !== this.lastHostsSection && !this.hostsTamperReported) {
      this.hostsTamperReported = true;
      await this.agent.report('protection_disabled', { protection: 'Archivo hosts modificado (restaurado)' });
    }
    await this.deps.writeHosts(applyHostsSection(content, section));
    this.lastHostsSection = section;
  }

  private async checkClock(now: Date, mono: number): Promise<void> {
    if (this.lastWall) {
      const drift = now.getTime() - this.lastWall - (mono - this.lastMono);
      if (Math.abs(drift) > 2 * 60_000) await this.agent.report('time_changed', { driftMinutes: Math.round(drift / 60_000) });
    }
    this.lastWall = now.getTime();
    this.lastMono = mono;
  }

  private async checkSession(mono: number): Promise<void> {
    // Sólo si la app de sesión estuvo activa y dejó de reportar (si nadie ha iniciado sesión, no se alerta).
    if (this.foregroundAt && !this.sessionDownReported && mono - this.foregroundAt > 120_000) {
      this.sessionDownReported = true;
      await this.agent.report('agent_stopped', { component: 'session' });
    }
  }
}
