import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
  /** URL pública del panel (para enlaces en correos y Telegram). */
  publicUrl?: string;
  /** Token del bot de Telegram (de @BotFather). Sin él no hay avisos por Telegram. */
  telegramBotToken?: string;
  /** SMTP para avisos por correo, p. ej. smtps://usuario:clave@smtp.proveedor.com:465 */
  smtpUrl?: string;
  smtpFrom: string;
  /** APNs (notificaciones silenciosas al iPhone). Todos los campos o ninguno. */
  apns?: { keyId: string; teamId: string; key: string; bundleId: string; sandbox: boolean };
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
    publicUrl: env.GUARDIAN_PUBLIC_URL?.replace(/\/+$/, ''),
    telegramBotToken: env.GUARDIAN_TELEGRAM_BOT_TOKEN || undefined,
    smtpUrl: env.GUARDIAN_SMTP_URL || undefined,
    smtpFrom: env.GUARDIAN_SMTP_FROM ?? 'Guardián <alertas@example.com>',
    apns:
      env.GUARDIAN_APNS_KEY_ID && env.GUARDIAN_APNS_TEAM_ID && (env.GUARDIAN_APNS_KEY || env.GUARDIAN_APNS_KEY_FILE)
        ? {
            keyId: env.GUARDIAN_APNS_KEY_ID,
            teamId: env.GUARDIAN_APNS_TEAM_ID,
            key: env.GUARDIAN_APNS_KEY ?? readFileSync(env.GUARDIAN_APNS_KEY_FILE!, 'utf8'),
            bundleId: env.GUARDIAN_APNS_BUNDLE_ID ?? 'com.guardian.blocker',
            sandbox: env.GUARDIAN_APNS_SANDBOX === '1',
          }
        : undefined,
  };
}
