import { Agent, generateUnlockCode, type AgentData } from '@guardian/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

let app: FastifyInstance;

beforeEach(async () => {
  ({ app } = await buildApp({ ...loadConfig({}), databasePath: ':memory:', webDist: undefined, tokenSecret: 't' }));
});
afterEach(() => app.close());

/** fetch que va directo a Fastify sin abrir puertos. */
const injectFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const res = await app.inject({
    method: (init?.method ?? 'GET') as 'GET',
    url: url.pathname + url.search,
    headers: init?.headers as Record<string, string>,
    payload: init?.body as string | undefined,
  });
  return new Response(res.body, { status: res.statusCode, headers: { 'content-type': 'application/json' } });
};

function memoryStorage() {
  let saved: AgentData | null = null;
  return { load: async () => saved, save: async (d: AgentData) => void (saved = structuredClone(d)) };
}

async function admin() {
  const call = async (method: string, url: string, token?: string, body?: unknown) =>
    (await app.inject({ method: method as 'GET', url, payload: body as object, headers: token ? { authorization: `Bearer ${token}` } : {} })).json();
  const { token } = await call('POST', '/api/auth/register', undefined, { email: 'p@x.com', password: '12345678', name: 'P' });
  const profile = await call('POST', '/api/profiles', token, { name: 'Leo', timezone: 'America/Mexico_City' });
  const { code } = await call('POST', `/api/profiles/${profile.id}/pairing-codes`, token);
  return { call, token: token as string, profileId: profile.id as string, code: code as string };
}

it('flujo completo de un agente: vincular, bloquear, pedir desbloqueo, códigos', async () => {
  const { call, token, profileId, code } = await admin();
  const agent = new Agent({ platform: 'windows', agentVersion: 'test', storage: memoryStorage(), fetch: injectFetch });
  await agent.pair('http://guardian.local', code, 'PC de Leo');

  await call('PUT', `/api/profiles/${profileId}/policy`, token, {
    rules: [{ id: 'games', name: 'Juegos', mode: 'always', targets: [{ kind: 'category', category: 'games' }] }],
  });
  await agent.sync();
  const roblox = { type: 'app', platform: 'windows', id: 'RobloxPlayerBeta.exe' } as const;
  const decision = await agent.open(roblox);
  expect(decision.blocked).toBe(true);
  expect(agent.webBlockList().blockedDomains).toContain('roblox.com');

  // Pide desbloqueo, el admin aprueba y el agente se entera al sincronizar.
  const req = await agent.requestUnlock(roblox, decision, 30, 'Tarea de computación');
  await call('POST', `/api/requests/${req.id}/decision`, token, { approve: true, minutes: 15 });
  await agent.sync();
  expect(agent.check(roblox).blocked).toBe(false);
  expect((await agent.requestStatus(req.id)).status).toBe('approved');

  // Uso y aperturas llegan al panel.
  await agent.use({ type: 'web', url: 'https://www.youtube.com/watch?v=1' }, 5 * 60_000);
  await agent.flush();
  const usage = await call('GET', `/api/profiles/${profileId}/usage`, token);
  expect(usage.items.find((i: { label: string }) => i.label === 'YouTube').usedMs).toBe(5 * 60_000);
  expect(usage.items.find((i: { label: string }) => i.label === 'Roblox').blockedAttempts).toBe(1);

  // 3 códigos incorrectos → alerta al admin.
  for (let i = 0; i < 3; i++) expect((await agent.enterCode('000000')).ok).toBe(false);
  const events = await call('GET', '/api/events', token);
  expect(events.some((e: { type: string }) => e.type === 'wrong_code')).toBe(true);

  // Código válido libera el dispositivo, y no se puede reutilizar.
  const valid = await generateUnlockCode(agent.state.bundle.unlockSecret, 60);
  expect(await agent.enterCode(valid)).toEqual({ ok: true, minutes: 60 });
  expect(agent.check({ type: 'app', platform: 'windows', id: 'steam.exe' }).allowedBy).toBe('pause');
  expect((await agent.enterCode(valid)).ok).toBe(false);
});

it('los eventos sin conexión se guardan y se envían después', async () => {
  const { call, token, code } = await admin();
  let offline = false;
  const flaky: typeof fetch = async (i, init) => {
    if (offline) throw new Error('sin red');
    return injectFetch(i, init);
  };
  const agent = new Agent({ platform: 'android', agentVersion: 'test', storage: memoryStorage(), fetch: flaky });
  await agent.pair('http://guardian.local', code, 'Cel');
  offline = true;
  await agent.report('time_changed', {});
  expect(agent.state.outbox).toHaveLength(1);
  offline = false;
  await agent.sync();
  expect(agent.state.outbox).toHaveLength(0);
  const events = await call('GET', '/api/events', token);
  expect(events.some((e: { type: string }) => e.type === 'time_changed')).toBe(true);
});
