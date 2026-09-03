// /api/attendance — check-in/check-out sessions.
// An employee may come and go SEVERAL times a day, so every check-in/check-out
// is stored as a separate record (session).
//
// Permissions:
//   admin     — sees and edits the records of every employee
//   employee  — only sees, adds, edits and deletes THEIR OWN records
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
  nowParts,
  nextDay,
  isFutureMoment,
} = require('../utils/report');

const router = express.Router();
router.use(authRequired);

/** Today's date as YYYY-MM-DD */
function todayStr() {
  return nowParts().date;
}

// To validate a FUTURE TIME on the server, the server clock has to be in the
// same time zone as the user. If TZ is not set (the default on Railway is UTC)
// the server clock differs from the user's and valid records could be rejected.
// That is why this check only runs when TZ is explicitly set; on the browser
// side it always runs.
const TIMEZONE_CONFIGURED = Boolean(process.env.TZ);

/**
 * Checks that the check-in/check-out time is not in the future.
 * On a night shift (checkOut < checkIn) the check-out belongs to the NEXT day —
 * which means it too can lie in the future.
 */
function assertNotInFuture({ date, checkIn, checkOut }) {
  if (!TIMEZONE_CONFIGURED) return;
  const now = nowParts();

  if (checkIn && isFutureMoment(date, checkIn, now)) {
    throw new AppError(400, '"Geldi" wagty geljekde bolup bilmez.');
  }

  if (checkOut) {
    // checkOut <= checkIn — this is a night shift, the check-out is on the next day
    const overnight = checkIn && checkOut <= checkIn;
    const outDate = overnight ? nextDay(date) : date;
    if (isFutureMoment(outDate, checkOut, now)) {
      throw new AppError(
        400,
        overnight
          ? '"Gitdi" wagty geljekde bolup bilmez (bu wagt ertirki güne degişli).'
          : '"Gitdi" wagty geljekde bolup bilmez.'
      );
    }
  }
}

/** May this actor edit this record? */
function assertCanTouch(actor, employeeId) {
  if (actor.type === 'admin') return;
  if (actor.id !== employeeId) {
    throw new AppError(403, 'Diňe öz ýazgylaryňyzy üýtgedip bilýärsiňiz.');
  }
}

/**
 * Checks that the new/edited session does not overlap with the other sessions of
 * that day — otherwise the same period would be counted twice.
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

/** Common validation of a session's date and time */
function assertValidDate(date) {
  if (date > todayStr()) {
    throw new AppError(400, 'Geljekki sene üçin maglumat girizip bolmaýar.');
  }
}

// ── GET /api/attendance?year=2026&month=9 ─────────────────────────────
// The whole month: days, employees, sessions, settings and totals.
// When an employee calls it — only their own data is returned.
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
// Adds a new session. For an employee, employeeId is optional — it is inferred.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = validate(schemas.attendanceCreate, req.body);

    // An employee only writes for themselves, while an admin must supply employeeId
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
    assertNotInFuture({
      date: data.date,
      checkIn: data.checkIn,
      checkOut: data.checkOut ?? null,
    });
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
// Edits an existing session.
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

    assertNotInFuture({ date: old.date, checkIn, checkOut });
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
// An admin can delete any record, an employee only their own.
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
