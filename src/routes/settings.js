// /api/settings — working hours and weekend day settings
const express = require('express');
const prisma = require('../prisma');
const { asyncHandler, AppError } = require('../middleware/error');
const { authRequired, adminOnly } = require('../middleware/auth');
const { schemas, validate } = require('../utils/validate');
const { writeAudit } = require('../utils/audit');
const { getSettings, timeToMinutes } = require('../utils/report');

const router = express.Router();
router.use(authRequired);

// GET /api/settings — both admins and employees can read it (so they know the lateness threshold)
router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ settings: await getSettings() });
  })
);

// PUT /api/settings — admin only
router.put(
  '/',
  adminOnly,
  asyncHandler(async (req, res) => {
    const data = validate(schemas.settingsUpdate, req.body);
    const old = await getSettings();

    const merged = { ...old, ...data };
    if (timeToMinutes(merged.workEnd) <= timeToMinutes(merged.workStart)) {
      throw new AppError(400, 'Iş tamamlanýan wagt başlanýan wagtdan giç bolmaly.');
    }

    const updateData = {};
    if (data.workStart !== undefined) updateData.workStart = data.workStart;
    if (data.workEnd !== undefined) updateData.workEnd = data.workEnd;
    if (data.lateThresholdMin !== undefined) updateData.lateThresholdMin = data.lateThresholdMin;
    if (data.weekendDays !== undefined) {
      updateData.weekendDays = [...new Set(data.weekendDays)].sort((a, b) => a - b).join(',');
    }

    await prisma.settings.upsert({
      where: { id: 1 },
      update: updateData,
      create: { id: 1, ...updateData },
    });

    const settings = await getSettings();

    await writeAudit({
      actor: req.actor,
      action: 'update',
      entity: 'Settings',
      entityId: 1,
      oldValue: old,
      newValue: settings,
    });

    res.json({ settings, message: 'Sazlamalar ýatda saklandy.' });
  })
);

module.exports = router;
