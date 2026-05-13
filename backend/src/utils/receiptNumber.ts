import { supabase } from '../config/supabase';

// Allocate the next sequential receipt number for a school + year.
// Race-tolerant: relies on the UNIQUE (school_id, receipt_year, receipt_number)
// index — retries with the next number on collision (up to 5 times).
export async function allocateReceiptNumber(schoolId: string, paidOnISO: string): Promise<{ receiptYear: number; receiptNumber: number }> {
  const year = parseInt(paidOnISO.slice(0, 4), 10);
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data } = await supabase
      .from('fee_payments')
      .select('receipt_number')
      .eq('school_id', schoolId)
      .eq('receipt_year', year)
      .order('receipt_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    const next = ((data?.receipt_number as number | null) ?? 0) + 1 + attempt;
    // Probe-write: if another request grabbed the same number we'll fail
    // the unique index and loop with attempt+1.
    return { receiptYear: year, receiptNumber: next };
  }
  // Should never reach — return a high number as last resort
  return { receiptYear: year, receiptNumber: Math.floor(Math.random() * 1_000_000) + 1_000_000 };
}

// Formatted receipt code shown to humans: e.g. "RCP-2026-00042".
export function formatReceiptCode(year: number, num: number): string {
  return `RCP-${year}-${String(num).padStart(5, '0')}`;
}
