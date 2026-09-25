import { describe, expect, it } from 'vitest';
import {
  currentWebBlockList,
  emptyUsage,
  evaluate,
  policySchema,
  recordOpen,
  recordUsage,
  ruleStatuses,
  type Override,
  type Policy,
  type Rule,
  type Subject,
} from '../src/index.js';

const TZ = 'America/Mexico_City'; // UTC-6 sin horario de verano
/** Lunes 21 sep 2026, hora local de CDMX. */
const at = (hhmm: string, day = '2026-09-21') => new Date(`${day}T${hhmm}:00-06:00`);
const MIN = 60_000;

function policy(rules: Partial<Rule>[], extra: Partial<Policy> = {}): Policy {
  return policySchema.parse({
    version: 1,
    profileId: 'p1',
    timezone: TZ,
    rules: rules.map((r, i) => ({ id: `r${i}`, name: `Regla ${i}`, targets: [{ kind: 'service', id: 'tiktok' }], mode: 'always', ...r })),
    overrides: [],
    ...extra,
  });
}

const tiktokApp: Subject = { type: 'app', platform: 'android', id: 'com.zhiliaoapp.musically' };
const tiktokWeb: Subject = { type: 'web', url: 'https://www.tiktok.com/@alguien' };
const whatsapp: Subject = { type: 'app', platform: 'android', id: 'com.whatsapp' };
const dialer: Subject = { type: 'app', platform: 'android', id: 'com.google.android.dialer' };
const usage0 = emptyUsage('2026-09-21');

describe('always', () => {
  it('bloquea la app y el sitio del servicio', () => {
    const p = policy([{}]);
    expect(evaluate(p, usage0, tiktokApp, at('10:00')).blocked).toBe(true);
    expect(evaluate(p, usage0, tiktokWeb, at('10:00')).blocked).toBe(true);
    expect(evaluate(p, usage0, whatsapp, at('10:00')).blocked).toBe(false);
    const d = evaluate(p, usage0, tiktokApp, at('10:00'));
    expect(d.until).toBeNull();
    expect(d.mode).toBe('always');
  });

  it('respeta reglas deshabilitadas, plataformas y dispositivos', () => {
    expect(evaluate(policy([{ enabled: false }]), usage0, tiktokApp, at('10:00')).blocked).toBe(false);
    const p = policy([{ platforms: ['windows'] }]);
    expect(evaluate(p, usage0, tiktokApp, at('10:00'), { platform: 'android' }).blocked).toBe(false);
    const q = policy([{ deviceIds: ['d2'] }]);
    expect(evaluate(q, usage0, tiktokApp, at('10:00'), { deviceId: 'd1' }).blocked).toBe(false);
    expect(evaluate(q, usage0, tiktokApp, at('10:00'), { deviceId: 'd2' }).blocked).toBe(true);
  });
});

describe('todo el dispositivo', () => {
  const p = policy([{ targets: [{ kind: 'all' }], exceptions: [{ kind: 'service', id: 'whatsapp' }] }], {
    allowlist: [{ kind: 'domain', domain: 'escuela.edu.mx' }],
  });
  it('bloquea todo salvo esenciales, excepciones y lista permitida', () => {
    expect(evaluate(p, usage0, tiktokApp, at('10:00')).blocked).toBe(true);
    expect(evaluate(p, usage0, { type: 'web', url: 'wikipedia.org' }, at('10:00')).blocked).toBe(true);
    expect(evaluate(p, usage0, whatsapp, at('10:00')).blocked).toBe(false);
    expect(evaluate(p, usage0, dialer, at('10:00')).allowedBy).toBe('essential');
    expect(evaluate(p, usage0, { type: 'web', url: 'https://aula.escuela.edu.mx/x' }, at('10:00')).allowedBy).toBe('allowlist');
  });
});

describe('schedule', () => {
  const night = policy([{ mode: 'schedule', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '22:00', end: '07:00' }] } as Partial<Rule>]);

  it('bloquea dentro de una ventana nocturna y calcula el fin', () => {
    expect(evaluate(night, usage0, tiktokApp, at('21:59')).blocked).toBe(false);
    const d = evaluate(night, usage0, tiktokApp, at('23:30'));
    expect(d.blocked).toBe(true);
    expect(d.until).toBe(at('07:00', '2026-09-22').toISOString());
    expect(evaluate(night, usage0, tiktokApp, at('06:59')).blocked).toBe(true);
    expect(evaluate(night, usage0, tiktokApp, at('07:00')).blocked).toBe(false);
  });

  it('respeta los días (la ventana del viernes cubre la madrugada del sábado)', () => {
    const fri = policy([{ mode: 'schedule', windows: [{ days: [5], start: '22:00', end: '07:00' }] } as Partial<Rule>]);
    expect(evaluate(fri, usage0, tiktokApp, at('23:00', '2026-09-25')).blocked).toBe(true);
    expect(evaluate(fri, usage0, tiktokApp, at('03:00', '2026-09-26')).blocked).toBe(true);
    expect(evaluate(fri, usage0, tiktokApp, at('23:00', '2026-09-24')).blocked).toBe(false);
  });

  it('encadena ventanas contiguas', () => {
    const p = policy([
      {
        mode: 'schedule',
        windows: [
          { days: [1], start: '20:00', end: '00:00' },
          { days: [2], start: '00:00', end: '06:00' },
        ],
      } as Partial<Rule>,
    ]);
    expect(evaluate(p, usage0, tiktokApp, at('21:00')).until).toBe(at('06:00', '2026-09-22').toISOString());
  });

  it('invert: permitido sólo dentro de la ventana', () => {
    const p = policy([{ mode: 'schedule', invert: true, windows: [{ days: [1, 2, 3, 4, 5], start: '16:00', end: '18:00' }] } as Partial<Rule>]);
    expect(evaluate(p, usage0, tiktokApp, at('17:00')).blocked).toBe(false);
    const d = evaluate(p, usage0, tiktokApp, at('19:00'));
    expect(d.blocked).toBe(true);
    expect(d.until).toBe(at('16:00', '2026-09-22').toISOString());
  });
});

