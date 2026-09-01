// Davomat hisob-kitoblari.
// Bir kunda bir nechta kelish-ketish seansi bo'lishi mumkin, shuning uchun
// kunlik jami = o'sha kundagi barcha seanslar yig'indisi.
const prisma = require('../prisma');

/** "HH:MM" ni yarim tundan boshlab minutga aylantiradi */
function timeToMinutes(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Minutni "HH:MM" ko'rinishiga qaytaradi (24 soatdan oshsa ham) */
function minutesToTime(min) {
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Berilgan oydagi kunlar soni */
function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/** YYYY-MM-DD qatorini yasaydi */
function toDateStr(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** ISO hafta kuni: 1 = Dushanba ... 7 = Yakshanba */
function isoWeekday(year, month, day) {
  const wd = new Date(year, month - 1, day).getDay(); // 0 = Yakshanba
  return wd === 0 ? 7 : wd;
}

/** Bitta seansda ishlangan vaqt (minut). Tunda tugasa keyingi kunga o'tadi. */
function workedMinutes(checkIn, checkOut) {
  const inM = timeToMinutes(checkIn);
  const outM = timeToMinutes(checkOut);
  if (inM == null || outM == null) return 0;
  let diff = outM - inM;
  if (diff < 0) diff += 24 * 60; // tungi smena
  return diff;
}

/**
 * Seansni [boshlanish, tugash] minut oralig'iga aylantiradi.
 * Tungi smena bo'lsa tugash 24 soatdan oshadi (masalan 22:00→06:00 = [1320, 1800]).
 * Hali tugamagan seans nuqta sifatida qaraladi.
 */
function toInterval(checkIn, checkOut) {
  const start = timeToMinutes(checkIn);
  if (start == null) return null;
  if (!checkOut) return [start, start + 1];
  let end = timeToMinutes(checkOut);
  if (end <= start) end += 24 * 60;
  return [start, end];
}

/** Ikki seans vaqt bo'yicha kesishadimi? */
function intervalsOverlap(a, b) {
  if (!a || !b) return false;
  return a[0] < b[1] && b[0] < a[1];
}

/** Kechikkanmi? (kunning ENG ERTA kelishi bo'yicha aniqlanadi) */
function isLate(checkIn, settings) {
  if (!checkIn) return false;
  const limit = timeToMinutes(settings.workStart) + (settings.lateThresholdMin || 0);
  return timeToMinutes(checkIn) > limit;
}

/** weekendDays matnini massivga aylantiradi: "6,7" -> [6,7] */
function parseWeekendDays(str) {
  if (!str) return [];
  return str
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n) && n >= 1 && n <= 7);
}

/** Sozlamalarni oladi (yo'q bo'lsa yaratadi) */
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
 * Seanslarni kunlar bo'yicha guruhlab, kunlik yig'indini hisoblaydi.
 * @returns Map<"employeeId|date", {sessions, minutes, firstCheckIn, hasOpen}>
 */
function groupByDay(records) {
  const map = new Map();
  for (const r of records) {
    const key = `${r.employeeId}|${r.date}`;
    let day = map.get(key);
    if (!day) {
      day = { sessions: [], minutes: 0, firstCheckIn: null, hasOpen: false };
      map.set(key, day);
    }
    day.sessions.push(r);
    day.minutes += workedMinutes(r.checkIn, r.checkOut);
    if (!r.checkOut) day.hasOpen = true;
    if (!day.firstCheckIn || r.checkIn < day.firstCheckIn) day.firstCheckIn = r.checkIn;
  }
  // Har bir kun ichidagi seanslar vaqt bo'yicha tartiblanadi
  for (const day of map.values()) {
    day.sessions.sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  }
  return map;
}

/**
 * Oylik hisobot.
 * @param {number} year
 * @param {number} month
 * @param {{employeeId?: number, includeInactive?: boolean}} opts
 *        employeeId berilsa — faqat o'sha xodim (xodimning shaxsiy sahifasi uchun)
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

  // Kunlar ro'yxati (jadval ustunlari uchun)
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

  const byDay = groupByDay(records);

  // Har bir xodim bo'yicha yig'indi
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
      // Kechikish kuniga bir marta — eng erta kelish bo'yicha
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
