// Single source of truth for currency formatting across the web app.
// Replaces the inline `fmt()` copies that previously only handled USD/EUR/GBP.

const SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', CHF: 'Fr',
  CAD: 'CA$', AUD: 'A$', NZD: 'NZ$',
  IQD: 'ع.د', SAR: 'ر.س', AED: 'د.إ', KWD: 'د.ك', QAR: 'ر.ق',
  BHD: 'د.ب', OMR: 'ر.ع', JOD: 'د.ا', LBP: 'ل.ل', EGP: 'ج.م',
  TRY: '₺', ILS: '₪',
  INR: '₹', PKR: '₨', BDT: '৳', LKR: 'Rs',
  CNY: '¥', KRW: '₩', RUB: '₽', BRL: 'R$', ZAR: 'R',
};

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'IQD', 'VND']);

export function fmtMoney(amount: number, currency: string): string {
  const sym = SYMBOLS[currency];
  const digits = ZERO_DECIMAL.has(currency) ? 0 : 2;
  const v = Number(amount) || 0;
  // Minus sign goes in front of the symbol (-$2,850.00, not $-2,850.00).
  const n = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const body = sym ? `${sym}${n}` : `${currency} ${n}`;
  return v < 0 ? `-${body}` : body;
}

export function getCurrencySymbol(currency: string): string {
  return SYMBOLS[currency] ?? currency;
}

// All currencies we know how to symbolize — used to populate dropdowns
// without exposing an unbounded text field that mis-spells codes.
export const KNOWN_CURRENCIES: string[] = Object.keys(SYMBOLS).sort();