describe('limit', () => {
  const p = policy([{ mode: 'limit', dailyMinutes: 30, targets: [{ kind: 'category', category: 'social' }] } as Partial<Rule>]);

  it('acumula uso compartido entre app y web y bloquea al llegar al límite', () => {
    let u = recordUsage(p, usage0, tiktokApp, 20 * MIN, at('10:00'));
    expect(evaluate(p, u, tiktokWeb, at('10:00')).remainingMs).toBe(10 * MIN);
    u = recordUsage(p, u, tiktokWeb, 10 * MIN, at('10:10'));
    const d = evaluate(p, u, tiktokApp, at('10:10'));
    expect(d.blocked).toBe(true);
    expect(d.until).toBe(at('00:00', '2026-09-22').toISOString());
    // Otra app de la categoría también queda bloqueada.
    expect(evaluate(p, u, { type: 'app', platform: 'android', id: 'com.instagram.android' }, at('10:10')).blocked).toBe(true);
    // Al día siguiente se reinicia.
    expect(evaluate(p, u, tiktokApp, at('08:00', '2026-09-22')).blocked).toBe(false);
  });

  it('límite distinto por día y minutos extra', () => {
    const q = policy([{ mode: 'limit', dailyMinutes: 30, perDay: { '1': 10 } } as Partial<Rule>]);
    const u = recordUsage(q, usage0, tiktokApp, 15 * MIN, at('10:00'));
    expect(evaluate(q, u, tiktokApp, at('10:00')).blocked).toBe(true);
    const bonus: Override = { id: 'b', type: 'bonus', day: '2026-09-21', minutes: 10, ruleId: 'r0' };
    const withBonus = { ...q, overrides: [bonus] };
    expect(evaluate(withBonus, u, tiktokApp, at('10:00')).remainingMs).toBe(5 * MIN);
  });

  it('máximo de aperturas', () => {
    const q = policy([{ mode: 'limit', dailyMinutes: 600, maxOpens: 2 } as Partial<Rule>]);
    let u = usage0;
    for (let i = 0; i < 2; i++) {
      u = recordOpen(q, u, tiktokApp, at('10:00'));
      expect(evaluate(q, u, tiktokApp, at('10:00')).blocked).toBe(false);
    }
    u = recordOpen(q, u, tiktokApp, at('11:00'));
    expect(evaluate(q, u, tiktokApp, at('11:00')).blocked).toBe(true);
  });

  it('no cuenta uso de apps esenciales ni permitidas', () => {
    const q = policy([{ mode: 'limit', dailyMinutes: 1, targets: [{ kind: 'all' }] } as Partial<Rule>]);
    const u = recordUsage(q, usage0, dialer, 60 * MIN, at('10:00'));
    expect(u.rules.r0).toBeUndefined();
  });
});

describe('interval (descansos cada cierto tiempo)', () => {
  const p = policy([{ mode: 'interval', useMinutes: 20, breakMinutes: 10 } as Partial<Rule>]);

  it('bloquea el descanso al cumplir el tiempo de uso y luego libera', () => {
    let u = usage0;
    for (let m = 1; m <= 19; m++) u = recordUsage(p, u, tiktokApp, MIN, at(`10:${String(m).padStart(2, '0')}`));
    expect(evaluate(p, u, tiktokApp, at('10:19')).remainingMs).toBe(MIN);
    u = recordUsage(p, u, tiktokApp, MIN, at('10:20'));
    const d = evaluate(p, u, tiktokApp, at('10:20'));
    expect(d.blocked).toBe(true);
    expect(d.until).toBe(at('10:30').toISOString());
    expect(evaluate(p, u, tiktokApp, at('10:30')).blocked).toBe(false);
  });

  it('un descanso natural reinicia el ciclo', () => {
    let u = recordUsage(p, usage0, tiktokApp, 15 * MIN, at('10:15'));
    u = recordUsage(p, u, tiktokApp, 10 * MIN, at('11:00')); // no usó de 10:15 a 10:50
    expect(evaluate(p, u, tiktokApp, at('11:00')).blocked).toBe(false);
    expect(u.rules.r0?.intervalUsedMs).toBe(10 * MIN);
  });

  it('sólo corre dentro de sus ventanas', () => {
    const q = policy([{ mode: 'interval', useMinutes: 5, breakMinutes: 5, windows: [{ days: [1], start: '09:00', end: '10:00' }] } as Partial<Rule>]);
    const u = recordUsage(q, usage0, tiktokApp, 5 * MIN, at('09:30'));
    expect(evaluate(q, u, tiktokApp, at('09:31')).blocked).toBe(true);
    const u2 = { ...u, rules: { r0: { ...u.rules.r0!, breakUntil: at('10:30').getTime() } } };
    expect(evaluate(q, u2, tiktokApp, at('10:10')).blocked).toBe(false);
  });
});

