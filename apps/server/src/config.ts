import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

export interface Config {
  port: number;
  host: string;
  /** Ruta del archivo SQLite, o ":memory:". */
  databasePath: string;
  /** Secreto para firmar sesiones de administrador. */
  tokenSecret: string;
  /** Orígenes permitidos por CORS (el panel web). */
  corsOrigins: string[] | true;
  /** Carpeta con el build del panel web para servirlo desde el mismo servidor. */
  webDist?: string;
  /** Contacto para Web Push (mailto:). */
  vapidSubject: string;
  /** Intervalo de tareas periódicas (dispositivos sin conexión, cambios diferidos). */
  jobIntervalMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const secret = env.GUARDIAN_TOKEN_SECRET;
  if (!secret && env.NODE_ENV === 'production') {
    throw new Error('GUARDIAN_TOKEN_SECRET es obligatorio en producción');
  }
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '0.0.0.0',
    databasePath: env.GUARDIAN_DB ?? resolve('data/guardian.sqlite'),
    tokenSecret: secret ?? randomBytes(32).toString('hex'),
    corsOrigins: env.GUARDIAN_CORS_ORIGINS ? env.GUARDIAN_CORS_ORIGINS.split(',').map((s) => s.trim()) : true,
    webDist: env.GUARDIAN_WEB_DIST ?? resolve('../web/dist'),
    vapidSubject: env.GUARDIAN_VAPID_SUBJECT ?? 'mailto:admin@example.com',
    jobIntervalMs: Number(env.GUARDIAN_JOB_INTERVAL_MS ?? 60_000),
  };
}
