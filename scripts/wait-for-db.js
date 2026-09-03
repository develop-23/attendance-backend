/**
 * Waits until the database becomes reachable over the network.
 *
 * Why this is needed: Railway's internal network (`*.railway.internal`) only
 * becomes ready a few hundred milliseconds after the container starts. If
 * `prisma migrate deploy` runs at that very moment it fails with
 * `P1001: Can't reach database server` and the container ends up in a
 * restart (crash) loop.
 *
 * Configuration (optional):
 *   DB_WAIT_ATTEMPTS   — number of attempts (default 20)
 *   DB_WAIT_DELAY_MS   — wait between attempts (default 1500 ms)
 *   DB_WAIT_TIMEOUT_MS — timeout for a single attempt (default 3000 ms)
 */
const net = require('net');

try {
  require('dotenv').config();
} catch {
  /* carry on even without dotenv */
}

const ATTEMPTS = Number(process.env.DB_WAIT_ATTEMPTS || 20);
const DELAY_MS = Number(process.env.DB_WAIT_DELAY_MS || 1500);
const TIMEOUT_MS = Number(process.env.DB_WAIT_TIMEOUT_MS || 3000);

/** Extracts the host and port from DATABASE_URL. Returns null for SQLite. */
function parseTarget(url) {
  if (!url) return null;
  if (url.startsWith('file:')) return null; // SQLite — no network needed

  try {
    const u = new URL(url);
    return { host: u.hostname, port: Number(u.port) || 5432 };
  } catch {
    // The URL parser can fail if the password contains special characters — fallback
    const m = url.match(/@([^/:?]+)(?::(\d+))?/);
    if (!m) return null;
    return { host: m[1], port: Number(m[2]) || 5432 };
  }
}

/** A single TCP connection attempt */
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
    console.log('ℹ  No network connection needed (SQLite) — waiting was skipped.');
    return;
  }

  for (let i = 1; i <= ATTEMPTS; i++) {
    if (await tryConnect(target)) {
      console.log(`✔ The database is reachable: ${target.host}:${target.port} (attempt ${i})`);
      return;
    }
    if (i < ATTEMPTS) {
      console.log(
        `…  ${target.host}:${target.port} is not answering yet (${i}/${ATTEMPTS}), ` +
          `waiting ${DELAY_MS} ms…`
      );
      await sleep(DELAY_MS);
    }
  }

  console.error(
    [
      '',
      `✖ Could not connect to ${target.host}:${target.port} even after ${ATTEMPTS} attempts.`,
      '',
      '  Check the following:',
      '   1) Is the PostgreSQL service on Railway running? (a green "Active" status)',
      '   2) Is DATABASE_URL linked to the right service?',
      `      Current address: ${target.host}:${target.port}`,
      '   3) The `*.railway.internal` address only works from INSIDE Railway.',
      '      To connect from a local machine use DATABASE_PUBLIC_URL.',
      '   4) If the internal network still does not work, switch to the public address for now:',
      '         DATABASE_URL = ${{Postgres.DATABASE_PUBLIC_URL}}',
      '      (make sure Settings → Networking → Public Networking is enabled on the Postgres service)',
      '',
      '  To wait longer: the DB_WAIT_ATTEMPTS and DB_WAIT_DELAY_MS variables.',
      '',
    ].join('\n')
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('✖ wait-for-db unexpected error:', e.message);
  process.exit(1);
});
