import { api, useData, type EventItem, type ProfileSummary } from '../api';
import { Empty, attempt } from '../components/ui';
import { clock } from '../format';

const ICON: Record<EventItem['severity'], string> = { critical: '🚨', warning: '⚠️', info: 'ℹ️' };

export function AlertsPage({ onRead }: { onRead: () => void }) {
  const events = useData<EventItem[]>('/api/events?limit=200', ['event']);
  const profiles = useData<ProfileSummary[]>('/api/profiles');
  const name = (id: string) => profiles.data?.find((p) => p.id === id)?.name ?? '';
  const deviceName = (id: string | null) => profiles.data?.flatMap((p) => p.devices).find((d) => d.id === id)?.name;

  const markAll = async () => {
    await attempt(() => api('/api/events/read', 'POST', {}), 'Marcadas como leídas');
    events.reload();
    onRead();
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Alertas</h1>
          <p className="muted" style={{ margin: 0 }}>
            Intentos de desinstalar, desactivar protecciones, adivinar códigos, cambiar la hora, usar VPN, o dispositivos que dejaron de reportar.
          </p>
        </div>
        <button onClick={markAll}>Marcar todo como leído</button>
      </div>
      <div className="card">
        {events.data?.length === 0 && <Empty>Sin alertas.</Empty>}
        <div className="list">
          {events.data?.map((e) => (
            <div key={e.id} className="list-item" style={{ opacity: e.read ? 0.6 : 1 }}>
              <span style={{ fontSize: '1.4rem' }}>{ICON[e.severity]}</span>
              <div className="grow">
                <div style={{ fontWeight: e.read ? 400 : 700 }}>{e.message}</div>
                <div className="muted small">
                  {name(e.profileId)}
                  {deviceName(e.deviceId) ? ` · ${deviceName(e.deviceId)}` : ''} · {clock(e.createdAt)}
                </div>
              </div>
              {e.severity !== 'info' && !e.read && <span className={`badge ${e.severity === 'critical' ? 'red' : 'amber'}`}>Nueva</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
