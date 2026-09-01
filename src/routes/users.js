// /api/users — administratorlar boshqaruvi (faqat admin).
// Tizimda faqat bitta turdagi "user" bor — administrator.
// Xodimlar alohida /api/employees orqali boshqariladi.
const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../prisma');
const { asyncHandler, AppError } = require('../middleware/error');
const { authRequired, adminOnly } = require('../middleware/auth');
const { schemas, validate } = require('../utils/validate');
const { writeAudit } = require('../utils/audit');
const { assertLoginAvailable } = require('../utils/accounts');

const router = express.Router();
router.use(authRequired, adminOnly);

const publicFields = {
  id: true,
  login: true,
  fullName: true,
  isActive: true,
  createdAt: true,
};

// GET /api/users
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({
      select: publicFields,
      orderBy: [{ isActive: 'desc' }, { login: 'asc' }],
    });
    res.json({ users });
  })
);

// POST /api/users
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = validate(schemas.userCreate, req.body);
    await assertLoginAvailable(data.login);

    const user = await prisma.user.create({
      data: {
        login: data.login,
        passwordHash: await bcrypt.hash(data.password, 10),
        fullName: data.fullName,
      },
      select: publicFields,
    });

    await writeAudit({
      actor: req.actor,
      action: 'create',
      entity: 'User',
      entityId: user.id,
      newValue: user,
    });

    res.status(201).json({ user });
  })
);

// PUT /api/users/:id
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new AppError(400, 'Nädogry ulanyjy ID-si.');

    const data = validate(schemas.userUpdate, req.body);
    const old = await prisma.user.findUnique({ where: { id }, select: publicFields });
    if (!old) throw new AppError(404, 'Ulanyjy tapylmady.');

    // Admin o'z hisobini to'xtatib qo'ymasligi kerak
    if (id === req.actor.id && data.isActive === false) {
      throw new AppError(400, 'Öz hasabyňyzy togtadyp bilmeýärsiňiz.');
    }

    // Tizimda kamida bitta faol administrator qolishi shart
    if (data.isActive === false && old.isActive) {
      const activeAdmins = await prisma.user.count({ where: { isActive: true } });
      if (activeAdmins <= 1) {
        throw new AppError(400, 'Ulgamda azyndan bir işjeň administrator galmaly.');
      }
    }

    const updateData = {};
    if (data.fullName !== undefined) updateData.fullName = data.fullName;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.password) updateData.passwordHash = await bcrypt.hash(data.password, 10);

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: publicFields,
    });

    await writeAudit({
      actor: req.actor,
      action: 'update',
      entity: 'User',
      entityId: id,
      oldValue: old,
      newValue: { ...user, passwordChanged: Boolean(data.password) },
    });

    res.json({ user });
  })
);

module.exports = router;
