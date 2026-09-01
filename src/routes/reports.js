// /api/reports — oylik hisobot va XLSX eksport
const express = require('express');
const ExcelJS = require('exceljs');
const { asyncHandler } = require('../middleware/error');
const { authRequired } = require('../middleware/auth');
const { schemas, validate } = require('../utils/validate');
const {
  buildMonthlyReport,
  groupByDay,
  minutesToTime,
  workedMinutes,
  isLate,
} = require('../utils/report');

const router = express.Router();
router.use(authRequired);

// Turkman tilidagi oy nomlari va hafta kunlari
const MONTHS_TK = [
  'Ýanwar', 'Fewral', 'Mart', 'Aprel', 'Maý', 'Iýun',
  'Iýul', 'Awgust', 'Sentýabr', 'Oktýabr', 'Noýabr', 'Dekabr',
];
const WEEKDAYS_TK = ['Du', 'Si', 'Ça', 'Pe', 'An', 'Şe', 'Ýe'];

/** Xodim faqat o'z ma'lumotlarini oladi */
function scopeFor(req) {
  return req.actor.type === 'employee'
    ? { employeeId: req.actor.id }
    : { includeInactive: req.query.includeInactive !== 'false' };
}

/** Bir kundagi seanslarni "09:00 - 12:00\n13:00 - 18:00" ko'rinishida */
function formatDayCell(day) {
  if (!day || day.sessions.length === 0) return '';
  return day.sessions.map((s) => `${s.checkIn} - ${s.checkOut || '…'}`).join('\n');
}

// GET /api/reports/monthly?year=&month=
router.get(
  '/monthly',
  asyncHandler(async (req, res) => {
    const { year, month } = validate(schemas.yearMonth, req.query);
    const report = await buildMonthlyReport(year, month, scopeFor(req));

    res.json({
      year,
      month,
      monthName: MONTHS_TK[month - 1],
      settings: report.settings,
      workdays: report.days.filter((d) => !d.isWeekend).length,
      summary: report.summary,
    });
  })
);

