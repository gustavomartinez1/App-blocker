import webpush from 'web-push';
import type { Db } from './db.js';

export interface Alert {
  title: string;
  body: string;
  /** Ruta del panel que se abre al tocar la notificación. */
  url?: string;
  tag?: string;
  severity?: 'info' | 'warning' | 'critical';
  /** Si la alerta es una solicitud: permite responderla desde Telegram. */
  request?: { id: string; kind: 'unlock' | 'more_time' | 'new_app'; minutes: number };
}

export interface AccountTarget {
  id: string;
  name: string;
  email: string;
  telegram_chat_id: string | null;
  email_alerts: 'all' | 'critical' | 'off';
}

/** Canal adicional de avisos (Telegram, correo…). */
export interface Channel {
  readonly name: string;
  send(account: AccountTarget, alert: Alert): Promise<void>;
}

export interface PushSender {
  send(subscription: webpush.PushSubscription, payload: string): Promise<void>;
}

/**
 * Notificaciones push a los administradores (Web Push: funciona en Android,
 * iOS 16.4+ con el panel instalado como app, Windows y macOS). El panel en
 * vivo recibe además todo por WebSocket.
 */
export class Notifier {
  readonly publicKey: string;
  private readonly sender: PushSender;
  private readonly channels: Channel[] = [];

  constructor(private readonly db: Db, subject: string, sender?: PushSender) {
    let keys = db.kvGet('vapid');
    if (!keys) {
      keys = JSON.stringify(webpush.generateVAPIDKeys());
      db.kvSet('vapid', keys);
    }
    const { publicKey, privateKey } = JSON.parse(keys) as { publicKey: string; privateKey: string };
    this.publicKey = publicKey;
    this.sender = sender ?? {
      send: async (sub, payload) => {
        await webpush.sendNotification(sub, payload, { vapidDetails: { subject, publicKey, privateKey }, TTL: 24 * 3600 });
      },
    };
  }

  addChannel(channel: Channel): void {
    this.channels.push(channel);
  }

  hasChannel(name: string): boolean {
    return this.channels.some((c) => c.name === name);
  }

  subscribe(accountId: string, sub: webpush.PushSubscription): void {
    this.db.run(
      `INSERT INTO push_subscriptions (endpoint, account_id, keys_json, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET account_id = excluded.account_id, keys_json = excluded.keys_json`,
      sub.endpoint,
      accountId,
      JSON.stringify(sub.keys),
      Date.now(),
    );
  }

  unsubscribe(endpoint: string): void {
    this.db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', endpoint);
  }

  async alertFamily(familyId: string, alert: Alert): Promise<void> {
    const subs = this.db.all<{ endpoint: string; keys_json: string }>(
      `SELECT s.endpoint, s.keys_json FROM push_subscriptions s JOIN accounts a ON a.id = s.account_id WHERE a.family_id = ?`,
      familyId,
    );
    const payload = JSON.stringify(alert);
    await Promise.all(
      subs.map(async (s) => {
        try {
          await this.sender.send({ endpoint: s.endpoint, keys: JSON.parse(s.keys_json) }, payload);
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) this.unsubscribe(s.endpoint);
        }
      }),
    );
    if (!this.channels.length) return;
    const accounts = this.db.all<AccountTarget>('SELECT id, name, email, telegram_chat_id, email_alerts FROM accounts WHERE family_id = ?', familyId);
    await Promise.all(
      accounts.flatMap((a) =>
        this.channels.map((c) =>
          c.send(a, alert).catch((err: unknown) => console.error(`[avisos] ${c.name}: ${(err as Error).message}`)),
        ),
      ),
    );
  }
}
