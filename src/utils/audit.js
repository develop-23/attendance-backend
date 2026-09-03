// Write changes to the AuditLog table
const prisma = require('../prisma');
const { actorFields } = require('../middleware/auth');

/**
 * @param {object} p
 * @param {{type:'admin'|'employee', id:number}} p.actor - the actor that performed the action
 * @param {string} p.action    - create | update | delete | login | change-password
 * @param {string} p.entity    - Employee | Attendance | User | Settings
 * @param {string|number|null} p.entityId
 * @param {object|null} p.oldValue
 * @param {object|null} p.newValue
 */
async function writeAudit({ actor, action, entity, entityId, oldValue, newValue }) {
  try {
    await prisma.auditLog.create({
      data: {
        ...actorFields(actor),
        action,
        entity,
        entityId: entityId != null ? String(entityId) : null,
        oldValue: oldValue ? JSON.stringify(oldValue) : null,
        newValue: newValue ? JSON.stringify(newValue) : null,
      },
    });
  } catch (e) {
    // An audit record must never break the main operation
    console.error('[AUDIT ERROR]', e.message);
  }
}

module.exports = { writeAudit };
