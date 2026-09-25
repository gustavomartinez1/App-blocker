import { isEssential, matchesAny, ruleAppliesTo, ruleCovers, targetDomains } from './match.js';
import type { EvalContext, Override, Policy, Rule, RuleMode, Subject } from './schema.js';
import { MINUTE, formatDuration, localTime, nextLocalMidnight, windowState } from './time.js';

/** Uso acumulado de una regla en el día. */
export interface RuleUsage {
  /** Tiempo de uso hoy (reglas de límite). */
  usedMs: number;
  /** Aperturas hoy. */
  opens: number;
  /** Tiempo de uso en el ciclo actual (reglas de intervalo). */
  intervalUsedMs: number;
  /** Fin del descanso obligatorio en curso (epoch ms). */
  breakUntil?: number;
  /** Último momento de uso registrado (epoch ms). */
  lastUsedAt?: number;
}

export interface UsageState {
  day: string;
  rules: Record<string, RuleUsage>;
}

export type BlockMode = RuleMode | 'lock';

export interface Decision {
  blocked: boolean;
  /** Regla (o 'lock') responsable del bloqueo. */
  mode?: BlockMode;
  ruleId?: string;
  ruleName?: string;
  /** Hasta cuándo dura el bloqueo; null = indefinido. */
  until?: string | null;
  /** El usuario NO puede pedir desbloqueo ni usar códigos. */
  strict: boolean;
  /** Si está permitido pero hay límites en juego: tiempo restante antes de bloquearse. */
  remainingMs?: number;
  /** Por qué se permite, si aplica. */
  allowedBy?: 'essential' | 'allowlist' | 'pause' | 'unlock';
  message: string;
}

export interface RuleStatus {
  ruleId: string;
  name: string;
  mode: RuleMode;
  enabled: boolean;
  blocked: boolean;
  until: string | null;
  usedMs: number;
  limitMs?: number;
  remainingMs?: number;
  opens?: number;
  maxOpens?: number;
  /** Próximo inicio de bloqueo programado (horarios). */
  nextBlockAt?: string;
}

export function emptyUsage(day: string): UsageState {
  return { day, rules: {} };
}

function ruleUsage(usage: UsageState, ruleId: string): RuleUsage {
  return usage.rules[ruleId] ?? { usedMs: 0, opens: 0, intervalUsedMs: 0 };
}

/** Reinicia contadores si cambió el día local. Conserva descansos en curso. */
export function ensureDay(usage: UsageState, now: Date, timeZone: string): UsageState {
  const day = localTime(now, timeZone).day;
  if (usage.day === day) return usage;
  const rules: Record<string, RuleUsage> = {};
  for (const [id, u] of Object.entries(usage.rules)) {
    if (u.breakUntil && u.breakUntil > now.getTime()) {
      rules[id] = { usedMs: 0, opens: 0, intervalUsedMs: 0, breakUntil: u.breakUntil };
    }
  }
  return { day, rules };
}

/** Suma el uso de otros dispositivos (el servidor lo envía) al uso local. */
export function mergeUsage(a: UsageState, b: UsageState): UsageState {
  if (a.day !== b.day) return a.day > b.day ? a : b;
  const rules: Record<string, RuleUsage> = { ...a.rules };
  for (const [id, u] of Object.entries(b.rules)) {
    const x = rules[id];
    if (!x) {
      rules[id] = { ...u };
      continue;
    }
    rules[id] = {
      usedMs: x.usedMs + u.usedMs,
      opens: x.opens + u.opens,
      intervalUsedMs: Math.max(x.intervalUsedMs, u.intervalUsedMs),
      breakUntil: Math.max(x.breakUntil ?? 0, u.breakUntil ?? 0) || undefined,
      lastUsedAt: Math.max(x.lastUsedAt ?? 0, u.lastUsedAt ?? 0) || undefined,
    };
  }
  return { day: a.day, rules };
}

function activeOverrides(policy: Policy, now: Date): Override[] {
  const t = now.getTime();
  return policy.overrides.filter((o) => o.type === 'bonus' || Date.parse(o.until) > t);
}

