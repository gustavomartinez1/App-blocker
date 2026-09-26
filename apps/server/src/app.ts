import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import { Db } from './db.js';
import { Hub } from './hub.js';
import { ApnsWaker, type DeviceWaker } from './apns.js';
import { EmailChannel, type MailTransport } from './email.js';
import { Notifier, type PushSender } from './notify.js';
import { adminRoutes } from './routes/admin.js';
import { deviceRoutes } from './routes/device.js';
import { hashDeviceToken, verifyAdminToken } from './security.js';
import { TelegramBot } from './telegram.js';
import { HttpError, Services, type DeviceRow } from './services.js';

export interface AppContext {
  config: Config;
  db: Db;
  hub: Hub;
  notifier: Notifier;
  services: Services;
  telegram?: TelegramBot;
  email?: EmailChannel;
  requireAdmin(req: FastifyRequest): { accountId: string; familyId: string };
  requireDevice(req: FastifyRequest): DeviceRow;
}

export interface BuildOptions {
  pushSender?: PushSender;
  logger?: boolean;
  /** Para pruebas: fetch falso hacia la API de Telegram. */
  telegramFetch?: typeof fetch;
  /** Para pruebas: transporte de correo falso. */
  mailTransport?: MailTransport;
  /** Para pruebas: notificaciones silenciosas falsas a dispositivos. */
  deviceWaker?: DeviceWaker;
}

export async function buildApp(config: Config, opts: BuildOptions = {}): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const db = new Db(config.databasePath);
  const hub = new Hub();
  const notifier = new Notifier(db, config.vapidSubject, opts.pushSender);
  const services = new Services(db, hub, notifier);
  if (opts.deviceWaker) services.setDeviceWaker(opts.deviceWaker);
  else if (config.apns) services.setDeviceWaker(new ApnsWaker(config.apns));

  let telegram: TelegramBot | undefined;
  if (config.telegramBotToken) {
    telegram = new TelegramBot(
      config.telegramBotToken,
      db,
      {
        async decide(accountId, requestId, approve, minutes) {
          const acc = db.get<{ family_id: string }>('SELECT family_id FROM accounts WHERE id = ?', accountId);
          if (!acc) throw new HttpError(403, 'Cuenta no encontrada');
          const r = services.request(requestId);
          const p = services.profile(acc.family_id, r.profile_id);
          if (r.status !== 'pending') return 'Esta solicitud ya fue respondida.';
          const res = services.decideRequest(p, r, accountId, approve, minutes);
          if (!approve) return '❌ Rechazada';
          return res.applied ? `✅ Aprobada${res.request.minutesGranted ? `: ${res.request.minutesGranted} min` : ''}` : '⏳ Aprobada; se aplicará al terminar la espera (autocontrol)';
        },
      },
      config.publicUrl,
      opts.telegramFetch,
    );
    notifier.addChannel(telegram);
  }
  let email: EmailChannel | undefined;
  if (config.smtpUrl || opts.mailTransport) {
    email = opts.mailTransport ? new EmailChannel(config.smtpFrom, opts.mailTransport, config.publicUrl) : EmailChannel.fromUrl(config.smtpUrl!, config.smtpFrom, config.publicUrl);
    notifier.addChannel(email);
  }

  const bearer = (req: FastifyRequest): string | undefined => {
    const h = req.headers.authorization;
    if (h?.startsWith('Bearer ')) return h.slice(7);
    const q = (req.query as Record<string, string> | undefined)?.token;
    return q || undefined;
  };

  const ctx: AppContext = {
    config,
    db,
    hub,
    notifier,
    services,
    telegram,
    email,
    requireAdmin(req) {
      const token = bearer(req);
      const claims = token ? verifyAdminToken(config.tokenSecret, token) : null;
      if (!claims) throw new HttpError(401, 'Sesión inválida o vencida');
      const exists = db.get<{ id: string }>('SELECT id FROM accounts WHERE id = ? AND family_id = ?', claims.sub, claims.fam);
      if (!exists) throw new HttpError(401, 'Cuenta no encontrada');
      return { accountId: claims.sub, familyId: claims.fam };
    },
    requireDevice(req) {
      const token = bearer(req);
      const row = token ? db.get<DeviceRow>('SELECT * FROM devices WHERE token_hash = ?', hashDeviceToken(token)) : undefined;
      if (!row) throw new HttpError(401, 'Dispositivo no vinculado');
      return row;
    },
  };

  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 1024 * 1024 });
  await app.register(cors, { origin: config.corsOrigins });
  await app.register(websocket);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message });
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: 'Datos inválidos', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: (err as Error).message });
    app.log.error(err);
    return reply.status(500).send({ error: 'Error interno' });
  });

  app.get('/api/health', async () => ({ ok: true, time: new Date().toISOString() }));

  // WebSocket único: el panel y los agentes se identifican con su token.
  app.get('/api/ws', { websocket: true }, (socket, req) => {
    try {
      const token = bearer(req) ?? '';
      if (token.startsWith('dev_')) {
        const d = ctx.requireDevice(req);
        hub.addDevice(d.id, socket);
        services.touchDevice(d);
        socket.send(JSON.stringify({ type: 'hello', role: 'device' }));
        socket.on('message', () => services.touchDevice(services.device(d.id)));
      } else {
        const { familyId } = ctx.requireAdmin(req);
        hub.addAdmin(familyId, socket);
        socket.send(JSON.stringify({ type: 'hello', role: 'admin' }));
      }
    } catch {
      socket.close(4001, 'unauthorized');
    }
  });

  await app.register(async (scope) => adminRoutes(scope, ctx));
  await app.register(async (scope) => deviceRoutes(scope, ctx));

  if (config.webDist && existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'No encontrado' });
      return reply.sendFile('index.html');
    });
  }

  app.addHook('onClose', async () => {
    telegram?.stop();
    db.close();
  });
  return { app, ctx };
}
