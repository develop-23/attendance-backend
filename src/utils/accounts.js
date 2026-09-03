// Shared helpers for accounts.
// An admin (User) and an employee (Employee) share the same login namespace —
// both sign in through the same /api/auth/login, so a login must be unique
// across BOTH tables.
const prisma = require('../prisma');
const { AppError } = require('../middleware/error');

/**
 * Checks whether the login is already taken.
 * @param {string} login
 * @param {{type: 'admin'|'employee', id: number}} [except] - the account being edited
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
