import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from './logger';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface DeliveryResult {
  messageId?: string;
  transport: 'smtp' | 'log' | 'memory';
}

/** Thrown when a message could not be handed to the mail server. Messages are safe to show admins. */
export class MailDeliveryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'MailDeliveryError';
  }
}

/** Messages captured by the in-memory transport (tests only). */
export const sentMail: MailMessage[] = [];

let transporter: Transporter | undefined;

/** Test hook: rebuild the transport after env changes. */
export function resetMailer(): void {
  transporter?.close();
  transporter = undefined;
}

function smtpSettings() {
  const cfg = env();
  const host = cfg.SMTP_HOST ?? '';
  const user = cfg.SENDER_EMAIL || cfg.SMTP_USER || '';
  let pass = cfg.SENDER_PASSWORD || cfg.SMTP_PASS || '';
  const isGmail = /(^|\.)gmail\.com$|googlemail\.com$/i.test(host);
  // Google shows App Passwords in groups ("abcd efgh ijkl mnop"); the spaces are not part of it.
  if (isGmail) pass = pass.replace(/\s+/g, '');
  const isLocal = /^(localhost|127\.0\.0\.1|::1)$/i.test(host);
  return { cfg, host, user, pass, isGmail, isLocal };
}

/**
 * The visible sender. Gmail only sends as the signed-in account (or a verified
 * alias), so keep EMAIL_FROM's display name but use SENDER_EMAIL as the address.
 */
export function fromAddress(): string {
  const { cfg, user, isGmail } = smtpSettings();
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(cfg.EMAIL_FROM);
  const name = (match?.[1] ?? '').trim() || 'Innovexa Digital';
  const address = match?.[2] ?? cfg.EMAIL_FROM;
  if (
    cfg.EMAIL_TRANSPORT === 'smtp' &&
    isGmail &&
    user &&
    address.toLowerCase() !== user.toLowerCase()
  ) {
    return `"${name.replace(/"/g, '')}" <${user}>`;
  }
  return cfg.EMAIL_FROM;
}

function getTransporter(): Transporter {
  if (!transporter) {
    const { cfg, host, user, pass, isLocal } = smtpSettings();
    transporter = nodemailer.createTransport({
      host,
      port: cfg.SMTP_PORT,
      secure: cfg.SMTP_SECURE, // false on 587: connection is upgraded with STARTTLS
      requireTLS: !cfg.SMTP_SECURE && !isLocal, // never send credentials in clear text to a remote server
      auth: user ? { user, pass } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });
  }
  return transporter;
}

/** Maps Nodemailer errors to messages that never include credentials or tokens. */
function describeSmtpError(err: unknown): MailDeliveryError {
  const e = err as { code?: string; responseCode?: number; command?: string };
  const { isGmail } = smtpSettings();
  switch (e.code) {
    case 'EAUTH':
      return new MailDeliveryError(
        isGmail
          ? 'SMTP sign-in failed. Check SENDER_EMAIL and SENDER_PASSWORD (Gmail needs a 16-character App Password with 2-Step Verification on).'
          : 'SMTP sign-in failed. Check SENDER_EMAIL and SENDER_PASSWORD.',
        'SMTP_AUTH_FAILED',
      );
    case 'ECONNECTION':
    case 'ETIMEDOUT':
    case 'ESOCKET':
    case 'EDNS':
      return new MailDeliveryError(
        'Could not connect to the SMTP server. Check SMTP_HOST, SMTP_PORT and your network.',
        'SMTP_UNREACHABLE',
      );
    case 'ETLS':
      return new MailDeliveryError(
        'Secure connection to the SMTP server failed. Check SMTP_PORT and SMTP_SECURE.',
        'SMTP_TLS_FAILED',
      );
    case 'EENVELOPE':
      return new MailDeliveryError(
        'The mail server rejected the recipient address.',
        'SMTP_RECIPIENT_REJECTED',
      );
    case 'EMESSAGE':
      return new MailDeliveryError(
        'The mail server rejected the message.',
        'SMTP_MESSAGE_REJECTED',
      );
    default:
      return new MailDeliveryError(
        e.responseCode
          ? `The mail server refused the message (SMTP ${e.responseCode}).`
          : 'Email delivery failed.',
        'SMTP_FAILED',
      );
  }
}

