import { formatDuration, type RuleStatus } from '@guardian/core';
import { $, send } from './messaging';

async function render(): Promise<void> {
  const s = await send<{ paired: boolean; profile?: { name: string }; statuses?: RuleStatus[] }>({ type: 'status' });
  $('pair').style.display = s.paired ? 'none' : 'block';
  $('status').style.display = s.paired ? 'block' : 'none';
  if (!s.paired) return;
  $('who').textContent = `Protegiendo a ${s.profile?.name ?? ''}`;
  const list = $('rules');
  list.innerHTML = '';
  for (const r of s.statuses ?? []) {
    if (!r.enabled) continue;
    const li = document.createElement('li');
    const state = r.blocked ? '⛔ bloqueado' : r.remainingMs !== undefined ? `quedan ${formatDuration(r.remainingMs)}` : '✅';
    li.textContent = `${r.name} — ${state}`;
    list.append(li);
  }
  if (!list.children.length) list.innerHTML = '<li>Sin reglas activas</li>';
}

$<HTMLFormElement>('pair-form').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await send({
      type: 'pair',
      server: $<HTMLInputElement>('server').value.trim(),
      code: $<HTMLInputElement>('code').value.trim(),
      name: $<HTMLInputElement>('name').value.trim() || 'Navegador',
    });
    await render();
  } catch (err) {
    $('pair-result').textContent = (err as Error).message;
  }
};

void render();
