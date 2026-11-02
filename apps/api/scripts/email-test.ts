/**
 * Verifies SMTP settings from .env and sends a real test email.
 *
 *   npm run email:test                 # sends to SENDER_EMAIL (yourself)
 *   npm run email:test -- someone@x.com
 *
 * Never prints the password.
 */
import { env } from '../src/config/env';
import { MailDeliveryError, fromAddress, sendMail, verifyMailer } from '../src/utils/mailer';

async function main() {
  const cfg = env();
  if (cfg.EMAIL_TRANSPORT !== 'smtp') {
    throw new Error(
      `EMAIL_TRANSPORT is "${cfg.EMAIL_TRANSPORT}". Set EMAIL_TRANSPORT=smtp in .env to send real email.`,
    );
  }
  const to =
    process.argv.slice(2).find((a) => a.includes('@')) ?? cfg.SENDER_EMAIL ?? cfg.SMTP_USER!;

  const check = await verifyMailer();
  console.log(`SMTP ${check.host}:${cfg.SMTP_PORT} (secure=${cfg.SMTP_SECURE}) as ${check.user}`);
  if (!check.ok) throw new Error(`Connection/sign-in failed: ${check.error}`);
  console.log('✔ Connected and signed in');

  const result = await sendMail({
    to,
    subject: 'Innovexa SMTP test',
    text: `This is a test email from the Innovexa platform, sent at ${new Date().toISOString()}.\nFrom: ${fromAddress()}`,
  });
  console.log(`✔ Accepted by the mail server for ${to} (message id ${result.messageId})`);
}

main().catch((err: unknown) => {
  console.error(
    `✘ ${err instanceof MailDeliveryError || err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
