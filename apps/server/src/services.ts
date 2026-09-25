import {
  emptyUsage,
  localTime,
  policyInputSchema,
  randomSecret,
  ruleStatuses,
  type Override,
  type Platform,
  type Policy,
  type PolicyInput,
  type Target,
  type UsageState,
} from '@guardian/core';
import type { Db } from './db.js';
import type { Hub } from './hub.js';
import type { Notifier } from './notify.js';
import { deviceUnlockSecret, newId } from './security.js';

export class HttpError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

export interface ProfileRow {
  id: string;
  family_id: string;
  name: string;
  avatar: string | null;
  mode: 'supervised' | 'self';
  timezone: string;
  policy_json: string;
  policy_version: number;
  overrides_json: string;
  unlock_secret: string;
  created_at: number;
}

export interface DeviceRow {
  id: string;
  profile_id: string;
  name: string;
  platform: string;
  token_hash: string;
  agent_version: string | null;
  status_json: string;
  policy_version: number;
  last_seen: number | null;
  offline_alerted: number;
  created_at: number;
}

export interface RequestRow {
  id: string;
  profile_id: string;
  device_id: string | null;
  kind: 'unlock' | 'more_time' | 'new_app';
  rule_id: string | null;
  target_json: string | null;
  label: string;
  reason: string | null;
  minutes_requested: number;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  minutes_granted: number | null;
  decided_by: string | null;
  response_note: string | null;
  created_at: number;
  decided_at: number | null;
}

export interface EventRow {
  id: string;
  profile_id: string;
  device_id: string | null;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  data_json: string;
  read: number;
  created_at: number;
}

export const DEVICE_EVENT_TYPES = [
  'wrong_code',
  'code_used',
  'uninstall_attempt',
  'protection_disabled',
  'protection_restored',
  'time_changed',
  'safe_mode',
  'settings_attempt',
  'bypass_detected',
  'app_installed',
  'agent_stopped',
  'agent_started',
  'unlock_attempts',
] as const;
export type DeviceEventType = (typeof DEVICE_EVENT_TYPES)[number];
type EventType = DeviceEventType | 'device_offline' | 'device_online' | 'device_paired' | 'device_removed';

type EventData = Record<string, unknown>;
const str = (v: unknown, fallback = '') => (typeof v === 'string' || typeof v === 'number' ? String(v) : fallback);

/** Severidad y texto de cada tipo de evento (lo que ve el admin). */
const EVENT_INFO: Record<EventType, { severity: EventRow['severity']; message: (d: EventData) => string }> = {
  wrong_code: { severity: 'critical', message: (d) => `Intentaron desbloquear con un código incorrecto (${str(d.attempts, '1')} intentos)` },
  code_used: { severity: 'info', message: (d) => `Se usó un código de desbloqueo sin conexión (${str(d.minutes)} min)` },
  uninstall_attempt: { severity: 'critical', message: () => 'Intentaron desinstalar o desactivar Guardián' },
  protection_disabled: { severity: 'critical', message: (d) => `Se desactivó una protección: ${str(d.protection, 'desconocida')}` },
  protection_restored: { severity: 'info', message: (d) => `Protección restablecida: ${str(d.protection)}` },
  time_changed: { severity: 'warning', message: () => 'Se cambió la fecha, hora o zona horaria del dispositivo' },
  safe_mode: { severity: 'critical', message: () => 'El dispositivo arrancó en modo seguro (los bloqueos pueden no funcionar)' },
  settings_attempt: { severity: 'warning', message: (d) => `Intento de abrir ajustes protegidos${d.screen ? `: ${str(d.screen)}` : ''}` },
  bypass_detected: { severity: 'critical', message: (d) => `Se detectó una herramienta para saltarse el bloqueo: ${str(d.label, 'VPN/proxy')}` },
  app_installed: { severity: 'info', message: (d) => `Se instaló una app: ${str(d.label ?? d.id)}` },
  agent_stopped: { severity: 'critical', message: () => 'El agente de bloqueo se detuvo' },
  agent_started: { severity: 'info', message: () => 'El agente de bloqueo se inició' },
  unlock_attempts: { severity: 'warning', message: (d) => `Intentó abrir ${str(d.label, 'algo bloqueado')} ${str(d.count, 'varias')} veces estando bloqueado` },
  device_offline: { severity: 'warning', message: (d) => `El dispositivo lleva ${str(d.minutes)} min sin conectarse (¿apagado, sin internet o desinstalado?)` },
  device_online: { severity: 'info', message: () => 'El dispositivo volvió a conectarse' },
  device_paired: { severity: 'info', message: (d) => `Nuevo dispositivo vinculado: ${str(d.name)}` },
  device_removed: { severity: 'warning', message: (d) => `Dispositivo desvinculado: ${str(d.name)}` },
};

