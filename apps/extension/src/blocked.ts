import type { Decision } from '@guardian/core';
import { $, send } from './messaging';

const params = new URLSearchParams(location.search);
const url = params.get('u') ?? '';
const isSettings = params.has('settings');
let host = url;
try {
  host = new URL(url).hostname.replace(/^www\./, '');
} catch {
  /* URL interna */
}

function result(text: string, ok: boolean): void {
  $('result').textContent = text;
  $('result').className = `msg ${ok ? 'ok' : 'err'}`;
}

async function init(): Promise<void> {
  $('site').textContent = isSettings ? 'Configuración protegida' : host;
  if (isSettings) {
    $('message').textContent = 'El administrador protegió esta página. Si necesitas entrar, pide un código de “Acceso de admin”.';
    $('btn-request').style.display = 'none';
    return;
  }
  const d = await send<Decision>({ type: 'check', url });
  if (!d.blocked) {
    location.replace(url);
    return;
  }
  $('message').textContent = d.message;
  if (d.strict) $('actions').style.display = 'none';
  if (d.until) {
    const until = new Date(d.until).getTime();
    const tick = () => {
      const ms = until - Date.now();
      if (ms <= 0) return location.replace(url);
      const h = Math.floor(ms / 3.6e6);
      const m = Math.floor((ms % 3.6e6) / 6e4);
      const s = Math.floor((ms % 6e4) / 1e3);
      $('until').textContent = `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`;
    };
    tick();
    setInterval(tick, 1000);
  }
}

function show(panel: string): void {
  for (const p of ['panel-request', 'panel-code']) $(p).classList.toggle('on', p === panel);
  $('result').textContent = '';
}

$('btn-request').onclick = () => show('panel-request');
$('btn-code').onclick = () => {
  show('panel-code');
  $('code').focus();
};

$('send').onclick = async () => {
  try {
    const minutes = Number($<HTMLSelectElement>('minutes').value);
    const reason = $<HTMLTextAreaElement>('reason').value.trim() || undefined;
    const r = await send<{ id: string }>({ type: 'request', url, minutes, reason });
    result('Solicitud enviada. Espera la respuesta…', true);
    const poll = setInterval(async () => {
      const s = await send<{ status: string; minutesGranted: number | null }>({ type: 'requestStatus', id: r.id }).catch(() => null);
      if (!s || s.status === 'pending') return;
      clearInterval(poll);
      if (s.status === 'approved') {
        result(`¡Aprobada! Tienes ${s.minutesGranted} min.`, true);
        setTimeout(() => location.replace(url), 1500);
      } else result(s.status === 'denied' ? 'Tu solicitud fue rechazada.' : 'La solicitud venció.', false);
    }, 4000);
  } catch (e) {
    result((e as Error).message, false);
  }
};

$('check').onclick = async () => {
  const input = $<HTMLInputElement>('code');
  const r = await send<{ ok: true; minutes: number } | { ok: false; attempts: number }>({ type: 'code', code: input.value });
  input.value = '';
  if (r.ok) {
    result(r.minutes ? `Código aceptado: ${r.minutes} min libres.` : 'Acceso de administrador por 10 min.', true);
    setTimeout(() => location.replace(url), 1200);
  } else result(`Código incorrecto (${r.attempts} intentos). Se avisará al administrador.`, false);
};

void init();
