import { PLATFORMS, WEEKDAY_NAMES, describeTarget, ruleSchema, type Platform, type Rule, type RuleMode, type Target, type TimeWindow } from '@guardian/core';
import { useState } from 'react';
import type { Device } from '../api';
import { PLATFORM_LABELS } from '../format';
import { TargetPicker } from './TargetPicker';
import { Modal } from './ui';

export const MODE_INFO: Record<RuleMode, { title: string; icon: string; description: string }> = {
  always: { title: 'Bloquear siempre', icon: '⛔', description: 'Bloqueo definitivo hasta que tú lo quites.' },
  schedule: { title: 'Por horario', icon: '🕘', description: 'Bloquea en ciertas horas (noche, escuela) o permite sólo en ciertas horas.' },
  limit: { title: 'Límite diario', icon: '⏳', description: 'Minutos al día (compartidos entre todos sus dispositivos) y máximo de aperturas.' },
  interval: { title: 'Descansos', icon: '🔁', description: 'Cada cierto tiempo de uso se bloquea un rato para descansar.' },
  until: { title: 'Temporal', icon: '📅', description: 'Bloquea hasta una fecha y hora (castigo, exámenes, enfoque).' },
};

const newId = () => `r_${Math.random().toString(36).slice(2, 10)}`;

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Draft = {
  id: string;
  name: string;
  enabled: boolean;
  mode: RuleMode;
  targets: Target[];
  exceptions: Target[];
  platforms: Platform[];
  deviceIds: string[];
  strict: boolean;
  windows: TimeWindow[];
  invert: boolean;
  dailyMinutes: number;
  perDay: Record<string, number>;
  maxOpens: string;
  useMinutes: number;
  breakMinutes: number;
  intervalWindows: boolean;
  until: string;
};

function toDraft(rule: Rule | null): Draft {
  const d: Draft = {
    id: rule?.id ?? newId(),
    name: rule?.name ?? '',
    enabled: rule?.enabled ?? true,
    mode: rule?.mode ?? 'limit',
    targets: rule?.targets ?? [],
    exceptions: rule?.exceptions ?? [],
    platforms: rule?.platforms ?? [],
    deviceIds: rule?.deviceIds ?? [],
    strict: rule?.strict ?? false,
    windows: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '22:00', end: '07:00' }],
    invert: false,
    dailyMinutes: 60,
    perDay: {},
    maxOpens: '',
    useMinutes: 30,
    breakMinutes: 10,
    intervalWindows: false,
    until: toLocalInput(new Date(Date.now() + 2 * 3600_000).toISOString()),
  };
  if (rule?.mode === 'schedule') Object.assign(d, { windows: rule.windows, invert: rule.invert });
  if (rule?.mode === 'limit') Object.assign(d, { dailyMinutes: rule.dailyMinutes, perDay: rule.perDay ?? {}, maxOpens: rule.maxOpens ? String(rule.maxOpens) : '' });
  if (rule?.mode === 'interval') Object.assign(d, { useMinutes: rule.useMinutes, breakMinutes: rule.breakMinutes, intervalWindows: !!rule.windows?.length, windows: rule.windows?.length ? rule.windows : d.windows });
  if (rule?.mode === 'until') d.until = toLocalInput(rule.until);
  return d;
}

function fromDraft(d: Draft): unknown {
  const base = {
    id: d.id,
    name: d.name.trim(),
    enabled: d.enabled,
    targets: d.targets,
    exceptions: d.exceptions,
    platforms: d.platforms.length ? d.platforms : undefined,
    deviceIds: d.deviceIds.length ? d.deviceIds : undefined,
    strict: d.strict,
  };
  switch (d.mode) {
    case 'always':
      return { ...base, mode: 'always' };
    case 'schedule':
      return { ...base, mode: 'schedule', windows: d.windows, invert: d.invert };
    case 'limit':
      return { ...base, mode: 'limit', dailyMinutes: d.dailyMinutes, perDay: Object.keys(d.perDay).length ? d.perDay : undefined, maxOpens: d.maxOpens ? Number(d.maxOpens) : undefined };
    case 'interval':
      return { ...base, mode: 'interval', useMinutes: d.useMinutes, breakMinutes: d.breakMinutes, windows: d.intervalWindows ? d.windows : undefined };
    case 'until':
      return { ...base, mode: 'until', until: new Date(d.until).toISOString() };
  }
}

