import { Agent, SAFE_SEARCH, type Subject } from '@guardian/core';
import { randomBytes } from 'node:crypto';
import { resolve4 } from 'node:dns/promises';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { DESKTOP_SUBJECT, Enforcer } from './enforcer.js';
import { stripHostsSection } from './hosts.js';
import { killProcess, listProcesses } from './processes.js';
import { currentPlatform, dataDir, hostsPath, LOCAL_API_PORT } from './platform.js';
import { FileStorage } from './storage.js';

/**
 * Servicio privilegiado de Guardián (SYSTEM en Windows, root en macOS/Linux).
 * Arranca con el sistema y se reinicia si lo matan (ver installers/).
 * Expone una API local en 127.0.0.1 para la app de sesión.
 */

const VERSION = '0.1.0';
const platform = currentPlatform();
const dir = dataDir(platform);
mkdirSync(dir, { recursive: true });

// Token de la API local: la app de sesión lo lee de este archivo.
const tokenFile = join(dir, 'session.token');
let localToken: string;
try {
  localToken = readFileSync(tokenFile, 'utf8').trim();
} catch {
  localToken = randomBytes(24).toString('hex');
  writeFileSync(tokenFile, localToken, { mode: 0o644 });
}

const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);
const agent = new Agent({ platform, agentVersion: VERSION, storage: new FileStorage(join(dir, 'state.json')) });
const enforcer = new Enforcer(agent, {
  platform,
  listProcesses: () => listProcesses(platform),
  kill: (pid) => killProcess(platform, pid),
  readHosts: () => readFile(hostsPath(platform), 'utf8').catch(() => ''),
  writeHosts: (c) => writeFile(hostsPath(platform), c),
  resolveSafeSearch: async () => {
    const map: Record<string, string> = {};
    for (const [host, target] of Object.entries(SAFE_SEARCH.dns)) {
      const [ip] = await resolve4(target).catch(() => [] as string[]);
      if (ip) map[host] = ip;
    }
    return map;
  },
  now: () => new Date(),
  monotonic: () => performance.now(),
  log,
});

async function startLoops(): Promise<void> {
  agent.connectLive((e) => log(`live: ${String(e)}`));
  await agent.report('agent_started', { component: 'service', host: hostname() });
  const sync = async () => agent.sync().catch((e) => log(`sync: ${(e as Error).message}`));
  await sync();
  setInterval(sync, 60_000);
  setInterval(() => agent.heartbeat({ protections: { service: true, hostsFile: true } }).catch(() => undefined), 5 * 60_000);
}

setInterval(() => {
  if (agent.paired) enforcer.tick().catch((e) => log(`tick: ${(e as Error).message}`));
}, 2000);

// ------------------------------------------------------------ API local

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64_000) throw new Error('Cuerpo demasiado grande');
  }
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': 'null' });
  res.end(JSON.stringify(data));
}

function status() {
  if (!agent.paired) return { paired: false };
  const s = agent.state;
  return {
    paired: true,
    profile: s.bundle.profile,
    device: s.bundle.device,
    statuses: agent.statuses(),
    overrides: agent.policy().overrides,
    desktop: agent.check(DESKTOP_SUBJECT(platform)),
    warnBeforeMinutes: s.bundle.policy.settings.warnBeforeMinutes,
    unlockRequestsEnabled: s.bundle.policy.settings.unlockRequestsEnabled,
    offlineCodesEnabled: s.bundle.policy.settings.offlineCodesEnabled,
    adminAccess: agent.hasAdminAccess(),
    lastSyncAt: s.lastSyncAt,
  };
}

const server = createServer(async (req, res) => {
  try {
    if (req.headers.authorization !== `Bearer ${localToken}`) return send(res, 401, { error: 'No autorizado' });
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/status') return send(res, 200, status());

    if (req.method === 'POST' && url.pathname === '/pair') {
      if (agent.paired && !agent.hasAdminAccess()) return send(res, 403, { error: 'Ya está vinculado' });
      const b = await body(req);
      await agent.pair(String(b.server), String(b.code), String(b.name || hostname()));
      void startLoops();
      return send(res, 200, status());
    }
    if (!agent.paired) return send(res, 409, { error: 'No vinculado' });

    if (req.method === 'POST' && url.pathname === '/foreground') {
      const b = await body(req);
      const app = b.app as { id: string; label?: string } | null;
      const subject: Subject | null = app?.id ? { type: 'app', platform, id: app.id, label: app.label } : null;
      return send(res, 200, await enforcer.reportForeground({ subject, idle: Boolean(b.idle) }));
    }
    if (req.method === 'POST' && url.pathname === '/request') {
      const b = await body(req);
      const subject = (b.subject as Subject | undefined) ?? DESKTOP_SUBJECT(platform);
      const decision = agent.check(subject);
      if (decision.strict) return send(res, 403, { error: 'Este bloqueo no admite solicitudes' });
      return send(res, 200, await agent.requestUnlock(subject, decision, Number(b.minutes ?? 15), b.reason ? String(b.reason) : undefined));
    }
    if (req.method === 'GET' && url.pathname.startsWith('/request/')) {
      const r = await agent.requestStatus(url.pathname.slice('/request/'.length));
      if (r.status === 'approved') await agent.sync();
      return send(res, 200, r);
    }
    if (req.method === 'POST' && url.pathname === '/code') {
      const b = await body(req);
      return send(res, 200, await agent.enterCode(String(b.code ?? '')));
    }
    if (req.method === 'POST' && url.pathname === '/sync') {
      await agent.sync();
      return send(res, 200, status());
    }
    if (req.method === 'POST' && url.pathname === '/uninstall-check') {
      // El desinstalador pregunta si puede proceder: sólo con acceso de administrador (código 0).
      if (!agent.hasAdminAccess()) {
        await agent.report('uninstall_attempt', {});
        return send(res, 403, { error: 'Se necesita un código de administrador' });
      }
      const hosts = await readFile(hostsPath(platform), 'utf8').catch(() => '');
      await writeFile(hostsPath(platform), stripHostsSection(hosts));
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'No encontrado' });
  } catch (e) {
    return send(res, 500, { error: (e as Error).message });
  }
});

server.listen(LOCAL_API_PORT, '127.0.0.1', () => log(`API local en 127.0.0.1:${LOCAL_API_PORT} (datos en ${dir})`));

if (await agent.init()) void startLoops();
else log('Sin vincular: abre Guardián en la sesión del usuario para vincular este equipo.');
