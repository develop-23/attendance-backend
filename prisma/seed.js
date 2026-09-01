/**
 * Seed script — birinchi ishga tushirishda bitta admin va standart sozlamalarni yaratadi.
 * Ishlatilishi: npm run seed
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const login = process.env.SEED_ADMIN_LOGIN || 'admin';
  const password = process.env.SEED_ADMIN_PASSWORD || 'admin123';

  // 1) Standart sozlamalar
  await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });

  // 2) Admin (agar mavjud bo'lsa — qayta yaratilmaydi)
  const existing = await prisma.user.findUnique({ where: { login } });
  if (existing) {
    console.log(`ℹ  "${login}" administratori allaqachon mavjud, o'tkazib yuborildi.`);
  } else {
    await prisma.user.create({
      data: {
        login,
        passwordHash: await bcrypt.hash(password, 10),
        fullName: 'Bosh administrator',
      },
    });
    console.log('✔ Administrator yaratildi:');
    console.log(`   login:  ${login}`);
    console.log(`   parol:  ${password}`);
    console.log('   ⚠  Birinchi kirishdan so\'ng parolni ALBATTA o\'zgartiring!');
  }

  // 3) Namuna xodimlar — har biri o'z login/paroli bilan
  const employeeCount = await prisma.employee.count();
  if (employeeCount === 0) {
    const samples = [
      { login: 'aman', fullName: 'Aman Amanow', position: 'Menejer' },
      { login: 'merjen', fullName: 'Merjen Gurbanowa', position: 'Buhgalter' },
      { login: 'serdar', fullName: 'Serdar Nazarow', position: 'Programmist' },
    ];
    const passwordHash = await bcrypt.hash('xodim123', 10);
    for (const s of samples) {
      await prisma.employee.create({ data: { ...s, passwordHash } });
    }
    console.log('✔ 3 ta namuna xodim qo\'shildi (parol: xodim123)');
    console.log('   loginlar: ' + samples.map((s) => s.login).join(', '));
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('Seed xatosi:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
