import { useState } from 'react';
import { api, useData, type ProfileSummary } from '../api';
import { Empty, Modal, attempt } from '../components/ui';
import { PLATFORM_ICONS, clock } from '../format';
import { navigate } from '../router';

const AVATARS = ['🧒', '👧', '👦', '🧑', '👩', '👨', '🧑‍🎓', '🧑‍💼', '🐱', '🦊', '🐼', '🚀'];

export function HomePage() {
  const { data: profiles, error, reload } = useData<ProfileSummary[]>('/api/profiles', ['policy', 'device', 'request', 'event']);
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Perfiles</h1>
          <p className="muted" style={{ margin: 0 }}>
            Cada perfil es una persona. Sus reglas aplican en todos sus dispositivos.
          </p>
        </div>
        <button className="primary" onClick={() => setCreating(true)}>
          + Nuevo perfil
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {profiles && profiles.length === 0 && (
        <div className="card">
          <Empty>
            <p style={{ fontSize: '2.5rem', margin: 0 }}>🛡️</p>
            <h2>Empieza creando un perfil</h2>
            <p>Después vincula su celular, tablet o computadora y define qué se bloquea.</p>
            <button className="primary" onClick={() => setCreating(true)}>
              Crear perfil
            </button>
          </Empty>
        </div>
      )}
      <div className="grid">
        {profiles?.map((p) => <ProfileCard key={p.id} p={p} />)}
      </div>
      {creating && (
        <CreateProfile
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            reload();
            navigate(`/perfil/${id}/dispositivos`);
          }}
        />
      )}
    </div>
  );
}

function ProfileCard({ p }: { p: ProfileSummary }) {
  const lock = p.overrides.find((o) => o.type === 'lock');
  const pause = p.overrides.find((o) => o.type === 'pause');
  const online = p.devices.filter((d) => d.online).length;
  return (
    <a href={`#/perfil/${p.id}`} className="card stack" style={{ color: 'inherit', gap: 10 }}>
      <div className="row">
        <span style={{ fontSize: '2rem' }}>{p.avatar ?? '🧑'}</span>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0 }}>{p.name}</h2>
          <span className="muted small">{p.mode === 'self' ? 'Autocontrol' : 'Supervisado'}</span>
        </div>
        {p.pendingRequests > 0 && <span className="badge amber">🔓 {p.pendingRequests}</span>}
        {p.unreadAlerts > 0 && <span className="badge red">🚨 {p.unreadAlerts}</span>}
      </div>
      <div className="row">
        {lock && 'until' in lock && <span className="badge red">⛔ Bloqueado hasta {clock(lock.until)}</span>}
        {pause && 'until' in pause && <span className="badge green">✅ Liberado hasta {clock(pause.until)}</span>}
        {!lock && !pause && <span className="badge blue">Reglas normales</span>}
      </div>
      <div className="row muted small">
        {p.devices.length === 0 ? (
          <span>Sin dispositivos vinculados</span>
        ) : (
          <>
            {p.devices.map((d) => (
              <span key={d.id} title={d.name}>
                {PLATFORM_ICONS[d.platform] ?? '📟'}
              </span>
            ))}
            <span>
              · {online}/{p.devices.length} en línea
            </span>
          </>
        )}
      </div>
    </a>
  );
}

function CreateProfile({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('🧒');
  const [mode, setMode] = useState<'supervised' | 'self'>('supervised');
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const create = async () => {
    const p = await attempt(() => api<ProfileSummary>('/api/profiles', 'POST', { name, avatar, mode, timezone }), 'Perfil creado');
    if (p) onCreated(p.id);
  };
  return (
    <Modal
      title="Nuevo perfil"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancelar</button>
          <button className="primary" disabled={!name.trim()} onClick={create}>
            Crear
          </button>
        </>
      }
    >
      <label className="field">
        <span>Nombre</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Sofía, Empleado 1, Yo…" />
      </label>
      <div className="row" style={{ gap: 4 }}>
        {AVATARS.map((a) => (
          <button key={a} type="button" className={a === avatar ? 'primary' : 'ghost'} onClick={() => setAvatar(a)} style={{ fontSize: '1.3rem', padding: '4px 8px' }}>
            {a}
          </button>
        ))}
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <label className={`pick ${mode === 'supervised' ? 'on' : ''}`}>
          <input type="radio" checked={mode === 'supervised'} onChange={() => setMode('supervised')} />
          <span>
            <strong>Supervisado</strong> — un administrador (padre, madre, tutor, empresa) controla las reglas.
          </span>
        </label>
        <label className={`pick ${mode === 'self' ? 'on' : ''}`}>
          <input type="radio" checked={mode === 'self'} onChange={() => setMode('self')} />
          <span>
            <strong>Autocontrol</strong> — para ti mismo. Puedes poner un tiempo de espera antes de poder relajar las reglas.
          </span>
        </label>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Zona horaria: {timezone}
      </p>
    </Modal>
  );
}
