// Attendance calculations.
// A day may contain several check-in/check-out sessions, so the daily total is
// the sum of all of that day's sessions.
const prisma = require('../prisma');

/** Converts "HH:MM" into minutes since midnight */
function timeToMinutes(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Converts minutes back into "HH:MM" (even beyond 24 hours) */
function minutesToTime(min) {
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Number of days in the given month */
function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/** Builds a YYYY-MM-DD string */
function toDateStr(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Next day: "2026-09-01" -> "2026-09-02" */
function nextDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + 1);
  return toDateStr(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

/** "Now" in server time: { date: "YYYY-MM-DD", time: "HH:MM" } */
function nowParts() {
  const d = new Date();
  return {
    date: toDateStr(d.getFullYear(), d.getMonth() + 1, d.getDate()),
    time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
  };
}

/**
 * Is the (date, time) pair later than the current moment?
 * String comparison is used — for both "YYYY-MM-DD" and "HH:MM" lexicographic
 * order matches chronological order.
 */
function isFutureMoment(date, time, now = nowParts()) {
  if (date > now.date) return true;
  if (date < now.date) return false;
  return time > now.time;
}

/** ISO weekday: 1 = Monday ... 7 = Sunday */
function isoWeekday(year, month, day) {
  const wd = new Date(year, month - 1, day).getDay(); // 0 = Sunday
  return wd === 0 ? 7 : wd;
}

/** Maximum time counted for an open session (24 hours) */
const OPEN_SESSION_MAX_MINUTES = 24 * 60;

/**
 * Time worked in a single session (minutes).
 *
 * - If "Gitdi" is recorded — a plain difference (night shifts are handled).
 * - If "Gitdi" is not recorded yet — counted up to the CURRENT TIME, so the
 *   hours are visible even while the employee is still working.
 *
 * The 24-hour cap: if somebody forgets to record "Gitdi", an open session from
 * last week would turn into 200+ hours and wreck the reports.
 *
 * ⚠ The server time zone matters: if the `TZ` variable is not set, Railway runs
 * in UTC and open sessions are counted incorrectly (usually as 0).
 * See .env.example.
 *
 * @param {string} checkIn
 * @param {string|null} checkOut
 * @param {{date?: string, now?: number}} [options]
 */
function workedMinutes(checkIn, checkOut, options = {}) {
  const inM = timeToMinutes(checkIn);
  if (inM == null) return 0;

  // Completed session
  if (checkOut) {
    const outM = timeToMinutes(checkOut);
    if (outM == null) return 0;
    let diff = outM - inM;
    if (diff < 0) diff += 24 * 60; // night shift
    return diff;
  }

  // Open session — up to the current time
  const { date, now } = options;
  if (!date || now == null) return 0;

  const [y, mo, d] = date.split('-').map(Number);
  if (!y || !mo || !d) return 0;

  const start = new Date(y, mo - 1, d, Math.floor(inM / 60), inM % 60, 0, 0).getTime();
  const elapsed = Math.floor((now - start) / 60000);

  if (elapsed < 0 || elapsed > OPEN_SESSION_MAX_MINUTES) return 0;
  return elapsed;
}

/**
 * Converts a session into a [start, end] range in minutes.
 * For a night shift the end goes past 24 hours (e.g. 22:00→06:00 = [1320, 1800]).
 * A session that has not finished yet is treated as a single point.
 */
function toInterval(checkIn, checkOut) {
  const start = timeToMinutes(checkIn);
  if (start == null) return null;
  if (!checkOut) return [start, start + 1];
  let end = timeToMinutes(checkOut);
  if (end <= start) end += 24 * 60;
  return [start, end];
}

/** Do the two sessions overlap in time? */
function intervalsOverlap(a, b) {
  if (!a || !b) return false;
  return a[0] < b[1] && b[0] < a[1];
}

/** Is it late? (decided by the EARLIEST check-in of the day) */
function isLate(checkIn, settings) {
  if (!checkIn) return false;
  const limit = timeToMinutes(settings.workStart) + (settings.lateThresholdMin || 0);
  return timeToMinutes(checkIn) > limit;
}

/** Turns the weekendDays string into an array: "6,7" -> [6,7] */
function parseWeekendDays(str) {
  if (!str) return [];
  return str
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n) && n >= 1 && n <= 7);
}

/** Reads the settings (creating them if they do not exist) */
async function getSettings() {
  let s = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!s) s = await prisma.settings.create({ data: { id: 1 } });
  return {
    workStart: s.workStart,
    workEnd: s.workEnd,
    lateThresholdMin: s.lateThresholdMin,
    weekendDays: parseWeekendDays(s.weekendDays),
    updatedAt: s.updatedAt,
  };
}

