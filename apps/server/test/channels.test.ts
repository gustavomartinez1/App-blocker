import type { FastifyInstance } from 'fastify';
import { afterEach, expect, it } from 'vitest';
import { buildApp, type AppContext } from '../src/app.js';
import { loadConfig } from '../src/config.js';

let app: FastifyInstance;
let ctx: AppContext;
const telegramCalls: { method: string; body: any }[] = [];
const mails: { to: string; subject: string }[] = [];

const telegramFetch: typeof fetch = async (url, init) => {
  const method = String(url).split('/').pop()!;
  telegramCalls.push({ method, body: JSON.parse(String(init?.body ?? '{}')) });
  const result = method === 'getMe' ? { username: 'GuardianTestBot' } : method === 'sendMessage' ? { message_id: 1 } : true;
  return new Response(JSON.stringify({ ok: true, result }));
};

afterEach(() => app?.close());

async function setup() {
  telegramCalls.length = 0;
  mails.length = 0;
  ({ app, ctx } = await buildApp(
    { ...loadConfig({}), databasePath: ':memory:', webDist: undefined, tokenSecret: 't', telegramBotToken: 'x', publicUrl: 'https://guardian.example' },
    { telegramFetch, mailTransport: { sendMail: async (m) => void mails.push(m) } },
  ));
  const call = async (method: string, url: string, token?: string, body?: unknown) =>
    (await app.inject({ method: method as 'GET', url, payload: body as object, headers: token ? { authorization: `Bearer ${token}` } : {} })).json();
  const { token } = await call('POST', '/api/auth/register', undefined, { email: 'papa@x.com', password: '12345678', name: 'Papá' });
  const profile = await call('POST', '/api/profiles', token, { name: 'Leo', timezone: 'UTC' });
  await call('PUT', `/api/profiles/${profile.id}/policy`, token, { rules: [{ id: 'j', name: 'Juegos', mode: 'always', targets: [{ kind: 'category', category: 'games' }] }] });
  const { code } = await call('POST', `/api/profiles/${profile.id}/pairing-codes`, token);
  const dev = await call('POST', '/api/device/pair', undefined, { code, name: 'Cel', platform: 'android' });
  return { call, token: token as string, device: dev.token as string };
}

it('Telegram: vincular, recibir la solicitud con botones y aprobarla desde el chat', async () => {
  const { call, token, device } = await setup();
  await ctx.telegram!.start();
  ctx.telegram!.stop();
  const link = await call('POST', '/api/notifications/telegram/link', token);
  expect(link.url).toBe(`https://t.me/GuardianTestBot?start=${link.code}`);
  await ctx.telegram!.handleUpdate({ update_id: 1, message: { chat: { id: 555 }, text: `/start ${link.code}` } });
  expect((await call('GET', '/api/notifications', token)).telegram.linked).toBe(true);

  const req = await call('POST', '/api/device/requests', device, { ruleId: 'j', label: 'Roblox', minutes: 30, reason: 'Ya acabé' });
  await new Promise((r) => setTimeout(r, 20));
  const msg = telegramCalls.find((c) => c.method === 'sendMessage' && c.body.chat_id === '555' && c.body.reply_markup);
  expect(msg?.body.text).toContain('Roblox');
  const buttons = msg!.body.reply_markup.inline_keyboard.flat().map((b: { callback_data: string }) => b.callback_data);
  expect(buttons).toEqual([`r:${req.id}:15`, `r:${req.id}:30`, `r:${req.id}:60`, `r:${req.id}:x`]);

  await ctx.telegram!.handleUpdate({ update_id: 2, callback_query: { id: 'cb', data: `r:${req.id}:15`, message: { chat: { id: 555 }, message_id: 1, text: 'x' } } });
  const [decided] = await call('GET', '/api/requests?status=approved', token);
  expect(decided).toMatchObject({ id: req.id, minutesGranted: 15 });
  expect(telegramCalls.find((c) => c.method === 'answerCallbackQuery')?.body.text).toContain('15 min');

  // Otro chat (no vinculado) no puede responder.
  const req2 = await call('POST', '/api/device/requests', device, { ruleId: 'j', label: 'Fortnite', minutes: 30 });
  await ctx.telegram!.handleUpdate({ update_id: 3, callback_query: { id: 'cb2', data: `r:${req2.id}:30`, message: { chat: { id: 999 }, message_id: 2 } } });
  expect((await call('GET', '/api/requests?status=pending', token))).toHaveLength(1);
});

it('Correo: por defecto sólo alertas críticas', async () => {
  const { call, token, device } = await setup();
  await call('POST', '/api/device/events', device, { type: 'time_changed' });
  await call('POST', '/api/device/events', device, { type: 'uninstall_attempt' });
  await new Promise((r) => setTimeout(r, 20));
  expect(mails.map((m) => m.subject)).toEqual([expect.stringContaining('Leo')]);
  await call('PUT', '/api/notifications/email', token, { level: 'off' });
  await call('POST', '/api/device/events', device, { type: 'uninstall_attempt' });
  await new Promise((r) => setTimeout(r, 20));
  expect(mails).toHaveLength(1);
});
