// /api/auth — kirish, joriy aktyor, parolni o'zgartirish
// Admin ham, xodim ham bitta endpoint orqali kiradi.
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../prisma');
const { asyncHandler, AppError } = require('../middleware/error');
const { authRequired } = require('../middleware/auth');
const { schemas, validate } = require('../utils/validate');
const { writeAudit } = require('../utils/audit');

const router = express.Router();

/** Token yaratish */
function signToken({ id, login, type }) {
  return jwt.sign({ sub: id, login, type }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  });
}

// POST /api/auth/login
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { login, password } = validate(schemas.login, req.body);

    // Avval administratorlar, so'ng xodimlar orasidan qidiramiz
    const user = await prisma.user.findUnique({ where: { login } });
    const employee = user ? null : await prisma.employee.findUnique({ where: { login } });
    const account = user || employee;
    const type = user ? 'admin' : 'employee';

    // Xavfsizlik: login yoki parol xato ekanini ajratib ko'rsatmaymiz
    if (!account || !(await bcrypt.compare(password, account.passwordHash))) {
      throw new AppError(401, 'Ulanyjy ady ýa-da açar sözi nädogry.');
    }
    if (!account.isActive) {
      throw new AppError(403, 'Bu hasap togtadyldy. Administrator bilen habarlaşyň.');
    }

    const actor = { type, id: account.id };
    const token = signToken({ id: account.id, login: account.login, type });

    await writeAudit({
      actor,
      action: 'login',
      entity: type === 'admin' ? 'User' : 'Employee',
      entityId: account.id,
    });

    res.json({
      token,
      user: {
        type,
        id: account.id,
        login: account.login,
        fullName: account.fullName,
        position: account.position ?? null,
      },
    });
  })
);

// GET /api/auth/me
router.get(
  '/me',
  authRequired,
  asyncHandler(async (req, res) => {
    res.json({ user: req.actor });
  })
);

// POST /api/auth/change-password — admin ham, xodim ham o'z parolini almashtiradi
router.post(
  '/change-password',
  authRequired,
  asyncHandler(async (req, res) => {
    const { oldPassword, newPassword } = validate(schemas.changePassword, req.body);
    const { type, id } = req.actor;

    const model = type === 'admin' ? prisma.user : prisma.employee;
    const account = await model.findUnique({ where: { id } });

    if (!(await bcrypt.compare(oldPassword, account.passwordHash))) {
      throw new AppError(400, 'Häzirki açar sözi nädogry.');
    }
    if (oldPassword === newPassword) {
      throw new AppError(400, 'Täze açar sözi öňküsinden tapawutly bolmaly.');
    }

    await model.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10) },
    });

    await writeAudit({
      actor: req.actor,
      action: 'change-password',
      entity: type === 'admin' ? 'User' : 'Employee',
      entityId: id,
    });

    res.json({ message: 'Açar sözi üstünlikli üýtgedildi.' });
  })
);

module.exports = router;
