import { adminDb as supabase } from './db';
import { getSchoolTimezone, todayInTimezone } from './attendance';

// Per-term grade filing window helpers. The window is AUTHORITATIVE: a teacher
// may only file grades for a term while today (in the school's timezone) falls
// within that term's [opens_on, closes_on]. Shared by teacher.upsertGrade (the
// enforcement) and attention.controller (the dashboard signal + settings).

export interface GradeWindow {
  id: string;
  term: string;
  opensOn: string;   // YYYY-MM-DD
  closesOn: string;  // YYYY-MM-DD
}

interface WindowRow {
  id: string;
  term: string;
  opens_on: string;
  closes_on: string;
}

const toWindow = (r: WindowRow): GradeWindow => ({
  id: r.id, term: r.term, opensOn: r.opens_on, closesOn: r.closes_on,
});

// All configured windows for a school, ordered by open date. For the settings
// panel / "Set window" modal.
export async function listGradeWindows(schoolId: string): Promise<GradeWindow[]> {
  const { data } = await supabase
    .from('grade_filing_windows')
    .select('id, term, opens_on, closes_on')
    .eq('school_id', schoolId)
    .order('opens_on', { ascending: true });
  return ((data as WindowRow[] | null) ?? []).map(toWindow);
}

// The window for one term IF it is open today (school-local). Returns null when
// the term has no window or today is outside it. This is the teacher-filing
// gate's single source of truth.
export async function getOpenWindowForTerm(schoolId: string, term: string): Promise<GradeWindow | null> {
  if (!term) return null;
  const today = todayInTimezone(await getSchoolTimezone(schoolId));
  const { data } = await supabase
    .from('grade_filing_windows')
    .select('id, term, opens_on, closes_on')
    .eq('school_id', schoolId)
    .eq('term', term)
    .lte('opens_on', today)
    .gte('closes_on', today)
    .maybeSingle();
  return data ? toWindow(data as WindowRow) : null;
}

// The window that is open today; if several overlap, the one closing soonest.
// Used as the "current term" for the dashboard grade-gap signal.
export async function getCurrentOpenWindow(schoolId: string): Promise<GradeWindow | null> {
  const today = todayInTimezone(await getSchoolTimezone(schoolId));
  const { data } = await supabase
    .from('grade_filing_windows')
    .select('id, term, opens_on, closes_on')
    .eq('school_id', schoolId)
    .lte('opens_on', today)
    .gte('closes_on', today)
    .order('closes_on', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ? toWindow(data as WindowRow) : null;
}
