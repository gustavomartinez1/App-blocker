import type { Settings } from '@guardian/core';
import { useState } from 'react';
import type { ProfileCtx } from '../Profile';

const TOGGLES: { key: keyof Settings; title: string; description: string }[] = [
  { key: 'blockAdultContent', title: 'Filtro de contenido para adultos', description: 'Usa un DNS familiar que bloquea millones de sitios para adultos y de malware, además de la categoría “Adultos”.' },
  { key: 'enforceSafeSearch', title: 'Búsqueda segura obligatoria', description: 'Fuerza SafeSearch en Google, Bing y DuckDuckGo, y el modo restringido de YouTube.' },
  { key: 'blockIncognito', title: 'Bloquear modo incógnito', description: 'Evita la navegación privada donde el sistema lo permite (Chrome/Edge administrados, Android).' },
  { key: 'preventUninstall', title: 'Impedir desinstalar Guardián', description: 'Pide autorización para desinstalar o desactivar el agente. Si lo intentan, recibes una alerta.' },
  { key: 'protectSettings', title: 'Proteger ajustes del sistema', description: 'Bloquea cambiar fecha/hora, desactivar accesibilidad o VPN, restablecer, y forzar la detención de la app.' },
  { key: 'blockBypassTools', title: 'Bloquear herramientas de evasión', description: 'Detecta y bloquea apps de VPN, proxys, Tor y DNS cifrado alternativo.' },
  { key: 'approveNewApps', title: 'Aprobar apps nuevas', description: 'Toda app que se instale queda bloqueada hasta que la apruebes desde Solicitudes.' },
  { key: 'unlockRequestsEnabled', title: 'Permitir solicitudes de desbloqueo', description: 'Desde la pantalla de bloqueo pueden pedirte más tiempo o un desbloqueo; te llega una notificación.' },
  { key: 'offlineCodesEnabled', title: 'Permitir códigos sin internet', description: 'Puedes dictar un código de 6 dígitos para desbloquear aunque el dispositivo no tenga conexión.' },
];

export function ProtectionsTab({ ctx }: { ctx: ProfileCtx }) {
  const input = ctx.policy.policy;
  const [s, setS] = useState<Settings>(input.settings);
  const dirty = JSON.stringify(s) !== JSON.stringify(input.settings);
  const num = (key: 'warnBeforeMinutes' | 'offlineAlertMinutes' | 'relaxCooldownMinutes') => (e: React.ChangeEvent<HTMLInputElement>) =>
    setS({ ...s, [key]: Number(e.target.value) });

  return (
    <div className="stack">
      <div className="card">
        <h2>Protecciones</h2>
        {TOGGLES.map((t) => (
          <label key={t.key} className="toggle-row">
            <input type="checkbox" checked={Boolean(s[t.key])} onChange={(e) => setS({ ...s, [t.key]: e.target.checked })} />
            <span>
              <strong>{t.title}</strong>
              <div className="muted small">{t.description}</div>
            </span>
          </label>
        ))}
      </div>
      <div className="card stack">
        <h2>Avisos y tiempos</h2>
        <label className="row">
          Avisar al usuario
          <input type="number" min={0} max={60} value={s.warnBeforeMinutes} onChange={num('warnBeforeMinutes')} style={{ width: 80 }} />
          min antes de que se acabe su tiempo.
        </label>
        <label className="row">
          Alertarme si un dispositivo pasa
          <input type="number" min={5} max={1440} value={s.offlineAlertMinutes} onChange={num('offlineAlertMinutes')} style={{ width: 90 }} />
          min sin conectarse.
        </label>
        {ctx.profile.mode === 'self' && (
          <label className="row">
            Esperar
            <input type="number" min={0} max={10080} value={s.relaxCooldownMinutes} onChange={num('relaxCooldownMinutes')} style={{ width: 90 }} />
            min antes de aplicar cambios que relajen las reglas (contra impulsos).
          </label>
        )}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button disabled={!dirty} onClick={() => setS(input.settings)}>
          Descartar
        </button>
        <button className="primary" disabled={!dirty} onClick={() => ctx.savePolicy({ rules: input.rules, allowlist: input.allowlist, settings: s })}>
          Guardar
        </button>
      </div>
    </div>
  );
}
