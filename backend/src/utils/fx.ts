// Shared FX helpers for cash that moves through a payment account (drawer) in a
// currency different from how the salary/fee/expense is denominated. The amount
// recorded against the salary/fee/expense stays in its own currency; the cash
// that actually enters/leaves the drawer is converted to the drawer's currency
// at the configured fx_rate. Used by staff salary, fee payments + refunds, and
// expenses so the drawer balance and GL always move the real cash amount.

import { adminDb as supabase } from './db';

// Most recent configured rate (effective_from ≤ asOf) for from→to. Returns 1
// when the currencies match, or null when no rate is configured.
export async function getFxRate(schoolId: string, from: string, to: string, asOf: string): Promise<number | null> {
  if (from === to) return 1;
  const { data } = await supabase
    .from('fx_rates')
    .select('rate')
    .eq('school_id', schoolId)
    .eq('from_currency', from)
    .eq('to_currency', to)
    .lte('effective_from', asOf)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? Number((data as { rate: number }).rate) : null;
}

export type DrawerAmount =
  | { ok: true; paidAmount: number; paidCurrency: string; exchangeRate: number }
  | { ok: false; error: string };

// Convert `amount` (denominated in `currency`) into the currency of the chosen
// payment account. When the account currency matches (or no account is given),
// returns the amount unchanged at rate 1. When it differs and no rate exists,
// returns ok:false with a message for the caller to surface as a 400.
export async function resolveDrawerAmount(
  schoolId: string,
  opts: { amount: number; currency: string; paymentAccountId?: string | null; asOf: string },
): Promise<DrawerAmount> {
  const { amount, paymentAccountId, asOf } = opts;
  const currency = opts.currency.toUpperCase();
  if (!paymentAccountId) return { ok: true, paidAmount: amount, paidCurrency: currency, exchangeRate: 1 };

  const { data: acct } = await supabase
    .from('payment_accounts').select('currency').eq('id', paymentAccountId).eq('school_id', schoolId).maybeSingle();
  const drawer = acct ? String((acct as { currency: string }).currency).toUpperCase() : null;
  if (!drawer || drawer === currency) return { ok: true, paidAmount: amount, paidCurrency: currency, exchangeRate: 1 };

  const rate = await getFxRate(schoolId, currency, drawer, asOf);
  if (rate === null) {
    return { ok: false, error: `No exchange rate from ${currency} to ${drawer}. Set one on the FX Rates page (effective on or before ${asOf}), or use a ${currency} drawer.` };
  }
  return { ok: true, paidAmount: Math.round(amount * rate * 100) / 100, paidCurrency: drawer, exchangeRate: rate };
}