function bonusMinutes(overrides: Override[], rule: Rule, day: string): number {
  let total = 0;
  for (const o of overrides) {
    if (o.type === 'bonus' && o.day === day && (!o.ruleId || o.ruleId === rule.id)) total += o.minutes;
  }
  return total;
}

export function limitMsFor(rule: Extract<Rule, { mode: 'limit' }>, weekday: number, bonus: number): number {
  const base = rule.perDay?.[String(weekday)] ?? rule.dailyMinutes;
  return (base + bonus) * MINUTE;
}

interface RuleState {
  blocked: boolean;
  until: Date | null;
  remainingMs?: number;
  nextBlockAt?: Date;
  limitMs?: number;
}

function computeRuleState(rule: Rule, policy: Policy, usage: UsageState, now: Date, overrides: Override[]): RuleState {
  const tz = policy.timezone;
  const u = ruleUsage(usage, rule.id);
  switch (rule.mode) {
    case 'always':
      return { blocked: true, until: null };
    case 'until': {
      const until = new Date(rule.until);
      return until > now ? { blocked: true, until } : { blocked: false, until: null };
    }
    case 'schedule': {
      const ws = windowState(rule.windows, now, tz);
      const inside = ws.active;
      if (rule.invert) {
        // Permitido sólo dentro de las ventanas.
        return inside
          ? { blocked: false, until: null, remainingMs: ws.endsAt ? ws.endsAt.getTime() - now.getTime() : undefined, nextBlockAt: ws.endsAt }
          : { blocked: true, until: ws.nextStart ?? null };
      }
      return inside ? { blocked: true, until: ws.endsAt ?? null } : { blocked: false, until: null, nextBlockAt: ws.nextStart };
    }
    case 'limit': {
      const lt = localTime(now, tz);
      const limitMs = limitMsFor(rule, lt.weekday, bonusMinutes(overrides, rule, lt.day));
      const midnight = nextLocalMidnight(now, tz);
      if (rule.maxOpens !== undefined && u.opens > rule.maxOpens) return { blocked: true, until: midnight, limitMs, remainingMs: 0 };
      if (u.usedMs >= limitMs) return { blocked: true, until: midnight, limitMs, remainingMs: 0 };
      return { blocked: false, until: null, limitMs, remainingMs: limitMs - u.usedMs };
    }
    case 'interval': {
      if (rule.windows?.length && !windowState(rule.windows, now, tz).active) return { blocked: false, until: null };
      if (u.breakUntil && u.breakUntil > now.getTime()) return { blocked: true, until: new Date(u.breakUntil) };
      return { blocked: false, until: null, remainingMs: Math.max(0, rule.useMinutes * MINUTE - u.intervalUsedMs) };
    }
  }
}

function blockMessage(mode: BlockMode, name: string | undefined, until: Date | null, now: Date): string {
  const left = until ? ` Se libera en ${formatDuration(until.getTime() - now.getTime())}.` : '';
  switch (mode) {
    case 'lock':
      return `El administrador bloqueó el dispositivo.${left}`;
    case 'always':
      return `Bloqueado por “${name}”.`;
    case 'schedule':
      return `Fuera del horario permitido (“${name}”).${left}`;
    case 'limit':
      return `Se terminó el tiempo de hoy para “${name}”.${left}`;
    case 'interval':
      return `Hora de descansar (“${name}”).${left}`;
    case 'until':
      return `Bloqueo temporal activo (“${name}”).${left}`;
  }
}

function untilRank(until: Date | null): number {
  return until === null ? Number.POSITIVE_INFINITY : until.getTime();
}

function unlockCovers(o: Override, rule: Rule | null, subject: Subject): boolean {
  if (o.type !== 'unlock') return false;
  if (o.targets?.length && matchesAny(o.targets, subject)) return true;
  return !!rule && o.ruleId === rule.id;
}

/**
 * Decide si un sujeto (app o URL) debe bloquearse ahora.
 *
 * Orden de precedencia:
 *  1. Apps esenciales (llamadas, SMS, emergencias) → siempre permitidas.
 *  2. Lista permitida del admin → permitido.
 *  3. Desbloqueos temporales concedidos por el admin → permitido.
 *  4. "Liberar dispositivo" (pause) → sólo siguen activas las reglas estrictas.
 *  5. "Bloquear ya" (lock) → bloqueado.
 *  6. Reglas: si cualquiera bloquea, se bloquea (se informa la más duradera).
 *
 * Para reglas con máximo de aperturas, llamar a recordOpen() ANTES de evaluar.
 */
