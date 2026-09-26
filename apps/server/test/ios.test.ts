import { generateKeyPairSync, verify } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, expect, it } from 'vitest';
import { ApnsWaker } from '../src/apns.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

let app: FastifyInstance;
afterEach(() => app?.close());

it('despierta al iPhone con push silencioso cuando cambia la política o se aprueba una solicitud', async () => {
  const woken: string[][] = [];
  ({ app } = await buildApp(
    { ...loadConfig({}), databasePath: ':memory:', webDist: undefined, tokenSecret: 't' },
    { deviceWaker: { wake: async (tokens) => (woken.push(tokens), { invalid: [] }) } },
  ));
  const call = async (method: string, url: string, token?: string, body?: unknown) =>
    (await app.inject({ method: method as 'GET', url, payload: body as object, headers: token ? { authorization: `Bearer ${token}` } : {} })).json();
  const { token } = await call('POST', '/api/auth/register', undefined, { email: 'a@x.com', password: '12345678', name: 'A' });
  const p = await call('POST', '/api/profiles', token, { name: 'Leo', timezone: 'UTC' });
  const { code } = await call('POST', `/api/profiles/${p.id}/pairing-codes`, token);
  const dev = await call('POST', '/api/device/pair', undefined, { code, name: 'iPhone', platform: 'ios' });
  const pushToken = 'ab'.repeat(32);
  await call('POST', '/api/device/heartbeat', dev.token, {
    pushToken,
    status: { protections: { screenTime: true, contentFilter: true }, iosSelections: { r1: { rule: 'Redes', apps: 3, categories: 1, webDomains: 0 } } },
  });
  expect(dev.catalog.services.find((s: { id: string }) => s.id === 'tiktok').apps).toEqual(['com.zhiliaoapp.musically']);

  await call('POST', `/api/profiles/${p.id}/overrides`, token, { type: 'lock', minutes: 30 });
  expect(woken.at(-1)).toEqual([pushToken]);

  await call('PUT', `/api/profiles/${p.id}/policy`, token, { rules: [{ id: 'r1', name: 'Redes', mode: 'always', targets: [{ kind: 'ip', ip: '203.0.113.0/24' }] }] });
  const bundle = await call('GET', '/api/device/bundle', dev.token);
  expect(bundle.policy.rules[0].targets[0]).toEqual({ kind: 'ip', ip: '203.0.113.0/24' });

  const ev = await call('POST', '/api/device/events', dev.token, { type: 'ios_selection_changed', data: { rule: 'Redes', apps: 2, categories: 0, webDomains: 1 } });
  expect(ev.message).toContain('2 apps');
  const devices = (await call('GET', `/api/profiles/${p.id}`, token)).devices;
  expect(devices[0].status.iosSelections.r1.apps).toBe(3);

  expect((await app.inject({ method: 'PUT', url: `/api/profiles/${p.id}/policy`, headers: { authorization: `Bearer ${token}` }, payload: { rules: [{ id: 'x', name: 'x', mode: 'always', targets: [{ kind: 'ip', ip: '999.1.1.1' }] }] } })).statusCode).toBe(400);
});

it('firma el token de APNs en ES256 con el formato que pide Apple', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const waker = new ApnsWaker({ keyId: 'KEY123', teamId: 'TEAM456', key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), bundleId: 'com.guardian.blocker', sandbox: true });
  const jwt = waker.jwt(1_800_000_000_000);
  const [h, pl, sig] = jwt.split('.');
  expect(JSON.parse(Buffer.from(h!, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'KEY123' });
  expect(JSON.parse(Buffer.from(pl!, 'base64url').toString())).toEqual({ iss: 'TEAM456', iat: 1_800_000_000 });
  expect(verify('sha256', Buffer.from(`${h}.${pl}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig!, 'base64url'))).toBe(true);
  expect(waker.jwt(1_800_000_000_000 + 60_000)).toBe(jwt);
});
