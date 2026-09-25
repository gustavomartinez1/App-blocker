import { PLATFORMS, targetSchema } from '@guardian/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { newDeviceToken, newId } from '../security.js';
import { DEVICE_EVENT_TYPES, HttpError, type DeviceRow } from '../services.js';

const statusSchema = z.record(z.unknown()).refine((v) => JSON.stringify(v).length < 8_000, 'Estado demasiado grande');

/** API que usan los agentes (Android, iOS, escritorio, extensión) con su token. */
export async function deviceRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, services } = ctx;

  app.post('/api/device/pair', async (req, reply) => {
    const body = z
      .object({
        code: z.string().trim().toUpperCase(),
        name: z.string().trim().min(1).max(60),
        platform: z.enum(PLATFORMS),
        agentVersion: z.string().max(40).optional(),
      })
      .parse(req.body);
    const code = body.code.replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2');
    const pc = db.get<{ profile_id: string; expires_at: number }>('SELECT profile_id, expires_at FROM pairing_codes WHERE code = ?', code);
    if (!pc || pc.expires_at < Date.now()) throw new HttpError(400, 'Código de vinculación inválido o vencido');
    const id = newId('dev');
    const { token, hash } = newDeviceToken();
    db.transaction(() => {
      db.run('DELETE FROM pairing_codes WHERE code = ?', code);
      db.run(
        'INSERT INTO devices (id, profile_id, name, platform, token_hash, agent_version, last_seen, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        id,
        pc.profile_id,
        body.name,
        body.platform,
        hash,
        body.agentVersion ?? null,
        Date.now(),
        Date.now(),
      );
    });
    const device = services.device(id);
    services.recordEvent(pc.profile_id, id, 'device_paired', { name: body.name, platform: body.platform });
    ctx.hub.toFamily(services.profileById(pc.profile_id).family_id, { type: 'device', device: services.publicDevice(device) });
    return reply.status(201).send({ token, ...services.deviceBundle(device) });
  });

  /** Política vigente. Con ?version=N responde {unchanged:true} si no hay cambios. */
  app.get<{ Querystring: { version?: string } }>('/api/device/bundle', async (req) => {
    const d = ctx.requireDevice(req);
    services.touchDevice(d);
    const p = services.profileById(d.profile_id);
    if (req.query.version && Number(req.query.version) === p.policy_version) {
      return { unchanged: true, version: p.policy_version, othersUsage: services.deviceBundle(d).othersUsage };
    }
    return services.deviceBundle(d);
  });

  app.post('/api/device/heartbeat', async (req) => {
    const d = ctx.requireDevice(req);
    const body = z.object({ status: statusSchema.optional(), agentVersion: z.string().max(40).optional() }).parse(req.body ?? {});
    services.touchDevice(d, body.status, body.agentVersion);
    return { ok: true, policyVersion: services.profileById(d.profile_id).policy_version };
  });

  app.post('/api/device/usage', async (req) => {
    const d = ctx.requireDevice(req);
    const body = z
      .object({
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        rules: z.record(
          z.object({
            usedMs: z.number().min(0).max(86_400_000),
            opens: z.number().int().min(0).max(100_000),
            intervalUsedMs: z.number().min(0).max(86_400_000).optional(),
            breakUntil: z.number().int().optional(),
          }),
        ),
        items: z
          .array(
            z.object({
              key: z.string().min(1).max(300),
              label: z.string().max(120),
              usedMs: z.number().min(0).max(86_400_000),
              opens: z.number().int().min(0).max(100_000),
              blockedAttempts: z.number().int().min(0).max(100_000).optional(),
            }),
          )
          .max(500)
          .default([]),
      })
      .parse(req.body);
    services.touchDevice(d);
    services.saveUsage(d, body);
    return { ok: true };
  });

  app.post('/api/device/requests', async (req, reply) => {
    const d = ctx.requireDevice(req);
    const body = z
      .object({
        kind: z.enum(['unlock', 'more_time']).default('unlock'),
        ruleId: z.string().optional(),
        target: targetSchema.optional(),
        label: z.string().trim().min(1).max(120),
        reason: z.string().trim().max(300).optional(),
        minutes: z.number().int().min(1).max(24 * 60).default(15),
      })
      .parse(req.body);
    const r = services.createRequest(services.profileById(d.profile_id), d, body);
    return reply.status(201).send(services.publicRequest(r));
  });

  app.get<{ Params: { id: string } }>('/api/device/requests/:id', async (req) => {
    const d = ctx.requireDevice(req);
    const r = services.request(req.params.id);
    if (r.device_id !== d.id) throw new HttpError(404, 'Solicitud no encontrada');
    return services.publicRequest(r);
  });

  app.post('/api/device/events', async (req, reply) => {
    const d: DeviceRow = ctx.requireDevice(req);
    const body = z
      .object({ type: z.enum(DEVICE_EVENT_TYPES), data: z.record(z.unknown()).default({}) })
      .refine((v) => JSON.stringify(v.data).length < 4_000, 'Datos demasiado grandes')
      .parse(req.body);
    services.touchDevice(d);
    const e = services.deviceEvent(d, body.type, body.data);
    return reply.status(201).send(services.publicEvent(e));
  });
}
