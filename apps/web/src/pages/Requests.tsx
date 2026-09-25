import { describeTarget } from '@guardian/core';
import { useState } from 'react';
import { api, useData, type ProfileSummary, type RequestItem } from '../api';
import { Empty, attempt } from '../components/ui';
import { clock, timeAgo } from '../format';

const STATUS: Record<RequestItem['status'], [string, string]> = {
  pending: ['Pendiente', 'amber'],
  approved: ['Aprobada', 'green'],
  denied: ['Rechazada', 'red'],
  expired: ['Vencida', ''],
};

export function RequestsPage() {
  const pending = useData<RequestItem[]>('/api/requests?status=pending', ['request']);
  const all = useData<RequestItem[]>('/api/requests', ['request']);
  const profiles = useData<ProfileSummary[]>('/api/profiles');
  const name = (id: string) => profiles.data?.find((p) => p.id === id)?.name ?? '';
  const history = all.data?.filter((r) => r.status !== 'pending').slice(0, 50) ?? [];

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Solicitudes</h1>
          <p className="muted" style={{ margin: 0 }}>
            Cuando alguien toca “Pedir desbloqueo” o “Pedir más tiempo”, aparece aquí y te llega una notificación.
          </p>
        </div>
      </div>
      {pending.data?.length === 0 && (
        <div className="card">
          <Empty>No hay solicitudes pendientes 🎉</Empty>
        </div>
      )}
      <div className="grid">
        {pending.data?.map((r) => <PendingCard key={r.id} r={r} profileName={name(r.profileId)} onDone={() => (pending.reload(), all.reload())} />)}
      </div>
      {history.length > 0 && (
        <div className="card">
          <h2>Historial</h2>
          <div className="list">
            {history.map((r) => (
              <div key={r.id} className="list-item">
                <div className="grow">
                  <strong>{name(r.profileId)}</strong> · {r.label}
                  <div className="muted small">
                    {clock(r.createdAt)}
                    {r.reason ? ` · “${r.reason}”` : ''}
                    {r.minutesGranted ? ` · ${r.minutesGranted} min concedidos` : ''}
                  </div>
                </div>
                <span className={`badge ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PendingCard({ r, profileName, onDone }: { r: RequestItem; profileName: string; onDone: () => void }) {
  const [minutes, setMinutes] = useState(r.minutesRequested || 15);
  const decide = async (approve: boolean) => {
    const res = await attempt(() => api<{ applied: boolean }>(`/api/requests/${r.id}/decision`, 'POST', { approve, minutes: r.kind === 'new_app' ? undefined : minutes }), approve ? 'Aprobada' : 'Rechazada');
    if (res) onDone();
  };
  const title = r.kind === 'new_app' ? 'Quiere usar una app nueva' : r.kind === 'more_time' ? 'Pide más tiempo' : 'Pide desbloquear';
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="spread">
        <strong>{profileName}</strong>
        <span className="muted small">{timeAgo(r.createdAt)}</span>
      </div>
      <div>
        <div className="muted small">{title}</div>
        <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{r.label}</div>
        {r.target && r.kind !== 'new_app' && <div className="muted small">{describeTarget(r.target)}</div>}
        {r.reason && <p style={{ margin: '6px 0 0' }}>“{r.reason}”</p>}
      </div>
      {r.kind !== 'new_app' && (
        <div className="row">
          {[5, 15, 30, 60].map((m) => (
            <button key={m} className={`small ${minutes === m ? 'primary' : ''}`} onClick={() => setMinutes(m)}>
              {m} min
            </button>
          ))}
          <input type="number" min={1} max={1440} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} style={{ width: 80 }} />
        </div>
      )}
      <div className="row">
        <button className="primary" onClick={() => decide(true)}>
          {r.kind === 'new_app' ? 'Aprobar app' : `Dar ${minutes} min`}
        </button>
        <button className="danger" onClick={() => decide(false)}>
          Rechazar
        </button>
      </div>
    </div>
  );
}
