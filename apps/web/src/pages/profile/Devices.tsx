import { useEffect, useState } from 'react';
import { api, type Device } from '../../api';
import { Empty, attempt } from '../../components/ui';
import { PLATFORM_ICONS, PLATFORM_LABELS, timeAgo } from '../../format';
import type { ProfileCtx } from '../Profile';

const PROTECTION_LABELS: Record<string, string> = {
  accessibility: 'Accesibilidad',
  usageAccess: 'Acceso a uso',
  vpn: 'Filtro DNS (VPN local)',
  deviceAdmin: 'Admin. del dispositivo',
  deviceOwner: 'Propietario del dispositivo',
  overlay: 'Mostrar sobre otras apps',
  notifications: 'Notificaciones',
  batteryUnrestricted: 'Sin optimización de batería',
  screenTime: 'Tiempo en pantalla (Screen Time)',
  service: 'Servicio del sistema',
  hostsFile: 'Filtro de sitios (hosts)',
  extension: 'Extensión del navegador',
  incognitoBlocked: 'Incógnito bloqueado',
};

const SETUP: Record<string, string[]> = {
  Android: [
    'Instala Guardián (APK o Play Store) en el celular.',
    'Ábrelo, elige “Vincular” y escribe el código.',
    'Sigue el asistente: activa Accesibilidad, Acceso a uso, VPN local y Administrador del dispositivo.',
    'Opcional (máxima protección): configúralo como “propietario del dispositivo” para impedir desinstalar y el modo seguro.',
  ],
  'iPhone / iPad': [
    'Instala Guardián desde la App Store en el iPhone.',
    'Ábrelo, elige “Vincular” y escribe el código.',
    'Acepta el permiso de Tiempo en pantalla (con Compartir en familia, lo aprueba el adulto).',
    'Elige las apps a bloquear con el selector de Apple (Apple no permite hacerlo remotamente).',
  ],
  'Windows / Mac / Linux': [
    'Instala el agente de escritorio con permisos de administrador.',
    'Escribe el código en la ventana de vinculación.',
    'Instala también la extensión en Chrome/Edge/Firefox para bloquear secciones de sitios y el incógnito.',
    'Usa una cuenta de usuario estándar (no administrador) para el usuario supervisado.',
  ],
  Navegador: ['Instala la extensión Guardián en Chrome, Edge, Brave o Firefox.', 'Abre la extensión y escribe el código.'],
};

export function DevicesTab({ ctx }: { ctx: ProfileCtx }) {
  const { profile } = ctx;
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number } | null>(null);
  const [left, setLeft] = useState(0);
  const [platform, setPlatform] = useState('Android');

  useEffect(() => {
    if (!pairing) return;
    const t = setInterval(() => setLeft(Math.max(0, pairing.expiresAt - Date.now())), 1000);
    setLeft(pairing.expiresAt - Date.now());
    return () => clearInterval(t);
  }, [pairing]);

  const newCode = async () => {
    const r = await attempt(() => api<{ code: string; expiresAt: number }>(`/api/profiles/${profile.id}/pairing-codes`, 'POST'));
    if (r) setPairing(r);
  };

  return (
    <div className="stack">
      <div className="card stack">
        <div className="spread">
          <h2 style={{ margin: 0 }}>Vincular un dispositivo</h2>
          <button className="primary" onClick={newCode}>
            {pairing ? 'Generar otro código' : 'Generar código'}
          </button>
        </div>
        {pairing && left > 0 && (
          <div className="row" style={{ justifyContent: 'center', flexDirection: 'column' }}>
            <div className="pairing-code">{pairing.code}</div>
            <span className="muted small">
              Vence en {Math.floor(left / 60000)}:{String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}
            </span>
          </div>
        )}
        <div className="row" style={{ gap: 6 }}>
          {Object.keys(SETUP).map((p) => (
            <button key={p} className={`small ${platform === p ? 'primary' : ''}`} onClick={() => setPlatform(p)}>
              {p}
            </button>
          ))}
        </div>
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          {SETUP[platform]!.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </div>

      <div className="card">
        <h2>Dispositivos vinculados</h2>
        {profile.devices.length === 0 ? <Empty>Todavía no hay dispositivos.</Empty> : <div className="list">{profile.devices.map((d) => <DeviceRow key={d.id} d={d} ctx={ctx} />)}</div>}
      </div>
    </div>
  );
}

function DeviceRow({ d, ctx }: { d: Device; ctx: ProfileCtx }) {
  const protections = (d.status.protections ?? {}) as Record<string, boolean>;
  const missing = Object.entries(protections).filter(([, v]) => !v);
  const stale = !d.online && (!d.lastSeen || Date.now() - d.lastSeen > 30 * 60_000);

  const rename = async () => {
    const name = prompt('Nuevo nombre', d.name);
    if (name?.trim()) await attempt(() => api(`/api/devices/${d.id}`, 'PATCH', { name }), 'Nombre actualizado').then(ctx.reload);
  };
  const remove = async () => {
    if (confirm(`¿Desvincular “${d.name}”? Dejará de recibir reglas.`)) await attempt(() => api(`/api/devices/${d.id}`, 'DELETE'), 'Dispositivo desvinculado').then(ctx.reload);
  };

  return (
    <div className="list-item" style={{ alignItems: 'flex-start' }}>
      <span style={{ fontSize: '1.8rem' }}>{PLATFORM_ICONS[d.platform] ?? '📟'}</span>
      <div className="grow stack" style={{ gap: 4 }}>
        <div className="row" style={{ gap: 6 }}>
          <strong>{d.name}</strong>
          <span className="muted small">{PLATFORM_LABELS[d.platform] ?? d.platform}</span>
          {d.online ? <span className="badge green">En línea</span> : <span className={`badge ${stale ? 'amber' : ''}`}>Visto {timeAgo(d.lastSeen)}</span>}
          {d.policyVersion < ctx.profile.policyVersion && <span className="badge amber">Actualizando reglas…</span>}
        </div>
        {Object.keys(protections).length > 0 && (
          <div className="row" style={{ gap: 4 }}>
            {Object.entries(protections).map(([k, v]) => (
              <span key={k} className={`badge ${v ? 'green' : 'red'}`}>
                {v ? '✓' : '✕'} {PROTECTION_LABELS[k] ?? k}
              </span>
            ))}
          </div>
        )}
        {missing.length > 0 && <span className="small" style={{ color: 'var(--danger)' }}>Faltan protecciones: el bloqueo puede no funcionar por completo.</span>}
        {typeof d.status.currentApp === 'string' && <span className="muted small">Usando ahora: {d.status.currentApp}</span>}
        {d.agentVersion && <span className="muted small">Agente v{d.agentVersion}</span>}
      </div>
      <div className="row" style={{ gap: 4 }}>
        <a className="btn small" href={`#/perfil/${ctx.profile.id}/codigos`}>
          Códigos
        </a>
        <button className="small" onClick={rename}>
          Renombrar
        </button>
        <button className="small danger" onClick={remove}>
          Desvincular
        </button>
      </div>
    </div>
  );
}
