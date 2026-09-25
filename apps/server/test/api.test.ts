import { verifyUnlockCode, type Policy } from '@guardian/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type AppContext } from '../src/app.js';
import { loadConfig } from '../src/config.js';

let app: FastifyInstance;
let ctx: AppContext;
const pushes: { endpoint: string; payload: string }[] = [];

beforeEach(async () => {
  pushes.length = 0;
  const config = { ...loadConfig({}), databasePath: ':memory:', webDist: undefined, tokenSecret: 'test-secret' };
  ({ app, ctx } = await buildApp(config, { pushSender: { send: async (sub, payload) => void pushes.push({ endpoint: sub.endpoint, payload }) } }));
});

afterEach(async () => {
  await app.close();
});

async function call<T = any>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, token?: string, body?: unknown) {
  const res = await app.inject({ method, url, payload: body as object, headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
}

async function setup(mode: 'supervised' | 'self' = 'supervised') {
  const reg = await call('POST', '/api/auth/register', undefined, { email: 'mama@example.com', password: 'contraseña-segura', name: 'Mamá' });
  expect(reg.status).toBe(201);
  const admin = reg.body.token as string;
  const prof = await call('POST', '/api/profiles', admin, { name: 'Sofía', timezone: 'America/Mexico_City', mode });
  expect(prof.status).toBe(201);
  const profileId = prof.body.id as string;
  const pc = await call('POST', `/api/profiles/${profileId}/pairing-codes`, admin);
  const pair = await call('POST', '/api/device/pair', undefined, { code: pc.body.code.toLowerCase(), name: 'Celular de Sofía', platform: 'android' });
  expect(pair.status).toBe(201);
  return { admin, profileId, device: pair.body.token as string, deviceId: pair.body.device.id as string };
}

describe('cuentas', () => {
  it('registro, login y sesión', async () => {
    await call('POST', '/api/auth/register', undefined, { email: 'a@b.com', password: '12345678', name: 'A' });
    expect((await call('POST', '/api/auth/login', undefined, { email: 'a@b.com', password: 'mala-clave' })).status).toBe(401);
    const ok = await call('POST', '/api/auth/login', undefined, { email: 'A@B.com', password: '12345678' });
    expect(ok.status).toBe(200);
    const me = await call('GET', '/api/me', ok.body.token);
    expect(me.body.account.email).toBe('a@b.com');
    expect((await call('GET', '/api/me', 'basura')).status).toBe(401);
  });

  it('un admin no ve perfiles de otra familia', async () => {
    const { profileId } = await setup();
    const other = await call('POST', '/api/auth/register', undefined, { email: 'otro@example.com', password: '12345678', name: 'Otro' });
    expect((await call('GET', `/api/profiles/${profileId}`, other.body.token)).status).toBe(404);
  });
});

describe('política y dispositivos', () => {
  it('el dispositivo recibe la política y la versión cambia al editar', async () => {
    const { admin, profileId, device } = await setup();
    const b1 = await call('GET', '/api/device/bundle', device);
    expect(b1.body.policy.rules).toEqual([]);
    expect(b1.body.unlockSecret).toBeTruthy();

    const put = await call('PUT', `/api/profiles/${profileId}/policy`, admin, {
      rules: [{ id: 'r1', name: 'Redes', mode: 'limit', dailyMinutes: 60, targets: [{ kind: 'category', category: 'social' }] }],
    });
    expect(put.status).toBe(200);
    expect(put.body.applied).toBe(true);

    const b2 = await call('GET', `/api/device/bundle?version=${b1.body.policy.version}`, device);
    expect(b2.body.policy.version).toBe(b1.body.policy.version + 1);
    expect(b2.body.policy.rules[0].name).toBe('Redes');
    const b3 = await call('GET', `/api/device/bundle?version=${b2.body.policy.version}`, device);
    expect(b3.body.unchanged).toBe(true);
  });

  it('rechaza políticas inválidas', async () => {
    const { admin, profileId } = await setup();
    const bad = await call('PUT', `/api/profiles/${profileId}/policy`, admin, { rules: [{ id: 'x', name: 'x', mode: 'limit', targets: [] }] });
    expect(bad.status).toBe(400);
  });

  it('el código de vinculación es de un solo uso', async () => {
    const { admin, profileId } = await setup();
    const pc = await call('POST', `/api/profiles/${profileId}/pairing-codes`, admin);
    expect((await call('POST', '/api/device/pair', undefined, { code: pc.body.code, name: 'PC', platform: 'windows' })).status).toBe(201);
    expect((await call('POST', '/api/device/pair', undefined, { code: pc.body.code, name: 'PC2', platform: 'windows' })).status).toBe(400);
  });

  it('el uso se suma entre dispositivos', async () => {
    const { admin, profileId, device } = await setup();
    await call('PUT', `/api/profiles/${profileId}/policy`, admin, {
      rules: [{ id: 'r1', name: 'Redes', mode: 'limit', dailyMinutes: 60, targets: [{ kind: 'category', category: 'social' }] }],
    });
    const pc = await call('POST', `/api/profiles/${profileId}/pairing-codes`, admin);
    const laptop = (await call('POST', '/api/device/pair', undefined, { code: pc.body.code, name: 'Laptop', platform: 'windows' })).body.token;
    const day = (await call('GET', `/api/profiles/${profileId}/usage`, admin)).body.day;
    await call('POST', '/api/device/usage', device, { day, rules: { r1: { usedMs: 20 * 60_000, opens: 3 } }, items: [{ key: 'app:com.instagram.android', label: 'Instagram', usedMs: 20 * 60_000, opens: 3 }] });
    await call('POST', '/api/device/usage', laptop, { day, rules: { r1: { usedMs: 25 * 60_000, opens: 1 } }, items: [] });
    // Reenvío idempotente: no duplica.
    await call('POST', '/api/device/usage', laptop, { day, rules: { r1: { usedMs: 25 * 60_000, opens: 1 } }, items: [] });

    const bundle = await call('GET', '/api/device/bundle', device);
    expect(bundle.body.othersUsage.rules.r1.usedMs).toBe(25 * 60_000);
    const summary = await call('GET', `/api/profiles/${profileId}/usage`, admin);
    expect(summary.body.rules[0].usedMs).toBe(45 * 60_000);
    expect(summary.body.rules[0].remainingMs).toBe(15 * 60_000);
    expect(summary.body.items[0].label).toBe('Instagram');
    const hist = await call('GET', `/api/profiles/${profileId}/usage/history?days=7`, admin);
    expect(hist.body).toHaveLength(7);
    expect(hist.body[6].usedMs).toBe(20 * 60_000);
  });

  it('códigos sin conexión válidos para el secreto del dispositivo', async () => {
    const { admin, device, deviceId } = await setup();
    const secret = (await call('GET', '/api/device/bundle', device)).body.unlockSecret;
    const codes = await call('GET', `/api/devices/${deviceId}/unlock-codes`, admin);
    const c30 = codes.body.codes.find((c: { minutes: number }) => c.minutes === 30);
    expect(await verifyUnlockCode(secret, c30.code)).toMatchObject({ minutes: 30 });
  });
});

describe('solicitudes de desbloqueo', () => {
  it('el admin aprueba y el dispositivo recibe un desbloqueo temporal', async () => {
    const { admin, profileId, device } = await setup();
    await app.inject({ method: 'POST', url: '/api/push/subscribe', headers: { authorization: `Bearer ${admin}` }, payload: { endpoint: 'https://push.example/1', keys: { p256dh: 'k', auth: 'a' } } });
    await call('PUT', `/api/profiles/${profileId}/policy`, admin, {
      rules: [{ id: 'r1', name: 'Juegos', mode: 'always', targets: [{ kind: 'service', id: 'roblox' }] }],
    });
    const req = await call('POST', '/api/device/requests', device, { ruleId: 'r1', target: { kind: 'service', id: 'roblox' }, label: 'Roblox', reason: 'Ya hice la tarea', minutes: 30 });
    expect(req.status).toBe(201);
    await new Promise((r) => setTimeout(r, 10));
    expect(pushes.some((p) => p.payload.includes('Roblox'))).toBe(true);

    const pending = await call('GET', '/api/requests?status=pending', admin);
    expect(pending.body).toHaveLength(1);
    const dec = await call('POST', `/api/requests/${req.body.id}/decision`, admin, { approve: true, minutes: 20 });
    expect(dec.body.request.status).toBe('approved');
    expect(dec.body.request.minutesGranted).toBe(20);

    const bundle = await call('GET', '/api/device/bundle', device);
    const unlock = (bundle.body.policy as Policy).overrides.find((o) => o.type === 'unlock');
    expect(unlock).toMatchObject({ ruleId: 'r1' });
    expect((await call('POST', `/api/requests/${req.body.id}/decision`, admin, { approve: false })).status).toBe(409);
  });

  it('las reglas estrictas no admiten solicitudes', async () => {
    const { admin, profileId, device } = await setup();
    await call('PUT', `/api/profiles/${profileId}/policy`, admin, {
      rules: [{ id: 'r1', name: 'Adultos', mode: 'always', strict: true, targets: [{ kind: 'category', category: 'adult' }] }],
    });
    expect((await call('POST', '/api/device/requests', device, { ruleId: 'r1', label: 'x', minutes: 10 })).status).toBe(403);
  });

  it('pedir más tiempo crea minutos extra para hoy', async () => {
    const { admin, profileId, device } = await setup();
    await call('PUT', `/api/profiles/${profileId}/policy`, admin, {
      rules: [{ id: 'r1', name: 'YouTube', mode: 'limit', dailyMinutes: 30, targets: [{ kind: 'service', id: 'youtube' }] }],
    });
    const req = await call('POST', '/api/device/requests', device, { kind: 'more_time', ruleId: 'r1', label: 'YouTube', minutes: 15 });
    await call('POST', `/api/requests/${req.body.id}/decision`, admin, { approve: true });
    const summary = await call('GET', `/api/profiles/${profileId}/usage`, admin);
    expect(summary.body.rules[0].limitMs).toBe(45 * 60_000);
  });
});

describe('acciones rápidas y alertas', () => {
  it('liberar y bloquear ya se reemplazan entre sí', async () => {
    const { admin, profileId } = await setup();
    await call('POST', `/api/profiles/${profileId}/overrides`, admin, { type: 'pause', minutes: 60 });
    await call('POST', `/api/profiles/${profileId}/overrides`, admin, { type: 'lock', minutes: 30 });
    const p = await call('GET', `/api/profiles/${profileId}`, admin);
    expect(p.body.overrides.map((o: { type: string }) => o.type)).toEqual(['lock']);
    await call('DELETE', `/api/profiles/${profileId}/overrides/${p.body.overrides[0].id}`, admin);
    expect((await call('GET', `/api/profiles/${profileId}`, admin)).body.overrides).toEqual([]);
  });

  it('intentos de evasión generan alertas push al admin', async () => {
    const { admin, device } = await setup();
    await call('POST', '/api/push/subscribe', admin, { endpoint: 'https://push.example/2', keys: { p256dh: 'k', auth: 'a' } });
    const ev = await call('POST', '/api/device/events', device, { type: 'wrong_code', data: { attempts: 3 } });
    expect(ev.body.severity).toBe('critical');
    await new Promise((r) => setTimeout(r, 10));
    expect(pushes.at(-1)?.payload).toContain('código incorrecto');
    expect((await call('POST', '/api/device/events', device, { type: 'inventado' })).status).toBe(400);
    const events = await call('GET', '/api/events?unread=1', admin);
    expect(events.body.some((e: { type: string }) => e.type === 'wrong_code')).toBe(true);
    await call('POST', '/api/events/read', admin, {});
    expect((await call('GET', '/api/events?unread=1', admin)).body).toEqual([]);
  });

  it('avisa cuando un dispositivo deja de reportar', async () => {
    const { admin, deviceId } = await setup();
    ctx.db.run('UPDATE devices SET last_seen = ? WHERE id = ?', Date.now() - 3 * 3600_000, deviceId);
    ctx.services.runJobs();
    ctx.services.runJobs();
    const events = await call('GET', '/api/events', admin);
    expect(events.body.filter((e: { type: string }) => e.type === 'device_offline')).toHaveLength(1);
  });

  it('apps nuevas quedan bloqueadas hasta aprobarlas', async () => {
    const { admin, profileId, device } = await setup();
    const policy = (await call('GET', `/api/profiles/${profileId}/policy`, admin)).body.policy;
    await call('PUT', `/api/profiles/${profileId}/policy`, admin, { ...policy, settings: { ...policy.settings, approveNewApps: true } });
    await call('POST', '/api/device/events', device, { type: 'app_installed', data: { id: 'com.nuevo.juego', label: 'Juego Nuevo' } });
    let bundle = await call('GET', '/api/device/bundle', device);
    expect(bundle.body.policy.rules[0].targets[0]).toMatchObject({ kind: 'app', id: 'com.nuevo.juego' });
    const [req] = (await call('GET', '/api/requests?status=pending', admin)).body;
    expect(req.kind).toBe('new_app');
    await call('POST', `/api/requests/${req.id}/decision`, admin, { approve: true });
    bundle = await call('GET', '/api/device/bundle', device);
    expect(bundle.body.policy.rules).toEqual([]);
  });
});

describe('modo autocontrol', () => {
  it('los cambios que relajan esperan el tiempo configurado', async () => {
    const { admin, profileId } = await setup('self');
    const strict = {
      rules: [{ id: 'r1', name: 'Redes', mode: 'always', targets: [{ kind: 'category', category: 'social' }] }],
      settings: { relaxCooldownMinutes: 60 },
    };
    expect((await call('PUT', `/api/profiles/${profileId}/policy`, admin, strict)).body.applied).toBe(true);
    // Endurecer se aplica al momento.
    const stricter = { ...strict, rules: [...strict.rules, { id: 'r2', name: 'Juegos', mode: 'always', targets: [{ kind: 'category', category: 'games' }] }] };
    expect((await call('PUT', `/api/profiles/${profileId}/policy`, admin, stricter)).body.applied).toBe(true);
    // Quitar una regla queda en espera.
    const relaxed = await call('PUT', `/api/profiles/${profileId}/policy`, admin, strict);
    expect(relaxed.body.applied).toBe(false);
    expect(relaxed.body.policy.rules).toHaveLength(2);
    const pend = await call('GET', `/api/profiles/${profileId}/policy`, admin);
    expect(pend.body.pending).toHaveLength(1);
    // Cuando vence la espera se aplica.
    ctx.services.runJobs(Date.now() + 61 * 60_000);
    expect((await call('GET', `/api/profiles/${profileId}/policy`, admin)).body.policy.rules).toHaveLength(1);
  });
});
