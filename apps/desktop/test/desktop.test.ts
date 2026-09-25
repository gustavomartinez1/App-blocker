import { Agent, emptyUsage, policySchema, type AgentData, type Rule } from '@guardian/core';
import { describe, expect, it } from 'vitest';
import { Enforcer } from '../src/service/enforcer.js';
import { applyHostsSection, BEGIN, currentHostsSection, END, renderHostsSection, stripHostsSection } from '../src/service/hosts.js';
import { macAppBundle, parsePs, parseTasklistCsv } from '../src/service/processes.js';
import { parseLsappinfo, parseWindowsLine } from '../src/session/foreground.js';

describe('archivo hosts', () => {
  const list = { blockAll: false, blockedDomains: ['tiktok.com', 'roblox.com'], allowedDomains: ['roblox.com'] };

  it('genera la sección con subdominios, IPv4/IPv6 y SafeSearch', () => {
    const s = renderHostsSection(list, { 'www.google.com': '216.239.38.120' });
    expect(s.startsWith(BEGIN)).toBe(true);
    expect(s.endsWith(END)).toBe(true);
    expect(s).toContain('0.0.0.0 tiktok.com');
    expect(s).toContain(':: www.tiktok.com');
    expect(s).toContain('216.239.38.120 www.google.com');
    expect(s).not.toContain('roblox.com');
  });

  it('reemplaza la sección conservando el resto y el fin de línea', () => {
    const original = '127.0.0.1 localhost\r\n::1 localhost\r\n';
    const once = applyHostsSection(original, renderHostsSection(list));
    expect(once).toContain('127.0.0.1 localhost');
    expect(once.split(BEGIN)).toHaveLength(2);
    expect(once).toContain('\r\n0.0.0.0 tiktok.com\r\n');
    const twice = applyHostsSection(once, renderHostsSection({ ...list, blockedDomains: [] }));
    expect(twice.split(BEGIN)).toHaveLength(2);
    expect(twice).not.toContain('tiktok');
    expect(stripHostsSection(twice).trim()).toBe(original.trim());
    expect(currentHostsSection(twice)).toBe(renderHostsSection({ ...list, blockedDomains: [] }));
  });
});

describe('procesos y primer plano', () => {
  it('parsea tasklist, ps, lsappinfo y PowerShell', () => {
    expect(parseTasklistCsv('"Discord.exe","1234","Console","1","90,000 K"\r\n"System","4","Services","0","100 K"')).toEqual([
      { pid: 1234, id: 'Discord.exe', name: 'Discord' },
      { pid: 4, id: 'System', name: 'System' },
    ]);
    expect(parsePs('  501 sofia /Applications/Discord.app/Contents/MacOS/Discord\n')).toEqual([
      { pid: 501, user: 'sofia', path: '/Applications/Discord.app/Contents/MacOS/Discord' },
    ]);
    expect(macAppBundle('/Applications/Discord.app/Contents/MacOS/Discord')).toBe('/Applications/Discord.app');
    expect(parseLsappinfo('"CFBundleIdentifier"="com.hnc.Discord"')).toBe('com.hnc.Discord');
    expect(parseWindowsLine('RobloxPlayerBeta|999')).toEqual({ id: 'RobloxPlayerBeta.exe', label: 'RobloxPlayerBeta' });
    expect(parseWindowsLine('|')).toBeNull();
  });
});

