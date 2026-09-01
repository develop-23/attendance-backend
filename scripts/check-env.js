/**
 * Ishlab chiqarishda serverni ishga tushirishdan OLDIN muhit o'zgaruvchilarini
 * tekshiradi. Maqsad — Prisma'ning tushunarsiz "P1012 / getConfig" xatosi
 * o'rniga aniq va bajariladigan ko'rsatma berish.
 *
 * Ishlatilishi: npm run start:prod (zanjirning birinchi bo'g'ini)
 */
const fs = require('fs');
const path = require('path');

// .env bo'lsa o'qiymiz (Railway'da .env bo'lmaydi — o'zgaruvchilar to'g'ridan-to'g'ri beriladi)
try {
  require('dotenv').config();
} catch {
  /* dotenv bo'lmasa ham davom etamiz */
}

const problems = [];

// ── 1) DATABASE_URL ───────────────────────────────────────────────────
if (!process.env.DATABASE_URL) {
  problems.push(
    [
      'DATABASE_URL aniqlanmagan.',
      '',
      '  Railway’da:',
      '    1) Loyihangizga PostgreSQL qo‘shing: New → Database → Add PostgreSQL',
      '    2) Backend xizmatining Variables bo‘limida yangi o‘zgaruvchi yarating:',
      '         Nomi:     DATABASE_URL',
      '         Qiymati:  ${{Postgres.DATABASE_URL}}',
      '       (“Postgres” — bazangizning xizmat nomi; boshqacha bo‘lsa o‘shani yozing)',
      '    3) Qayta deploy qiling.',
      '',
      '  Lokal ishlashda:  cp .env.example .env  va DATABASE_URL ni to‘ldiring.',
    ].join('\n')
  );
} else {
  // Provider bilan URL bir-biriga mos keladimi? (tez-tez uchraydigan xato)
  const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const match = schema.match(/datasource\s+\w+\s*\{[^}]*provider\s*=\s*"(\w+)"/);
  const provider = match ? match[1] : 'postgresql';
  const url = process.env.DATABASE_URL;

  const looksPostgres = /^postgres(ql)?:\/\//.test(url);
  const looksSqlite = /^file:/.test(url);

  if (provider === 'postgresql' && !looksPostgres) {
    problems.push(
      `schema.prisma da provider = "postgresql", lekin DATABASE_URL "postgresql://" bilan boshlanmayapti.\n` +
        `  Hozirgi qiymat: ${url.slice(0, 24)}…\n` +
        `  SQLite ishlatmoqchi bo‘lsangiz:  npm run use:sqlite`
    );
  }
  if (provider === 'sqlite' && !looksSqlite) {
    problems.push(
      `schema.prisma da provider = "sqlite", lekin DATABASE_URL "file:" bilan boshlanmayapti.\n` +
        `  PostgreSQL ishlatmoqchi bo‘lsangiz:  npm run use:postgres`
    );
  }
}

// ── 2) JWT_SECRET ─────────────────────────────────────────────────────
if (!process.env.JWT_SECRET) {
  problems.push(
    [
      'JWT_SECRET aniqlanmagan.',
      '  Yaratish:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
      '  So‘ng uni Railway → Variables ga JWT_SECRET nomi bilan qo‘shing.',
    ].join('\n')
  );
} else if (process.env.JWT_SECRET.length < 32) {
  console.warn(
    '⚠  JWT_SECRET juda qisqa (32 belgidan kam). Ishlab chiqarish uchun uzunroq kalit ishlating.'
  );
}

// ── 3) Migratsiya fayllari ────────────────────────────────────────────
const migrationsDir = path.join(__dirname, '..', 'prisma', 'migrations');
if (!fs.existsSync(migrationsDir) || fs.readdirSync(migrationsDir).length === 0) {
  problems.push(
    [
      'prisma/migrations papkasi bo‘sh yoki yo‘q — `prisma migrate deploy` ishlamaydi.',
      '  Lokal mashinada yarating va git’ga qo‘shing:',
      '    npm run migrate',
      '    git add server/prisma/migrations && git commit -m "migratsiya" && git push',
    ].join('\n')
  );
}

// ── Natija ────────────────────────────────────────────────────────────
if (problems.length > 0) {
  console.error('\n✖ Server ishga tushmadi — sozlamalarda muammo bor:\n');
  problems.forEach((p, i) => console.error(`${i + 1}) ${p}\n`));
  process.exit(1);
}

console.log('✔ Muhit o‘zgaruvchilari tekshirildi.');
