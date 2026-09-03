/**
 * Seed script — creates one admin and the default settings on the first run.
 * Usage: npm run seed
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const login = process.env.SEED_ADMIN_LOGIN || 'admin';
  const password = process.env.SEED_ADMIN_PASSWORD || 'admin123';

  // 1) Default settings
  await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });

  // 2) Admin (if it already exists it is not recreated)
  const existing = await prisma.user.findUnique({ where: { login } });
  if (existing) {
    console.log(`ℹ  The "${login}" administrator already exists, skipped.`);
  } else {
    await prisma.user.create({
      data: {
        login,
        passwordHash: await bcrypt.hash(password, 10),
        fullName: 'Main administrator',
      },
    });
    console.log('✔ Administrator created:');
    console.log(`   login:  ${login}`);
    console.log(`   password:  ${password}`);
    console.log('   ⚠  Be sure to CHANGE the password after the first sign-in!');
  }

  // 3) Sample employees — each with their own login/password
  const employeeCount = await prisma.employee.count();
  if (employeeCount === 0) {
    const samples = [
      { login: 'aman', fullName: 'Aman Amanow', position: 'Menejer' },
      { login: 'merjen', fullName: 'Merjen Gurbanowa', position: 'Buhgalter' },
      { login: 'serdar', fullName: 'Serdar Nazarow', position: 'Programmist' },
    ];
    const passwordHash = await bcrypt.hash('employee123', 10);
    for (const s of samples) {
      await prisma.employee.create({ data: { ...s, passwordHash } });
    }
    console.log('✔ 3 sample employees added (password: employee123)');
    console.log('   logins: ' + samples.map((s) => s.login).join(', '));
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    const msg = String(e?.message || e);

    // The most common misleading error: schema.prisma has changed but the
    // generated Prisma client is still stuck on the old provider.
    if (/must start with the protocol/i.test(msg)) {
      console.error('\n✖ The Prisma client does not match the schema (it is stale).');
      console.error('  The provider in schema.prisma changed, but the client was not regenerated.');
      console.error('\n  Fix:');
      console.error('    npm run generate');
      console.error('    npm run seed\n');
    } else if (/Environment variable not found: DATABASE_URL/i.test(msg)) {
      console.error('\n✖ DATABASE_URL is not set.');
      console.error('  Fix:  cp .env.example .env  and fill in DATABASE_URL.\n');
    } else if (/P1001|Can't reach database server/i.test(msg)) {
      console.error('\n✖ Could not connect to the database.');
      console.error('  Check that DATABASE_URL is correct and that the database is running.');
      console.error('  The Railway internal address (*.railway.internal) does not work from a local machine —');
      console.error('  use DATABASE_PUBLIC_URL instead.\n');
    } else {
      console.error('Seed error:', e);
    }

    await prisma.$disconnect();
    process.exit(1);
  });