describe('until', () => {
  it('bloquea hasta la fecha', () => {
    const p = policy([{ mode: 'until', until: at('12:00').toISOString() } as Partial<Rule>]);
    expect(evaluate(p, usage0, tiktokApp, at('11:00')).blocked).toBe(true);
    expect(evaluate(p, usage0, tiktokApp, at('12:00')).blocked).toBe(false);
  });
});

describe('overrides del administrador', () => {
  const base = policy([{}, { id: 'strict', mode: 'always', strict: true, targets: [{ kind: 'category', category: 'adult' }] } as Partial<Rule>]);
  const adult: Subject = { type: 'web', url: 'https://pornhub.com' };

  it('pause libera todo excepto reglas estrictas', () => {
    const p = { ...base, overrides: [{ id: 'o', type: 'pause', until: at('12:00').toISOString() } as Override] };
    const d = evaluate(p, usage0, tiktokApp, at('11:00'));
    expect(d.blocked).toBe(false);
    expect(d.allowedBy).toBe('pause');
    expect(evaluate(p, usage0, adult, at('11:00')).blocked).toBe(true);
    expect(evaluate(p, usage0, adult, at('11:00')).strict).toBe(true);
    expect(evaluate(p, usage0, tiktokApp, at('12:01')).blocked).toBe(true);
  });

  it('lock bloquea todo salvo esenciales', () => {
    const p = { ...base, overrides: [{ id: 'o', type: 'lock', until: at('12:00').toISOString() } as Override] };
    const d = evaluate(p, usage0, whatsapp, at('11:00'));
    expect(d.blocked).toBe(true);
    expect(d.mode).toBe('lock');
    expect(evaluate(p, usage0, dialer, at('11:00')).blocked).toBe(false);
    expect(evaluate(p, usage0, whatsapp, at('12:00')).blocked).toBe(false);
  });

  it('unlock temporal por regla o por objetivo', () => {
    const byRule = { ...base, overrides: [{ id: 'o', type: 'unlock', ruleId: 'r0', until: at('12:00').toISOString() } as Override] };
    expect(evaluate(byRule, usage0, tiktokApp, at('11:00')).blocked).toBe(false);
    const byTarget = {
      ...base,
      overrides: [{ id: 'o', type: 'unlock', targets: [{ kind: 'service', id: 'tiktok' }], until: at('12:00').toISOString() } as Override],
    };
    const d = evaluate(byTarget, usage0, tiktokWeb, at('11:00'));
    expect(d.blocked).toBe(false);
    expect(d.allowedBy).toBe('unlock');
  });
});

describe('ruleStatuses y lista web', () => {
  it('reporta estado por regla', () => {
    const p = policy([
      { mode: 'limit', dailyMinutes: 60 } as Partial<Rule>,
      { id: 'night', mode: 'schedule', windows: [{ days: [1], start: '22:00', end: '23:00' }] } as Partial<Rule>,
    ]);
    const u = recordUsage(p, usage0, tiktokApp, 15 * MIN, at('10:00'));
    const [lim, night] = ruleStatuses(p, u, at('10:00'));
    expect(lim).toMatchObject({ blocked: false, usedMs: 15 * MIN, limitMs: 60 * MIN, remainingMs: 45 * MIN });
    expect(night).toMatchObject({ blocked: false, nextBlockAt: at('22:00').toISOString() });
  });

  it('genera dominios bloqueados para DNS/hosts', () => {
    const p = policy(
      [
        { targets: [{ kind: 'category', category: 'social' }], exceptions: [{ kind: 'service', id: 'pinterest' }] },
        { id: 'later', mode: 'schedule', windows: [{ days: [1], start: '22:00', end: '23:00' }], targets: [{ kind: 'domain', domain: 'roblox.com' }] } as Partial<Rule>,
      ],
      { allowlist: [{ kind: 'domain', domain: 'reddit.com' }] },
    );
    const list = currentWebBlockList(p, usage0, at('10:00'));
    expect(list.blockAll).toBe(false);
    expect(list.blockedDomains).toContain('instagram.com');
    expect(list.blockedDomains).not.toContain('pinterest.com');
    expect(list.blockedDomains).not.toContain('reddit.com');
    expect(list.blockedDomains).not.toContain('roblox.com');
  });
});
