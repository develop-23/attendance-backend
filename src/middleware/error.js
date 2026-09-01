// Xatolarni markazlashgan holda qayta ishlash.
// Foydalanuvchiga ko'rsatiladigan matnlar turkman tilida.

/** Boshqariladigan (kutilgan) xato */
class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** async route handler larni try/catch bilan o'rash uchun yordamchi */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/** Topilmagan yo'llar uchun */
function notFound(req, res) {
  res.status(404).json({ error: { message: 'Salgylanma tapylmady' } });
}

/** Umumiy xato ishlovchisi */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Bizning boshqariladigan xatolarimiz
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: { message: err.message, details: err.details },
    });
  }

  // Prisma: unique constraint buzilishi
  if (err.code === 'P2002') {
    return res.status(409).json({
      error: { message: 'Beýle ýazgy eýýäm bar (gaýtalanýan maglumat).' },
    });
  }

  // Prisma: yozuv topilmadi
  if (err.code === 'P2025') {
    return res.status(404).json({ error: { message: 'Ýazgy tapylmady.' } });
  }

  // JSON parse xatosi
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { message: 'Nädogry JSON maglumat iberildi.' } });
  }

  console.error('[SERVER ERROR]', err);
  return res.status(500).json({
    error: { message: 'Serwerde näbelli ýalňyşlyk ýüze çykdy.' },
  });
}

module.exports = { AppError, asyncHandler, notFound, errorHandler };
