import { useEffect, useState } from 'react';
import { api, setToken, useData } from '../api';
import { attempt } from '../components/ui';

interface Admin {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'admin';
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function SettingsPage() {
  const me = useData<{ account: Admin; family: { name: string } }>('/api/me');
  const admins = useData<Admin[]>('/api/family/admins');
  const [pushState, setPushState] = useState<'unsupported' | 'off' | 'on' | 'denied'>('off');
  const [form, setForm] = useState({ name: '', email: '', password: '' });

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return setPushState('unsupported');
    if (Notification.permission === 'denied') return setPushState('denied');
    void navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription()).then((s) => setPushState(s ? 'on' : 'off'));
  }, []);

  const enablePush = async () => {
    const ok = await attempt(async () => {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Permiso de notificaciones denegado');
      const { publicKey } = await api<{ publicKey: string }>('/api/push/key');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      await api('/api/push/subscribe', 'POST', sub.toJSON());
      return true;
    }, 'Notificaciones activadas en este dispositivo');
    if (ok) setPushState('on');
  };

  const disablePush = async () => {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api('/api/push/unsubscribe', 'POST', { endpoint: sub.endpoint }).catch(() => undefined);
      await sub.unsubscribe();
    }
    setPushState('off');
  };

  const addAdmin = async () => {
    const r = await attempt(() => api('/api/family/admins', 'POST', form), 'Administrador agregado');
    if (r) {
      setForm({ name: '', email: '', password: '' });
      admins.reload();
    }
  };

  const isOwner = me.data?.account.role === 'owner';

  return (
    <div className="stack">
      <h1>Ajustes</h1>
      <div className="card stack">
        <h2>Notificaciones en este dispositivo</h2>
        <p className="muted" style={{ margin: 0 }}>
          Recibe al instante las solicitudes de desbloqueo y los intentos de evasión. En iPhone, primero agrega este panel a la pantalla de inicio (Compartir → “Agregar a inicio”).
        </p>
        <div className="row">
          {pushState === 'on' && (
            <>
              <span className="badge green">Activadas</span>
              <button onClick={() => attempt(() => api('/api/push/test', 'POST'))}>Enviar prueba</button>
              <button className="danger" onClick={disablePush}>
                Desactivar
              </button>
            </>
          )}
          {pushState === 'off' && (
            <button className="primary" onClick={enablePush}>
              Activar notificaciones
            </button>
          )}
          {pushState === 'denied' && <span className="notice">Bloqueaste las notificaciones para este sitio. Actívalas en la configuración del navegador.</span>}
          {pushState === 'unsupported' && <span className="notice">Este navegador no admite notificaciones push.</span>}
        </div>
      </div>

      <ChannelsCard />

      <div className="card stack">
        <h2>Administradores de “{me.data?.family.name}”</h2>
        <p className="muted" style={{ margin: 0 }}>
          Todos pueden cambiar reglas, aprobar solicitudes y reciben las alertas.
        </p>
        <div className="list">
          {admins.data?.map((a) => (
            <div key={a.id} className="list-item">
              <div className="grow">
                <strong>{a.name}</strong> <span className="muted small">{a.email}</span>
              </div>
              <span className="badge">{a.role === 'owner' ? 'Dueño' : 'Admin'}</span>
              {isOwner && a.role !== 'owner' && (
                <button className="small danger" onClick={() => confirm(`¿Quitar a ${a.name}?`) && attempt(() => api(`/api/family/admins/${a.id}`, 'DELETE')).then(admins.reload)}>
                  Quitar
                </button>
              )}
            </div>
          ))}
        </div>
        {isOwner && (
          <div className="stack" style={{ gap: 8 }}>
            <h3 style={{ margin: 0 }}>Agregar administrador</h3>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <input placeholder="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ maxWidth: 200 }} />
              <input placeholder="Correo" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={{ maxWidth: 240 }} />
              <input placeholder="Contraseña temporal" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} style={{ maxWidth: 200 }} />
              <button className="primary" onClick={addAdmin} disabled={!form.name || !form.email || form.password.length < 8}>
                Agregar
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card spread">
        <div>
          <strong>{me.data?.account.name}</strong>
          <div className="muted small">{me.data?.account.email}</div>
        </div>
        <button className="danger" onClick={() => setToken(null)}>
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}

interface Channels {
  telegram: { available: boolean; linked: boolean; bot: string | null };
  email: { available: boolean; address: string; level: 'all' | 'critical' | 'off' };
}

/** Avisos por Telegram (con botones para aprobar) y por correo. */
function ChannelsCard() {
  const channels = useData<Channels>('/api/notifications');
  const c = channels.data;
  if (!c) return null;

  const connectTelegram = async () => {
    const r = await attempt(() => api<{ url: string | null; code: string }>('/api/notifications/telegram/link', 'POST'));
    if (!r) return;
    if (r.url) window.open(r.url, '_blank');
    // Al volver, recarga el estado.
    setTimeout(channels.reload, 8000);
  };

  return (
    <div className="card stack">
      <h2>Otros avisos</h2>
      <div className="toggle-row" style={{ alignItems: 'center' }}>
        <span style={{ fontSize: '1.6rem' }}>✈️</span>
        <div style={{ flex: 1 }}>
          <strong>Telegram</strong>
          <div className="muted small">Te llegan las solicitudes con botones para aprobar o rechazar desde el chat, y las alertas al instante. Gratis.</div>
        </div>
        {!c.telegram.available ? (
          <span className="badge">No configurado en el servidor</span>
        ) : c.telegram.linked ? (
          <>
            <span className="badge green">Conectado</span>
            <button className="small danger" onClick={() => attempt(() => api('/api/notifications/telegram', 'DELETE'), 'Telegram desconectado').then(channels.reload)}>
              Desconectar
            </button>
          </>
        ) : (
          <button className="primary" onClick={connectTelegram}>
            Conectar Telegram
          </button>
        )}
      </div>
      <div className="toggle-row" style={{ alignItems: 'center' }}>
        <span style={{ fontSize: '1.6rem' }}>✉️</span>
        <div style={{ flex: 1 }}>
          <strong>Correo</strong>
          <div className="muted small">{c.email.available ? `A ${c.email.address}` : 'El servidor no tiene configurado el envío de correos.'}</div>
        </div>
        {c.email.available && (
          <select
            value={c.email.level}
            style={{ width: 'auto' }}
            onChange={(e) => attempt(() => api('/api/notifications/email', 'PUT', { level: e.target.value }), 'Guardado').then(channels.reload)}
          >
            <option value="critical">Sólo alertas críticas</option>
            <option value="all">Alertas y avisos</option>
            <option value="off">Nada</option>
          </select>
        )}
      </div>
    </div>
  );
}
