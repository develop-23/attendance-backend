/**
 * Checks the environment variables BEFORE the server is started in production.
 * The goal is to give a clear, actionable instruction instead of Prisma's
 * cryptic "P1012 / getConfig" error.
 *
 * Usage: npm run start:prod (the first link in the chain)
 */
const fs = require('fs');
const path = require('path');

// Read .env if there is one (on Railway there is none — the variables are provided directly)
try {
  require('dotenv').config();
} catch {
  /* carry on even without dotenv */
}

const problems = [];

// ── 1) DATABASE_URL ───────────────────────────────────────────────────
if (!process.env.DATABASE_URL) {
  problems.push(
    [
      'DATABASE_URL is not set.',
      '',
      '  On Railway:',
      '    1) Add PostgreSQL to your project: New → Database → Add PostgreSQL',
      '    2) In the Variables section of the backend service create a new variable:',
      '         Name:   DATABASE_URL',
      '         Value:  ${{Postgres.DATABASE_URL}}',
      '       (“Postgres” is the service name of your database; use yours if it differs)',
      '    3) Redeploy.',
      '',
      '  When running locally:  cp .env.example .env  and fill in DATABASE_URL.',
    ].join('\n')
  );
} else {
  // Do the provider and the URL match each other? (a frequent mistake)
  const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const match = schema.match(/datasource\s+\w+\s*\{[^}]*provider\s*=\s*"(\w+)"/);
  const provider = match ? match[1] : 'postgresql';
  const url = process.env.DATABASE_URL;

  const looksPostgres = /^postgres(ql)?:\/\//.test(url);
  const looksSqlite = /^file:/.test(url);

  if (provider === 'postgresql' && !looksPostgres) {
    problems.push(
      `schema.prisma has provider = "postgresql", but DATABASE_URL does not start with "postgresql://".\n` +
        `  Current value: ${url.slice(0, 24)}…\n` +
        `  If you want to use SQLite:  npm run use:sqlite`
    );
  }
  if (provider === 'sqlite' && !looksSqlite) {
    problems.push(
      `schema.prisma has provider = "sqlite", but DATABASE_URL does not start with "file:".\n` +
        `  If you want to use PostgreSQL:  npm run use:postgres`
    );
  }
}

// ── 2) JWT_SECRET ─────────────────────────────────────────────────────
if (!process.env.JWT_SECRET) {
  problems.push(
    [
      'JWT_SECRET is not set.',
      '  Generate one:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
      '  Then add it under Railway → Variables with the name JWT_SECRET.',
    ].join('\n')
  );
} else if (process.env.JWT_SECRET.length < 32) {
  console.warn(
    '⚠  JWT_SECRET is very short (fewer than 32 characters). Use a longer key in production.'
  );
}

// ── 3) Migration files ────────────────────────────────────────────────
const migrationsDir = path.join(__dirname, '..', 'prisma', 'migrations');
if (!fs.existsSync(migrationsDir) || fs.readdirSync(migrationsDir).length === 0) {
  problems.push(
    [
      'The prisma/migrations folder is empty or missing — `prisma migrate deploy` will not work.',
      '  Create it on your local machine and commit it to git:',
      '    npm run migrate',
      '    git add server/prisma/migrations && git commit -m "migration" && git push',
    ].join('\n')
  );
}

// ── Result ────────────────────────────────────────────────────────────
if (problems.length > 0) {
  console.error('\n✖ The server did not start — there is a configuration problem:\n');
  problems.forEach((p, i) => console.error(`${i + 1}) ${p}\n`));
  process.exit(1);
}

console.log('✔ Environment variables checked.');
