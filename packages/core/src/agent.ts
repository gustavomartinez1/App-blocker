import { getService, SERVICES } from './catalog.js';
import { verifyUnlockCode } from './codes.js';
import { currentWebBlockList, emptyUsage, ensureDay, evaluate, mergeUsage, recordOpen, recordUsage, ruleStatuses, type Decision, type UsageState } from './engine.js';
import { normalizeHost } from './match.js';
import type { EvalContext, Override, Platform, Policy, Subject, Target } from './schema.js';
import { localTime } from './time.js';

/**
 * Lógica común de los agentes escritos en TypeScript (escritorio y extensión
 * de navegador). Los agentes nativos de Android e iOS implementan lo mismo en
 * Kotlin y Swift siguiendo este archivo como referencia.
 *
 * Responsabilidades: vincular, sincronizar la política, llevar el uso local,
 * decidir bloqueos, pedir desbloqueos, validar códigos sin conexión y reportar
 * eventos de manipulación al servidor.
 */

export interface Bundle {
  profile: { id: string; name: string; mode: 'supervised' | 'self' };
  device: { id: string; name: string; platform: Platform };
  policy: Policy;
  othersUsage: UsageState;
  unlockSecret: string;
  serverTime: string;
}

export interface ItemUsage {
  label: string;
  usedMs: number;
  opens: number;
  blockedAttempts: number;
}

export interface AgentData {
  server: string;
  token: string;
  bundle: Bundle;
  usage: UsageState;
  items: { day: string; byKey: Record<string, ItemUsage> };
  /** Excepciones locales (códigos sin conexión). */
  localOverrides: Override[];
  /** Códigos ya usados (paso:código) para impedir reutilizarlos. */
  usedCodes: string[];
  wrongCodes: number;
  /** Acceso de administrador en el dispositivo (código de duración 0). */
  adminAccessUntil?: number;
  lastSyncAt?: number;
  /** Eventos pendientes de enviar (sin conexión). */
  outbox: { type: string; data: Record<string, unknown>; at: number }[];
}

export interface AgentStorage {
  load(): Promise<AgentData | null>;
  save(data: AgentData): Promise<void>;
}

export interface AgentOptions {
  platform: Platform;
  agentVersion: string;
  storage: AgentStorage;
  fetch?: typeof fetch;
  now?: () => Date;
}

export class NotPairedError extends Error {
  constructor() {
    super('El dispositivo no está vinculado');
  }
}

export function subjectKey(subject: Subject): string {
  return subject.type === 'app' ? `app:${subject.id}` : `web:${normalizeHost(subject.url)}`;
}

export function subjectLabel(subject: Subject): string {
  if (subject.type === 'web') return normalizeHost(subject.url);
  const svc = SERVICES.find((s) => s.apps[subject.platform]?.some((id) => id.toLowerCase() === subject.id.toLowerCase()));
  return svc?.name ?? subject.label ?? subject.id;
}

/** Objetivo más útil para pedir desbloqueo de un sujeto (servicio del catálogo si existe). */
export function subjectTarget(subject: Subject): Target {
  if (subject.type === 'web') {
    const host = normalizeHost(subject.url);
    const svc = SERVICES.find((s) => s.domains.some((d) => host === d || host.endsWith('.' + d)));
    return svc ? { kind: 'service', id: svc.id } : { kind: 'domain', domain: host };
  }
  const svc = SERVICES.find((s) => s.apps[subject.platform]?.some((id) => id.toLowerCase() === subject.id.toLowerCase()));
  return svc ? { kind: 'service', id: svc.id } : { kind: 'app', id: subject.id, platform: subject.platform, label: subject.label };
}

export const WRONG_CODE_ALERT_THRESHOLD = 3;

export class Agent {
  private data: AgentData | null = null;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;
  private socket: WebSocket | null = null;
  private listeners = new Set<() => void>();

  constructor(private readonly opts: AgentOptions) {
    this.fetchFn = opts.fetch ?? ((...args) => fetch(...args));
    this.now = opts.now ?? (() => new Date());
  }

  get ctx(): EvalContext {
    return { platform: this.opts.platform, deviceId: this.data?.bundle.device.id };
  }

  get paired(): boolean {
    return !!this.data;
  }

  get state(): Readonly<AgentData> {
    return this.d;
  }

  private get d(): AgentData {
    if (!this.data) throw new NotPairedError();
    return this.data;
  }

  /** Se llama cuando cambia la política o el uso (para refrescar la interfaz). */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  async init(): Promise<boolean> {
    this.data = await this.opts.storage.load();
    return !!this.data;
  }

