// /api/employees — xodimlar boshqaruvi (faqat admin).
// Har bir xodimning o'z login/paroli bor — u bilan tizimga kirib
// o'z kelish-ketish vaqtlarini kiritadi.
const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../prisma');
const { asyncHandler, AppError } = require('../middleware/error');
const { authRequired, adminOnly } = require('../middleware/auth');
const { schemas, validate } = require('../utils/validate');
const { writeAudit } = require('../utils/audit');
const { assertLoginAvailable } = require('../utils/accounts');

const router = express.Router();
router.use(authRequired);

// Parol xeshi hech qachon qaytarilmasligi uchun
const publicFields = {
  id: true,
  login: true,
  fullName: true,
  position: true,
  isActive: true,
  createdAt: true,
};

// Ro'yxat uchun: har bir xodimning nechta davomat yozuvi borligi ham qaytadi.
// Bu butunlay o'chirishdan oldin ogohlantirish ko'rsatish uchun kerak.
const publicFieldsWithCount = {
  ...publicFields,
  _count: { select: { attendances: true } },
};

/** Prisma'ning _count ni oddiy `attendanceCount` maydoniga aylantiradi */
function withCount(employee) {
  if (!employee) return employee;
  const { _count, ...rest } = employee;
  return { ...rest, attendanceCount: _count?.attendances ?? 0 };
}

// GET /api/employees?search=&includeInactive=true
// Xodim ham chaqira oladi, lekin faqat o'zini ko'radi.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    if (req.actor.type === 'employee') {
      const employee = await prisma.employee.findUnique({
        where: { id: req.actor.id },
        select: publicFields,
      });
      return res.json({ employees: [employee] });
    }

    const { search, includeInactive } = req.query;
    const showInactive = includeInactive === 'true' || includeInactive === '1';

    const where = {};
    if (!showInactive) where.isActive = true;
    if (search && String(search).trim()) {
      // SQLite'da `mode: insensitive` qo'llab-quvvatlanmaydi, shu sabab oddiy `contains`
      where.fullName = { contains: String(search).trim() };
    }

    const employees = await prisma.employee.findMany({
      where,
      select: publicFieldsWithCount,
      orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
    });

    res.json({ employees: employees.map(withCount) });
  })
);

// POST /api/employees  (faqat admin)
router.post(
  '/',
  adminOnly,
  asyncHandler(async (req, res) => {
    const data = validate(schemas.employeeCreate, req.body);
    await assertLoginAvailable(data.login);

    const employee = await prisma.employee.create({
      data: {
        login: data.login,
        passwordHash: await bcrypt.hash(data.password, 10),
        fullName: data.fullName,
        position: data.position ?? null,
        isActive: data.isActive ?? true,
      },
      select: publicFields,
    });

    await writeAudit({
      actor: req.actor,
      action: 'create',
      entity: 'Employee',
      entityId: employee.id,
      newValue: employee,
    });

    res.status(201).json({ employee });
  })
);

// PUT /api/employees/:id  (faqat admin) — parolni ham tiklashi mumkin
router.put(
  '/:id',
  adminOnly,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new AppError(400, 'Nädogry işgär ID-si.');

    const data = validate(schemas.employeeUpdate, req.body);
    const old = await prisma.employee.findUnique({ where: { id }, select: publicFields });
    if (!old) throw new AppError(404, 'Işgär tapylmady.');

    const updateData = {};
    if (data.fullName !== undefined) updateData.fullName = data.fullName;
    if (data.position !== undefined) updateData.position = data.position;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.password) updateData.passwordHash = await bcrypt.hash(data.password, 10);

    const employee = await prisma.employee.update({
      where: { id },
      data: updateData,
      select: publicFields,
    });

    await writeAudit({
      actor: req.actor,
      action: 'update',
      entity: 'Employee',
      entityId: id,
      oldValue: old,
      newValue: { ...employee, passwordChanged: Boolean(data.password) },
    });

    res.json({ employee });
  })
);

// DELETE /api/employees/:id                 → arxivga (soft delete)
// DELETE /api/employees/:id?permanent=true   → BUTUNLAY o'chirish
//
// ⚠ Butunlay o'chirishda xodimning BARCHA davomat yozuvlari ham o'chadi
// (schema.prisma: Attendance.employee → onDelete: Cascade). Bu amalni
// qaytarib bo'lmaydi, shuning uchun o'tgan oylardagi hisobotlar ham o'zgaradi.
// AuditLog'da esa nima o'chirilgani (ism, login, yozuvlar soni) saqlanib qoladi.
router.delete(
  '/:id',
  adminOnly,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new AppError(400, 'Nädogry işgär ID-si.');

    const permanent = req.query.permanent === 'true' || req.query.permanent === '1';

    const old = await prisma.employee.findUnique({
      where: { id },
      select: publicFieldsWithCount,
    });
    if (!old) throw new AppError(404, 'Işgär tapylmady.');

    const employee = withCount(old);

    // ── Butunlay o'chirish ──────────────────────────────────────────
    if (permanent) {
      await prisma.employee.delete({ where: { id } });

      await writeAudit({
        actor: req.actor,
        action: 'delete',
        entity: 'Employee',
        entityId: id,
        oldValue: employee, // yozuvlar soni bilan birga saqlanadi
      });

      return res.json({
        deleted: true,
        attendanceCount: employee.attendanceCount,
        message:
          employee.attendanceCount > 0
            ? `Işgär we onuň ${employee.attendanceCount} sany gatnaşyk ýazgysy hemişelik pozuldy.`
            : 'Işgär hemişelik pozuldy.',
      });
    }

    // ── Arxivga o'tkazish ───────────────────────────────────────────
    if (!old.isActive) throw new AppError(400, 'Bu işgär eýýäm işjeň däl.');

    const updated = await prisma.employee.update({
      where: { id },
      data: { isActive: false },
      select: publicFieldsWithCount,
    });

    await writeAudit({
      actor: req.actor,
      action: 'soft-delete',
      entity: 'Employee',
      entityId: id,
      oldValue: employee,
      newValue: withCount(updated),
    });

    res.json({ employee: withCount(updated), message: 'Işgär arhiwe geçirildi.' });
  })
);

module.exports = router;