/**
 * Groups the sessions by day and computes the daily totals.
 * @param {Array} records
 * @param {number} [now] - used to count open sessions (Date.now())
 * @returns Map<"employeeId|date", {sessions, minutes, firstCheckIn, hasOpen}>
 */
function groupByDay(records, now = Date.now()) {
  const map = new Map();
  for (const r of records) {
    const key = `${r.employeeId}|${r.date}`;
    let day = map.get(key);
    if (!day) {
      day = { sessions: [], minutes: 0, firstCheckIn: null, hasOpen: false };
      map.set(key, day);
    }
    day.sessions.push(r);
    day.minutes += workedMinutes(r.checkIn, r.checkOut, { date: r.date, now });
    if (!r.checkOut) day.hasOpen = true;
    if (!day.firstCheckIn || r.checkIn < day.firstCheckIn) day.firstCheckIn = r.checkIn;
  }
  // The sessions within each day are sorted by time
  for (const day of map.values()) {
    day.sessions.sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  }
  return map;
}

/**
 * Monthly report.
 * @param {number} year
 * @param {number} month
 * @param {{employeeId?: number, includeInactive?: boolean}} opts
 *        if employeeId is given — only that employee (for the employee's own page)
 */
async function buildMonthlyReport(year, month, { employeeId, includeInactive = true } = {}) {
  const total = daysInMonth(year, month);
  const from = toDateStr(year, month, 1);
  const to = toDateStr(year, month, total);

  const settings = await getSettings();

  const employeeWhere = {};
  if (employeeId) employeeWhere.id = employeeId;
  else if (!includeInactive) employeeWhere.isActive = true;

  const employees = await prisma.employee.findMany({
    where: employeeWhere,
    orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
    select: { id: true, login: true, fullName: true, position: true, isActive: true },
  });

  const records = await prisma.attendance.findMany({
    where: {
      date: { gte: from, lte: to },
      ...(employeeId ? { employeeId } : {}),
    },
    orderBy: [{ date: 'asc' }, { checkIn: 'asc' }],
    select: {
      id: true,
      employeeId: true,
      date: true,
      checkIn: true,
      checkOut: true,
      note: true,
      updatedAt: true,
    },
  });

  // List of days (for the table columns)
  const days = [];
  for (let d = 1; d <= total; d++) {
    const weekday = isoWeekday(year, month, d);
    days.push({
      day: d,
      date: toDateStr(year, month, d),
      weekday,
      isWeekend: settings.weekendDays.includes(weekday),
    });
  }

  const now = Date.now();
  const byDay = groupByDay(records, now);

  // Totals per employee
  const summary = employees.map((emp) => {
    let totalMinutes = 0;
    let workedDays = 0;
    let lateCount = 0;
    let incompleteDays = 0;
    let sessionCount = 0;

    for (const d of days) {
      const day = byDay.get(`${emp.id}|${d.date}`);
      if (!day || day.sessions.length === 0) continue;
      totalMinutes += day.minutes;
      sessionCount += day.sessions.length;
      workedDays += 1;
      // Lateness counts once per day — based on the earliest check-in
      if (isLate(day.firstCheckIn, settings)) lateCount += 1;
      if (day.hasOpen) incompleteDays += 1;
    }

    return {
      employeeId: emp.id,
      login: emp.login,
      fullName: emp.fullName,
      position: emp.position,
      isActive: emp.isActive,
      totalMinutes,
      totalHours: Math.round((totalMinutes / 60) * 100) / 100,
      totalFormatted: minutesToTime(totalMinutes),
      workedDays,
      lateCount,
      incompleteDays,
      sessionCount,
    };
  });

  return { year, month, days, settings, employees, records, summary, byDay };
}

module.exports = {
  OPEN_SESSION_MAX_MINUTES,
  nextDay,
  nowParts,
  isFutureMoment,
  timeToMinutes,
  minutesToTime,
  daysInMonth,
  toDateStr,
  isoWeekday,
  workedMinutes,
  toInterval,
  intervalsOverlap,
  isLate,
  parseWeekendDays,
  getSettings,
  groupByDay,
  buildMonthlyReport,
};
