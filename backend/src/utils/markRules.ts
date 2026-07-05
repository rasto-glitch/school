// Server-side mark rules shared by every grades write path (teacher upsert +
// admin edit), so the rules can't drift between them:
//
//  1. Unknown-name rejection (audit M-2): when the school has configured
//     grade mark types, every submitted mark must use one of them — an
//     unknown name can't be matched to an "out of" value and would silently
//     drop out of the official percentage.
//  2. Value bounds (audit LOW): numeric values must be ≥ 0 and, when the
//     matching type has a max_value, ≤ that max — otherwise a typo like 855
//     for 85.5 sails into released grades and inflates every average built
//     on it. Non-numeric (letter) values are legacy raw-sum strings: the
//     grade math skips them, so they pass through here too.

export interface GradeMarkType { name: string; max_value: number | string | null }

// Returns a human-readable error, or null when the marks are acceptable.
export function checkGradeMarks(marks: unknown, types: GradeMarkType[]): string | null {
  const arr = Array.isArray(marks) ? marks : [];
  const maxByName = new Map<string, number | null>(
    types.map(t => [t.name, t.max_value == null ? null : Number(t.max_value)]),
  );

  if (maxByName.size > 0) {
    const unknown = [...new Set(
      arr
        .map((m: { name?: unknown }) => m?.name)
        .filter((n: unknown): n is string => typeof n === 'string' && !maxByName.has(n)),
    )];
    if (unknown.length > 0) {
      return `Unknown mark type(s): ${unknown.join(', ')}. Use the school's configured mark types.`;
    }
  }

  for (const m of arr) {
    const name = (m as { name?: unknown })?.name;
    const raw = (m as { value?: unknown })?.value;
    const v = typeof raw === 'number'
      ? raw
      : (typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN);
    if (!Number.isFinite(v)) continue; // letters / blanks — not part of the math
    if (v < 0) return `"${String(name)}": marks can't be negative.`;
    const max = typeof name === 'string' ? maxByName.get(name) : undefined;
    if (max != null && v > max) return `"${String(name)}": ${v} exceeds the maximum of ${max}.`;
  }
  return null;
}
