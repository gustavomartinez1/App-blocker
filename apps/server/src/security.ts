import { createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('base64url')}`;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64url');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64url'), expected.length);
  return timingSafeEqual(actual, expected);
}

export interface AdminClaims {
  sub: string;
  fam: string;
  exp: number;
}

/** Token de sesión firmado con HMAC-SHA256: base64url(json).base64url(firma). */
export function signAdminToken(secret: string, accountId: string, familyId: string, ttlMs = 30 * 24 * 3600_000): string {
  const payload = Buffer.from(JSON.stringify({ sub: accountId, fam: familyId, exp: Date.now() + ttlMs } satisfies AdminClaims)).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyAdminToken(secret: string, token: string): AdminClaims | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as AdminClaims;
    return claims.exp > Date.now() ? claims : null;
  } catch {
    return null;
  }
}

/** Token opaco de dispositivo: se guarda sólo su hash. */
export function newDeviceToken(): { token: string; hash: string } {
  const token = `dev_${randomBytes(32).toString('base64url')}`;
  return { token, hash: hashDeviceToken(token) };
}

export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Código de vinculación legible, sin caracteres ambiguos (0/O, 1/I). */
export function newPairingCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[randomInt(alphabet.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Secreto de códigos sin conexión propio de cada dispositivo, derivado del del perfil. */
export function deviceUnlockSecret(profileSecret: string, deviceId: string): string {
  return createHmac('sha256', profileSecret).update(`device:${deviceId}`).digest('base64url');
}
