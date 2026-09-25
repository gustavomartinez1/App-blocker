import type { PolicyInput } from '@guardian/core';
import { api, useData, type PolicyResponse, type ProfileSummary } from '../api';
import { attempt, toast } from '../components/ui';
import { clock } from '../format';
import { AllowlistTab } from './profile/Allowlist';
import { CodesTab } from './profile/Codes';
import { DevicesTab } from './profile/Devices';
import { ProtectionsTab } from './profile/Protections';
import { RulesTab } from './profile/Rules';
import { SummaryTab } from './profile/Summary';

const TABS = [
  ['resumen', 'Resumen'],
  ['reglas', 'Reglas'],
  ['permitidas', 'Siempre permitido'],
  ['dispositivos', 'Dispositivos'],
  ['protecciones', 'Protecciones'],
  ['codigos', 'Códigos sin internet'],
] as const;

export interface ProfileCtx {
  profile: ProfileSummary;
  policy: PolicyResponse;
  reload: () => void;
  savePolicy: (next: PolicyInput) => Promise<boolean>;
}

export function ProfilePage({ id, tab }: { id: string; tab: string }) {
  const profile = useData<ProfileSummary>(`/api/profiles/${id}`, ['policy', 'device']);
  const policy = useData<PolicyResponse>(`/api/profiles/${id}/policy`, ['policy']);
  const reload = () => {
    profile.reload();
    policy.reload();
  };

  if (profile.error) return <div className="error">{profile.error}</div>;
  if (!profile.data || !policy.data) return <p className="muted">Cargando…</p>;

  const ctx: ProfileCtx = {
    profile: profile.data,
    policy: policy.data,
    reload,
    async savePolicy(next) {
      const res = await attempt(() => api<{ applied: boolean; applyAt?: number }>(`/api/profiles/${id}/policy`, 'PUT', next));
      if (!res) return false;
      if (res.applied) toast('Guardado. Los dispositivos se actualizan al instante.');
      else toast(`Modo autocontrol: el cambio se aplicará a las ${clock(res.applyAt!)}`);
      reload();
      return true;
    },
  };

  const p = profile.data;
  return (
    <div>
      <div className="page-head">
        <div className="row">
          <a href="#/" className="muted">
            ← Perfiles
          </a>
        </div>
      </div>
      <div className="row" style={{ marginBottom: 16 }}>
        <span style={{ fontSize: '2.4rem' }}>{p.avatar ?? '🧑'}</span>
        <div>
          <h1 style={{ margin: 0 }}>{p.name}</h1>
          <span className="muted small">
            {p.mode === 'self' ? 'Autocontrol' : 'Supervisado'} · {p.timezone} · {p.devices.length} dispositivo(s)
          </span>
        </div>
      </div>
      <nav className="tabs">
        {TABS.map(([t, label]) => (
          <a key={t} href={`#/perfil/${id}/${t}`} className={`tab ${tab === t ? 'active' : ''}`}>
            {label}
          </a>
        ))}
      </nav>
      {tab === 'resumen' && <SummaryTab ctx={ctx} />}
      {tab === 'reglas' && <RulesTab ctx={ctx} />}
      {tab === 'permitidas' && <AllowlistTab ctx={ctx} />}
      {tab === 'dispositivos' && <DevicesTab ctx={ctx} />}
      {tab === 'protecciones' && <ProtectionsTab ctx={ctx} />}
      {tab === 'codigos' && <CodesTab ctx={ctx} />}
    </div>
  );
}
