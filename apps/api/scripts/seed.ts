/**
 * Development seed. Creates demo users, a client and the default service
 * categories. Refuses to run in production. Passwords come from SEED_PASSWORD
 * (or a generated one that is printed once) — never hardcoded.
 *
 *   npm run seed            # idempotent upsert
 *   npm run seed -- --reset # wipe the database first
 */
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { DEFAULT_SERVICE_CATEGORIES, PartnerType, Role, UserStatus } from '@innovexa/shared';
import { connectDatabase } from '../src/config/db';
import { env } from '../src/config/env';
import { Client, ServiceCategory, User } from '../src/models';
import { hashPassword } from '../src/modules/auth/auth.service';
import { slugify } from '../src/modules/service-categories/serviceCategory.model';
import { formatCode, nextSequence } from '../src/utils/sequence';

async function main() {
  const cfg = env();
  if (cfg.NODE_ENV === 'production') throw new Error('Refusing to seed a production database');

  await connectDatabase(cfg.MONGODB_URI);
  if (process.argv.includes('--reset')) {
    await mongoose.connection.dropDatabase();
    console.log('Database dropped.');
  }

  const generated = !process.env.SEED_PASSWORD;
  const password = process.env.SEED_PASSWORD ?? `Dev-${randomBytes(6).toString('base64url')}9a`;
  const passwordHash = await hashPassword(password);

  for (const name of DEFAULT_SERVICE_CATEGORIES) {
    await ServiceCategory.updateOne(
      { slug: slugify(name) },
      { $setOnInsert: { name, slug: slugify(name), isSystem: true, isActive: true } },
      { upsert: true },
    );
  }

  let client = await Client.findOne({ email: 'client.demo@example.com' });
  if (!client) {
    client = await Client.create({
      clientCode: formatCode('CLI', await nextSequence('client')),
      companyName: 'Demo Retail Pvt Ltd',
      contactName: 'Demo Client',
      email: 'client.demo@example.com',
      phone: '+91 90000 00000',
      address: { city: 'Chennai', state: 'Tamil Nadu', country: 'India' },
    });
  }

  const users = [
    { email: 'admin.demo@example.com', name: 'Demo Admin', role: Role.ADMIN },
    {
      email: 'partner.demo@example.com',
      name: 'Demo Partner',
      role: Role.PARTNER,
      partnerProfile: {
        partnerType: PartnerType.FREELANCER,
        category: 'Web Development',
        skills: ['React', 'Node.js'],
      },
    },
    {
      email: 'employee.demo@example.com',
      name: 'Demo Employee',
      role: Role.PARTNER,
      partnerProfile: {
        partnerType: PartnerType.INTERNAL_EMPLOYEE,
        category: 'UI/UX Design',
        skills: ['Figma'],
      },
    },
    {
      email: 'client.demo@example.com',
      name: 'Demo Client',
      role: Role.CLIENT,
      clientId: client._id,
    },
  ];

  for (const u of users) {
    await User.updateOne(
      { email: u.email },
      {
        $set: { ...u, status: UserStatus.ACTIVE, emailVerifiedAt: new Date(), passwordHash },
        $inc: { tokenVersion: 1 },
      },
      { upsert: true },
    );
  }

  console.log('\nSeed complete. Demo accounts (development only):');
  for (const u of users) console.log(`  ${u.role.padEnd(8)} ${u.email}`);
  console.log(
    generated
      ? `\n  Generated password: ${password}\n  (set SEED_PASSWORD to choose one)`
      : '\n  Password: value of SEED_PASSWORD',
  );
  await mongoose.disconnect();
}

main().catch(async (err: unknown) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
