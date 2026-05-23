import { z } from 'zod';
import { nonEmptyStr, uuid, amount, positiveAmount, isoDate, currency, hrFields } from './common';

// Money / accounting write schemas (Phase 1b).
//
// Philosophy: these guard TYPE, SHAPE, BOUNDS, and strip unknown keys
// (mass-assignment defense on the highest-damage endpoints in the system).
// They deliberately stay lenient where a controller already does deeper
// SEMANTIC validation it must keep owning — installment-sum checks,
// period-close guards, currency-source-of-truth, insurance math, etc.
// The schema rejecting obvious garbage early does not remove those.

// id/uuid-ish optional field that also tolerates '' and null, because the
// controllers normalize those to null themselves (`categoryId || null`).
const optionalId = z.union([uuid, z.literal('')]).nullable().optional();
// Required account reference — money in/out must name the cash/bank account it
// touches, so GL cash never falls back to a phantom default.
const requiredId = uuid;
const optText = (max = 2000) => z.string().max(max).nullable().optional();
const idParam = z.object({ id: uuid });

// ── Fee plans ───────────────────────────────────────────────────────────
const planKind = z.enum(['tuition', 'transport', 'lunch', 'uniform', 'exam', 'registration', 'other']);
const installment = z.object({
  sequence: z.number().int().nonnegative(),
  amount: amount,
  dueDate: isoDate,
});
const planBase = {
  name: nonEmptyStr(200),
  totalAmount: amount,
  currency: currency.optional(),
  appliesTo: z.enum(['all', 'classes', 'manual']),
  classIds: z.array(uuid).optional(),
  academicYear: z.string().trim().max(20).optional(),
  installments: z.array(installment).max(60).optional(),
  isActive: z.boolean().optional(),
  kind: planKind.optional(),
  lateFeeEnabled: z.boolean().optional(),
  lateFeeType: z.enum(['fixed', 'percent']).nullable().optional(),
  lateFeeAmount: amount.optional(),
  lateFeeGraceDays: z.number().int().nonnegative().max(365).optional(),
};
export const createPlanSchema = z.object(planBase);
// Update: same shape, every field optional (controller re-validates).
export const updatePlanSchema = z.object(planBase).partial();

export const assignPlanSchema = z.object({ studentIds: z.array(uuid).optional() });

// ── Payments ────────────────────────────────────────────────────────────
const allocation = z.object({ installmentId: uuid, amount: positiveAmount });
export const recordPaymentSchema = z.object({
  amount: positiveAmount,
  paidOn: isoDate,
  method: optText(120),
  reference: optText(200),
  notes: optText(),
  unallocatedNote: optText(),
  currency: currency.optional(),
  taxAmount: amount.optional(),
  taxLabel: optText(120),
  paymentAccountId: requiredId,
  allocations: z.array(allocation).max(200).nullable().optional(),
});
export const refundPaymentSchema = z.object({
  amount: positiveAmount,
  refundedOn: isoDate.optional(),
  method: optText(120),
  reference: optText(200),
  notes: optText(),
  paymentAccountId: requiredId,
});
export const reasonBody = z.object({ reason: z.string().max(1000).optional() });

export const updateStudentFeeSchema = z.object({
  adjustment: z.number().finite().optional(),
  notes: optText(),
  totalAmount: amount.optional(),
});

export const setLockParams = z.object({ studentId: uuid });
export const setLockSchema = z.object({
  feature: nonEmptyStr(80),
  reason: z.string().max(1000).optional(),
});
export const removeLockParams = z.object({ studentId: uuid, feature: z.string().min(1).max(80) });

// tuition_config is free-form JSON merged by the controller — validate the
// known keys but DON'T strip the rest (passthrough), so config can't be
// silently truncated.
export const updateConfigSchema = z.object({
  currency: currency.optional(),
  siblingDiscount: z.any().optional(),
}).passthrough();

export const notifyDueSchema = z.object({
  title: z.string().max(200).optional(),
  message: z.string().max(4000).optional(),
  statusFilter: z.array(z.enum(['paid_up', 'current', 'due_soon', 'overdue'])).optional(),
});

// ── Expenses ────────────────────────────────────────────────────────────
const expenseBase = {
  name: nonEmptyStr(200),
  amount: amount,
  currency: currency.optional(),
  expenseDate: isoDate,
  categoryId: optionalId,
  vendor: optText(200),
  paymentMethod: optText(120),
  notes: optText(),
  taxAmount: amount.optional(),
  taxLabel: optText(120),
  paymentAccountId: requiredId,
};
export const createExpenseSchema = z.object(expenseBase);
export const updateExpenseSchema = z.object(expenseBase).partial();

export const createCategorySchema = z.object({ name: nonEmptyStr(120) });
export const updateCategorySchema = z.object({
  name: nonEmptyStr(120).optional(),
  isActive: z.boolean().optional(),
});

