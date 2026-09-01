// Kirish ma'lumotlarini tekshirish (zod) — xato matnlari turkman tilida
const { z } = require('zod');
const { AppError } = require('../middleware/error');

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/; // HH:MM
const dateRegex = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/; // YYYY-MM-DD

// Majburiy maydon yuborilmasa ham xato matni turkman tilida bo'lishi uchun
// har bir maydonga `required_error` beriladi (aks holda zod inglizcha "Required" qaytaradi).
const req = (message) => ({ required_error: message, invalid_type_error: message });

const timeField = z
  .string(req('Wagt giriziň (mysal: 09:30)'))
  .regex(timeRegex, 'Wagt "SS:MM" görnüşinde bolmaly (mysal: 09:30)');

const dateField = z
  .string(req('Sene giriziň'))
  .regex(dateRegex, 'Sene "ÝÝÝÝ-AA-GG" görnüşinde bolmaly (mysal: 2026-09-01)');

// Bo'sh matnni null ga aylantiruvchi yordamchi.
// MUHIM: undefined (maydon umuman yuborilmagan) null ga AYLANTIRILMAYDI —
// aks holda qisman tahrirlashda (PATCH-uslub) yuborilmagan maydonlar
// o'chib ketardi. undefined = "tegmang", null/'' = "tozalang".
const emptyToNull = (v) => (v === '' ? null : v);

const loginField = z
  .string(req('Ulanyjy adyny giriziň'))
  .trim()
  .min(3, 'Ulanyjy ady azyndan 3 belgiden ybarat bolmaly')
  .max(50)
  .regex(/^[a-zA-Z0-9._-]+$/, 'Ulanyjy adynda diňe harplar, sanlar we . _ - belgileri bolup biler');

const passwordField = z
  .string(req('Açar sözi giriziň'))
  .min(6, 'Açar sözi azyndan 6 belgiden ybarat bolmaly');

const fullNameField = z
  .string(req('Doly adyny giriziň'))
  .trim()
  .min(2, 'Doly ady azyndan 2 harpdan ybarat bolmaly')
  .max(120);

const schemas = {
  login: z.object({
    login: z.string(req('Ulanyjy adyny giriziň')).trim().min(1, 'Ulanyjy adyny giriziň'),
    password: z.string(req('Açar sözi giriziň')).min(1, 'Açar sözi giriziň'),
  }),

  changePassword: z.object({
    oldPassword: z.string(req('Häzirki açar sözi giriziň')).min(1, 'Häzirki açar sözi giriziň'),
    newPassword: passwordField,
  }),

  // ── Xodimlar ──────────────────────────────────────────────────────
  employeeCreate: z.object({
    login: loginField,
    password: passwordField,
    fullName: fullNameField,
    position: z.preprocess(emptyToNull, z.string().trim().max(120).nullable().optional()),
    isActive: z.boolean().optional(),
  }),

  employeeUpdate: z.object({
    fullName: fullNameField.optional(),
    position: z.preprocess(emptyToNull, z.string().trim().max(120).nullable().optional()),
    isActive: z.boolean().optional(),
    password: z.preprocess(emptyToNull, passwordField.nullable().optional()),
  }),

  // ── Davomat seansi ────────────────────────────────────────────────
  // Bir kunda bir nechta seans bo'lishi mumkin, shuning uchun har biri
  // alohida yozuv sifatida yaratiladi/tahrirlanadi.
  attendanceCreate: z.object({
    employeeId: z.coerce.number().int().positive('Işgär saýlanmady').optional(),
    date: dateField,
    checkIn: timeField,
    checkOut: z.preprocess(emptyToNull, timeField.nullable().optional()),
    note: z.preprocess(emptyToNull, z.string().trim().max(300).nullable().optional()),
  }),

  attendanceUpdate: z.object({
    checkIn: timeField.optional(),
    checkOut: z.preprocess(emptyToNull, timeField.nullable().optional()),
    note: z.preprocess(emptyToNull, z.string().trim().max(300).nullable().optional()),
  }),

  // ── Administratorlar ──────────────────────────────────────────────
  userCreate: z.object({
    login: loginField,
    password: passwordField,
    fullName: fullNameField,
  }),

  userUpdate: z.object({
    fullName: fullNameField.optional(),
    isActive: z.boolean().optional(),
    password: z.preprocess(emptyToNull, passwordField.nullable().optional()),
  }),

  // ── Sozlamalar ────────────────────────────────────────────────────
  settingsUpdate: z.object({
    workStart: timeField.optional(),
    workEnd: timeField.optional(),
    lateThresholdMin: z.coerce
      .number()
      .int()
      .min(0, 'Gijä galma çägi 0-dan kiçi bolup bilmez')
      .max(240, 'Gijä galma çägi 240 minutdan uly bolup bilmez')
      .optional(),
    weekendDays: z.array(z.coerce.number().int().min(1).max(7)).max(7).optional(),
  }),

  yearMonth: z.object({
    year: z.coerce.number(req('Ýyl görkeziliň')).int().min(2000, 'Ýyl nädogry').max(2100, 'Ýyl nädogry'),
    month: z.coerce
      .number(req('Aý görkeziliň'))
      .int()
      .min(1, 'Aý 1-12 aralygynda bolmaly')
      .max(12, 'Aý 1-12 aralygynda bolmaly'),
  }),
};

/** Ma'lumotni tekshiradi, xato bo'lsa 400 bilan AppError otadi */
function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    throw new AppError(400, details[0]?.message || 'Girizilen maglumatlar nädogry.', details);
  }
  return result.data;
}

module.exports = { schemas, validate, timeRegex, dateRegex };