// GET /api/reports/export?year=&month=  → XLSX fayl
router.get(
  '/export',
  asyncHandler(async (req, res) => {
    const { year, month } = validate(schemas.yearMonth, req.query);
    const report = await buildMonthlyReport(year, month, scopeFor(req));
    const { days, employees, records, settings, summary } = report;

    const now = Date.now();
    const byDay = groupByDay(records, now);
    const summaryMap = new Map(summary.map((s) => [s.employeeId, s]));

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Işgär gatnaşyk ulgamy';
    wb.created = new Date();

    const thin = (argb) => ({
      top: { style: 'thin', color: { argb } },
      left: { style: 'thin', color: { argb } },
      bottom: { style: 'thin', color: { argb } },
      right: { style: 'thin', color: { argb } },
    });

    // ── 1-varaq: kunlik jadval ──────────────────────────────────────
    const ws = wb.addWorksheet(`${MONTHS_TK[month - 1]} ${year}`, {
      views: [{ state: 'frozen', xSplit: 2, ySplit: 2 }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });

    ws.addRow([
      'Ady',
      'Wezipesi',
      ...days.map((d) => String(d.day).padStart(2, '0')),
      'Jemi sagat',
      'Işlän güni',
      'Gijä galma',
    ]);
    ws.addRow([
      '',
      '',
      ...days.map((d) => WEEKDAYS_TK[d.weekday - 1]),
      '',
      '',
      '',
    ]);

    for (const emp of employees) {
      const row = [emp.fullName, emp.position || ''];
      for (const d of days) row.push(formatDayCell(byDay.get(`${emp.id}|${d.date}`)));
      const s = summaryMap.get(emp.id);
      row.push(s ? s.totalHours : 0, s ? s.workedDays : 0, s ? s.lateCount : 0);
      ws.addRow(row);
    }

    // Sarlavha uslubi
    [1, 2].forEach((i) => {
      const r = ws.getRow(i);
      r.font = { bold: true, size: 10 };
      r.alignment = { horizontal: 'center', vertical: 'middle' };
      r.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
        cell.border = thin('FFB0BCCB');
      });
    });

    // Ma'lumot kataklari + ranglar
    ws.eachRow((row, rowNumber) => {
      if (rowNumber <= 2) return;
      const emp = employees[rowNumber - 3];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.border = thin('FFDDE3EA');
        if (colNumber <= 2) {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
          return;
        }
        // Bir katakda bir nechta seans bo'lishi mumkin — matn qatorlarga bo'linadi
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.font = { size: 8 };

        const dayIndex = colNumber - 3;
        if (dayIndex < 0 || dayIndex >= days.length) return;

        const d = days[dayIndex];
        const day = emp ? byDay.get(`${emp.id}|${d.date}`) : null;

        let color = null;
        if (day && isLate(day.firstCheckIn, settings)) {
          color = 'FFFDE0E0'; // kechikkan
        } else if (day && !day.hasOpen) {
          color = 'FFE3F6E5'; // to'liq
        } else if (day && day.hasOpen) {
          color = 'FFFFF4DB'; // tugallanmagan
        } else if (d.isWeekend) {
          color = 'FFF1F1F4'; // dam olish kuni
        }
        if (color) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
      });
    });

    ws.getColumn(1).width = 26;
    ws.getColumn(2).width = 18;
    for (let i = 0; i < days.length; i++) ws.getColumn(3 + i).width = 13;
    [3, 4, 5].forEach((o) => (ws.getColumn(days.length + o).width = 12));

    // ── 2-varaq: umumiy hisobot ─────────────────────────────────────
    const ws2 = wb.addWorksheet('Hasabat');
    ws2.addRow([`${MONTHS_TK[month - 1]} ${year} — aýlyk hasabat`]);
    ws2.addRow([
      `Iş başlanýan wagt: ${settings.workStart} · Gijä galma çägi: ${settings.lateThresholdMin} min`,
    ]);
    ws2.addRow([]);
    ws2.addRow([
      'Ady', 'Wezipesi', 'Jemi sagat', 'Jemi (SS:MM)',
      'Işlän güni', 'Gijä galma', 'Doly däl gün', 'Ýazgy sany',
    ]);

    for (const s of summary) {
      ws2.addRow([
        s.fullName, s.position || '', s.totalHours, s.totalFormatted,
        s.workedDays, s.lateCount, s.incompleteDays, s.sessionCount,
      ]);
    }

    ws2.getRow(1).font = { bold: true, size: 14 };
    ws2.getRow(4).font = { bold: true };
    ws2.getRow(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
    ws2.getColumn(1).width = 26;
    ws2.getColumn(2).width = 18;
    [3, 4, 5, 6, 7, 8].forEach((c) => (ws2.getColumn(c).width = 14));

    // ── 3-varaq: har bir seans alohida qator ────────────────────────
    // Bir kunda bir nechta kelish-ketish bo'lgani uchun batafsil ro'yxat foydali
    const ws3 = wb.addWorksheet('Jikme-jik');
    ws3.addRow(['Ady', 'Sene', 'Gün', 'Geldi', 'Gitdi', 'Dowamlylygy', 'Bellik']);
    ws3.getRow(1).font = { bold: true };
    ws3.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };

    const empMap = new Map(employees.map((e) => [e.id, e]));
    const dayMap = new Map(days.map((d) => [d.date, d]));

    for (const r of records) {
      const emp = empMap.get(r.employeeId);
      if (!emp) continue;
      const d = dayMap.get(r.date);
      // Ochiq seans ham hisoblanadi (joriy vaqtgacha) — eksport qilingan
      // paytdagi holatni ko'rsatadi
      const mins = workedMinutes(r.checkIn, r.checkOut, { date: r.date, now });
      ws3.addRow([
        emp.fullName,
        r.date,
        d ? WEEKDAYS_TK[d.weekday - 1] : '',
        r.checkIn,
        r.checkOut || '',
        mins > 0 ? minutesToTime(mins) : '',
        r.note || '',
      ]);
    }

    ws3.getColumn(1).width = 26;
    ws3.getColumn(2).width = 13;
    ws3.getColumn(3).width = 6;
    [4, 5, 6].forEach((c) => (ws3.getColumn(c).width = 12));
    ws3.getColumn(7).width = 32;

    // ── Faylni yuborish ─────────────────────────────────────────────
    const fileName = `gatnasyk-${year}-${String(month).padStart(2, '0')}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

    await wb.xlsx.write(res);
    res.end();
  })
);

module.exports = router;
