import { randomBytes } from 'node:crypto';
import type { Db } from './db.js';
import type { AccountTarget, Alert, Channel } from './notify.js';

/**
 * Avisos por Telegram. Gratis, instantáneos y con botones: el administrador
 * puede aprobar o rechazar una solicitud sin abrir el panel.
 *
 * Configuración: crea un bot con @BotFather y define GUARDIAN_TELEGRAM_BOT_TOKEN.
 * Cada admin vincula su chat desde Ajustes → "Conectar Telegram".
 */

export interface TelegramHandlers {
  /** Responde una solicitud; devuelve el texto que se muestra en el chat. */
  decide(accountId: string, requestId: string, approve: boolean, minutes?: number): Promise<string>;
}

interface Update {
  update_id: number;
  message?: { chat: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number }; message_id: number; text?: string } };
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export class TelegramBot implements Channel {
  readonly name = 'telegram';
  username: string | null = null;
  private stopped = false;
  private offset = 0;

  constructor(
    private readonly token: string,
    private readonly db: Db,
    private readonly handlers: TelegramHandlers,
    private readonly publicUrl?: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async api<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
    const res = await this.fetchFn(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok: boolean; result: T; description?: string };
    if (!json.ok) throw new Error(json.description ?? `Telegram ${method} falló`);
    return json.result;
  }

  async start(): Promise<void> {
    const me = await this.api<{ username: string }>('getMe');
    this.username = me.username;
    void this.poll();
  }

  stop(): void {
    this.stopped = true;
  }

  private async poll(): Promise<void> {
    while (!this.stopped) {
      try {
        const updates = await this.api<Update[]>('getUpdates', { offset: this.offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
        for (const u of updates) {
          this.offset = u.update_id + 1;
          await this.handleUpdate(u).catch((e: unknown) => console.error(`[telegram] ${(e as Error).message}`));
        }
      } catch {
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  /** Código de un solo uso para vincular el chat de un admin (vence en 15 min). */
  createLink(accountId: string): { code: string; url: string | null } {
    this.db.run('DELETE FROM telegram_links WHERE expires_at < ?', Date.now());
    const code = randomBytes(9).toString('base64url');
    this.db.run('INSERT INTO telegram_links (code, account_id, expires_at) VALUES (?, ?, ?)', code, accountId, Date.now() + 15 * 60_000);
    return { code, url: this.username ? `https://t.me/${this.username}?start=${code}` : null };
  }

  async handleUpdate(u: Update): Promise<void> {
    if (u.message?.text?.startsWith('/start')) {
      const chatId = String(u.message.chat.id);
      const code = u.message.text.split(/\s+/)[1] ?? '';
      const link = this.db.get<{ account_id: string }>('SELECT account_id FROM telegram_links WHERE code = ? AND expires_at > ?', code, Date.now());
      if (!link) {
        await this.api('sendMessage', { chat_id: chatId, text: 'Para conectar, abre el panel de Guardián → Ajustes → “Conectar Telegram”.' });
        return;
      }
      this.db.run('DELETE FROM telegram_links WHERE code = ?', code);
      this.db.run('UPDATE accounts SET telegram_chat_id = ? WHERE id = ?', chatId, link.account_id);
      await this.api('sendMessage', { chat_id: chatId, text: '✅ Listo. Aquí te llegarán las solicitudes de desbloqueo y las alertas de Guardián.' });
      return;
    }

    const cb = u.callback_query;
    if (cb?.data?.startsWith('r:') && cb.message) {
      const chatId = String(cb.message.chat.id);
      const account = this.db.get<{ id: string }>('SELECT id FROM accounts WHERE telegram_chat_id = ?', chatId);
      let text = 'Este chat no está vinculado a ninguna cuenta.';
      if (account) {
        const [, requestId = '', choice = ''] = cb.data.split(':');
        const approve = choice !== 'x';
        const minutes = approve && choice !== 'a' ? Number(choice) : undefined;
        text = await this.handlers.decide(account.id, requestId, approve, minutes).catch((e: Error) => `No se pudo: ${e.message}`);
      }
      await this.api('answerCallbackQuery', { callback_query_id: cb.id, text: text.slice(0, 190) });
      await this.api('editMessageText', {
        chat_id: chatId,
        message_id: cb.message.message_id,
        text: `${cb.message.text ?? ''}\n\n${text}`,
      }).catch(() => undefined);
    }
  }

  async send(account: AccountTarget, alert: Alert): Promise<void> {
    if (!account.telegram_chat_id) return;
    const link = this.publicUrl && alert.url ? `\n<a href="${this.publicUrl}/${alert.url.replace(/^\//, '')}">Abrir panel</a>` : '';
    let keyboard: { text: string; callback_data: string }[][] | undefined;
    if (alert.request) {
      const { id, kind, minutes } = alert.request;
      keyboard =
        kind === 'new_app'
          ? [[{ text: '✅ Aprobar app', callback_data: `r:${id}:a` }, { text: '❌ Rechazar', callback_data: `r:${id}:x` }]]
          : [
              [...new Set([15, minutes, 60])].filter((m) => m > 0).sort((a, b) => a - b).map((m) => ({ text: `✅ ${m} min`, callback_data: `r:${id}:${m}` })),
              [{ text: '❌ Rechazar', callback_data: `r:${id}:x` }],
            ];
    }
    await this.api('sendMessage', {
      chat_id: account.telegram_chat_id,
      text: `<b>${escape(alert.title)}</b>\n${escape(alert.body)}${link}`,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
    });
  }
}
