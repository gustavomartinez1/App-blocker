import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { Platform } from '@guardian/core';

const run = promisify(execFile);

export interface Proc {
  pid: number;
  /** Identificador comparable con el catálogo: exe en Windows, bundle id en macOS, nombre en Linux. */
  id: string;
  name: string;
  path?: string;
  user?: string;
}

/** Parsea `tasklist /fo csv /nh /v`-like: "Imagen","PID","Sesión","#","Mem"… */
export function parseTasklistCsv(out: string): Proc[] {
  const procs: Proc[] = [];
  for (const line of out.split(/\r?\n/)) {
    const cols = [...line.matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? '');
    const pid = Number(cols[1]);
    if (!cols[0] || !Number.isFinite(pid)) continue;
    procs.push({ pid, id: cols[0], name: cols[0].replace(/\.exe$/i, '') });
  }
  return procs;
}

/** Parsea `ps -axo pid=,user=,comm=`. */
export function parsePs(out: string): { pid: number; user: string; path: string }[] {
  const rows: { pid: number; user: string; path: string }[] = [];
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), user: m[2]!, path: m[3]! });
  }
  return rows;
}

/** "/Applications/Discord.app/Contents/MacOS/Discord" → "/Applications/Discord.app" */
export function macAppBundle(path: string): string | null {
  const i = path.indexOf('.app/Contents/MacOS/');
  return i === -1 ? null : path.slice(0, i + 4);
}

const bundleIdCache = new Map<string, string | null>();

async function macBundleId(appPath: string): Promise<string | null> {
  if (bundleIdCache.has(appPath)) return bundleIdCache.get(appPath)!;
  let id: string | null = null;
  try {
    const plist = await readFile(`${appPath}/Contents/Info.plist`, 'utf8');
    id = /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1] ?? null;
    if (!id) id = (await run('plutil', ['-extract', 'CFBundleIdentifier', 'raw', `${appPath}/Contents/Info.plist`])).stdout.trim() || null;
  } catch {
    id = null;
  }
  bundleIdCache.set(appPath, id);
  return id;
}

export async function listProcesses(platform: Platform): Promise<Proc[]> {
  if (platform === 'windows') {
    const { stdout } = await run('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    return parseTasklistCsv(stdout);
  }
  const { stdout } = await run('ps', ['-axo', 'pid=,user=,comm='], { maxBuffer: 8 * 1024 * 1024 });
  const rows = parsePs(stdout);
  if (platform === 'macos') {
    const out: Proc[] = [];
    for (const r of rows) {
      const app = macAppBundle(r.path);
      const id = app ? await macBundleId(app) : null;
      out.push({ pid: r.pid, id: id ?? r.path.split('/').pop()!, name: (app ?? r.path).split('/').pop()!.replace(/\.app$/, ''), path: r.path, user: r.user });
    }
    return out;
  }
  return rows.map((r) => ({ pid: r.pid, id: r.path.split('/').pop()!, name: r.path.split('/').pop()!, path: r.path, user: r.user }));
}

export async function killProcess(platform: Platform, pid: number): Promise<void> {
  if (platform === 'windows') {
    await run('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }).catch(() => undefined);
  } else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* ya terminó */
    }
  }
}
