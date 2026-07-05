import { decryptPii } from './employeePiiCrypto';

// The read-only "safety subset" of a student's clinic health profile, surfaced
// in teacher / supervisor / admin student briefs (migration 067 stores the full
// profile; the nurse-visit log and other fields stay clinic-only under
// `health.manage`). Only what a teacher needs to keep the student safe in class:
// allergies, chronic/critical conditions, and dietary notes. The two free-text
// fields are field-level encrypted at rest and decrypted here.

export interface HealthBrief {
  allergyTags: string[];
  chronicConditions: string | null;
  dietaryNotes: string | null;
  hasAny: boolean;   // false → the frontend shows nothing
}

// `db` is any school-scoped Supabase client (the service-role `supabase` or a
// request-scoped `req.db`). Returns null when the student has no health profile.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadHealthBrief(db: any, schoolId: string, studentId: string): Promise<HealthBrief | null> {
  const { data } = await db
    .from('student_health_profiles')
    .select('allergy_tags, chronic_conditions_ct, dietary_notes_ct')
    .eq('school_id', schoolId)
    .eq('student_id', studentId)
    .maybeSingle();
  if (!data) return null;

  // Per-field guard: the brief is best-effort safety info embedded in the
  // whole student brief — one corrupt ciphertext must degrade to a missing
  // field, not 500 the entire teacher/admin page (the clinic controller
  // guards the same decrypt; this path forgot to).
  const safeDecrypt = (ct: string | null): string | null => {
    try { return decryptPii(ct, schoolId); }
    catch (e) {
      console.error(`[healthBrief] decrypt failed for student ${studentId}:`, e instanceof Error ? e.message : e);
      return null;
    }
  };
  const allergyTags = Array.isArray(data.allergy_tags) ? (data.allergy_tags as string[]) : [];
  const chronicConditions = (safeDecrypt(data.chronic_conditions_ct as string | null) || '').trim() || null;
  const dietaryNotes = (safeDecrypt(data.dietary_notes_ct as string | null) || '').trim() || null;
  const hasAny = allergyTags.length > 0 || !!chronicConditions || !!dietaryNotes;
  return { allergyTags, chronicConditions, dietaryNotes, hasAny };
}
