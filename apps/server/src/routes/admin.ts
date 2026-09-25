import { CODE_DURATIONS, generateUnlockCode, isValidTimeZone, localTime, policyInputSchema, targetSchema, type Override } from '@guardian/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { deviceUnlockSecret, hashPassword, newId, newPairingCode, signAdminToken, verifyPassword } from '../security.js';
import { HttpError, type DeviceRow, type EventRow, type RequestRow } from '../services.js';

const email = z.string().trim().toLowerCase().email();
const password = z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(200);
const timezone = z.string().refine(isValidTimeZone, 'Zona horaria inválida');

const profileInput = z.object({
  name: z.string().trim().min(1).max(60),
  mode: z.enum(['supervised', 'self']).default('supervised'),
  timezone,
  avatar: z.string().max(16).optional(),
});

const overrideInput = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pause'), minutes: z.number().int().min(1).max(7 * 24 * 60), note: z.string().max(200).optional() }),
  z.object({ type: z.literal('lock'), minutes: z.number().int().min(1).max(7 * 24 * 60), note: z.string().max(200).optional() }),
  z.object({
    type: z.literal('unlock'),
    minutes: z.number().int().min(1).max(7 * 24 * 60),
    ruleId: z.string().optional(),
    targets: z.array(targetSchema).optional(),
    note: z.string().max(200).optional(),
  }),
  z.object({ type: z.literal('bonus'), minutes: z.number().int().min(1).max(24 * 60), ruleId: z.string().optional(), note: z.string().max(200).optional() }),
]);

/** Freno sencillo contra fuerza bruta en el inicio de sesión. */
const loginAttempts = new Map<string, { count: number; until: number }>();

