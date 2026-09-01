/**
 * Ma'lumotlar bazasi tarmoq bo'yicha yetib boradigan holga kelguncha kutadi.
 *
 * Nima uchun kerak: Railway'ning ichki tarmog'i (`*.railway.internal`) konteyner
 * ishga tushgandan bir necha yuz millisekund keyin tayyor bo'ladi. Agar
 * `prisma migrate deploy` shu ondayoq ishga tushsa, u `P1001: Can't reach
 * database server` xatosi bilan yiqiladi va konteyner qayta ishga tushish
 * sikliga (crash loop) tushib qoladi.
 *
 * Sozlash (ixtiyoriy):
 *   DB_WAIT_ATTEMPTS   — urinishlar soni (standart 20)
 *   DB_WAIT_DELAY_MS   — urinishlar orasidagi kutish (standart 1500 ms)
 *   DB_WAIT_TIMEOUT_MS — bitta urinish uchun timeout (standart 3000 ms)
 */
const net = require('net');

try {
  require('dotenv').config();
} catch {
  /* dotenv bo'lmasa ham davom etamiz */
}

const ATTEMPTS = Number(process.env.DB_WAIT_ATTEMPTS || 20);
const DELAY_MS = Number(process.env.DB_WAIT_DELAY_MS || 1500);
const TIMEOUT_MS = Number(process.env.DB_WAIT_TIMEOUT_MS || 3000);

/** DATABASE_URL dan host va portni ajratib oladi. SQLite bo'lsa null qaytaradi. */
function parseTarget(url) {
  if (!url) return null;
  if (url.startsWith('file:')) return null; // SQLite — tarmoq kerak emas

  try {
    const u = new URL(url);
    return { host: u.hostname, port: Number(u.port) || 5432 };
  } catch {
    // Parol ichida maxsus belgilar bo'lsa URL parser yiqilishi mumkin — zaxira usul
    const m = url.match(/@([^/:?]+)(?::(\d+))?/);
    if (!m) return null;
    return { host: m[1], port: Number(m[2]) || 5432 };
  }
}

/** Bitta TCP ulanish urinishi */
function tryConnect({ host, port }) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(TIMEOUT_MS);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const target = parseTarget(process.env.DATABASE_URL);

  if (!target) {
    console.log('ℹ  Tarmoq orqali ulanish kerak emas (SQLite) — kutish o\'tkazib yuborildi.');
    return;
  }

  for (let i = 1; i <= ATTEMPTS; i++) {
    if (await tryConnect(target)) {
      console.log(`✔ Baza yetib bo'ladigan holatda: ${target.host}:${target.port} (${i}-urinish)`);
      return;
    }
    if (i < ATTEMPTS) {
      console.log(
        `…  ${target.host}:${target.port} hali javob bermayapti (${i}/${ATTEMPTS}), ` +
          `${DELAY_MS} ms kutilyapti…`
      );
      await sleep(DELAY_MS);
    }
  }

  console.error(
    [
      '',
      `✖ ${target.host}:${target.port} manziliga ${ATTEMPTS} urinishdan keyin ham ulanib bo'lmadi.`,
      '',
      '  Tekshiring:',
      '   1) Railway’da PostgreSQL xizmati ishlab turibdimi? (yashil "Active" holati)',
      '   2) DATABASE_URL to‘g‘ri xizmatga bog‘langanmi?',
      `      Hozirgi manzil: ${target.host}:${target.port}`,
      '   3) `*.railway.internal` manzili faqat Railway ICHIDAN ishlaydi.',
      '      Lokal mashinadan ulanmoqchi bo‘lsangiz DATABASE_PUBLIC_URL ni ishlating.',
      '   4) Ichki tarmoq baribir ishlamasa, vaqtincha public manzilga o‘ting:',
      '         DATABASE_URL = ${{Postgres.DATABASE_PUBLIC_URL}}',
      '      (Postgres xizmatida Settings → Networking → Public Networking yoqilgan bo‘lsin)',
      '',
      '  Kutish vaqtini uzaytirish: DB_WAIT_ATTEMPTS va DB_WAIT_DELAY_MS o‘zgaruvchilari.',
      '',
    ].join('\n')
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('✖ wait-for-db kutilmagan xato:', e.message);
  process.exit(1);
});
