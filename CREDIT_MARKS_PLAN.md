# Credit Marks (نمرەی هاوکاری) — support-mark rounding under school control

**Status: PROPOSED 2026-07-06 — core decisions locked with the user; phase plan awaiting
build approval.** Origin: the functional-audit LOW "grade band from 1-dp-rounded percent
promotes 49.96 → 50.0". The user rejected automatic rounding entirely: some schools may not
round freely; instead schools have a **credit system** — each student carries a pool of
"support" marks per round, and the school decides per student per subject how much of the
pool to spend to lift a failing subject to pass.

## Locked decisions (user, 2026-07-06)

1. **Pool is per ROUND, size set by the school** — a per-school setting: number of credit
   marks each student gets per round (خولی یەکەم = Round One / year result; خولی دووەم =
   Round Two / remedial). `0` (or unset) = feature off for that school.
2. **Capped to pass** — credit can only bring a failing subject exactly up to the pass
   mark: 47 + 3 → 50, never 51. Passing subjects can't receive credit.
3. **One pool across subjects in the same round** — e.g. 5 credits split 2 to math +
   3 to science, all within the round's pool.
4. **Per-school configuration** for BOTH the pool size and the pass mark (default 50).
5. **The automatic 1-dp rounding promotion is REMOVED** — banding/pass decisions use the
   unrounded percent everywhere. All rounding mercy flows through visible, audited credit
   allocations instead.

## Design

### Storage (migration 079)
New table `grade_credit_allocations` — allocations never mutate the teacher's raw marks:

```
id, school_id, student_id, academic_year TEXT, round TEXT CHECK ('round1'|'round2'),
subject TEXT, amount NUMERIC(5,2) CHECK (amount > 0),
granted_by UUID, granted_at, note TEXT,
UNIQUE (school_id, student_id, academic_year, round, subject)
```

Config lives in the school's grading config (same place as bands/mode):
`creditMarks: { perRoundPool: number, passMark: number }` — admin-editable on the grading
settings page (academic policy, not premium/platform-gated).

### Semantics
- **Round One**: credit applies to the subject's **year average** (the subject-first year
  math from M-3b). Effective = raw year average + credit, capped at passMark.
- **Round Two**: credit applies to the **remedial mark** for that subject. Same cap.
- Validation at write time: subject must be failing (effective < passMark before credit);
  amount ≤ deficit (passMark − raw); Σ allocations for (student, year, round) ≤ pool.
- Credit that lifts a Round One subject to pass **removes it from the remedial roster**
  (re-run `syncClassRemedial` after allocation changes).
- Every allocation writes an audit-log entry (who gave how much to whom, for what).

### Where the school allocates (decision surface)
Admin review surface, gated `academics.oversee`: per-class year view listing each student's
failing subjects with the deficit (e.g. "math 47 → needs 3"), the student's remaining pool,
and an inline credit input. Round Two gets the same treatment on the remedial review page.

### Presentation (report cards, transcripts, web, mobile)
Everywhere grades show: effective mark, with the support annotation per subject
(e.g. "50 (47 + هاوکاری 3)") and a per-round summary line naming the round and subjects:
"خولی یەکەم: +3 (بیرکاری)". Report-card + transcript PDFs, parent web GradesPage, mobile
GradesScreen, admin StudentBrief. Parent surfaces need the allocations delivered alongside
grades; the effective-mark math joins the THREE LOCKSTEP COPIES (backend gradeCalc.ts, web
marks.ts, mobile gpa.ts) as a shared helper in each.

### Strict banding (decision 5)
`subjectPercent` currently rounds to 1 dp before `bandForPercent`, so 49.96 displays AND
passes as 50.0. Change (lockstep ×3 + PDFs): percent computed unrounded for banding /
pass-fail / remedial eligibility; display **floors** to 1 dp (49.96 shows "49.9") so a
failing mark can never display as a passing one. Money-free, migration-free, but touches
every grade surface — ships as its own phase with regression care.

## Phases (each: implement → verify → doc, per the audit rhythm)

- **P1 — strict banding**: remove the 1-dp promotion (gradeCalc.ts + marks.ts + gpa.ts +
  report-card/transcript PDFs). Floor-display. No feature gate — this is the bug half.
- **P2 — foundation**: migration 079 + grading-config fields + backend allocation CRUD
  (validation, audit, remedial re-sync) + effective-mark helper in gradeCalc.ts.
- **P3 — admin allocation UI**: per-class Round One review surface + Round Two on the
  remedial page; pool/pass settings on the grading config page. EN/AR/KU.
- **P4 — presentation**: report cards + transcripts (per-subject annotation + per-round
  summary), parent web + mobile grade pages (lockstep helpers + allocations in payloads).
  Mobile is OTA-safe (no new deps).

## Deferred / explicitly out of scope
- Credit on individual TERM marks (credits apply to round outcomes only, per the user's
  framing).
- Teacher visibility of allocations beyond the effective mark (school-internal decision).
- Any automatic allocation suggestions.
