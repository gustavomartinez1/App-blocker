import type { Target } from '@guardian/core';
import { useState } from 'react';
import { TargetPicker } from '../../components/TargetPicker';
import type { ProfileCtx } from '../Profile';

export function AllowlistTab({ ctx }: { ctx: ProfileCtx }) {
  const input = ctx.policy.policy;
  const [list, setList] = useState<Target[]>(input.allowlist);
  const dirty = JSON.stringify(list) !== JSON.stringify(input.allowlist);
  return (
    <div className="stack">
      <div className="card stack">
        <div>
          <h2>Siempre permitido</h2>
          <p className="muted" style={{ margin: 0 }}>
            Estas apps y sitios nunca se bloquean, ni siquiera con “Bloquear ya” o de noche: escuela, mapas, apps de salud, el banco…
            Las llamadas, SMS y números de emergencia siempre están permitidos automáticamente.
          </p>
        </div>
        <TargetPicker value={list} onChange={setList} allowAll={false} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button disabled={!dirty} onClick={() => setList(input.allowlist)}>
            Descartar
          </button>
          <button className="primary" disabled={!dirty} onClick={() => ctx.savePolicy({ rules: input.rules, allowlist: list, settings: input.settings })}>
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