export async function adminRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, services, notifier, config } = ctx;

  const session = (accountId: string, familyId: string) => {
    const account = db.get<{ id: string; email: string; name: string; role: string }>('SELECT id, email, name, role FROM accounts WHERE id = ?', accountId)!;
    const family = db.get<{ id: string; name: string }>('SELECT id, name FROM families WHERE id = ?', familyId)!;
    return { token: signAdminToken(config.tokenSecret, accountId, familyId), account, family };
  };

  // ------------------------------------------------------------ cuentas

  app.post('/api/auth/register', async (req, reply) => {
    const body = z.object({ email, password, name: z.string().trim().min(1).max(60), familyName: z.string().trim().min(1).max(60).optional() }).parse(req.body);
    if (db.get('SELECT id FROM accounts WHERE email = ?', body.email)) throw new HttpError(409, 'Ese correo ya está registrado');
    const familyId = newId('fam');
    const accountId = newId('acc');
    const hash = await hashPassword(body.password);
    db.transaction(() => {
      db.run('INSERT INTO families (id, name, created_at) VALUES (?, ?, ?)', familyId, body.familyName ?? `Familia de ${body.name}`, Date.now());
      db.run(
        'INSERT INTO accounts (id, family_id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        accountId,
        familyId,
        body.email,
        body.name,
        hash,
        'owner',
        Date.now(),
      );
    });
    return reply.status(201).send(session(accountId, familyId));
  });

  app.post('/api/auth/login', async (req) => {
    const body = z.object({ email, password: z.string() }).parse(req.body);
    const att = loginAttempts.get(body.email);
    if (att && att.count >= 5 && att.until > Date.now()) throw new HttpError(429, 'Demasiados intentos. Espera unos minutos.');
    const acc = db.get<{ id: string; family_id: string; password_hash: string }>('SELECT id, family_id, password_hash FROM accounts WHERE email = ?', body.email);
    if (!acc || !(await verifyPassword(body.password, acc.password_hash))) {
      loginAttempts.set(body.email, { count: (att && att.until > Date.now() ? att.count : 0) + 1, until: Date.now() + 15 * 60_000 });
      throw new HttpError(401, 'Correo o contraseña incorrectos');
    }
    loginAttempts.delete(body.email);
    return session(acc.id, acc.family_id);
  });

  app.get('/api/me', async (req) => {
    const { accountId, familyId } = ctx.requireAdmin(req);
    const { account, family } = session(accountId, familyId);
    return { account, family };
  });

  app.get('/api/family/admins', async (req) => {
    const { familyId } = ctx.requireAdmin(req);
    return db.all('SELECT id, email, name, role, created_at AS createdAt FROM accounts WHERE family_id = ? ORDER BY created_at', familyId);
  });

  /** Agregar otro administrador (p. ej. el otro padre o un tutor). */
  app.post('/api/family/admins', async (req, reply) => {
    const { accountId, familyId } = ctx.requireAdmin(req);
    const me = db.get<{ role: string }>('SELECT role FROM accounts WHERE id = ?', accountId);
    if (me?.role !== 'owner') throw new HttpError(403, 'Sólo el dueño de la cuenta puede agregar administradores');
    const body = z.object({ email, password, name: z.string().trim().min(1).max(60) }).parse(req.body);
    if (db.get('SELECT id FROM accounts WHERE email = ?', body.email)) throw new HttpError(409, 'Ese correo ya está registrado');
    const id = newId('acc');
    db.run(
      'INSERT INTO accounts (id, family_id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      familyId,
      body.email,
      body.name,
      await hashPassword(body.password),
      'admin',
      Date.now(),
    );
    return reply.status(201).send({ id, email: body.email, name: body.name, role: 'admin' });
  });

  app.delete<{ Params: { id: string } }>('/api/family/admins/:id', async (req) => {
    const { accountId, familyId } = ctx.requireAdmin(req);
    const me = db.get<{ role: string }>('SELECT role FROM accounts WHERE id = ?', accountId);
    if (me?.role !== 'owner' || req.params.id === accountId) throw new HttpError(403, 'No permitido');
    db.run("DELETE FROM accounts WHERE id = ? AND family_id = ? AND role = 'admin'", req.params.id, familyId);
    return { ok: true };
  });

  // ------------------------------------------------------------ perfiles

  const profileSummary = (p: ReturnType<typeof services.profile>) => {
    const devices = db.all<DeviceRow>('SELECT * FROM devices WHERE profile_id = ? ORDER BY created_at', p.id).map((d) => services.publicDevice(d));
    const pending = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM requests WHERE profile_id = ? AND status = 'pending'", p.id)?.n ?? 0;
    const unread = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM events WHERE profile_id = ? AND read = 0 AND severity != 'info'", p.id)?.n ?? 0;
    return {
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      mode: p.mode,
      timezone: p.timezone,
      policyVersion: p.policy_version,
      overrides: services.overrides(p),
      devices,
      pendingRequests: pending,
      unreadAlerts: unread,
      createdAt: p.created_at,
    };
  };

  app.get('/api/profiles', async (req) => {
    const { familyId } = ctx.requireAdmin(req);
    return db.all<{ id: string }>('SELECT id FROM profiles WHERE family_id = ? ORDER BY created_at', familyId).map((r) => profileSummary(services.profile(familyId, r.id)));
  });

  app.post('/api/profiles', async (req, reply) => {
    const { familyId } = ctx.requireAdmin(req);
    const p = services.createProfile(familyId, profileInput.parse(req.body));
    return reply.status(201).send(profileSummary(p));
  });

  app.get<{ Params: { id: string } }>('/api/profiles/:id', async (req) => {
    const { familyId } = ctx.requireAdmin(req);
    return profileSummary(services.profile(familyId, req.params.id));
  });

  app.patch<{ Params: { id: string } }>('/api/profiles/:id', async (req) => {
    const { familyId } = ctx.requireAdmin(req);
    const p = services.profile(familyId, req.params.id);
    const body = profileInput.partial().parse(req.body);
    db.run(
      'UPDATE profiles SET name = COALESCE(?, name), mode = COALESCE(?, mode), timezone = COALESCE(?, timezone), avatar = COALESCE(?, avatar) WHERE id = ?',
      body.name ?? null,
      body.mode ?? null,
      body.timezone ?? null,
      body.avatar ?? null,
      p.id,
    );
    return profileSummary(services.profile(familyId, p.id));
  });

  app.delete<{ Params: { id: string } }>('/api/profiles/:id', async (req) => {
    const { familyId } = ctx.requireAdmin(req);
    const p = services.profile(familyId, req.params.id);
    for (const d of db.all<{ id: string }>('SELECT id FROM devices WHERE profile_id = ?', p.id)) ctx.hub.disconnectDevice(d.id);
    db.run('DELETE FROM profiles WHERE id = ?', p.id);
    return { ok: true };
  });

  // ------------------------------------------------------------ política

  app.get<{ Params: { id: string } }>('/api/profiles/:id/policy', async (req) => {
    const { familyId } = ctx.requireAdmin(req);
    const p = services.profile(familyId, req.params.id);
    return { policy: services.policy(p), pending: services.pendingChanges(p.id) };
  });

  app.put<{ Params: { id: string } }>('/api/profiles/:id/policy', async (req) => {
    const { accountId, familyId } = ctx.requireAdmin(req);
    const p = services.profile(familyId, req.params.id);
    const result = services.savePolicy(p, policyInputSchema.parse(req.body), accountId);
    return { ...result, policy: services.policy(services.profile(familyId, p.id)) };
  });

  app.delete<{ Params: { id: string; changeId: string } }>('/api/profiles/:id/pending/:changeId', async (req) => {
    const { familyId } = ctx.requireAdmin(req);
    const p = services.profile(familyId, req.params.id);
    services.cancelPendingChange(p.id, req.params.changeId);
    return { ok: true };
  });

  /** Acciones rápidas: liberar, bloquear ya, desbloquear algo, dar tiempo extra. */
  app.post<{ Params: { id: string } }>('/api/profiles/:id/overrides', async (req, reply) => {
    const { accountId, familyId } = ctx.requireAdmin(req);
    const p = services.profile(familyId, req.params.id);
    const body = overrideInput.parse(req.body);
    const id = newId('ovr');
    const until = new Date(Date.now() + body.minutes * 60_000).toISOString();
    let override: Override;
    switch (body.type) {
      case 'pause':
      case 'lock':
        override = { id, type: body.type, until, note: body.note };
        break;
      case 'unlock':
        if (!body.ruleId && !body.targets?.length) throw new HttpError(400, 'Indica una regla o qué desbloquear');
        override = { id, type: 'unlock', until, ruleId: body.ruleId, targets: body.targets, note: body.note };
        break;
      case 'bonus':
        override = { id, type: 'bonus', day: localTime(new Date(), p.timezone).day, minutes: body.minutes, ruleId: body.ruleId, note: body.note };
        break;
    }
    const result = services.addOverride(p, override, accountId);
    return reply.status(201).send({ ...result, override });
  });

  app.delete<{ Params: { id: string; overrideId: string } }>('/api/profiles/:id/overrides/:overrideId', async (req) => {
    const { familyId } = ctx.requireAdmin(req);
    services.removeOverride(services.profile(familyId, req.params.id), req.params.overrideId);
    return { ok: true };
  });

  // ------------------------------------------------------------ uso

  app.get<{ Params: { id: string }; Querystring: { day?: string } }>('/api/profiles/:id/usage', async (req) => {
    const { familyId } = ctx.requireAdmin(req);
    const day = req.query.day && /^\d{4}-\d{2}-\d{2}$/.test(req.query.day) ? req.query.day : undefined;
    return services.usageSummary(services.profile(familyId, req.params.id), day);
  });

  app.get<{ Params: { id: string }; Querystring: { days?: string } }>('/api/profiles/:id/usage/history', async (req) => {
    const { familyId } = ctx.requireAdmin(req);
    const days = Math.min(Math.max(Number(req.query.days ?? 7) || 7, 1), 90);
    return services.usageHistory(services.profile(familyId, req.params.id), days);
  });

  // ------------------------------------------------------------ dispositivos

  app.post<{ Params: { id: string } }>('/api/profiles/:id/pairing-codes', async (req, reply) => {
    const { familyId } = ctx.requireAdmin(req);
    const p = services.profile(familyId, req.params.id);
    db.run('DELETE FROM pairing_codes WHERE expires_at < ?', Date.now());
    const code = newPairingCode();
    const expiresAt = Date.now() + 15 * 60_000;
    db.run('INSERT INTO pairing_codes (code, profile_id, expires_at) VALUES (?, ?, ?)', code, p.id, expiresAt);
    return reply.status(201).send({ code, expiresAt });
  });

  const familyDevice = (familyId: string, id: string) => {
    const d = services.device(id);
    services.profile(familyId, d.profile_id);
    return d;
  };

  app.patch<{ Params: { id: string } }>('/api/devices/:id', async (req) => {
    const { familyId } = ctx.requireAdmin(req);
    const d = familyDevice(familyId, req.params.id);
    const body = z.object({ name: z.string().trim().min(1).max(60) }).parse(req.body);
    db.run('UPDATE devices SET name = ? WHERE id = ?', body.name, d.id);
    return services.publicDevice(services.device(d.id));
  });

  app.delete<{ Params: { id: string } }>('/api/devices/:id', async (req) => {
    const { familyId } = ctx.requireAdmin(req);
    const d = familyDevice(familyId, req.params.id);
    services.recordEvent(d.profile_id, null, 'device_removed', { name: d.name });
    ctx.hub.disconnectDevice(d.id);
    db.run('DELETE FROM devices WHERE id = ?', d.id);
    return { ok: true };
  });

  /** Códigos sin conexión vigentes para un dispositivo. */
  app.get<{ Params: { id: string } }>('/api/devices/:id/unlock-codes', async (req) => {
    const { familyId } = ctx.requireAdmin(req);
    const d = familyDevice(familyId, req.params.id);
    const p = services.profileById(d.profile_id);
    if (!services.policyInput(p).settings.offlineCodesEnabled) throw new HttpError(403, 'Los códigos sin conexión están desactivados');
    const secret = deviceUnlockSecret(p.unlock_secret, d.id);
    const now = new Date();
    const stepEnd = (Math.floor(now.getTime() / 600_000) + 1) * 600_000;
    return {
      validUntil: stepEnd + 600_000,
      codes: await Promise.all(CODE_DURATIONS.map(async (minutes) => ({ minutes, code: await generateUnlockCode(secret, minutes, now) }))),
    };
  });

  // ------------------------------------------------------------ solicitudes

  app.get<{ Querystring: { status?: string; profileId?: string } }>('/api/requests', async (req) => {
    const { familyId } = ctx.requireAdmin(req);
    const status = z.enum(['pending', 'approved', 'denied', 'expired']).optional().parse(req.query.status);
    const rows = db.all<RequestRow>(
      `SELECT r.* FROM requests r JOIN profiles p ON p.id = r.profile_id
       WHERE p.family_id = ? AND (? IS NULL OR r.status = ?) AND (? IS NULL OR r.profile_id = ?)
       ORDER BY r.created_at DESC LIMIT 200`,
      familyId,
      status ?? null,
      status ?? null,
      req.query.profileId ?? null,
      req.query.profileId ?? null,
    );
    return rows.map((r) => services.publicRequest(r));
  });

  app.post<{ Params: { id: string } }>('/api/requests/:id/decision', async (req) => {
    const { accountId, familyId } = ctx.requireAdmin(req);
    const r = services.request(req.params.id);
    const p = services.profile(familyId, r.profile_id);
    const body = z
      .object({ approve: z.boolean(), minutes: z.number().int().min(1).max(24 * 60).optional(), note: z.string().max(200).optional() })
      .parse(req.body);
    return services.decideRequest(p, r, accountId, body.approve, body.minutes, body.note);
  });

  // ------------------------------------------------------------ alertas

  app.get<{ Querystring: { profileId?: string; unread?: string; limit?: string } }>('/api/events', async (req) => {
    const { familyId } = ctx.requireAdmin(req);
    const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
    const rows = db.all<EventRow>(
      `SELECT e.* FROM events e JOIN profiles p ON p.id = e.profile_id
       WHERE p.family_id = ? AND (? IS NULL OR e.profile_id = ?) AND (? = 0 OR e.read = 0)
       ORDER BY e.created_at DESC LIMIT ?`,
      familyId,
      req.query.profileId ?? null,
      req.query.profileId ?? null,
      req.query.unread === '1' ? 1 : 0,
      limit,
    );
    return rows.map((e) => services.publicEvent(e));
  });

  app.post('/api/events/read', async (req) => {
    const { familyId } = ctx.requireAdmin(req);
    const body = z.object({ ids: z.array(z.string()).optional() }).parse(req.body ?? {});
    if (body.ids?.length) {
      for (const id of body.ids) {
        db.run('UPDATE events SET read = 1 WHERE id = ? AND profile_id IN (SELECT id FROM profiles WHERE family_id = ?)', id, familyId);
      }
    } else {
      db.run('UPDATE events SET read = 1 WHERE profile_id IN (SELECT id FROM profiles WHERE family_id = ?)', familyId);
    }
    return { ok: true };
  });

  // ------------------------------------------------------------ notificaciones push

  app.get('/api/push/key', async () => ({ publicKey: notifier.publicKey }));

  app.post('/api/push/subscribe', async (req) => {
    const { accountId } = ctx.requireAdmin(req);
    const sub = z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) }).parse(req.body);
    notifier.subscribe(accountId, sub);
    return { ok: true };
  });

  app.post('/api/push/unsubscribe', async (req) => {
    ctx.requireAdmin(req);
    const { endpoint } = z.object({ endpoint: z.string() }).parse(req.body);
    notifier.unsubscribe(endpoint);
    return { ok: true };
  });

  // ------------------------------------------------------------ canales de aviso

  app.get('/api/notifications', async (req) => {
    const { accountId } = ctx.requireAdmin(req);
    const acc = db.get<{ telegram_chat_id: string | null; email_alerts: string; email: string }>(
      'SELECT telegram_chat_id, email_alerts, email FROM accounts WHERE id = ?',
      accountId,
    )!;
    return {
      telegram: { available: !!ctx.telegram, linked: !!acc.telegram_chat_id, bot: ctx.telegram?.username ?? null },
      email: { available: !!ctx.email, address: acc.email, level: acc.email_alerts },
    };
  });

  app.post('/api/notifications/telegram/link', async (req) => {
    const { accountId } = ctx.requireAdmin(req);
    if (!ctx.telegram) throw new HttpError(503, 'El servidor no tiene configurado un bot de Telegram');
    return ctx.telegram.createLink(accountId);
  });

  app.delete('/api/notifications/telegram', async (req) => {
    const { accountId } = ctx.requireAdmin(req);
    db.run('UPDATE accounts SET telegram_chat_id = NULL WHERE id = ?', accountId);
    return { ok: true };
  });

  app.put('/api/notifications/email', async (req) => {
    const { accountId } = ctx.requireAdmin(req);
    const { level } = z.object({ level: z.enum(['all', 'critical', 'off']) }).parse(req.body);
    db.run('UPDATE accounts SET email_alerts = ? WHERE id = ?', level, accountId);
    return { ok: true };
  });

  app.post('/api/push/test', async (req) => {
    const { familyId } = ctx.requireAdmin(req);
    await notifier.alertFamily(familyId, { title: 'Guardián', body: 'Las notificaciones funcionan ✅', url: '/#/' });
    return { ok: true };
  });
}