export function evaluate(policy: Policy, usageIn: UsageState, subject: Subject, now: Date, ctx: EvalContext = {}): Decision {
  if (isEssential(subject)) return { blocked: false, strict: false, allowedBy: 'essential', message: 'App esencial' };
  if (matchesAny(policy.allowlist, subject)) return { blocked: false, strict: false, allowedBy: 'allowlist', message: 'Permitido siempre' };

  const usage = ensureDay(usageIn, now, policy.timezone);
  const overrides = activeOverrides(policy, now);
  const paused = overrides.find((o) => o.type === 'pause');
  const lock = overrides.find((o) => o.type === 'lock');
  const subjectUnlock = overrides.find((o) => unlockCovers(o, null, subject));

  let rules = policy.rules.filter((r) => ruleCovers(r, subject, ctx) && !overrides.some((o) => unlockCovers(o, r, subject)));
  if (paused) rules = rules.filter((r) => r.strict);

  let best: { rule: Rule | null; mode: BlockMode; until: Date | null; strict: boolean } | null = null;
  let remainingMs: number | undefined;

  if (lock && !paused && !subjectUnlock) {
    best = { rule: null, mode: 'lock', until: new Date(lock.until), strict: false };
  }

  let anyStrict = false;
  for (const rule of rules) {
    const st = computeRuleState(rule, policy, usage, now, overrides);
    if (st.blocked) {
      anyStrict ||= rule.strict;
      if (!best || untilRank(st.until) > untilRank(best.until)) {
        best = { rule, mode: rule.mode, until: st.until, strict: rule.strict };
      }
    } else if (st.remainingMs !== undefined) {
      remainingMs = remainingMs === undefined ? st.remainingMs : Math.min(remainingMs, st.remainingMs);
    }
  }

  if (best) {
    return {
      blocked: true,
      mode: best.mode,
      ruleId: best.rule?.id,
      ruleName: best.rule?.name,
      until: best.until ? best.until.toISOString() : null,
      strict: best.strict || anyStrict,
      message: blockMessage(best.mode, best.rule?.name, best.until, now),
    };
  }
  if (subjectUnlock) return { blocked: false, strict: false, allowedBy: 'unlock', remainingMs, message: 'Desbloqueo temporal' };
  if (paused) return { blocked: false, strict: false, allowedBy: 'pause', message: 'Dispositivo liberado por el administrador' };
  return { blocked: false, strict: false, remainingMs, message: 'Permitido' };
}

function updateRule(usage: UsageState, ruleId: string, fn: (u: RuleUsage) => RuleUsage): UsageState {
  return { ...usage, rules: { ...usage.rules, [ruleId]: fn(ruleUsage(usage, ruleId)) } };
}

/** Registra `deltaMs` de uso en primer plano del sujeto que termina en `now`. */
export function recordUsage(policy: Policy, usageIn: UsageState, subject: Subject, deltaMs: number, now: Date, ctx: EvalContext = {}): UsageState {
  if (deltaMs <= 0 || isEssential(subject) || matchesAny(policy.allowlist, subject)) return ensureDay(usageIn, now, policy.timezone);
  let usage = ensureDay(usageIn, now, policy.timezone);
  const t = now.getTime();
  for (const rule of policy.rules) {
    if (rule.mode !== 'limit' && rule.mode !== 'interval') continue;
    if (!ruleCovers(rule, subject, ctx)) continue;
    usage = updateRule(usage, rule.id, (u) => {
      const next: RuleUsage = { ...u, usedMs: u.usedMs + deltaMs, lastUsedAt: t };
      if (rule.mode === 'interval') {
        const breakMs = rule.breakMinutes * MINUTE;
        const idleMs = u.lastUsedAt ? t - deltaMs - u.lastUsedAt : 0;
        // Si ya descansó por su cuenta el tiempo del descanso, el ciclo empieza de cero.
        const base = idleMs >= breakMs || (u.breakUntil && u.breakUntil <= t - deltaMs) ? 0 : u.intervalUsedMs;
        const used = base + deltaMs;
        if (used >= rule.useMinutes * MINUTE) {
          next.intervalUsedMs = 0;
          next.breakUntil = t + breakMs;
        } else {
          next.intervalUsedMs = used;
        }
      }
      return next;
    });
  }
  return usage;
}