function agentWith(rules: Partial<Rule>[]) {
  const policy = policySchema.parse({
    version: 1,
    profileId: 'p',
    timezone: 'UTC',
    rules: rules.map((r, i) => ({ id: `r${i}`, name: `R${i}`, targets: [{ kind: 'service', id: 'roblox' }], mode: 'always', ...r })),
  });
  const data: AgentData = {
    server: 'http://x',
    token: 't',
    bundle: {
      profile: { id: 'p', name: 'Leo', mode: 'supervised' },
      device: { id: 'd', name: 'PC', platform: 'windows' },
      policy,
      othersUsage: emptyUsage('2000-01-01'),
      unlockSecret: 's',
      serverTime: '',
    },
    usage: emptyUsage('2000-01-01'),
    items: { day: '2000-01-01', byKey: {} },
    localOverrides: [],
    usedCodes: [],
    wrongCodes: 0,
    outbox: [],
  };
  const reported: string[] = [];
  const agent = new Agent({
    platform: 'windows',
    agentVersion: 't',
    storage: { load: async () => data, save: async () => undefined },
    fetch: (async (_url: string, init: RequestInit) => {
      if (init?.method === 'POST') reported.push(String(init.body));
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
  });
  return { agent, reported };
}

function fakeDeps(procs: { pid: number; id: string; name: string }[]) {
  let hosts = '127.0.0.1 localhost\n';
  let mono = 0;
  let wall = Date.parse('2026-09-21T15:00:00Z');
  const killed: number[] = [];
  return {
    killed,
    get hosts() {
      return hosts;
    },
    set hosts(v: string) {
      hosts = v;
    },
    advance(ms: number, wallJump = 0) {
      mono += ms;
      wall += ms + wallJump;
    },
    deps: {
      platform: 'windows' as const,
      listProcesses: async () => procs,
      kill: async (pid: number) => void killed.push(pid),
      readHosts: async () => hosts,
      writeHosts: async (c: string) => void (hosts = c),
      resolveSafeSearch: async () => ({ 'www.google.com': '216.239.38.120' }),
      now: () => new Date(wall),
      monotonic: () => mono,
    },
  };
}

describe('Enforcer', () => {
  const procs = [
    { pid: 10, id: 'RobloxPlayerBeta.exe', name: 'Roblox' },
    { pid: 11, id: 'RobloxPlayerBeta.exe', name: 'Roblox' },
    { pid: 20, id: 'explorer.exe', name: 'explorer' },
    { pid: 30, id: 'notepad.exe', name: 'notepad' },
  ];

  it('cierra apps bloqueadas, escribe hosts y cuenta un solo intento por lanzamiento', async () => {
    const { agent } = agentWith([{}]);
    await agent.init();
    const f = fakeDeps(procs);
    const enforcer = new Enforcer(agent, f.deps);
    await enforcer.tick();
    expect(f.killed).toEqual([10, 11]);
    expect(f.hosts).toContain('0.0.0.0 roblox.com');
    expect(f.hosts).toContain('216.239.38.120 www.google.com');
    await enforcer.tick();
    const item = Object.values(agent.state.items.byKey)[0];
    expect(item?.blockedAttempts).toBe(1);
  });

  it('"todo el dispositivo" no mata procesos del sistema (lo cubre la pantalla de bloqueo)', async () => {
    const { agent } = agentWith([{ targets: [{ kind: 'all' }] }]);
    await agent.init();
    const f = fakeDeps(procs);
    const enforcer = new Enforcer(agent, f.deps);
    await enforcer.tick();
    expect(f.killed).toEqual([]);
    const { desktop } = await enforcer.reportForeground({ subject: { type: 'app', platform: 'windows', id: 'notepad.exe' }, idle: false });
    expect(desktop.blocked).toBe(true);
  });

  it('detecta hosts editado y reloj movido', async () => {
    const { agent, reported } = agentWith([{}]);
    await agent.init();
    const f = fakeDeps([]);
    const enforcer = new Enforcer(agent, f.deps);
    await enforcer.tick();
    f.hosts = '127.0.0.1 localhost\n';
    f.advance(2000, 3 * 3600_000);
    await enforcer.tick();
    expect(f.hosts).toContain('roblox.com');
    expect(reported.some((r) => r.includes('protection_disabled'))).toBe(true);
    expect(reported.some((r) => r.includes('time_changed'))).toBe(true);
  });

  it('cuenta el uso de la app en primer plano y respeta la inactividad', async () => {
    const { agent } = agentWith([{ mode: 'limit', dailyMinutes: 1, targets: [{ kind: 'service', id: 'discord' }] } as Partial<Rule>]);
    await agent.init();
    const f = fakeDeps([]);
    const enforcer = new Enforcer(agent, f.deps);
    const discord = { type: 'app', platform: 'windows', id: 'Discord.exe' } as const;
    await enforcer.reportForeground({ subject: discord, idle: false });
    for (let i = 0; i < 7; i++) {
      f.advance(10_000);
      await enforcer.reportForeground({ subject: discord, idle: false });
    }
    const r = await enforcer.reportForeground({ subject: discord, idle: true });
    expect(r.foreground?.blocked).toBe(true);
    expect(agent.statuses()[0]?.usedMs).toBe(60_000);
  });
});
