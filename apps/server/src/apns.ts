import { createPrivateKey, sign, type KeyObject } from 'node:crypto';
import { connect } from 'node:http2';

/** Despierta agentes móviles para que sincronicen al instante (p. ej. tras "Bloquear ya"). */
export interface DeviceWaker {
  wake(tokens: string[]): Promise<{ invalid: string[] }>;
}

export interface ApnsConfig {
  keyId: string;
  teamId: string;
  /** Contenido PEM de la llave .p8 de Apple. */
  key: string;
  bundleId: string;
  sandbox: boolean;
}

/**
 * Notificaciones silenciosas de Apple (APNs, "content-available") para que la
 * app del iPhone descargue la política nueva aunque esté cerrada. Usa la llave
 * .p8 de la cuenta de Apple Developer (Certificates → Keys → Apple Push Notifications).
 */
export class ApnsWaker implements DeviceWaker {
  private readonly key: KeyObject;
  private token: { value: string; at: number } | null = null;

  constructor(private readonly cfg: ApnsConfig) {
    this.key = createPrivateKey(cfg.key.replace(/\\n/g, '\n'));
  }

  /** JWT ES256 que Apple exige; se renueva cada 50 minutos. */
  jwt(now = Date.now()): string {
    if (this.token && now - this.token.at < 50 * 60_000) return this.token.value;
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const data = `${b64({ alg: 'ES256', kid: this.cfg.keyId })}.${b64({ iss: this.cfg.teamId, iat: Math.floor(now / 1000) })}`;
    const sig = sign('sha256', Buffer.from(data), { key: this.key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    this.token = { value: `${data}.${sig}`, at: now };
    return this.token.value;
  }

  async wake(tokens: string[]): Promise<{ invalid: string[] }> {
    if (!tokens.length) return { invalid: [] };
    const host = this.cfg.sandbox ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
    const session = connect(host);
    const invalid: string[] = [];
    try {
      await Promise.all(
        tokens.map(
          (t) =>
            new Promise<void>((resolve) => {
              const req = session.request({
                ':method': 'POST',
                ':path': `/3/device/${t}`,
                authorization: `bearer ${this.jwt()}`,
                'apns-topic': this.cfg.bundleId,
                'apns-push-type': 'background',
                'apns-priority': '5',
                'content-type': 'application/json',
              });
              req.on('response', (h) => {
                const status = Number(h[':status']);
                if (status === 410 || status === 400) invalid.push(t);
              });
              req.on('close', () => resolve());
              req.on('error', () => resolve());
              req.end(JSON.stringify({ aps: { 'content-available': 1 } }));
            }),
        ),
      );
    } finally {
      session.close();
    }
    return { invalid };
  }
}