const cadence = z.enum(['monthly', 'quarterly', 'yearly']);
const templateBase = {
  name: nonEmptyStr(200),
  amount: amount,
  currency: currency.optional(),
  cadence,
  nextDueDate: isoDate.optional(),
  categoryId: optionalId,
  vendor: optText(200),
  notes: optText(),
};
export const createTemplateSchema = z.object(templateBase);
export const updateTemplateSchema = z.object({ ...templateBase, isActive: z.boolean() }).partial();
export const recordTemplateSchema = z.object({
  expenseDate: isoDate.optional(),
  amount: amount.optional(),
  notes: optText(),
  paymentMethod: optText(120),
  taxAmount: amount.optional(),
  taxLabel: optText(120),
  paymentAccountId: requiredId,
});

// ── Staff ───────────────────────────────────────────────────────────────
const staffBase = {
  userId: optionalId,
  fullName: nonEmptyStr(200),
  position: optText(120),
  salaryAmount: amount.optional(),
  currency: currency.optional(),
  nextPaymentDate: isoDate.nullable().optional(),
  isActive: z.boolean().optional(),
  insurancePercentage: z.number().min(0).max(100).nullable().optional(),
  previousArchiveId: optionalId,
  emergencyContact: optText(120),
  ...hrFields,
};
export const createStaffSchema = z.object(staffBase);
export const updateStaffSchema = z.object(staffBase).partial();

export const recordStaffPaymentSchema = z.object({
  amount: positiveAmount,
  currency: currency.optional(),
  paidOn: isoDate,
  periodLabel: optText(120),
  notes: optText(),
  insuranceAmount: amount.nullable().optional(),
  insurancePercentage: z.number().min(0).max(100).nullable().optional(),
  taxAmount: amount.optional(),
  taxLabel: optText(120),
  paymentAccountId: requiredId,
});

export const insurancePayoutSchema = z.object({
  paidOn: isoDate.optional(),
  amount: amount.optional(),
  currency: currency.optional(),
  notes: optText(),
});

export const bulkNextPaymentSchema = z.object({
  nextPaymentDate: isoDate.nullable().optional(),
  staffIds: z.array(uuid).optional(),
});
export const notifyAllStaffDueSchema = z.object({
  title: z.string().max(200).optional(),
  message: z.string().max(4000).optional(),
  dueWithinDays: z.number().int().min(0).max(366).optional(),
});

// ── Accounting periods / accounts / fx ─────────────────────────────────
export const closePeriodSchema = z.object({
  periodStart: isoDate,
  periodEnd: isoDate,
  notes: z.string().max(2000).optional(),
});
export const reopenPeriodSchema = z.object({ reason: nonEmptyStr(1000) });

const accountKind = z.enum(['cash', 'bank', 'wallet', 'other']);
export const createPaymentAccountSchema = z.object({
  name: nonEmptyStr(120),
  kind: accountKind,
  currency: currency.optional(),
  openingBalance: z.number().finite().optional(),
  notes: optText(),
});
export const updatePaymentAccountSchema = z.object({
  name: nonEmptyStr(120).optional(),
  kind: accountKind.optional(),
  currency: currency.optional(),
  openingBalance: z.number().finite().optional(),
  notes: optText(),
}).partial();

export const setFxRateSchema = z.object({
  fromCurrency: currency,
  toCurrency: currency,
  rate: z.number().finite().positive(),
  effectiveFrom: isoDate.optional(),
});

// ── Reports ─────────────────────────────────────────────────────────────
export const rollupCurrenciesSchema = z.object({
  amounts: z.array(z.object({ amount: z.number().finite(), currency })).max(1000),
  toCurrency: currency.optional(),
  asOf: isoDate.optional(),
});

// ── General Ledger (Phase 4) ─────────────────────────────────────────────
const glAccountType = z.enum(['asset', 'liability', 'equity', 'income', 'expense']);
export const createGlAccountSchema = z.object({
  code: nonEmptyStr(20),
  name: nonEmptyStr(120),
  type: glAccountType,
  subtype: optText(40),
});
export const updateGlAccountSchema = z.object({
  name: nonEmptyStr(120).optional(),
  subtype: optText(40),
  isActive: z.boolean().optional(),
}).partial();

// Manual journal entry: shape/bounds only; the controller owns the deeper
// semantic checks (debit XOR credit per line, debits = credits, accounts
// belong to the school + active, period open).
export const manualJournalSchema = z.object({
  entryDate: isoDate,
  currency,
  memo: optText(500),
  source: z.enum(['manual', 'opening']).optional(),
  lines: z.array(z.object({
    accountId: uuid,
    debit: z.number().finite().min(0).optional(),
    credit: z.number().finite().min(0).optional(),
    description: optText(200),
  })).min(2).max(200),
});

// Opening balances: one normal-direction amount per account; the backend
// plugs the difference into Opening Balance Equity to balance.
export const openingBalancesSchema = z.object({
  asOf: isoDate.optional(),
  currency,
  memo: optText(500),
  balances: z.array(z.object({
    accountId: uuid,
    amount: z.number().finite(),
  })).min(1).max(500),
});

export { idParam };
