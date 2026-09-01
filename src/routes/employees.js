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
      select: publicFields,
      orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
    });

    res.json({ employees });
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

// DELETE /api/employees/:id  (faqat admin, soft delete)
router.delete(
  '/:id',
  adminOnly,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new AppError(400, 'Nädogry işgär ID-si.');

    const old = await prisma.employee.findUnique({ where: { id }, select: publicFields });
    if (!old) throw new AppError(404, 'Işgär tapylmady.');
    if (!old.isActive) throw new AppError(400, 'Bu işgär eýýäm işjeň däl.');

    // Soft delete — davomat tarixi saqlanib qoladi, lekin xodim kirolmaydi
    const employee = await prisma.employee.update({
      where: { id },
      data: { isActive: false },
      select: publicFields,
    });

    await writeAudit({
      actor: req.actor,
      action: 'soft-delete',
      entity: 'Employee',
      entityId: id,
      oldValue: old,
      newValue: employee,
    });

    res.json({ employee, message: 'Işgär arhiwe geçirildi.' });
  })
);

module.exports = router;
