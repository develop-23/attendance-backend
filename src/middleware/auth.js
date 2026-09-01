// JWT tokenni tekshirish. Tizimda ikki xil "aktyor" bor:
//   type = 'admin'    -> User jadvalidagi administrator
//   type = 'employee' -> Employee jadvalidagi xodim (o'z vaqtini kiritadi)
const jwt = require('jsonwebtoken');
const prisma = require('../prisma');
const { AppError, asyncHandler } = require('./error');

/** Token majburiy — req.actor ga joriy aktyorni yozadi */
const authRequired = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    throw new AppError(401, 'Awtorizasiýa talap edilýär. Ulgama giriň.');
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (e) {
    const message =
      e.name === 'TokenExpiredError'
        ? 'Sessiýanyň möhleti tamamlandy. Täzeden giriň.'
        : 'Nädogry ýa-da zaýalanan token.';
    throw new AppError(401, message);
  }

  const { sub, type } = payload;

  if (type === 'admin') {
    const user = await prisma.user.findUnique({
      where: { id: sub },
      select: { id: true, login: true, fullName: true, isActive: true },
    });
    if (!user || !user.isActive) {
      throw new AppError(401, 'Ulanyjy tapylmady ýa-da işjeň däl.');
    }
    req.actor = { type: 'admin', id: user.id, login: user.login, fullName: user.fullName };
  } else if (type === 'employee') {
    const emp = await prisma.employee.findUnique({
      where: { id: sub },
      select: { id: true, login: true, fullName: true, position: true, isActive: true },
    });
    if (!emp || !emp.isActive) {
      throw new AppError(401, 'Işgär tapylmady ýa-da işjeň däl.');
    }
    req.actor = {
      type: 'employee',
      id: emp.id,
      login: emp.login,
      fullName: emp.fullName,
      position: emp.position,
    };
  } else {
    throw new AppError(401, 'Nädogry token görnüşi.');
  }

  next();
});

/** Faqat administrator uchun */
function adminOnly(req, res, next) {
  if (!req.actor) return next(new AppError(401, 'Awtorizasiýa talap edilýär.'));
  if (req.actor.type !== 'admin') {
    return next(new AppError(403, 'Bu amaly ýerine ýetirmäge hukugyňyz ýok.'));
  }
  next();
}

/** Audit yozuvi uchun aktyor maydonlari */
function actorFields(actor) {
  return actor.type === 'admin'
    ? { userId: actor.id, employeeId: null }
    : { userId: null, employeeId: actor.id };
}

module.exports = { authRequired, adminOnly, actorFields };