/** Never let one-time tokens reach the logs. */
export const redactTokens = (text: string) =>
  text.replace(/([?&]token=)[^\s&"'<>]+/gi, '$1[redacted]');

/**
 * Sends a message. Resolves only when the server accepted it; otherwise throws
 * MailDeliveryError so callers never report an undelivered message as sent.
 */
export async function sendMail(message: MailMessage): Promise<DeliveryResult> {
  const cfg = env();
  switch (cfg.EMAIL_TRANSPORT) {
    case 'memory':
      sentMail.push(message);
      return { transport: 'memory' };
    case 'log':
      // Development without SMTP: show what would be sent, with one-time links redacted.
      logger.info(
        { to: message.to, subject: message.subject },
        `[mail not sent: EMAIL_TRANSPORT=log]\n${redactTokens(message.text)}`,
      );
      return { transport: 'log' };
    case 'smtp': {
      try {
        const info = await getTransporter().sendMail({ from: fromAddress(), ...message });
        const rejected = (info.rejected ?? []).map(String);
        if (rejected.length || !(info.accepted ?? []).length) {
          throw Object.assign(new Error('Recipient rejected'), { code: 'EENVELOPE' });
        }
        logger.info(
          { to: message.to, subject: message.subject, messageId: info.messageId },
          'Email sent',
        );
        return { transport: 'smtp', messageId: info.messageId };
      } catch (err) {
        const failure = err instanceof MailDeliveryError ? err : describeSmtpError(err);
        logger.warn(
          { to: message.to, subject: message.subject, code: failure.code },
          `Email delivery failed: ${failure.message}`,
        );
        throw failure;
      }
    }
  }
}

/** Checks the SMTP connection and login without sending anything. */
export async function verifyMailer(): Promise<{
  ok: boolean;
  transport: string;
  host?: string;
  user?: string;
  error?: string;
}> {
  const { cfg, host, user } = smtpSettings();
  if (cfg.EMAIL_TRANSPORT !== 'smtp') return { ok: true, transport: cfg.EMAIL_TRANSPORT };
  const masked = user.replace(/^(.)[^@]*(@.*)$/, '$1***$2');
  try {
    await getTransporter().verify();
    return { ok: true, transport: 'smtp', host, user: masked };
  } catch (err) {
    return {
      ok: false,
      transport: 'smtp',
      host,
      user: masked,
      error: describeSmtpError(err).message,
    };
  }
}

/**
 * Send without failing the calling request; delivery problems are logged.
 * Used for notifications where the business action has already succeeded.
 */
export function sendMailSafe(message: MailMessage): void {
  sendMail(message).catch(() => undefined); // already logged (without secrets) by sendMail
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** Absolute URL of the official logo for email clients (they cannot load relative paths). */
export function emailLogoUrl(): string {
  const cfg = env();
  return cfg.EMAIL_LOGO_URL ?? `${cfg.APP_URL.replace(/\/$/, '')}/innovex.logo.jpeg`;
}

/** Minimal branded transactional email with a single call-to-action. */
export function actionEmail(opts: {
  greeting: string;
  body: string;
  actionLabel: string;
  url: string;
  footer?: string;
}) {
  const text =
    `${opts.greeting}\n\n${opts.body}\n\n${opts.actionLabel}: ${opts.url}\n\n${opts.footer ?? ''}`.trim();
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#0f172a">
  <p style="margin:0 0 20px"><img src="${escapeHtml(emailLogoUrl())}" alt="Innovexa Digital Logo" width="96" height="93" style="display:block;width:96px;height:auto;border:0;border-radius:12px"></p>
  <p>${escapeHtml(opts.greeting)}</p>
  <p>${escapeHtml(opts.body)}</p>
  <p><a href="${escapeHtml(opts.url)}" style="background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(opts.actionLabel)}</a></p>
  <p style="color:#64748b;font-size:12px">If the button does not work, copy this link into your browser:<br>${escapeHtml(opts.url)}</p>
  ${opts.footer ? `<p style="color:#64748b;font-size:12px">${escapeHtml(opts.footer)}</p>` : ''}
</div>`;
  return { text, html };
}
