import { formatDuration, type Override } from '@guardian/core';
import { useState } from 'react';
import { api, useData, type UsageSummary } from '../../api';
import { MODE_INFO } from '../../components/RuleEditor';
import { Empty, Modal, Progress, attempt } from '../../components/ui';
import { clock, minutesUntilTomorrow } from '../../format';
import type { ProfileCtx } from '../Profile';

const DURATIONS = [
  { label: '15 min', minutes: 15 },
  { label: '30 min', minutes: 30 },
  { label: '1 hora', minutes: 60 },
  { label: '2 horas', minutes: 120 },
  { label: 'Hasta mañana', minutes: -1 },
];

export function SummaryTab({ ctx }: { ctx: ProfileCtx }) {
  const { profile, policy } = ctx;
  const usage = useData<UsageSummary>(`/api/profiles/${profile.id}/usage`, ['usage', 'policy']);
  const history = useData<{ day: string; usedMs: number }[]>(`/api/profiles/${profile.id}/usage/history?days=7`, ['usage']);
  const [action, setAction] = useState<'lock' | 'pause' | 'bonus' | null>(null);

  const lock = profile.overrides.find((o) => o.type === 'lock');
  const pause = profile.overrides.find((o) => o.type === 'pause');
  const others = profile.overrides.filter((o) => o.type === 'unlock' || o.type === 'bonus');

  const removeOverride = (o: Override) =>
    attempt(() => api(`/api/profiles/${profile.id}/overrides/${o.id}`, 'DELETE'), 'Listo').then(ctx.reload);

  return (
    <div className="stack">
      <div className={`status-banner ${lock ? 'lock' : pause ? 'pause' : 'normal'}`}>
        <span style={{ fontSize: '1.8rem' }}>{lock ? '⛔' : pause ? '✅' : '🛡️'}</span>
        <div style={{ flex: '1 1 220px' }}>
          <strong>
            {lock && 'until' in lock ? `Bloqueado por ti hasta ${clock(lock.until)}` : pause && 'until' in pause ? `Liberado hasta ${clock(pause.until)}` : 'Aplicando las reglas normales'}
          </strong>
          <div className="small">
            {lock ? 'Sólo funcionan llamadas, SMS, emergencias y lo que marcaste como siempre permitido.' : pause ? 'Sólo siguen activas las reglas estrictas.' : `${policy.policy.rules.filter((r) => r.enabled).length} reglas activas`}
          </div>
        </div>
        {(lock || pause) && <button onClick={() => removeOverride((lock ?? pause)!)}>Terminar ahora</button>}
      </div>

      <div className="row">
        <button className="danger solid" onClick={() => setAction('lock')}>
          ⛔ Bloquear ya
        </button>
        <button className="primary" onClick={() => setAction('pause')}>
          ✅ Liberar dispositivo
        </button>
        <button onClick={() => setAction('bonus')}>⏱️ Dar tiempo extra</button>
      </div>

      {others.length > 0 && (
        <div className="card">
          <h3>Excepciones activas</h3>
          <div className="list">
            {others.map((o) => (
              <div key={o.id} className="list-item">
                <div className="grow">
                  {o.type === 'bonus' ? `+${o.minutes} min hoy` : `Desbloqueado hasta ${clock(o.until)}`}
                  {' · '}
                  <span className="muted">{o.note ?? (o.ruleId ? policy.policy.rules.find((r) => r.id === o.ruleId)?.name : 'todas las reglas de límite')}</span>
                </div>
                <button className="small danger" onClick={() => removeOverride(o)}>
                  Quitar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {policy.pending.length > 0 && (
        <div className="notice">
          <strong>Cambios en espera (modo autocontrol):</strong>
          {policy.pending.map((c) => (
            <div key={c.id} className="spread" style={{ marginTop: 6 }}>
              <span>
                {c.kind === 'policy' ? 'Cambio de reglas' : 'Excepción'} — se aplica a las {clock(c.applyAt)}
              </span>
              <button className="small" onClick={() => attempt(() => api(`/api/profiles/${profile.id}/pending/${c.id}`, 'DELETE'), 'Cambio cancelado').then(ctx.reload)}>
                Cancelar
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <div className="card">
          <div className="spread">
            <h3>Reglas hoy</h3>
            <a href={`#/perfil/${profile.id}/reglas`} className="small">
              Editar
            </a>
          </div>
          {usage.data?.rules.length ? (
            <div className="list">
              {usage.data.rules.map((r) => (
                <div key={r.ruleId} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6, opacity: r.enabled ? 1 : 0.5 }}>
                  <div className="spread">
                    <span>
                      {MODE_INFO[r.mode].icon} {r.name}
                    </span>
                    {r.blocked ? <span className="badge red">Bloqueado{r.until ? ` hasta ${clock(r.until)}` : ''}</span> : <span className="badge green">Permitido</span>}
                  </div>
                  {r.limitMs !== undefined && (
                    <>
                      <Progress value={r.usedMs} max={r.limitMs} />
                      <span className="muted small">
                        {formatDuration(r.usedMs)} de {formatDuration(r.limitMs)}
                        {r.maxOpens ? ` · ${r.opens ?? 0}/${r.maxOpens} aperturas` : ''}
                      </span>
                    </>
                  )}
                  {r.nextBlockAt && !r.blocked && <span className="muted small">Próximo bloqueo: {clock(r.nextBlockAt)}</span>}
                </div>
              ))}
            </div>
          ) : (
            <Empty>
              Sin reglas todavía. <a href={`#/perfil/${profile.id}/reglas`}>Crear la primera</a>
            </Empty>
          )}
        </div>

        <div className="card">
          <div className="spread">
            <h3>Uso de hoy</h3>
            <strong>{formatDuration(usage.data?.totalMs ?? 0)}</strong>
          </div>
          {usage.data?.items.length ? (
            <div className="list">
              {usage.data.items.slice(0, 10).map((i) => (
                <div key={i.key} className="list-item">
                  <div className="grow">
                    {i.label}
                    <div className="muted small">
                      {i.opens} aperturas{i.blockedAttempts ? ` · ${i.blockedAttempts} intentos bloqueados` : ''}
                    </div>
                  </div>
                  <strong>{formatDuration(i.usedMs)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <Empty>Aún no hay uso registrado hoy.</Empty>
          )}
        </div>
      </div>

      {history.data && (
        <div className="card">
          <h3>Últimos 7 días</h3>
          <div className="bars">
            {history.data.map((h) => {
              const max = Math.max(...history.data!.map((x) => x.usedMs), 1);
              return (
                <div key={h.day} className="bar" title={formatDuration(h.usedMs)}>
                  <span className="small muted">{h.usedMs ? formatDuration(h.usedMs) : ''}</span>
                  <div style={{ height: `${(h.usedMs / max) * 80}%` }} />
                  <span className="small muted">{new Date(`${h.day}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'short' })}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {action && <QuickAction ctx={ctx} type={action} onClose={() => setAction(null)} />}
    </div>
  );
}

function QuickAction({ ctx, type, onClose }: { ctx: ProfileCtx; type: 'lock' | 'pause' | 'bonus'; onClose: () => void }) {
  const limitRules = ctx.policy.policy.rules.filter((r) => r.mode === 'limit');
  const [ruleId, setRuleId] = useState('');
  const [note, setNote] = useState('');
  const titles = { lock: '⛔ Bloquear todo ahora', pause: '✅ Liberar el dispositivo', bonus: '⏱️ Dar tiempo extra hoy' };
  const run = async (minutes: number) => {
    const m = minutes === -1 ? minutesUntilTomorrow() : minutes;
    const body = type === 'bonus' ? { type, minutes: m, ruleId: ruleId || undefined, note: note || undefined } : { type, minutes: m, note: note || undefined };
    const res = await attempt(() => api<{ applied: boolean }>(`/api/profiles/${ctx.profile.id}/overrides`, 'POST', body), 'Aplicado en todos los dispositivos');
    if (res) {
      ctx.reload();
      onClose();
    }
  };
  return (
    <Modal title={titles[type]} onClose={onClose}>
      <p className="muted" style={{ margin: 0 }}>
        {type === 'lock' && 'Bloquea todas las apps y sitios (salvo llamadas, SMS y emergencias) en todos sus dispositivos.'}
        {type === 'pause' && 'Desactiva los bloqueos (menos las reglas estrictas) durante el tiempo que elijas.'}
        {type === 'bonus' && 'Suma minutos a los límites diarios de hoy.'}
      </p>
      {type === 'bonus' && (
        <label className="field">
          <span>¿A qué límite?</span>
          <select value={ruleId} onChange={(e) => setRuleId(e.target.value)}>
            <option value="">Todos los límites</option>
            {limitRules.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span>Nota (opcional, la verá en su dispositivo)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={type === 'lock' ? 'Hora de cenar' : 'Premio por las calificaciones'} />
      </label>
      <div className="row">
        {(type === 'bonus' ? DURATIONS.slice(0, 4) : DURATIONS).map((d) => (
          <button key={d.label} className={type === 'lock' ? 'danger' : 'primary'} onClick={() => run(d.minutes)}>
            {type === 'bonus' ? `+${d.label}` : d.label}
          </button>
        ))}
      </div>
    </Modal>
  );
}
