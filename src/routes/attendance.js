// /api/attendance — kelish-ketish seanslari.
// Bir xodim bir kunda BIR NECHTA marta kelib-ketishi mumkin, shuning uchun
// har bir kelish-ketish alohida yozuv (seans) sifatida saqlanadi.
//
// Ruxsatlar:
//   admin  — barcha xodimlarning yozuvlarini ko'radi va tahrirlaydi
//   xodim  — faqat O'Z yozuvlarini ko'radi, qo'shadi, tahrirlaydi va o'chiradi
const express = require('express');
const prisma = require('../prisma');
const { asyncHandler, AppError } = require('../middleware/error');
const { authRequired } = require('../middleware/auth');
const { schemas, validate } = require('../utils/validate');
const { writeAudit } = require('../utils/audit');
const {
  buildMonthlyReport,
  workedMinutes,
  toInterval,
  intervalsOverlap,
} = require('../utils/report');

const router = express.Router();
router.use(authRequired);

/** Bugungi sana YYYY-MM-DD */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

/** Aktyor shu yozuvni tahrirlay oladimi? */
function assertCanTouch(actor, employeeId) {
  if (actor.type === 'admin') return;
  if (actor.id !== employeeId) {
    throw new AppError(403, 'Diňe öz ýazgylaryňyzy üýtgedip bilýärsiňiz.');
  }
}

/**
 * Yangi/tahrirlangan seans o'sha kundagi boshqa seanslar bilan kesishmasligini
 * tekshiradi — aks holda bir vaqt ikki marta hisoblanib ketadi.
 */
async function assertNoOverlap({ employeeId, date, checkIn, checkOut, exceptId }) {
  const siblings = await prisma.attendance.findMany({
    where: { employeeId, date, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true, checkIn: true, checkOut: true },
  });

  const target = toInterval(checkIn, checkOut);
  for (const s of siblings) {
    if (intervalsOverlap(target, toInterval(s.checkIn, s.checkOut))) {
      throw new AppError(
        409,
        `Bu wagt aralygy ${s.checkIn}${s.checkOut ? ` - ${s.checkOut}` : ''} ýazgysy bilen gabat gelýär.`
      );
    }
  }
}

/** Seansning sanasi va vaqtini umumiy tekshirish */
function assertValidDate(date) {
  if (date > todayStr()) {
    throw new AppError(400, 'Geljekki sene üçin maglumat girizip bolmaýar.');
  }
}

// ── GET /api/attendance?year=2026&month=9 ─────────────────────────────
// Butun oy: kunlar, xodimlar, seanslar, sozlamalar va yig'indi.
// Xodim chaqirsa — faqat o'z ma'lumotlari qaytadi.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { year, month } = validate(schemas.yearMonth, req.query);
    const includeInactive = req.query.includeInactive !== 'false';

    const opts =
      req.actor.type === 'employee'
        ? { employeeId: req.actor.id }
        : { includeInactive };

    const report = await buildMonthlyReport(year, month, opts);

    res.json({
      year: report.year,
      month: report.month,
      days: report.days,
      settings: report.settings,
      employees: report.employees,
      records: report.records,
      summary: report.summary,
    });
  })
);

// ── POST /api/attendance ──────────────────────────────────────────────
// Yangi seans qo'shadi. Xodim uchun employeeId majburiy emas — o'zi hisoblanadi.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = validate(schemas.attendanceCreate, req.body);

    // Xodim faqat o'ziga yozadi, admin esa employeeId ni ko'rsatishi shart
    let employeeId;
    if (req.actor.type === 'employee') {
      employeeId = req.actor.id;
    } else {
      if (!data.employeeId) throw new AppError(400, 'Işgär saýlanmady.');
      employeeId = data.employeeId;
    }

    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) throw new AppError(404, 'Işgär tapylmady.');
    if (!employee.isActive) {
      throw new AppError(400, 'Işjeň däl işgär üçin maglumat girizip bolmaýar.');
    }

    assertValidDate(data.date);
    await assertNoOverlap({
      employeeId,
      date: data.date,
      checkIn: data.checkIn,
      checkOut: data.checkOut ?? null,
    });

    const record = await prisma.attendance.create({
      data: {
        employeeId,
        date: data.date,
        checkIn: data.checkIn,
        checkOut: data.checkOut ?? null,
        note: data.note ?? null,
        updatedByUserId: req.actor.type === 'admin' ? req.actor.id : null,
        updatedByEmployeeId: req.actor.type === 'employee' ? req.actor.id : null,
      },
    });

    await writeAudit({
      actor: req.actor,
      action: 'create',
      entity: 'Attendance',
      entityId: record.id,
      newValue: record,
    });

    res.status(201).json({
      record,
      workedMinutes: workedMinutes(record.checkIn, record.checkOut, {
        date: record.date,
        now: Date.now(),
      }),
    });
  })
);

// ── PUT /api/attendance/:id ───────────────────────────────────────────
// Mavjud seansni tahrirlaydi.
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new AppError(400, 'Nädogry ýazgy ID-si.');

    const data = validate(schemas.attendanceUpdate, req.body);
    const old = await prisma.attendance.findUnique({ where: { id } });
    if (!old) throw new AppError(404, 'Ýazgy tapylmady.');

    assertCanTouch(req.actor, old.employeeId);

    const checkIn = data.checkIn ?? old.checkIn;
    const checkOut = data.checkOut !== undefined ? data.checkOut : old.checkOut;

    await assertNoOverlap({
      employeeId: old.employeeId,
      date: old.date,
      checkIn,
      checkOut,
      exceptId: id,
    });

    const record = await prisma.attendance.update({
      where: { id },
      data: {
        checkIn,
        checkOut,
        note: data.note !== undefined ? data.note : old.note,
        updatedByUserId: req.actor.type === 'admin' ? req.actor.id : null,
        updatedByEmployeeId: req.actor.type === 'employee' ? req.actor.id : null,
      },
    });

    await writeAudit({
      actor: req.actor,
      action: 'update',
      entity: 'Attendance',
      entityId: id,
      oldValue: old,
      newValue: record,
    });

    res.json({
      record,
      workedMinutes: workedMinutes(record.checkIn, record.checkOut, {
        date: record.date,
        now: Date.now(),
      }),
    });
  })
);

// ── DELETE /api/attendance/:id ────────────────────────────────────────
// Admin istalgan yozuvni, xodim esa faqat o'z yozuvini o'chira oladi.
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new AppError(400, 'Nädogry ýazgy ID-si.');

    const old = await prisma.attendance.findUnique({ where: { id } });
    if (!old) throw new AppError(404, 'Ýazgy tapylmady.');

    assertCanTouch(req.actor, old.employeeId);

    await prisma.attendance.delete({ where: { id } });

    await writeAudit({
      actor: req.actor,
      action: 'delete',
      entity: 'Attendance',
      entityId: id,
      oldValue: old,
    });

    res.json({ message: 'Ýazgy pozuldy.' });
  })
);

module.exports = router;
