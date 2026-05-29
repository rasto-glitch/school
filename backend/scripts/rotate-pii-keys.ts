// scripts/rotate-pii-keys.ts
//
// Re-encrypts every encrypted column on every employee_extended_profile
// row to the current master-key version (see utils/employeePiiCrypto.ts).
// Idempotent — re-running after a clean rotation is a no-op.
//
// Usage:
//   1. Set EMPLOYEE_PII_KEY_V<N> alongside the old EMPLOYEE_PII_KEY in the
//      backend env. Deploy. New writes are already on the new version;
//      existing rows still decrypt against their original key.
//   2. Run this script ONCE against the production env. It iterates rows
//      and bumps any sub-current ciphertext.
//   3. After every row reports vN+, remove the old EMPLOYEE_PII_KEY value.
//      Future deploys then run with only the new key in env.
//
// Failure semantics: a single row failure is logged and the script
// continues with the next one — partial completion is recoverable on
// re-run. A hard exception (e.g. DB connection lost) aborts the whole
// pass; nothing has been committed in a way that requires manual repair
// because each row is updated atomically.

// Load .env in dev. In CI / production the env is already injected.
import 'dotenv/config';

import { adminDb as supabase } from '../src/utils/db';
import {
  currentPiiKeyVersion,
  decryptPii, encryptPii,
  piiVersionOf, lookupHash,
} from '../src/utils/employeePiiCrypto';

const ENCRYPTED_COLS = [
  'mother_full_name_ct',
  'father_full_name_ct',
  'spouse_name_ct',
  'religion_ct',
  'bank_iban_ct',
  'tax_id_ct',
  'social_insurance_no_ct',
] as const;

// Columns that have a paired lookup_hash. The hash is rebuilt from the
// freshly-decrypted plaintext on every rotation so equality search stays
// correct under the new salt.
const LOOKUP_PAIRS: { ct: typeof ENCRYPTED_COLS[number]; hash: string }[] = [
  { ct: 'bank_iban_ct',            hash: 'bank_iban_lookup_hash' },
  { ct: 'tax_id_ct',               hash: 'tax_id_lookup_hash' },
  { ct: 'social_insurance_no_ct',  hash: 'social_insurance_lookup_hash' },
];

interface ExtendedRow {
  school_id: string;
  owner_type: string;
  owner_id: string;
  redacted_at: string | null;
  // dynamic encrypted columns
  [key: string]: unknown;
}

async function main(): Promise<void> {
  const targetVersion = currentPiiKeyVersion();
  console.log(`[rotate-pii] current master-key version: v${targetVersion}`);

  // Page through rows. We don't filter by version on the server because
  // wire-format version isn't stored separately — it's parsed from the
  // ciphertext string.
  let offset = 0;
  const PAGE = 500;
  let totalScanned = 0;
  let totalUpdated = 0;
  let totalFailed = 0;

  for (;;) {
    const { data: rows, error } = await supabase
      .from('employee_extended_profile')
      .select('school_id, owner_type, owner_id, redacted_at, ' + [
        ...ENCRYPTED_COLS,
        ...LOOKUP_PAIRS.map(p => p.hash),
      ].join(', '))
      .order('owner_type', { ascending: true }).order('owner_id', { ascending: true })
      .range(offset, offset + PAGE - 1);

    if (error) throw new Error(`load page at offset ${offset}: ${error.message}`);
    if (!rows || rows.length === 0) break;

    for (const row of rows as unknown as ExtendedRow[]) {
      totalScanned++;
      if (row.redacted_at) continue; // tombstone; nothing to rotate

      const patch: Record<string, unknown> = {};
      let bumped = false;

      try {
        for (const col of ENCRYPTED_COLS) {
          const stored = row[col] as string | null;
          if (stored == null) continue;
          const v = piiVersionOf(stored);
          if (v === null || v === targetVersion) continue; // already current
          const plaintext = decryptPii(stored, row.school_id);
          if (plaintext == null) continue;
          patch[col] = encryptPii(plaintext, row.school_id);
          bumped = true;

          // If this column has a paired lookup hash, recompute it under
          // the current key's salt.
          const pair = LOOKUP_PAIRS.find(p => p.ct === col);
          if (pair) patch[pair.hash] = lookupHash(plaintext, row.school_id);
        }
      } catch (err) {
        totalFailed++;
        console.error(`[rotate-pii] FAIL ${row.owner_type}/${row.owner_id}: ${(err as Error).message}`);
        continue;
      }

      if (!bumped) continue;

      // school-scoped update.
      patch.updated_at = new Date().toISOString();
      const { error: updErr } = await supabase
        .from('employee_extended_profile')
        .update(patch)
        .eq('school_id', row.school_id)
        .eq('owner_type', row.owner_type)
        .eq('owner_id', row.owner_id);
      if (updErr) {
        totalFailed++;
        console.error(`[rotate-pii] UPDATE FAIL ${row.owner_type}/${row.owner_id}: ${updErr.message}`);
        continue;
      }
      totalUpdated++;
      if (totalUpdated % 50 === 0) {
        console.log(`[rotate-pii] re-encrypted ${totalUpdated} rows so far...`);
      }
    }

    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  console.log(`[rotate-pii] done. scanned=${totalScanned}, re-encrypted=${totalUpdated}, failed=${totalFailed}, target=v${targetVersion}.`);
  if (totalFailed > 0) process.exit(1);
}

main().catch(err => {
  console.error(`[rotate-pii] aborted: ${(err as Error).message}`);
  process.exit(1);
});
