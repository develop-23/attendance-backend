// Hisoblar bilan bog'liq umumiy yordamchilar.
// Admin (User) va xodim (Employee) bitta login maydonini bo'lishadi —
// ikkalasi ham bitta /api/auth/login orqali kiradi, shuning uchun login
// IKKALA jadval bo'ylab takrorlanmasligi kerak.
const prisma = require('../prisma');
const { AppError } = require('../middleware/error');

/**
 * Login bandmi yoki yo'qligini tekshiradi.
 * @param {string} login
 * @param {{type: 'admin'|'employee', id: number}} [except] - tahrirlanayotgan hisob
 */
async function assertLoginAvailable(login, except) {
  const [user, employee] = await Promise.all([
    prisma.user.findUnique({ where: { login }, select: { id: true } }),
    prisma.employee.findUnique({ where: { login }, select: { id: true } }),
  ]);

  const takenByUser = user && !(except?.type === 'admin' && except.id === user.id);
  const takenByEmployee =
    employee && !(except?.type === 'employee' && except.id === employee.id);

  if (takenByUser || takenByEmployee) {
    throw new AppError(409, 'Bu ulanyjy ady eýýäm ulanylýar.');
  }
}

module.exports = { assertLoginAvailable };