export const PENDING_APPS_RULE_ID = 'pending-new-apps';

export interface UsageReport {
  day: string;
  rules: Record<string, { usedMs: number; opens: number; intervalUsedMs?: number; breakUntil?: number }>;
  items: { key: string; label: string; usedMs: number; opens: number; blockedAttempts?: number }[];
}

export class Services {
  constructor(
    private readonly db: Db,
    private readonly hub: Hub,
    private readonly notifier: Notifier,
  ) {}

  // ---------------------------------------------------------------- perfiles

  createProfile(familyId: string, input: { name: string; mode: 'supervised' | 'self'; timezone: string; avatar?: string }): ProfileRow {
    const id = newId('prf');
    const policy = policyInputSchema.parse({});
    this.db.run(
      `INSERT INTO profiles (id, family_id, name, avatar, mode, timezone, policy_json, unlock_secret, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      familyId,
      input.name,
      input.avatar ?? null,
      input.mode,
      input.timezone,
      JSON.stringify(policy),
      randomSecret(),
      Date.now(),
    );
    return this.profile(familyId, id);
  }

  profile(familyId: string, id: string): ProfileRow {
    const row = this.db.get<ProfileRow>('SELECT * FROM profiles WHERE id = ? AND family_id = ?', id, familyId);
    if (!row) throw new HttpError(404, 'Perfil no encontrado');
    return row;
  }

  profileById(id: string): ProfileRow {
    const row = this.db.get<ProfileRow>('SELECT * FROM profiles WHERE id = ?', id);
    if (!row) throw new HttpError(404, 'Perfil no encontrado');
    return row;
  }

  policyInput(p: ProfileRow): PolicyInput {
    return policyInputSchema.parse(JSON.parse(p.policy_json));
  }

  overrides(p: ProfileRow, now = Date.now()): Override[] {
    const today = localTime(new Date(now), p.timezone).day;
    return (JSON.parse(p.overrides_json) as Override[]).filter((o) => (o.type === 'bonus' ? o.day >= today : Date.parse(o.until) > now));
  }

  policy(p: ProfileRow): Policy {
    return { ...this.policyInput(p), version: p.policy_version, profileId: p.id, timezone: p.timezone, overrides: this.overrides(p) };
  }

  /** Incrementa la versión y avisa a dispositivos y paneles. */
  private policyChanged(profileId: string): void {
    this.db.run('UPDATE profiles SET policy_version = policy_version + 1 WHERE id = ?', profileId);
    const p = this.profileById(profileId);
    const msg = { type: 'policy', profileId, version: p.policy_version } as const;
    for (const d of this.db.all<{ id: string }>('SELECT id FROM devices WHERE profile_id = ?', profileId)) this.hub.toDevice(d.id, msg);
    this.hub.toFamily(p.family_id, msg);
  }

  /**
   * Guarda la política. En modo autocontrol con espera configurada, los cambios
   * que la relajan quedan pendientes hasta que pase el tiempo de espera.
   */
  savePolicy(p: ProfileRow, input: PolicyInput, accountId: string): { applied: boolean; applyAt?: number } {
    const ids = input.rules.map((r) => r.id);
    if (new Set(ids).size !== ids.length) throw new HttpError(400, 'Hay reglas con el mismo id');
    const current = this.policyInput(p);
    const cooldown = current.settings.relaxCooldownMinutes;
    if (p.mode === 'self' && cooldown > 0 && isRelaxing(current, input)) {
      const applyAt = Date.now() + cooldown * 60_000;
      this.db.run(
        'INSERT INTO pending_changes (id, profile_id, kind, payload_json, apply_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        newId('chg'),
        p.id,
        'policy',
        JSON.stringify(input),
        applyAt,
        accountId,
        Date.now(),
      );
      return { applied: false, applyAt };
    }
    this.writePolicy(p.id, input);
    return { applied: true };
  }

  private writePolicy(profileId: string, input: PolicyInput): void {
    this.db.run('UPDATE profiles SET policy_json = ? WHERE id = ?', JSON.stringify(input), profileId);
    this.policyChanged(profileId);
  }

  addOverride(p: ProfileRow, override: Override, accountId: string | null): { applied: boolean; applyAt?: number } {
    const cooldown = this.policyInput(p).settings.relaxCooldownMinutes;
    if (p.mode === 'self' && cooldown > 0 && override.type !== 'lock' && accountId) {
      const applyAt = Date.now() + cooldown * 60_000;
      this.db.run(
        'INSERT INTO pending_changes (id, profile_id, kind, payload_json, apply_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        newId('chg'),
        p.id,
        'override',
        JSON.stringify(override),
        applyAt,
        accountId,
        Date.now(),
      );
      return { applied: false, applyAt };
    }
    this.writeOverride(p.id, override);
    return { applied: true };
  }

  private writeOverride(profileId: string, override: Override): void {
    const p = this.profileById(profileId);
    // "Liberar" y "bloquear ya" se sustituyen entre sí: sólo uno a la vez.
    const keep = this.overrides(p).filter((o) => !((override.type === 'pause' || override.type === 'lock') && (o.type === 'pause' || o.type === 'lock')));
    this.db.run('UPDATE profiles SET overrides_json = ? WHERE id = ?', JSON.stringify([...keep, override]), profileId);
    this.policyChanged(profileId);
  }

  removeOverride(p: ProfileRow, overrideId: string): void {
    const list = this.overrides(p);
    const next = list.filter((o) => o.id !== overrideId);
    if (next.length === list.length) throw new HttpError(404, 'Excepción no encontrada');
    this.db.run('UPDATE profiles SET overrides_json = ? WHERE id = ?', JSON.stringify(next), p.id);
    this.policyChanged(p.id);
  }

  pendingChanges(profileId: string) {
    return this.db
      .all<{ id: string; kind: string; payload_json: string; apply_at: number; created_at: number }>(
        'SELECT id, kind, payload_json, apply_at, created_at FROM pending_changes WHERE profile_id = ? ORDER BY apply_at',
        profileId,
      )
      .map((r) => ({ id: r.id, kind: r.kind, payload: JSON.parse(r.payload_json) as unknown, applyAt: r.apply_at, createdAt: r.created_at }));
  }

  cancelPendingChange(profileId: string, id: string): void {
    if (this.db.run('DELETE FROM pending_changes WHERE id = ? AND profile_id = ?', id, profileId).changes === 0) {
      throw new HttpError(404, 'Cambio pendiente no encontrado');
    }
  }

  // ------------------------------------------------------------- dispositivos

  device(id: string): DeviceRow {
    const row = this.db.get<DeviceRow>('SELECT * FROM devices WHERE id = ?', id);
    if (!row) throw new HttpError(404, 'Dispositivo no encontrado');
    return row;
  }

  publicDevice(d: DeviceRow) {
    return {
      id: d.id,
      profileId: d.profile_id,
      name: d.name,
      platform: d.platform,
      agentVersion: d.agent_version,
      status: JSON.parse(d.status_json) as Record<string, unknown>,
      policyVersion: d.policy_version,
      lastSeen: d.last_seen,
      online: this.hub.isDeviceConnected(d.id),
      createdAt: d.created_at,
    };
  }

  /** Lo que el agente descarga: política, uso de los demás dispositivos y su secreto de códigos. */
  deviceBundle(d: DeviceRow) {
    const p = this.profileById(d.profile_id);
    const policy = this.policy(p);
    const day = localTime(new Date(), p.timezone).day;
    const others = this.aggregateUsage(p.id, day, d.id);
    this.db.run('UPDATE devices SET policy_version = ? WHERE id = ?', policy.version, d.id);
    return {
      profile: { id: p.id, name: p.name, mode: p.mode },
      device: { id: d.id, name: d.name, platform: d.platform },
      policy,
      othersUsage: others,
      unlockSecret: deviceUnlockSecret(p.unlock_secret, d.id),
      serverTime: new Date().toISOString(),
    };
  }

  touchDevice(d: DeviceRow, status?: Record<string, unknown>, agentVersion?: string): void {
    const wasOffline = d.offline_alerted === 1;
    this.db.run(
      'UPDATE devices SET last_seen = ?, offline_alerted = 0, status_json = COALESCE(?, status_json), agent_version = COALESCE(?, agent_version) WHERE id = ?',
      Date.now(),
      status ? JSON.stringify(status) : null,
      agentVersion ?? null,
      d.id,
    );
    if (wasOffline) this.recordEvent(d.profile_id, d.id, 'device_online', {});
    if (status || wasOffline) this.hub.toFamily(this.profileById(d.profile_id).family_id, { type: 'device', device: this.publicDevice(this.device(d.id)) });
  }

  // --------------------------------------------------------------------- uso

  /** Guarda los totales del día que reporta un dispositivo (idempotente). */
  saveUsage(d: DeviceRow, report: UsageReport): void {
    this.db.transaction(() => {
      for (const [ruleId, u] of Object.entries(report.rules)) {
        this.db.run(
          `INSERT INTO usage_rules (device_id, profile_id, day, rule_id, used_ms, opens, interval_used_ms, break_until) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(device_id, day, rule_id) DO UPDATE SET used_ms = MAX(used_ms, excluded.used_ms), opens = MAX(opens, excluded.opens),
             interval_used_ms = excluded.interval_used_ms, break_until = excluded.break_until`,
          d.id,
          d.profile_id,
          report.day,
          ruleId,
          Math.round(u.usedMs),
          u.opens,
          Math.round(u.intervalUsedMs ?? 0),
          u.breakUntil ?? null,
        );
      }
      for (const it of report.items) {
        this.db.run(
          `INSERT INTO usage_items (device_id, profile_id, day, item_key, label, used_ms, opens, blocked_attempts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(device_id, day, item_key) DO UPDATE SET label = excluded.label, used_ms = MAX(used_ms, excluded.used_ms),
             opens = MAX(opens, excluded.opens), blocked_attempts = MAX(blocked_attempts, excluded.blocked_attempts)`,
          d.id,
          d.profile_id,
          report.day,
          it.key,
          it.label,
          Math.round(it.usedMs),
          it.opens,
          it.blockedAttempts ?? 0,
        );
      }
    });
    this.hub.toFamily(this.profileById(d.profile_id).family_id, { type: 'usage', profileId: d.profile_id });
  }

  aggregateUsage(profileId: string, day: string, excludeDeviceId?: string): UsageState {
    const rows = this.db.all<{ rule_id: string; used_ms: number; opens: number; interval_used_ms: number; break_until: number | null }>(
      `SELECT rule_id, SUM(used_ms) AS used_ms, SUM(opens) AS opens, MAX(interval_used_ms) AS interval_used_ms, MAX(break_until) AS break_until
       FROM usage_rules WHERE profile_id = ? AND day = ? AND device_id != ? GROUP BY rule_id`,
      profileId,
      day,
      excludeDeviceId ?? '',
    );
    const usage = emptyUsage(day);
    for (const r of rows) {
      usage.rules[r.rule_id] = { usedMs: r.used_ms, opens: r.opens, intervalUsedMs: r.interval_used_ms, breakUntil: r.break_until ?? undefined };
    }
    return usage;
  }

  usageSummary(p: ProfileRow, day?: string) {
    const d = day ?? localTime(new Date(), p.timezone).day;
    const usage = this.aggregateUsage(p.id, d);
    const items = this.db.all<{ item_key: string; label: string; used_ms: number; opens: number; blocked_attempts: number }>(
      `SELECT item_key, MAX(label) AS label, SUM(used_ms) AS used_ms, SUM(opens) AS opens, SUM(blocked_attempts) AS blocked_attempts
       FROM usage_items WHERE profile_id = ? AND day = ? GROUP BY item_key ORDER BY used_ms DESC LIMIT 50`,
      p.id,
      d,
    );
    const byDevice = this.db.all<{ device_id: string; used_ms: number }>(
      'SELECT device_id, SUM(used_ms) AS used_ms FROM usage_items WHERE profile_id = ? AND day = ? GROUP BY device_id',
      p.id,
      d,
    );
    return {
      day: d,
      totalMs: items.reduce((s, i) => s + i.used_ms, 0),
      rules: ruleStatuses(this.policy(p), usage, new Date()),
      items: items.map((i) => ({ key: i.item_key, label: i.label, usedMs: i.used_ms, opens: i.opens, blockedAttempts: i.blocked_attempts })),
      devices: byDevice.map((r) => ({ deviceId: r.device_id, usedMs: r.used_ms })),
    };
  }

  usageHistory(p: ProfileRow, days: number) {
    const today = localTime(new Date(), p.timezone).day;
    const from = new Date(Date.parse(`${today}T12:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    const rows = this.db.all<{ day: string; used_ms: number }>(
      'SELECT day, SUM(used_ms) AS used_ms FROM usage_items WHERE profile_id = ? AND day >= ? GROUP BY day ORDER BY day',
      p.id,
      from,
    );
    const map = new Map(rows.map((r) => [r.day, r.used_ms]));
    const out: { day: string; usedMs: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const day = new Date(Date.parse(`${today}T12:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10);
      out.push({ day, usedMs: map.get(day) ?? 0 });
    }
    return out;
  }

  // ---------------------------------------------------------------- eventos

  recordEvent(profileId: string, deviceId: string | null, type: EventType, data: EventData): EventRow {
    const info = EVENT_INFO[type];
    const row: EventRow = {
      id: newId('evt'),
      profile_id: profileId,
      device_id: deviceId,
      type,
      severity: info.severity,
      message: info.message(data),
      data_json: JSON.stringify(data),
      read: 0,
      created_at: Date.now(),
    };
    this.db.run(
      'INSERT INTO events (id, profile_id, device_id, type, severity, message, data_json, read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)',
      row.id,
      row.profile_id,
      row.device_id,
      row.type,
      row.severity,
      row.message,
      row.data_json,
      row.created_at,
    );
    const p = this.profileById(profileId);
    this.hub.toFamily(p.family_id, { type: 'event', event: this.publicEvent(row) });
    if (row.severity !== 'info') {
      const deviceName = deviceId ? this.db.get<{ name: string }>('SELECT name FROM devices WHERE id = ?', deviceId)?.name : undefined;
      void this.notifier.alertFamily(p.family_id, {
        title: `${row.severity === 'critical' ? '⚠️ ' : ''}${p.name}${deviceName ? ` · ${deviceName}` : ''}`,
        body: row.message,
        url: `/#/alertas`,
        tag: `evt-${type}-${deviceId ?? p.id}`,
        severity: row.severity,
      });
    }
    return row;
  }

  publicEvent(e: EventRow) {
    return {
      id: e.id,
      profileId: e.profile_id,
      deviceId: e.device_id,
      type: e.type,
      severity: e.severity,
      message: e.message,
      data: JSON.parse(e.data_json) as EventData,
      read: e.read === 1,
      createdAt: e.created_at,
    };
  }

  /** Evento reportado por un agente. Algunos disparan acciones automáticas. */
  deviceEvent(d: DeviceRow, type: DeviceEventType, data: EventData): EventRow {
    const event = this.recordEvent(d.profile_id, d.id, type, data);
    if (type === 'app_installed' && typeof data.id === 'string') {
      const p = this.profileById(d.profile_id);
      if (this.policyInput(p).settings.approveNewApps) this.holdNewApp(p, d, data.id, str(data.label, data.id));
    }
    return event;
  }

  /** Bloquea una app recién instalada y crea una solicitud de aprobación. */
  private holdNewApp(p: ProfileRow, d: DeviceRow, appId: string, label: string): void {
    const input = this.policyInput(p);
    const target: Target = { kind: 'app', id: appId, platform: d.platform as Platform, label };
    let rule = input.rules.find((r) => r.id === PENDING_APPS_RULE_ID);
    if (!rule) {
      rule = { id: PENDING_APPS_RULE_ID, name: 'Apps nuevas por aprobar', enabled: true, mode: 'always', targets: [], exceptions: [], strict: false };
      input.rules.push(rule);
    }
    if (!rule.targets.some((t) => t.kind === 'app' && t.id === appId)) rule.targets.push(target);
    this.writePolicy(p.id, input);
    this.createRequest(p, d, { kind: 'new_app', target, label, reason: 'App instalada', minutes: 0 });
  }

  // ------------------------------------------------------------ solicitudes

  createRequest(
    p: ProfileRow,
    d: DeviceRow | null,
    input: { kind: RequestRow['kind']; ruleId?: string; target?: Target; label: string; reason?: string; minutes: number },
  ): RequestRow {
    if (input.kind !== 'new_app') {
      const settings = this.policyInput(p).settings;
      if (!settings.unlockRequestsEnabled) throw new HttpError(403, 'Las solicitudes de desbloqueo están desactivadas');
      const rule = input.ruleId ? this.policyInput(p).rules.find((r) => r.id === input.ruleId) : undefined;
      if (rule?.strict) throw new HttpError(403, 'Esta regla no admite solicitudes');
      const recent = this.db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM requests WHERE profile_id = ? AND status = 'pending' AND created_at > ?",
        p.id,
        Date.now() - 3600_000,
      );
      if ((recent?.n ?? 0) >= 10) throw new HttpError(429, 'Demasiadas solicitudes pendientes');
    }
    const row: RequestRow = {
      id: newId('req'),
      profile_id: p.id,
      device_id: d?.id ?? null,
      kind: input.kind,
      rule_id: input.ruleId ?? null,
      target_json: input.target ? JSON.stringify(input.target) : null,
      label: input.label,
      reason: input.reason ?? null,
      minutes_requested: input.minutes,
      status: 'pending',
      minutes_granted: null,
      decided_by: null,
      response_note: null,
      created_at: Date.now(),
      decided_at: null,
    };
    this.db.run(
      `INSERT INTO requests (id, profile_id, device_id, kind, rule_id, target_json, label, reason, minutes_requested, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      row.id,
      row.profile_id,
      row.device_id,
      row.kind,
      row.rule_id,
      row.target_json,
      row.label,
      row.reason,
      row.minutes_requested,
      row.created_at,
    );
    const pub = this.publicRequest(row);
    this.hub.toFamily(p.family_id, { type: 'request', request: pub });
    const what = input.kind === 'new_app' ? `quiere usar una app nueva: ${input.label}` : input.kind === 'more_time' ? `pide ${input.minutes} min más de ${input.label}` : `pide desbloquear ${input.label} por ${input.minutes} min`;
    void this.notifier.alertFamily(p.family_id, {
      title: `🔓 Solicitud de ${p.name}`,
      body: `${p.name} ${what}${input.reason ? `: “${input.reason}”` : ''}`,
      url: '/#/solicitudes',
      tag: `req-${row.id}`,
      severity: 'warning',
    });
    return row;
  }

  request(id: string): RequestRow {
    const row = this.db.get<RequestRow>('SELECT * FROM requests WHERE id = ?', id);
    if (!row) throw new HttpError(404, 'Solicitud no encontrada');
    return row;
  }

  publicRequest(r: RequestRow) {
    return {
      id: r.id,
      profileId: r.profile_id,
      deviceId: r.device_id,
      kind: r.kind,
      ruleId: r.rule_id,
      target: r.target_json ? (JSON.parse(r.target_json) as Target) : null,
      label: r.label,
      reason: r.reason,
      minutesRequested: r.minutes_requested,
      status: r.status,
      minutesGranted: r.minutes_granted,
      responseNote: r.response_note,
      createdAt: r.created_at,
      decidedAt: r.decided_at,
    };
  }

  decideRequest(p: ProfileRow, r: RequestRow, accountId: string, approve: boolean, minutes?: number, note?: string) {
    if (r.status !== 'pending') throw new HttpError(409, 'La solicitud ya fue respondida');
    let result: { applied: boolean; applyAt?: number } = { applied: true };
    const granted = approve ? (minutes ?? r.minutes_requested) : null;
    if (approve) {
      if (r.kind === 'new_app') {
        const input = this.policyInput(p);
        const target = r.target_json ? (JSON.parse(r.target_json) as Target) : null;
        const rule = input.rules.find((x) => x.id === PENDING_APPS_RULE_ID);
        if (rule && target?.kind === 'app') {
          rule.targets = rule.targets.filter((t) => !(t.kind === 'app' && t.id === target.id));
          input.rules = rule.targets.length ? input.rules : input.rules.filter((x) => x.id !== PENDING_APPS_RULE_ID);
          result = this.savePolicy(p, input, accountId);
        }
      } else if (r.kind === 'more_time' && r.rule_id) {
        const day = localTime(new Date(), p.timezone).day;
        result = this.addOverride(p, { id: newId('ovr'), type: 'bonus', day, minutes: granted!, ruleId: r.rule_id, note: `Solicitud: ${r.label}` }, accountId);
      } else {
        const until = new Date(Date.now() + granted! * 60_000).toISOString();
        const targets = r.target_json ? [JSON.parse(r.target_json) as Target] : undefined;
        result = this.addOverride(p, { id: newId('ovr'), type: 'unlock', until, ruleId: r.rule_id ?? undefined, targets, note: `Solicitud: ${r.label}` }, accountId);
      }
    }
    this.db.run(
      'UPDATE requests SET status = ?, minutes_granted = ?, decided_by = ?, response_note = ?, decided_at = ? WHERE id = ?',
      approve ? 'approved' : 'denied',
      granted,
      accountId,
      note ?? null,
      Date.now(),
      r.id,
    );
    const pub = this.publicRequest(this.request(r.id));
    this.hub.toFamily(p.family_id, { type: 'request', request: pub });
    if (r.device_id) this.hub.toDevice(r.device_id, { type: 'request', request: pub });
    return { request: pub, ...result };
  }

  // ------------------------------------------------------ tareas periódicas

  runJobs(now = Date.now()): void {
    // 1. Cambios diferidos (modo autocontrol) cuyo tiempo de espera ya pasó.
    for (const c of this.db.all<{ id: string; profile_id: string; kind: string; payload_json: string }>(
      'SELECT id, profile_id, kind, payload_json FROM pending_changes WHERE apply_at <= ?',
      now,
    )) {
      this.db.run('DELETE FROM pending_changes WHERE id = ?', c.id);
      const payload = JSON.parse(c.payload_json);
      if (c.kind === 'policy') this.writePolicy(c.profile_id, policyInputSchema.parse(payload));
      else this.writeOverride(c.profile_id, payload as Override);
    }

    // 2. Solicitudes sin respuesta por más de 24 h.
    this.db.run("UPDATE requests SET status = 'expired' WHERE status = 'pending' AND kind != 'new_app' AND created_at < ?", now - 24 * 3600_000);

    // 3. Dispositivos que dejaron de reportar (posible desinstalación o apagado).
    for (const p of this.db.all<ProfileRow>('SELECT * FROM profiles')) {
      const minutes = this.policyInput(p).settings.offlineAlertMinutes;
      const stale = this.db.all<DeviceRow>(
        'SELECT * FROM devices WHERE profile_id = ? AND offline_alerted = 0 AND last_seen IS NOT NULL AND last_seen < ?',
        p.id,
        now - minutes * 60_000,
      );
      for (const d of stale) {
        if (this.hub.isDeviceConnected(d.id)) continue;
        this.db.run('UPDATE devices SET offline_alerted = 1 WHERE id = ?', d.id);
        this.recordEvent(p.id, d.id, 'device_offline', { minutes: Math.round((now - (d.last_seen ?? now)) / 60_000) });
      }
      // 4. Limpieza de excepciones vencidas.
      const all = JSON.parse(p.overrides_json) as Override[];
      const alive = this.overrides(p, now);
      if (alive.length !== all.length) this.db.run('UPDATE profiles SET overrides_json = ? WHERE id = ?', JSON.stringify(alive), p.id);
    }
  }
}

const PROTECTIVE_SETTINGS = ['blockAdultContent', 'enforceSafeSearch', 'blockIncognito', 'preventUninstall', 'approveNewApps', 'blockBypassTools', 'protectSettings'] as const;

/** ¿El cambio hace la política menos estricta? */
export function isRelaxing(before: PolicyInput, after: PolicyInput): boolean {
  const afterRules = new Map(after.rules.map((r) => [r.id, JSON.stringify(r)]));
  for (const r of before.rules) {
    if (r.enabled && afterRules.get(r.id) !== JSON.stringify(r)) return true;
  }
  const beforeAllow = new Set(before.allowlist.map((t) => JSON.stringify(t)));
  if (after.allowlist.some((t) => !beforeAllow.has(JSON.stringify(t)))) return true;
  const b = before.settings;
  const a = after.settings;
  if (PROTECTIVE_SETTINGS.some((k) => b[k] && !a[k])) return true;
  if ((!b.unlockRequestsEnabled && a.unlockRequestsEnabled) || (!b.offlineCodesEnabled && a.offlineCodesEnabled)) return true;
  if (a.relaxCooldownMinutes < b.relaxCooldownMinutes) return true;
  return false;
}
