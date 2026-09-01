/**
 * schema.prisma faylidagi datasource provider ni almashtiradi.
 * Ishlatilishi:  node scripts/switch-db.js sqlite
 *                node scripts/switch-db.js postgresql
 *
 * Prisma migratsiyalari provider'ga bog'liq bo'lgani uchun (migration_lock.toml),
 * provider almashganda eski migratsiyalar papkasi ham o'chiriladi — aks holda
 * Prisma P3019 xatosini beradi.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const target = (process.argv[2] || '').toLowerCase();
const allowed = ['sqlite', 'postgresql'];

if (!allowed.includes(target)) {
  console.error(`Xato: provider "${allowed.join('" yoki "')}" bo'lishi kerak.`);
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
console.log(`✔ schema.prisma provider = "${target}" ga o'zgartirildi.`);

// Eski migratsiyalar boshqa provider uchun yozilgan — ular endi yaroqsiz
const migrationsDir = path.join(prismaDir, 'migrations');
if (fs.existsSync(migrationsDir)) {
  fs.rmSync(migrationsDir, { recursive: true, force: true });
  console.log('✔ prisma/migrations papkasi o\'chirildi (boshqa provider uchun edi).');
}

// Prisma klientini QAYTA YARATAMIZ.
// Bu majburiy: yaratilgan klient ichida provider "muhrlangan" bo'ladi va
// schema.prisma o'zgargani bilan u eski provider'da qolib ketadi. Natijada
// "the URL must start with the protocol `file:`" kabi chalg'ituvchi xato chiqadi.
// `prisma generate` bazaga ulanmaydi, shuning uchun DATABASE_URL to'g'ri
// bo'lmasa ham muvaffaqiyatli bajariladi.
try {
  console.log('\n⏳ Prisma klienti qayta yaratilyapti…');
  execFileSync('npx', ['prisma', 'generate'], {
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  console.log('✔ Prisma klienti yangilandi.');
} catch {
  console.warn('⚠  Prisma klientini yaratib bo\'lmadi. Qo\'lda bajaring:  npm run generate');
}

console.log('\nKeyingi qadamlar:');
if (target === 'sqlite') {
  console.log('  1) .env da:  DATABASE_URL="file:./dev.db"');
} else {
  console.log('  1) .env da:  DATABASE_URL="postgresql://user:parol@localhost:5432/davomat?schema=public"');
}
console.log('  2) npm run migrate');
console.log('  3) npm run seed');