  private async persist(): Promise<void> {
    if (this.data) await this.opts.storage.save(this.data);
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const d = this.d;
    const res = await this.fetchFn(`${d.server}${path}`, {
      method,
      headers: { authorization: `Bearer ${d.token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
    return json;
  }

  // ------------------------------------------------------------ vinculación

  async pair(server: string, code: string, name: string): Promise<Bundle> {
    const base = server.replace(/\/+$/, '');
    const res = await this.fetchFn(`${base}/api/device/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, name, platform: this.opts.platform, agentVersion: this.opts.agentVersion }),
    });
    const json = (await res.json()) as Bundle & { token: string; error?: string };
    if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
    const { token, ...bundle } = json;
    const day = localTime(this.now(), bundle.policy.timezone).day;
    this.data = {
      server: base,
      token,
      bundle,
      usage: emptyUsage(day),
      items: { day, byKey: {} },
      localOverrides: [],
      usedCodes: [],
      wrongCodes: 0,
      outbox: [],
      lastSyncAt: this.now().getTime(),
    };
    await this.persist();
    this.emit();
    return bundle;
  }

  // ------------------------------------------------------------ sincronización

  /** Descarga la política si cambió y envía uso y eventos pendientes. */
  async sync(): Promise<void> {
    const d = this.d;
    const res = await this.call<(Bundle & { unchanged?: false }) | { unchanged: true; version: number; othersUsage: UsageState }>(
      'GET',
      `/api/device/bundle?version=${d.bundle.policy.version}`,
    );
    if (res.unchanged) d.bundle.othersUsage = res.othersUsage;
    else d.bundle = res;
    d.lastSyncAt = this.now().getTime();
    await this.flush();
    await this.persist();
    this.emit();
  }

  /** Envía totales de uso del día y eventos acumulados sin conexión. */
  async flush(): Promise<void> {
    const d = this.d;
    const usage = this.localUsage();
    await this.call('POST', '/api/device/usage', {
      day: usage.day,
      rules: usage.rules,
      items: Object.entries(d.items.day === usage.day ? d.items.byKey : {}).map(([key, v]) => ({ key, ...v })),
    });
    while (d.outbox.length) {
      const ev = d.outbox[0]!;
      await this.call('POST', '/api/device/events', { type: ev.type, data: { ...ev.data, at: ev.at } });
      d.outbox.shift();
    }
  }

  async heartbeat(status: Record<string, unknown>): Promise<void> {
    await this.call('POST', '/api/device/heartbeat', { status, agentVersion: this.opts.agentVersion });
  }

  /** Conexión en vivo: el servidor avisa al instante de cambios de política. */
  connectLive(onError?: (e: unknown) => void): void {
    if (this.socket || !this.data || typeof WebSocket === 'undefined') return;
    const url = `${this.data.server.replace(/^http/, 'ws')}/api/ws?token=${encodeURIComponent(this.data.token)}`;
    const ws = new WebSocket(url);
    this.socket = ws;
    let retry = 0;
    ws.onopen = () => (retry = 0);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(String(e.data)) as { type: string };
        if (msg.type === 'policy' || msg.type === 'request') void this.sync().catch(onError);
      } catch (err) {
        onError?.(err);
      }
    };
    ws.onclose = () => {
      this.socket = null;
      if (this.data) setTimeout(() => this.connectLive(onError), Math.min(60_000, 2000 * 2 ** retry++));
    };
    ws.onerror = () => ws.close();
  }

  disconnectLive(): void {
    const ws = this.socket;
    this.socket = null;
    ws?.close();
  }

  // ------------------------------------------------------------ decisiones

  /** Política con las excepciones locales (códigos) añadidas. */
  policy(): Policy {
    const d = this.d;
    const t = this.now().getTime();
    const local = d.localOverrides.filter((o) => o.type === 'bonus' || Date.parse(o.until) > t);
    return { ...d.bundle.policy, overrides: [...d.bundle.policy.overrides, ...local] };
  }

  private localUsage(): UsageState {
    const d = this.d;
    d.usage = ensureDay(d.usage, this.now(), d.bundle.policy.timezone);
    return d.usage;
  }

  /** Uso de este dispositivo + el de los demás dispositivos del perfil. */
  usage(): UsageState {
    const local = this.localUsage();
    const others = this.d.bundle.othersUsage;
    return others.day === local.day ? mergeUsage(local, others) : local;
  }

  check(subject: Subject): Decision {
    return evaluate(this.policy(), this.usage(), subject, this.now(), this.ctx);
  }

  statuses() {
    return ruleStatuses(this.policy(), this.usage(), this.now(), this.ctx);
  }

  webBlockList() {
    return currentWebBlockList(this.policy(), this.usage(), this.now(), this.ctx);
  }

  private item(subject: Subject): ItemUsage {
    const d = this.d;
    const day = this.localUsage().day;
    if (d.items.day !== day) d.items = { day, byKey: {} };
    const key = subjectKey(subject);
    return (d.items.byKey[key] ??= { label: subjectLabel(subject), usedMs: 0, opens: 0, blockedAttempts: 0 });
  }

  /** El usuario abrió algo. Devuelve la decisión (con el conteo de aperturas ya aplicado). */
  async open(subject: Subject): Promise<Decision> {
    const d = this.d;
    d.usage = recordOpen(this.policy(), this.localUsage(), subject, this.now(), this.ctx);
    const decision = this.check(subject);
    const it = this.item(subject);
    if (decision.blocked) it.blockedAttempts++;
    else it.opens++;
    await this.persist();
    return decision;
  }

  /** Suma `ms` de uso en primer plano al sujeto. */
  async use(subject: Subject, ms: number): Promise<Decision> {
    const d = this.d;
    const before = this.check(subject);
    if (!before.blocked) {
      d.usage = recordUsage(this.policy(), this.localUsage(), subject, ms, this.now(), this.ctx);
      this.item(subject).usedMs += ms;
      await this.persist();
    }
    return this.check(subject);
  }

  // ------------------------------------------------------------ desbloqueos

  async requestUnlock(subject: Subject, decision: Decision, minutes: number, reason?: string): Promise<{ id: string }> {
    const kind = decision.mode === 'limit' ? 'more_time' : 'unlock';
    return this.call('POST', '/api/device/requests', {
      kind,
      ruleId: decision.ruleId,
      target: kind === 'unlock' ? subjectTarget(subject) : undefined,
      label: decision.ruleName && kind === 'more_time' ? decision.ruleName : subjectLabel(subject),
      reason,
      minutes,
    });
  }

  async requestStatus(id: string): Promise<{ status: string; minutesGranted: number | null }> {
    return this.call('GET', `/api/device/requests/${id}`);
  }

  /**
   * Valida un código sin conexión. Un código válido libera el dispositivo
   * (salvo reglas estrictas) durante su duración; el de duración 0 da acceso
   * de administrador por 10 minutos.
   */
  async enterCode(code: string): Promise<{ ok: true; minutes: number } | { ok: false; attempts: number }> {
    const d = this.d;
    if (!d.bundle.policy.settings.offlineCodesEnabled) return { ok: false, attempts: d.wrongCodes };
    const now = this.now();
    const v = await verifyUnlockCode(d.bundle.unlockSecret, code, now);
    const id = v ? `${v.step}:${code.replace(/\D/g, '')}` : '';
    if (!v || d.usedCodes.includes(id)) {
      d.wrongCodes++;
      if (d.wrongCodes % WRONG_CODE_ALERT_THRESHOLD === 0) await this.report('wrong_code', { attempts: d.wrongCodes });
      await this.persist();
      return { ok: false, attempts: d.wrongCodes };
    }
    d.wrongCodes = 0;
    d.usedCodes = [...d.usedCodes.slice(-50), id];
    if (v.minutes === 0) {
      d.adminAccessUntil = now.getTime() + 10 * 60_000;
    } else {
      d.localOverrides.push({ id: `code-${id}`, type: 'pause', until: new Date(now.getTime() + v.minutes * 60_000).toISOString(), note: 'Código sin conexión' });
    }
    await this.report('code_used', { minutes: v.minutes });
    await this.persist();
    this.emit();
    return { ok: true, minutes: v.minutes };
  }

  hasAdminAccess(): boolean {
    return (this.data?.adminAccessUntil ?? 0) > this.now().getTime();
  }

  // ------------------------------------------------------------ eventos

  /** Reporta un evento; si no hay conexión queda en cola. */
  async report(type: string, data: Record<string, unknown> = {}): Promise<void> {
    const d = this.d;
    try {
      await this.call('POST', '/api/device/events', { type, data });
    } catch {
      d.outbox.push({ type, data, at: this.now().getTime() });
      d.outbox = d.outbox.slice(-100);
      await this.persist();
    }
  }

  /** Nombre legible de un servicio del catálogo (para la interfaz). */
  static serviceName(id: string): string {
    return getService(id)?.name ?? id;
  }
}
