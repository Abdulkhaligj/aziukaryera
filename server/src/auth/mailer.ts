// Auth emails. With SMTP configured they go out through nodemailer; without
// it they are kept in an in-memory outbox (tests, local development).
import nodemailer from 'nodemailer';
import type { Config } from '../config.ts';

export interface Mail { to: string; subject: string; text: string; html: string; link: string; kind: MailKind }
export type MailKind = 'confirmation' | 'recovery' | 'invite' | 'magic_link' | 'email_change' | 'email_change_current';
export interface Mailer { send(mail: Mail): Promise<void>; outbox?: Mail[] }

const templates: Record<MailKind, { subject: string; intro: string; action: string }> = {
  confirmation: { subject: 'E-poçt ünvanınızı təsdiqləyin', intro: 'ADNSU Karyera Mərkəzində qeydiyyatı tamamlamaq üçün e-poçt ünvanınızı təsdiqləyin.', action: 'E-poçtu təsdiqlə' },
  recovery: { subject: 'Şifrənin bərpası', intro: 'Hesabınız üçün şifrə bərpası istənilib. Bunu siz etməmisinizsə, bu məktubu nəzərə almayın.', action: 'Yeni şifrə təyin et' },
  invite: { subject: 'ADNSU Karyera Mərkəzinə dəvət', intro: 'Sizi ADNSU Karyera Mərkəzinin platformasına dəvət ediblər.', action: 'Dəvəti qəbul et' },
  magic_link: { subject: 'Giriş linkiniz', intro: 'ADNSU Karyera Mərkəzinə daxil olmaq üçün aşağıdakı linkə klikləyin.', action: 'Daxil ol' },
  email_change: { subject: 'Yeni e-poçt ünvanınızı təsdiqləyin', intro: 'Hesabınızın e-poçt ünvanını bu ünvana dəyişmək istənilib. Dəyişikliyi təsdiqləmək üçün linkə klikləyin.', action: 'Yeni ünvanı təsdiqlə' },
  email_change_current: { subject: 'E-poçt ünvanının dəyişdirilməsi', intro: 'Hesabınızın e-poçt ünvanını dəyişmək istənilib. Bunu siz etmisinizsə, təsdiqləmək üçün linkə klikləyin; etməmisinizsə, bu məktubu nəzərə almayın.', action: 'Dəyişikliyi təsdiqlə' }
};

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function composeMail(kind: MailKind, to: string, link: string): Mail {
  const t = templates[kind];
  const text = `${t.intro}\n\n${t.action}: ${link}\n\nLink bir saat ərzində etibarlıdır.\n\nADNSU Karyera Mərkəzi`;
  const html = `<p>${escapeHtml(t.intro)}</p><p><a href="${escapeHtml(link)}">${escapeHtml(t.action)}</a></p>`
    + `<p style="color:#666;font-size:12px">Link bir saat ərzində etibarlıdır.</p><p>ADNSU Karyera Mərkəzi</p>`;
  return { to, subject: t.subject, text, html, link, kind };
}

export function createMailer(config: Config): Mailer {
  if (!config.smtp) {
    const outbox: Mail[] = [];
    return {
      outbox,
      async send(mail) {
        outbox.push(mail);
        if (outbox.length > 100) outbox.shift();
      }
    };
  }
  const smtp = config.smtp;
  const transport = nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.port === 465,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined
  });
  return {
    async send(mail) {
      await transport.sendMail({ from: smtp.from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
    }
  };
}
