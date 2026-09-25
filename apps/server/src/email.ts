import nodemailer from 'nodemailer';
import type { AccountTarget, Alert, Channel } from './notify.js';

export interface MailTransport {
  sendMail(msg: { from: string; to: string; subject: string; text: string; html: string }): Promise<unknown>;
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Avisos por correo (SMTP de cualquier proveedor: Brevo, Resend, Gmail, Zoho…).
 * Cada admin elige: todo, sólo lo crítico (por defecto) o nada.
 */
export class EmailChannel implements Channel {
  readonly name = 'email';

  constructor(
    private readonly from: string,
    private readonly transport: MailTransport,
    private readonly publicUrl?: string,
  ) {}

  static fromUrl(smtpUrl: string, from: string, publicUrl?: string): EmailChannel {
    return new EmailChannel(from, nodemailer.createTransport(smtpUrl), publicUrl);
  }

  async send(account: AccountTarget, alert: Alert): Promise<void> {
    if (account.email_alerts === 'off') return;
    if (account.email_alerts === 'critical' && alert.severity !== 'critical') return;
    const link = this.publicUrl && alert.url ? `${this.publicUrl}/${alert.url.replace(/^\//, '')}` : undefined;
    await this.transport.sendMail({
      from: this.from,
      to: account.email,
      subject: `Guardián: ${alert.title}`,
      text: `${alert.body}${link ? `\n\nAbrir el panel: ${link}` : ''}`,
      html: `<p style="font:15px system-ui">${escape(alert.body)}</p>${link ? `<p><a href="${link}">Abrir el panel</a></p>` : ''}`,
    });
  }
}