export function RuleEditor({ rule, devices, onSave, onClose }: { rule: Rule | null; devices: Device[]; onSave: (r: Rule) => void; onClose: () => void }) {
  const [d, setD] = useState<Draft>(() => toDraft(rule));
  const [showExceptions, setShowExceptions] = useState(d.exceptions.length > 0);
  const [showAdvanced, setShowAdvanced] = useState(d.platforms.length > 0 || d.deviceIds.length > 0);
  const [error, setError] = useState<string>();
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));

  const save = () => {
    const draft = { ...d, name: d.name.trim() || autoName(d) };
    const parsed = ruleSchema.safeParse(fromDraft(draft));
    if (!draft.targets.length) return setError('Elige al menos una app, sitio o categoría.');
    if (!parsed.success) return setError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · '));
    onSave(parsed.data);
  };

  return (
    <Modal
      title={rule ? 'Editar regla' : 'Nueva regla'}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancelar</button>
          <button className="primary" onClick={save}>
            Guardar regla
          </button>
        </>
      }
    >
      <div>
        <h3>1. ¿Cómo se bloquea?</h3>
        <div className="picker-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', maxHeight: 'none' }}>
          {(Object.keys(MODE_INFO) as RuleMode[]).map((m) => (
            <label key={m} className={`pick ${d.mode === m ? 'on' : ''}`} style={{ alignItems: 'flex-start' }}>
              <input type="radio" name="mode" checked={d.mode === m} onChange={() => set({ mode: m })} style={{ marginTop: 4 }} />
              <span>
                <strong>
                  {MODE_INFO[m].icon} {MODE_INFO[m].title}
                </strong>
                <br />
                <span className="muted small">{MODE_INFO[m].description}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <ModeFields d={d} set={set} />

      <div>
        <h3>2. ¿Qué se bloquea?</h3>
        <TargetPicker value={d.targets} onChange={(targets) => set({ targets })} />
      </div>

      <div>
        <label className="row" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={showExceptions} onChange={(e) => setShowExceptions(e.target.checked)} />
          <strong>Agregar excepciones</strong>
          <span className="muted small">(p. ej. “todo el celular excepto WhatsApp y Maps”)</span>
        </label>
        {showExceptions && (
          <div style={{ marginTop: 10 }}>
            <TargetPicker value={d.exceptions} onChange={(exceptions) => set({ exceptions })} allowAll={false} />
          </div>
        )}
      </div>

      <div className="stack" style={{ gap: 10 }}>
        <h3 style={{ margin: 0 }}>3. Detalles</h3>
        <label className="field">
          <span>Nombre de la regla</span>
          <input value={d.name} placeholder={autoName(d)} onChange={(e) => set({ name: e.target.value })} maxLength={80} />
        </label>
        <label className="row">
          <input type="checkbox" checked={d.strict} onChange={(e) => set({ strict: e.target.checked })} />
          <span>
            <strong>Estricta</strong> <span className="muted small">— no se puede pedir desbloqueo ni usar códigos, y sigue activa aunque liberes el dispositivo.</span>
          </span>
        </label>
        <label className="row">
          <input type="checkbox" checked={d.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          <strong>Regla activa</strong>
        </label>
        <label className="row">
          <input type="checkbox" checked={showAdvanced} onChange={(e) => setShowAdvanced(e.target.checked)} />
          <span>Aplicar sólo en ciertos dispositivos o plataformas</span>
        </label>
        {showAdvanced && (
          <div className="stack" style={{ gap: 8, paddingLeft: 26 }}>
            <div className="row" style={{ gap: 6 }}>
              {PLATFORMS.map((p) => (
                <label key={p} className={`pick ${d.platforms.includes(p) ? 'on' : ''}`}>
                  <input type="checkbox" checked={d.platforms.includes(p)} onChange={() => set({ platforms: d.platforms.includes(p) ? d.platforms.filter((x) => x !== p) : [...d.platforms, p] })} />
                  {PLATFORM_LABELS[p]}
                </label>
              ))}
            </div>
            {devices.length > 0 && (
              <div className="row" style={{ gap: 6 }}>
                {devices.map((dev) => (
                  <label key={dev.id} className={`pick ${d.deviceIds.includes(dev.id) ? 'on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={d.deviceIds.includes(dev.id)}
                      onChange={() => set({ deviceIds: d.deviceIds.includes(dev.id) ? d.deviceIds.filter((x) => x !== dev.id) : [...d.deviceIds, dev.id] })}
                    />
                    {dev.name}
                  </label>
                ))}
              </div>
            )}
            <span className="muted small">Si no marcas nada, aplica en todos.</span>
          </div>
        )}
      </div>

      {error && <div className="error">{error}</div>}
    </Modal>
  );
}

function autoName(d: Draft): string {
  const what = d.targets.slice(0, 2).map(describeTarget).join(', ');
  return (what ? `${MODE_INFO[d.mode].title}: ${what}${d.targets.length > 2 ? '…' : ''}` : MODE_INFO[d.mode].title).slice(0, 80);
}

function ModeFields({ d, set }: { d: Draft; set: (p: Partial<Draft>) => void }) {
  switch (d.mode) {
    case 'always':
      return null;
    case 'schedule':
      return (
        <div className="stack" style={{ gap: 10 }}>
          <div className="row">
            <label className="row">
              <input type="radio" checked={!d.invert} onChange={() => set({ invert: false })} /> Bloquear <strong>durante</strong> estos horarios
            </label>
            <label className="row">
              <input type="radio" checked={d.invert} onChange={() => set({ invert: true })} /> Permitir <strong>sólo</strong> en estos horarios
            </label>
          </div>
          <WindowsEditor value={d.windows} onChange={(windows) => set({ windows })} />
        </div>
      );
    case 'limit':
      return (
        <div className="stack" style={{ gap: 10 }}>
          <div className="row">
            <label className="field">
              <span>Minutos por día</span>
              <input type="number" min={0} max={1440} value={d.dailyMinutes} onChange={(e) => set({ dailyMinutes: Number(e.target.value) })} />
            </label>
            <label className="field">
              <span>Máx. aperturas por día (opcional)</span>
              <input type="number" min={1} value={d.maxOpens} placeholder="sin límite" onChange={(e) => set({ maxOpens: e.target.value })} />
            </label>
          </div>
          <details>
            <summary className="muted">Límite distinto por día de la semana</summary>
            <div className="row" style={{ marginTop: 8 }}>
              {WEEKDAY_NAMES.map((name, i) => (
                <label key={i} className="field" style={{ width: 80 }}>
                  <span>{name}</span>
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    placeholder={String(d.dailyMinutes)}
                    value={d.perDay[String(i)] ?? ''}
                    onChange={(e) => {
                      const perDay = { ...d.perDay };
                      if (e.target.value === '') delete perDay[String(i)];
                      else perDay[String(i)] = Number(e.target.value);
                      set({ perDay });
                    }}
                    style={{ width: '100%' }}
                  />
                </label>
              ))}
            </div>
          </details>
        </div>
      );
    case 'interval':
      return (
        <div className="stack" style={{ gap: 10 }}>
          <div className="row">
            Cada
            <input type="number" min={1} value={d.useMinutes} onChange={(e) => set({ useMinutes: Number(e.target.value) })} style={{ width: 80 }} />
            min de uso, bloquear
            <input type="number" min={1} value={d.breakMinutes} onChange={(e) => set({ breakMinutes: Number(e.target.value) })} style={{ width: 80 }} />
            min.
          </div>
          <label className="row">
            <input type="checkbox" checked={d.intervalWindows} onChange={(e) => set({ intervalWindows: e.target.checked })} />
            Sólo en ciertos horarios
          </label>
          {d.intervalWindows && <WindowsEditor value={d.windows} onChange={(windows) => set({ windows })} />}
        </div>
      );
    case 'until':
      return (
        <label className="field" style={{ maxWidth: 280 }}>
          <span>Bloqueado hasta</span>
          <input type="datetime-local" value={d.until} onChange={(e) => set({ until: e.target.value })} />
        </label>
      );
  }
}

export function WindowsEditor({ value, onChange }: { value: TimeWindow[]; onChange: (v: TimeWindow[]) => void }) {
  const update = (i: number, patch: Partial<TimeWindow>) => onChange(value.map((w, j) => (j === i ? { ...w, ...patch } : w)));
  return (
    <div className="stack" style={{ gap: 8 }}>
      {value.map((w, i) => (
        <div key={i} className="row">
          <div className="day-toggle">
            {WEEKDAY_NAMES.map((name, day) => (
              <button
                type="button"
                key={day}
                className={w.days.includes(day) ? 'on' : ''}
                onClick={() => {
                  const days = w.days.includes(day) ? w.days.filter((x) => x !== day) : [...w.days, day].sort();
                  if (days.length) update(i, { days });
                }}
              >
                {name.slice(0, 2)}
              </button>
            ))}
          </div>
          <input type="time" value={w.start} onChange={(e) => update(i, { start: e.target.value })} />
          a
          <input type="time" value={w.end} onChange={(e) => update(i, { end: e.target.value })} />
          {value.length > 1 && (
            <button type="button" className="ghost danger small" onClick={() => onChange(value.filter((_, j) => j !== i))}>
              Quitar
            </button>
          )}
        </div>
      ))}
      <div className="row">
        <button type="button" className="small" onClick={() => onChange([...value, { days: [1, 2, 3, 4, 5], start: '08:00', end: '14:00' }])}>
          + Otro horario
        </button>
        <span className="muted small">Si el fin es menor que el inicio, cruza la medianoche (22:00 a 07:00).</span>
      </div>
    </div>
  );
}
