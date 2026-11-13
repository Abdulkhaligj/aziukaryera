// Auth emails. With SMTP configured they go out through nodemailer; without
// it they are kept in an in-memory outbox (tests, local development).
import nodemailer from 'nodemailer';
import type { Config } from '../config.ts';

export interface Mail { to: string; subject: string; text: string; html: string; link: string; kind: MailKind }
export type MailKind = 'confirmation' | 'recovery' | 'invite' | 'magic_link' | 'email_change' | 'email_change_current' | 'already_registered';
export interface Mailer { send(mail: Mail): Promise<void>; outbox?: Mail[] }

const templates: Record<MailKind, { subject: string; intro: string; action: string }> = {
  confirmation: { subject: 'E-poçt ünvanınızı təsdiqləyin', intro: 'ADNSU Karyera Mərkəzində qeydiyyatı tamamlamaq üçün e-poçt ünvanınızı təsdiqləyin.', action: 'E-poçtu təsdiqlə' },
  recovery: { subject: 'Şifrənin bərpası', intro: 'Hesabınız üçün şifrə bərpası istənilib. Bunu siz etməmisinizsə, bu məktubu nəzərə almayın.', action: 'Yeni şifrə təyin et' },
  invite: { subject: 'ADNSU Karyera Mərkəzinə dəvət', intro: 'Sizi ADNSU Karyera Mərkəzinin platformasına dəvət ediblər.', action: 'Dəvəti qəbul et' },
  magic_link: { subject: 'Giriş linkiniz', intro: 'ADNSU Karyera Mərkəzinə daxil olmaq üçün aşağıdakı linkə klikləyin.', action: 'Daxil ol' },
  email_change: { subject: 'Yeni e-poçt ünvanınızı təsdiqləyin', intro: 'Hesabınızın e-poçt ünvanını bu ünvana dəyişmək istənilib. Dəyişikliyi təsdiqləmək üçün linkə klikləyin.', action: 'Yeni ünvanı təsdiqlə' },
  already_registered: { subject: 'Bu e-poçtla artıq hesab var', intro: 'Bu e-poçt ünvanı ilə yenidən qeydiyyat cəhdi olub, amma ünvan artıq qeydiyyatdadır. Şifrəni unutmusunuzsa, giriş səhifəsində "Şifrəni unutmusunuz?" ilə bərpa edin. Bu cəhdi siz etməmisinizsə, məktubu nəzərə almayın.', action: 'Sayta keç' },
  email_change_current: { subject: 'E-poçt ünvanının dəyişdirilməsi', intro: 'Hesabınızın e-poçt ünvanını dəyişmək istənilib. Bunu siz etmisinizsə, təsdiqləmək üçün linkə klikləyin; etməmisinizsə, bu məktubu nəzərə almayın.', action: 'Dəyişikliyi təsdiqlə' }
};

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** "bir saat", "24 saat": how long the link works, as the token really lives (#76). */
const lifetime = (minutes: number) => minutes % 60 === 0 ? (minutes === 60 ? 'bir saat' : `${minutes / 60} saat`) : `${minutes} dəqiqə`;

export function composeMail(kind: MailKind, to: string, link: string, ttlMinutes: number | null = 60): Mail {
  const t = templates[kind];
  const valid = ttlMinutes == null ? '' : `Link ${lifetime(ttlMinutes)} ərzində etibarlıdır.`;
  const text = `${t.intro}\n\n${t.action}: ${link}\n\n${valid ? valid + '\n\n' : ''}ADNSU Karyera Mərkəzi`;
  const html = `<p>${escapeHtml(t.intro)}</p><p><a href="${escapeHtml(link)}">${escapeHtml(t.action)}</a></p>`
    + (valid ? `<p style="color:#666;font-size:12px">${escapeHtml(valid)}</p>` : '') + `<p>ADNSU Karyera Mərkəzi</p>`;
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
    // 465 is TLS from the start; on any other port STARTTLS is required, never
    // plain text (#22). Certificates are verified.
    host: smtp.host, port: smtp.port, secure: smtp.port === 465, requireTLS: smtp.port !== 465, tls: { rejectUnauthorized: true },
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined
  });
  return {
    async send(mail) {
      await transport.sendMail({ from: smtp.from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
    }
  };
}
