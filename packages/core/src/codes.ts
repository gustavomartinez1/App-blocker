/**
 * Códigos de desbloqueo sin conexión.
 *
 * El admin ve en su panel un código de 6 dígitos (tipo "autenticador") que el
 * usuario teclea en la pantalla de bloqueo. El dispositivo lo valida con el
 * secreto compartido del perfil, sin internet. Cada código codifica la duración
 * del desbloqueo y caduca en 10-20 minutos. Los agentes guardan los códigos ya
 * usados para impedir reutilizarlos, y avisan al admin tras varios intentos
 * fallidos.
 *
 * Algoritmo (replicado en Kotlin y Swift):
 *   paso   = floor(epochSegundos / 600)
 *   hmac   = HMAC-SHA256(utf8(secreto), utf8(`${paso}:${minutos}`))
 *   offset = hmac[31] & 0x0f
 *   código = (uint31 big-endian en hmac[offset..offset+3]) mod 1_000_000, 6 dígitos
 */

export const CODE_STEP_SECONDS = 600;
/** Duraciones que puede conceder un código. 0 = acceso de administrador en el dispositivo. */
export const CODE_DURATIONS = [0, 15, 30, 60, 120, 240, 1440] as const;
export type CodeDuration = (typeof CODE_DURATIONS)[number];

const encoder = new TextEncoder();

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await globalThis.crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

function truncate(h: Uint8Array): string {
  const o = (h[31] ?? 0) & 0x0f;
  const bin = (((h[o] ?? 0) & 0x7f) << 24) | ((h[o + 1] ?? 0) << 16) | ((h[o + 2] ?? 0) << 8) | (h[o + 3] ?? 0);
  return String(bin % 1_000_000).padStart(6, '0');
}

export function codeStep(now: Date): number {
  return Math.floor(now.getTime() / 1000 / CODE_STEP_SECONDS);
}

export async function generateUnlockCode(secret: string, minutes: CodeDuration, now: Date = new Date()): Promise<string> {
  return truncate(await hmacSha256(secret, `${codeStep(now)}:${minutes}`));
}

export interface VerifiedCode {
  minutes: CodeDuration;
  step: number;
}

/** Devuelve la duración si el código es válido (paso actual o anterior). */
export async function verifyUnlockCode(secret: string, code: string, now: Date = new Date()): Promise<VerifiedCode | null> {
  const clean = code.replace(/\D/g, '');
  if (clean.length !== 6) return null;
  const step = codeStep(now);
  for (const s of [step, step - 1]) {
    for (const minutes of CODE_DURATIONS) {
      if (truncate(await hmacSha256(secret, `${s}:${minutes}`)) === clean) return { minutes, step: s };
    }
  }
  return null;
}

/** Secreto aleatorio (base64url, 32 bytes). */
export function randomSecret(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
