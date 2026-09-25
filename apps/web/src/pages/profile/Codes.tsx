import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Empty } from '../../components/ui';
import { PLATFORM_ICONS } from '../../format';
import type { ProfileCtx } from '../Profile';

interface Codes {
  validUntil: number;
  codes: { minutes: number; code: string }[];
}

const LABEL: Record<number, string> = { 0: 'Acceso de admin', 15: '15 min', 30: '30 min', 60: '1 hora', 120: '2 horas', 240: '4 horas', 1440: 'Resto del día' };

export function CodesTab({ ctx }: { ctx: ProfileCtx }) {
  const devices = ctx.profile.devices;
  const [deviceId, setDeviceId] = useState(devices[0]?.id ?? '');
  const [codes, setCodes] = useState<Codes>();
  const [error, setError] = useState<string>();
  const [, tick] = useState(0);

  useEffect(() => {
    if (!deviceId) return;
    let alive = true;
    const load = () =>
      api<Codes>(`/api/devices/${deviceId}/unlock-codes`)
        .then((c) => alive && (setCodes(c), setError(undefined)))
        .catch((e: Error) => alive && setError(e.message));
    void load();
    const t = setInterval(() => {
      tick((x) => x + 1);
      if (codes && Date.now() > codes.validUntil - 600_000) void load();
    }, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [deviceId, codes?.validUntil]);

  if (!devices.length) return <Empty>Vincula un dispositivo primero.</Empty>;

  return (
    <div className="stack">
      <div className="card stack">
        <div>
          <h2>Códigos de desbloqueo sin internet</h2>
          <p className="muted" style={{ margin: 0 }}>
            Si el dispositivo no tiene conexión, dicta uno de estos códigos: en la pantalla de bloqueo, “Tengo un código”. Cada código sirve una sola vez,
            funciona sólo en ese dispositivo y cambia cada 10 minutos. Si alguien intenta adivinarlo, recibirás una alerta.
          </p>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {devices.map((d) => (
            <button key={d.id} className={`small ${d.id === deviceId ? 'primary' : ''}`} onClick={() => setDeviceId(d.id)}>
              {PLATFORM_ICONS[d.platform]} {d.name}
            </button>
          ))}
        </div>
        {error && <div className="error">{error}</div>}
        {codes && (
          <>
            <div className="code-grid">
              {codes.codes.map((c) => (
                <div key={c.minutes} className="card" style={{ padding: 14, textAlign: 'center' }}>
                  <div className="muted small">{LABEL[c.minutes] ?? `${c.minutes} min`}</div>
                  <div className="code">{c.code}</div>
                </div>
              ))}
            </div>
            <span className="muted small">
              Válidos hasta las {new Date(codes.validUntil).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}. “Acceso de admin” permite abrir la configuración de
              Guardián en el dispositivo (p. ej. para desinstalarlo) durante 10 minutos.
            </span>
          </>
        )}
      </div>
    </div>
  );
}
