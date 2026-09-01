// Server kirish nuqtasi — Express ilovasi
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const { notFound, errorHandler } = require('./middleware/error');

const authRoutes = require('./routes/auth');
const employeeRoutes = require('./routes/employees');
const attendanceRoutes = require('./routes/attendance');
const reportRoutes = require('./routes/reports');
const userRoutes = require('./routes/users');
const settingsRoutes = require('./routes/settings');

// JWT_SECRET bo'lmasa ishga tushirmaymiz — bu jiddiy xavfsizlik masalasi
if (!process.env.JWT_SECRET) {
  console.error('✖ JWT_SECRET aniqlanmagan. .env faylini yarating (.env.example dan nusxa oling).');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('✖ DATABASE_URL aniqlanmagan. .env faylini tekshiring.');
  process.exit(1);
}

const app = express();
const PORT = Number(process.env.PORT) || 4000;

// ── CORS ──────────────────────────────────────────────────────────────
// Bir nechta manzilni vergul bilan ajratib yozish mumkin.
// `*` belgisi qo'llab-quvvatlanadi — Vercel'ning oldindan ko'rish (preview)
// deploylari har safar yangi manzil oladi, masalan:
//   CORS_ORIGIN="https://davomat.vercel.app,https://*.vercel.app"
const origins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** Maxsus belgilarni qochirish (regexp uchun) */
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Berilgan manzilga ruxsat bormi? */
function isOriginAllowed(origin) {
  // Origin yo'q = brauzerdan kelmagan so'rov (curl, sog'liq tekshiruvi) — ruxsat
  if (!origin) return true;
  if (origins.includes('*')) return true;

  return origins.some((pattern) => {
    if (pattern === origin) return true;
    if (!pattern.includes('*')) return false;
    const re = new RegExp('^' + pattern.split('*').map(escapeRegex).join('.*') + '$');
    return re.test(origin);
  });
}

app.use(
  cors({
    // Xato o'rniga `false` qaytaramiz — shunda 500 emas, brauzer o'zi bloklaydi
    origin: (origin, callback) => callback(null, isOriginAllowed(origin)),
  })
);

// Railway/Vercel kabi proksi ortida ishlaganda haqiqiy IP va protokolni bilish uchun
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

// Holatni tekshirish
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Marshrutlar
app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/users', userRoutes);
app.use('/api/settings', settingsRoutes);

// Xatolar
app.use(notFound);
app.use(errorHandler);

// Host berilmasa Node `::` ga bog'lanadi — bu Railway uchun to'g'ri
// (ham IPv4, ham IPv6 so'rovlarni qabul qiladi).
app.listen(PORT, () => {
  console.log(`✔ Server ishga tushdi: port ${PORT}`);
  console.log(`  Ruxsat etilgan manzillar (CORS): ${origins.join(', ')}`);

  // Vaqt mintaqasi ikkita narsaga ta'sir qiladi: (1) hali tugallanmagan
  // seanslarning joriy vaqtgacha hisoblanishi, (2) kelajakdagi vaqtni rad etish.
  if (process.env.TZ) {
    const now = new Date();
    console.log(`  Vaqt mintaqasi (TZ): ${process.env.TZ} — hozir ${now.toLocaleString('en-GB')}`);
  } else {
    console.warn(
      '  ⚠ TZ o\'zgaruvchisi qo\'yilmagan — server UTC\'da ishlayapti.\n' +
        '    • tugallanmagan seanslar noto\'g\'ri hisoblanishi mumkin\n' +
        '    • kelajakdagi vaqt serverda TEKSHIRILMAYDI (faqat brauzerda)\n' +
        '    Tuzatish: TZ="Asia/Ashgabat"'
    );
  }
});
