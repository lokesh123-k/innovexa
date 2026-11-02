/**
 * Development-only: ensures one ADMIN account exists so you can sign in, and
 * recovers it if it gets locked out.
 *
 * Credentials come from .env (never from code):
 *   DEV_ADMIN_EMAIL=admin@innovexa.com
 *   DEV_ADMIN_PASSWORD=...
 *
 *   npm run seed:admin                      # create if missing (never duplicates)
 *   npm run seed:admin -- --unlock          # clear a failed-login lockout, keep the password
 *   npm run seed:admin -- --reset-password  # set the password from .env, unlock, sign out all sessions
 *
 * Refuses to run when NODE_ENV=production and never modifies a non-admin account.
 * Passwords are hashed with the same service the login endpoint verifies against.
 */
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { Role, UserStatus, emailSchema, passwordSchema } from '@innovexa/shared';
import { connectDatabase } from '../src/config/db';
import { env } from '../src/config/env';
import { User } from '../src/modules/users/user.model';
import { hashPassword, revokeAllSessions } from '../src/modules/auth/auth.service';

async function main() {
  const cfg = env();
  if (cfg.NODE_ENV === 'production') throw new Error('Refusing to seed an admin in production');

  const rawEmail = process.env.DEV_ADMIN_EMAIL;
  const rawPassword = process.env.DEV_ADMIN_PASSWORD;
  if (!rawEmail || !rawPassword)
    throw new Error('Set DEV_ADMIN_EMAIL and DEV_ADMIN_PASSWORD in .env');
  const email = emailSchema.parse(rawEmail); // trims + lowercases exactly like the login endpoint
  const pw = passwordSchema.safeParse(rawPassword); // same policy as the app, incl. no outer spaces
  if (!pw.success) throw new Error(`DEV_ADMIN_PASSWORD: ${pw.error.issues[0]?.message}`);
  const password = pw.data;
  const reset = process.argv.includes('--reset-password');
  const unlock = process.argv.includes('--unlock');

  await connectDatabase(cfg.MONGODB_URI);
  const existing = await User.findOne({ email }).select('+passwordHash +lockUntil');

  if (existing && existing.role !== Role.ADMIN) {
    throw new Error(`${email} already exists with role ${existing.role}; not modifying it`);
  }

  if (!existing) {
    await User.create({
      email,
      name: 'Innovexa Admin',
      role: Role.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      passwordHash: await hashPassword(password),
    });
    console.log(`Created ADMIN ${email}`);
  } else if (reset) {
    existing.passwordHash = await hashPassword(password);
    existing.status = UserStatus.ACTIVE;
    existing.set({ failedLoginAttempts: 0, lockUntil: null });
    existing.tokenVersion += 1; // invalidate outstanding access tokens
    await existing.save();
    await revokeAllSessions(existing._id);
    console.log(`Reset password, unlocked and signed out all sessions for ADMIN ${email}`);
  } else if (unlock) {
    const wasLocked = Boolean(existing.lockUntil && existing.lockUntil > new Date());
    existing.set({ failedLoginAttempts: 0, lockUntil: null });
    await existing.save();
    console.log(
      wasLocked ? `Unlocked ADMIN ${email}` : `ADMIN ${email} was not locked; counter reset`,
    );
  } else {
    console.log(
      `ADMIN ${email} already exists, nothing changed (use --unlock or --reset-password)`,
    );
  }

  // Self-check with the same comparison the login service uses.
  const saved = await User.findOne({ email }).select('+passwordHash +lockUntil').lean();
  const matches = saved?.passwordHash ? await bcrypt.compare(password, saved.passwordHash) : false;
  const locked = Boolean(saved?.lockUntil && saved.lockUntil > new Date());
  console.log(
    `Verify: role=${saved?.role} status=${saved?.status} hashed=${saved?.passwordHash?.startsWith('$2')} passwordMatchesEnv=${matches} locked=${locked}`,
  );
  await mongoose.disconnect();
}

main().catch(async (err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  await mongoose.disconnect();
  process.exit(1);
});
