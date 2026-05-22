// Currency symbol map shared across server-side exports (receipts, ledger
// PDFs, salary slips). The web/mobile clients keep their own copy in their
// shared formatter — keep in sync.
const SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', CHF: 'Fr',
  CAD: 'CA$', AUD: 'A$', NZD: 'NZ$',
  // Middle East
  IQD: 'ع.د', SAR: 'ر.س', AED: 'د.إ', KWD: 'د.ك', QAR: 'ر.ق',
  BHD: 'د.ب', OMR: 'ر.ع', JOD: 'د.ا', LBP: 'ل.ل', EGP: 'ج.م',
  TRY: '₺', ILS: '₪',
  // South Asia
  INR: '₹', PKR: '₨', BDT: '৳', LKR: 'Rs',
  // Other common
  CNY: '¥', KRW: '₩', RUB: '₽', BRL: 'R$', ZAR: 'R',
};

// Currencies without a sub-unit (whole-number only) — used to drop the .00
// suffix on JPY etc. by default.
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'IQD', 'VND']);

export function fmtMoney(amount: number, currency: string): string {
  const sym = SYMBOLS[currency];
  const fractionDigits = ZERO_DECIMAL.has(currency) ? 0 : 2;
  const v = Number(amount) || 0;
  // Format the magnitude, then put the minus sign in FRONT of the symbol
  // (-$2,850.00, not $-2,850.00).
  const n = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
  const body = sym ? `${sym}${n}` : `${currency} ${n}`;
  return v < 0 ? `-${body}` : body;
}

export function getCurrencySymbol(currency: string): string {
  return SYMBOLS[currency] ?? currency;
}
