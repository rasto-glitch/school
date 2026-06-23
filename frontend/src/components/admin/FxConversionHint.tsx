// Small inline hint for cross-currency cash: when the amount's currency differs
// from the chosen drawer's currency, show the converted figure at the configured
// fx rate — or warn if no rate is set. Used on the salary / fee / expense forms.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { accountingApi, type PaymentAccount, type FxRate } from '../../services/api';

export default function FxConversionHint({ amount, currency, paymentAccountId, accounts, date }: {
  amount: number;
  currency: string;
  paymentAccountId: string;
  accounts: PaymentAccount[];
  date: string;
}) {
  const { t } = useTranslation();
  const [fxRates, setFxRates] = useState<FxRate[]>([]);
  useEffect(() => { accountingApi.listFxRates().then(r => setFxRates(r.data)).catch(() => {}); }, []);

  const acct = accounts.find(a => a.id === paymentAccountId);
  const drawerCcy = (acct?.currency || '').toUpperCase();
  const payCcy = (currency || '').toUpperCase();
  if (!drawerCcy || !payCcy || drawerCcy === payCcy) return null;

  const rate = fxRates
    .filter(r => r.fromCurrency.toUpperCase() === payCcy && r.toCurrency.toUpperCase() === drawerCcy && r.effectiveFrom <= date)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]?.rate;

  if (!rate) {
    return (
      <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-2">
        {t('accounting.fx_hint.missing', { from: payCcy, to: drawerCcy, defaultValue: 'No exchange rate from {{from}} to {{to}}. Set one on the FX Rates page, or use a {{from}} drawer.' })}
      </p>
    );
  }
  const conv = Math.round((Number(amount) || 0) * rate * 100) / 100;
  const convStr = `${conv.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${drawerCcy}`;
  return (
    <p className="text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded-lg p-2 mt-2">
      {t('accounting.fx_hint.preview', { amount: convStr, rate, defaultValue: '≈ {{amount}} will move through this drawer (rate {{rate}}).' })}
    </p>
  );
}
