// Centralised error handling.
// The texts shown to the user are in Turkmen.

/** A handled (expected) error */
class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Helper for wrapping async route handlers in try/catch */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/** For routes that were not found */
function notFound(req, res) {
  res.status(404).json({ error: { message: 'Salgylanma tapylmady' } });
}

/** Generic error handler */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Our own handled errors
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: { message: err.message, details: err.details },
    });
  }

  // Prisma: unique constraint violation
  if (err.code === 'P2002') {
    return res.status(409).json({
      error: { message: 'Beýle ýazgy eýýäm bar (gaýtalanýan maglumat).' },
    });
  }

  // Prisma: record not found
  if (err.code === 'P2025') {
    return res.status(404).json({ error: { message: 'Ýazgy tapylmady.' } });
  }

  // JSON parse error
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { message: 'Nädogry JSON maglumat iberildi.' } });
  }

  console.error('[SERVER ERROR]', err);
  return res.status(500).json({
    error: { message: 'Serwerde näbelli ýalňyşlyk ýüze çykdy.' },
  });
}

module.exports = { AppError, asyncHandler, notFound, errorHandler };
