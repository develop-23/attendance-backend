/**
 * Switches the datasource provider in the schema.prisma file.
 * Usage:  node scripts/switch-db.js sqlite
 *         node scripts/switch-db.js postgresql
 *
 * Because Prisma migrations depend on the provider (migration_lock.toml), the
 * old migrations folder is deleted as well when the provider changes —
 * otherwise Prisma raises error P3019.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const target = (process.argv[2] || '').toLowerCase();
const allowed = ['sqlite', 'postgresql'];

if (!allowed.includes(target)) {
  console.error(`Error: the provider must be "${allowed.join('" or "')}".`);
  process.exit(1);
}

const prismaDir = path.join(__dirname, '..', 'prisma');
const schemaPath = path.join(prismaDir, 'schema.prisma');
const schema = fs.readFileSync(schemaPath, 'utf8');

const current = schema.match(/provider\s*=\s*"(postgresql|sqlite)"/g) || [];
fs.writeFileSync(
  schemaPath,
  schema.replace(/provider\s*=\s*"(postgresql|sqlite)"/, `provider = "${target}"`)
);
console.log(`✔ schema.prisma provider changed to "${target}".`);

// The old migrations were written for a different provider — they are no longer valid
const migrationsDir = path.join(prismaDir, 'migrations');
if (fs.existsSync(migrationsDir)) {
  fs.rmSync(migrationsDir, { recursive: true, force: true });
  console.log('✔ The prisma/migrations folder was removed (it belonged to the other provider).');
}

// REGENERATE the Prisma client.
// This is mandatory: the provider is "baked into" the generated client, so even
// after schema.prisma changes the client stays on the old provider. The result
// is the misleading error "the URL must start with the protocol `file:`".
// `prisma generate` does not connect to the database, so it succeeds even when
// DATABASE_URL is not correct.
try {
  console.log('\n⏳ Regenerating the Prisma client…');
  execFileSync('npx', ['prisma', 'generate'], {
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  console.log('✔ The Prisma client was updated.');
} catch {
  console.warn('⚠  Could not generate the Prisma client. Do it by hand:  npm run generate');
}

console.log('\nNext steps:');
if (target === 'sqlite') {
  console.log('  1) In .env:  DATABASE_URL="file:./dev.db"');
} else {
  console.log('  1) In .env:  DATABASE_URL="postgresql://user:password@localhost:5432/attendance?schema=public"');
}
console.log('  2) npm run migrate');
console.log('  3) npm run seed');
