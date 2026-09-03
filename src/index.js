// Server entry point — the Express application
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

// Refuse to start without JWT_SECRET — this is a serious security issue
if (!process.env.JWT_SECRET) {
  console.error('✖ JWT_SECRET is not set. Create a .env file (copy it from .env.example).');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('✖ DATABASE_URL is not set. Check your .env file.');
  process.exit(1);
}

const app = express();
const PORT = Number(process.env.PORT) || 4000;

// ── CORS ──────────────────────────────────────────────────────────────
// Several addresses can be listed separated by commas.
// The `*` wildcard is supported — Vercel preview deployments get a new
// address every time, for example:
//   CORS_ORIGIN="https://davomat.vercel.app,https://*.vercel.app"
const origins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** Escape special characters (for the regexp) */
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Is the given origin allowed? */
function isOriginAllowed(origin) {
  // No origin = the request did not come from a browser (curl, health check) — allow it
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
    // Return `false` instead of an error — then the browser blocks it rather than a 500
    origin: (origin, callback) => callback(null, isOriginAllowed(origin)),
  })
);

// So the real IP and protocol are known when running behind a proxy such as Railway/Vercel
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/users', userRoutes);
app.use('/api/settings', settingsRoutes);

// Errors
app.use(notFound);
app.use(errorHandler);

// With no host given Node binds to `::` — which is what Railway needs
// (it accepts both IPv4 and IPv6 requests).
app.listen(PORT, () => {
  console.log(`✔ Server started: port ${PORT}`);
  console.log(`  Allowed origins (CORS): ${origins.join(', ')}`);

  // The time zone affects two things: (1) counting unfinished sessions up to
  // the current time, (2) rejecting times that lie in the future.
  if (process.env.TZ) {
    const now = new Date();
    console.log(`  Time zone (TZ): ${process.env.TZ} — now ${now.toLocaleString('en-GB')}`);
  } else {
    console.warn(
      '  ⚠ The TZ variable is not set — the server is running in UTC.\n' +
        '    • unfinished sessions may be counted incorrectly\n' +
        '    • future times are NOT VALIDATED on the server (only in the browser)\n' +
        '    Fix: TZ="Asia/Ashgabat"'
    );
  }
});