/** Registra que el sujeto se abrió (para reglas con máximo de aperturas). */
export function recordOpen(policy: Policy, usageIn: UsageState, subject: Subject, now: Date, ctx: EvalContext = {}): UsageState {
  let usage = ensureDay(usageIn, now, policy.timezone);
  for (const rule of policy.rules) {
    if (rule.mode !== 'limit' || rule.maxOpens === undefined || !ruleCovers(rule, subject, ctx)) continue;
    usage = updateRule(usage, rule.id, (u) => ({ ...u, opens: u.opens + 1 }));
  }
  return usage;
}

/** Estado de cada regla para mostrar en el panel o en el agente. */
export function ruleStatuses(policy: Policy, usageIn: UsageState, now: Date, ctx: EvalContext = {}): RuleStatus[] {
  const usage = ensureDay(usageIn, now, policy.timezone);
  const overrides = activeOverrides(policy, now);
  const paused = overrides.some((o) => o.type === 'pause');
  return policy.rules
    .filter((r) => ruleAppliesTo(r, ctx))
    .map((rule) => {
      const u = ruleUsage(usage, rule.id);
      const st = computeRuleState(rule, policy, usage, now, overrides);
      const unlocked = overrides.some((o) => o.type === 'unlock' && o.ruleId === rule.id);
      const blocked = rule.enabled && st.blocked && !unlocked && (!paused || rule.strict);
      return {
        ruleId: rule.id,
        name: rule.name,
        mode: rule.mode,
        enabled: rule.enabled,
        blocked,
        until: blocked && st.until ? st.until.toISOString() : null,
        usedMs: u.usedMs,
        limitMs: st.limitMs,
        remainingMs: st.remainingMs,
        opens: rule.mode === 'limit' && rule.maxOpens !== undefined ? u.opens : undefined,
        maxOpens: rule.mode === 'limit' ? rule.maxOpens : undefined,
        nextBlockAt: st.nextBlockAt?.toISOString(),
      };
    });
}

export interface WebBlockList {
  /** Bloquear todo el tráfico web salvo `allowedDomains`. */
  blockAll: boolean;
  blockedDomains: string[];
  allowedDomains: string[];
}

/**
 * Lista plana de dominios bloqueados AHORA, para mecanismos que sólo entienden
 * dominios (archivo hosts, DNS). Las reglas de URL/palabra clave requieren un
 * agente con visibilidad de URL (extensión de navegador, accesibilidad Android).
 */
export function currentWebBlockList(policy: Policy, usageIn: UsageState, now: Date, ctx: EvalContext = {}): WebBlockList {
  const usage = ensureDay(usageIn, now, policy.timezone);
  const overrides = activeOverrides(policy, now);
  const paused = overrides.some((o) => o.type === 'pause');
  const lock = !paused && overrides.some((o) => o.type === 'lock');
  const blocked = new Set<string>();
  const allowed = new Set<string>(policy.allowlist.flatMap(targetDomains));
  for (const o of overrides) if (o.type === 'unlock') o.targets?.flatMap(targetDomains).forEach((d) => allowed.add(d));
  let blockAll = lock;

  for (const rule of policy.rules) {
    if (!rule.enabled || !ruleAppliesTo(rule, ctx) || (paused && !rule.strict)) continue;
    if (overrides.some((o) => o.type === 'unlock' && o.ruleId === rule.id)) continue;
    if (!computeRuleState(rule, policy, usage, now, overrides).blocked) continue;
    const except = new Set(rule.exceptions.flatMap(targetDomains));
    if (rule.targets.some((t) => t.kind === 'all')) {
      blockAll = true;
      except.forEach((d) => allowed.add(d));
    }
    for (const d of rule.targets.flatMap(targetDomains)) if (!except.has(d)) blocked.add(d);
  }
  for (const d of allowed) blocked.delete(d);
  return { blockAll, blockedDomains: [...blocked].sort(), allowedDomains: [...allowed].sort() };
}
