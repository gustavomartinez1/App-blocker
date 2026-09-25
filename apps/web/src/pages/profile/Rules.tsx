import { describeRule, type Rule } from '@guardian/core';
import { useState } from 'react';
import { MODE_INFO, RuleEditor } from '../../components/RuleEditor';
import { Empty } from '../../components/ui';
import type { ProfileCtx } from '../Profile';

const rid = () => `r_${Math.random().toString(36).slice(2, 10)}`;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];

/** Plantillas de un clic para empezar rápido. */
export const TEMPLATES: { title: string; description: string; make: () => Rule }[] = [
  {
    title: '🌙 Hora de dormir',
    description: 'Todo bloqueado de 22:00 a 07:00',
    make: () => ({ id: rid(), name: 'Hora de dormir', enabled: true, strict: false, mode: 'schedule', invert: false, targets: [{ kind: 'all' }], exceptions: [], windows: [{ days: ALL_DAYS, start: '22:00', end: '07:00' }] }),
  },
  {
    title: '🏫 Horario escolar',
    description: 'Redes, juegos y video bloqueados L-V 08:00-14:00',
    make: () => ({
      id: rid(),
      name: 'Horario escolar',
      enabled: true,
      strict: false,
      mode: 'schedule',
      invert: false,
      targets: [{ kind: 'category', category: 'social' }, { kind: 'category', category: 'games' }, { kind: 'category', category: 'video' }],
      exceptions: [],
      windows: [{ days: WEEKDAYS, start: '08:00', end: '14:00' }],
    }),
  },
  {
    title: '⏳ 1 hora de redes al día',
    description: 'Límite diario compartido entre celular y PC',
    make: () => ({ id: rid(), name: 'Redes sociales 1 h', enabled: true, strict: false, mode: 'limit', dailyMinutes: 60, targets: [{ kind: 'category', category: 'social' }], exceptions: [] }),
  },
  {
    title: '🎮 Juegos 2 h fines de semana',
    description: '30 min entre semana, 2 h sábado y domingo',
    make: () => ({ id: rid(), name: 'Juegos', enabled: true, strict: false, mode: 'limit', dailyMinutes: 30, perDay: { '0': 120, '6': 120 }, targets: [{ kind: 'category', category: 'games' }], exceptions: [] }),
  },
  {
    title: '🔁 Descanso cada 45 min',
    description: 'Tras 45 min de uso, 15 min de descanso',
    make: () => ({ id: rid(), name: 'Descansos', enabled: true, strict: false, mode: 'interval', useMinutes: 45, breakMinutes: 15, targets: [{ kind: 'all' }], exceptions: [] }),
  },
  {
    title: '🔞 Adultos y apuestas',
    description: 'Bloqueo permanente y estricto',
    make: () => ({ id: rid(), name: 'Adultos y apuestas', enabled: true, strict: true, mode: 'always', targets: [{ kind: 'category', category: 'adult' }, { kind: 'category', category: 'gambling' }, { kind: 'category', category: 'dating' }], exceptions: [] }),
  },
  {
    title: '🕵️ Anti-evasión',
    description: 'Bloquea VPNs, proxys, Tor y DNS alternos',
    make: () => ({ id: rid(), name: 'Anti-evasión', enabled: true, strict: true, mode: 'always', targets: [{ kind: 'category', category: 'bypass' }], exceptions: [] }),
  },
];

export function RulesTab({ ctx }: { ctx: ProfileCtx }) {
  const input = ctx.policy.policy;
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);

  const saveRules = (rules: Rule[]) => ctx.savePolicy({ rules, allowlist: input.allowlist, settings: input.settings });

  const upsert = async (rule: Rule) => {
    const exists = input.rules.some((r) => r.id === rule.id);
    const ok = await saveRules(exists ? input.rules.map((r) => (r.id === rule.id ? rule : r)) : [...input.rules, rule]);
    if (ok) setEditing(null);
  };

  return (
    <div className="stack">
      <div className="spread">
        <p className="muted" style={{ margin: 0 }}>
          Si varias reglas aplican a la misma app, gana la más restrictiva.
        </p>
        <button className="primary" onClick={() => setEditing('new')}>
          + Nueva regla
        </button>
      </div>

      {input.rules.length === 0 ? (
        <div className="card">
          <Empty>No hay reglas. Crea una o usa una plantilla.</Empty>
        </div>
      ) : (
        <div className="card list">
          {input.rules.map((r) => (
            <div key={r.id} className="list-item" style={{ opacity: r.enabled ? 1 : 0.55 }}>
              <span style={{ fontSize: '1.4rem' }}>{MODE_INFO[r.mode].icon}</span>
              <div className="grow">
                <div className="row" style={{ gap: 6 }}>
                  <strong>{r.name}</strong>
                  {r.strict && <span className="badge red">Estricta</span>}
                  {!r.enabled && <span className="badge">Pausada</span>}
                  {r.platforms?.length ? <span className="badge">Sólo {r.platforms.join(', ')}</span> : null}
                </div>
                <div className="muted small">{describeRule(r)}</div>
              </div>
              <label className="row small" title="Activar o pausar">
                <input type="checkbox" checked={r.enabled} onChange={() => saveRules(input.rules.map((x) => (x.id === r.id ? { ...x, enabled: !x.enabled } : x)))} />
              </label>
              <button className="small" onClick={() => setEditing(r)}>
                Editar
              </button>
              <button
                className="small danger ghost"
                onClick={() => confirm(`¿Eliminar la regla “${r.name}”?`) && saveRules(input.rules.filter((x) => x.id !== r.id))}
                aria-label="Eliminar"
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      )}

      <div>
        <h3>Plantillas</h3>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
          {TEMPLATES.map((t) => (
            <button key={t.title} className="card" style={{ textAlign: 'left', flexDirection: 'column', alignItems: 'flex-start', whiteSpace: 'normal' }} onClick={() => setEditing(t.make())}>
              <strong>{t.title}</strong>
              <span className="muted small" style={{ fontWeight: 400 }}>
                {t.description}
              </span>
            </button>
          ))}
        </div>
      </div>

      {editing && <RuleEditor rule={editing === 'new' ? null : editing} devices={ctx.profile.devices} onSave={upsert} onClose={() => setEditing(null)} />}
    </div>
  );
}
