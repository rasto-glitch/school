# Remedial Term & Year Average Plan (audit M-3b)

**Status: ✅ COMPLETE — all phases P1–P6 shipped 2026-07-05 (⚠️ migration 075 not yet run;
one deploy bundle pending: backend + web + mobile OTA).**
Drafted 2026-07-04. Origin: functional audit finding M-3 (`FUNCTIONAL_AUDIT_2026-07-02.md`),
which split into:

- **M-3a** — term-level alignment: live pages (parent web GradesPage, mobile GradesScreen,
  admin StudentBriefPage) show raw `gradeTotal` sums while the report-card/transcript PDFs show
  normalized `subjectPercent`. Fix = live pages adopt `subjectPercent` + `averagePercent`
  (PDF inclusion rule: zeros counted, nulls skipped). Frontend-only, independent of this plan.
  **Not yet approved/implemented.**
- **M-3b** — THIS PLAN: the official year-average convention + the remedial (supplementary /
  summer) term, which no part of the system currently models.

---

## 1. The problem

1. **No surface implements the official year average** (per subject: mean across terms, then
   mean across subjects). Today:
   - Parent web `GradesPage.tsx:206-209`, mobile `GradesScreen.tsx:267-270`, admin
     `StudentBriefPage.tsx:143-160` → average of term averages (double-rounded, zeros excluded).
   - Transcript `reportCard.controller.ts:468` → flat mean of ALL subject percents lifetime.
   - The three agree only on a complete grade grid; they all diverge from the official
     convention when a subject is missing/zero in a term.
2. **The remedial term does not exist as a concept.** Terms are free-text + order_index. If a
   school files a "Remedial" term today it is counted as a third equal term — the failed mark
   still counts and the retake double-counts. No pass/fail threshold, no substitution, no
   remedial list.

## 2. Locked decisions (from user, 2026-07-04)

1. **Official year average (percent path):** per subject, `mean(effective value per REGULAR
   term)`, divisor = number of regular terms the subject appears in; year average = mean of
   subject year values. Example: Math T1=76, T2=85 → 80.5.
2. **Remedial is additive, not destructive.** The original failing mark stays on record and
   visible everywhere; the remedial result lives alongside it and is what COUNTS.
3. **Substitution rule (zero special cases):** effective value for a regular term = remedial
   entry's normalized total (out of 100) if one exists for that (subject, term), else the
   original term total. Failed both → (retake₁ + retake₂)/2, originals don't count. Failed one
   → (retake + passed original)/2.
4. **Pass/fail:** subject year value `< passPercent` = fail → remedial for each term scored
   below the threshold. After remedial, the SAME recomputed year average decides — a student
   can improve on the retake and still fail the year. Remedial failure = **repeat the year**
   (v1: reporting outcome only; no automated retention/re-enrollment).
5. **passPercent is per-school config, default 50** (some schools differ).
6. **Remedial exam schemes are school-wide config**, expressed as mark components summing
   to 100 (same shape as a regular term, so `subjectPercent` normalization applies unchanged):
   - out-of-100: single Remedial Exam component (max 100), OR
   - out-of-80 + carried component: Remedial Exam (max 80) + the failed term's midterm
     (max 20) or daily marks — school picks WHICH configured mark type carries over.
7. **Carried component is auto-copied** from the respective failed term's grade row, and is
   NOT teacher-editable (user, 2026-07-04): the teacher's ONLY input is the exam mark (e.g.
   what the student scored out of 80); the app fills the carried value and computes the /100
   total. Exam input validated against the exam mark type's max.
8. **Remedial entries are per (student, subject, corrected term)** — retaking both terms of
   Math = two remedial entries, each carrying from its own term.
9. **Filed by the subject teacher** through the normal grading flow: the remedial term is a
   real term (school-named), so it appears in the teacher's existing term picker as its own
   entry — teacher picks it instead of a regular term. (Remaining flow details deferred —
   user: "more on that later"; see O-2.)
9b. **Dedicated Settings section for the remedial term/exam** (user, 2026-07-04): owns
   designating/creating the remedial term (sets `kind='remedial'`; enforce one per school;
   NOT creatable from the general terms list, to avoid an accidental third regular term),
   the exam scheme (out-of-100 vs 80 + carried mark type), and plausibly `passPercent`.
10. **Official documents show original + remedial side by side** (report card, transcript,
    parent pages).
11. ~~GPA path deferred~~ → superseded by decision 16.
12. **No carry scaling (was O-6):** the Settings section requires the carry mark type's max to
    equal exactly 100 − exam max; the carried value is copied verbatim, never rescaled.
13. **Missing carried value = 0 with a visible warning in the filing UI (was O-7)** — never
    block the remedial process on a missing historical mark.
14. **Remedial filing UX (was O-2):** the app PRE-BUILDS remedial entries from the remedial
    list (student failed both terms → two rows for the subject, one per corrected term, each
    with its carried value filled); the teacher only types the exam mark(s). The remedial term
    gets its OWN grade-filing window and its OWN report-card publish gate.
15. **Transcript is per-year, NO lifetime average (was O-1):** each year block shows subjects ×
    (T1, T2, …, Final) + a Year Average row. Grade 8 = 87, Grade 9 = 93 — they represent that
    year; they are never combined into a cumulative figure.
16. **GPA = letters as PRESENTATION of the same percent math (was O-5).** There is no separate
    grade-point averaging. Every average (subject Final, term average, year average) is
    computed on the underlying numeric percents, then converted to its letter via the existing
    grade-scale bands setting. Example: Math T1 A(95), T2 B(85) → Final 90 → A-; Year Average
    88.4 → B+. Mode mapping: `scale` = numbers only, `gpa` = letters only, `both` = "88.4 (B+)".
    Consequence: existing `averageGpa` grade-point averaging (parent pages term/year GPA,
    cumulative GPA card, report-card/transcript `gpa` fields) is replaced by
    letter-of-percent-average.
17. **Per-subject "Final" column** (subject year value = mean of effective term values, i.e.
    with remedial substitution) becomes a first-class displayed figure — transcript per-year
    table at minimum (see O-10 for live pages).
18. **Round terminology (user, 2026-07-05).** The per-subject Final is called
    **"تێکڕای خوولی یەکەم"** — the Round One average: mean of the regular terms' ORIGINAL marks,
    the number that decides pass/fail. Round Two = the remedial exams. UI labels (EN/AR/KU)
    should use round vocabulary. Final/Round-One column IS SHOWN LIVE on parent web + mobile
    year views, not just documents (resolves O-10).
19. **Lifetime figures removed (resolves O-8):** the parent web/mobile "Cumulative GPA" card
    and the transcript's cumulative average/GPA footer are deleted; the transcript becomes
    per-year tables only. Nothing aggregates across years.
20. **Grade points retired (resolves O-9):** `grade_scale_bands` becomes percent-threshold →
    letter only in Settings and all displays; "(4.0)"-style renderings and the grade_point
    settings field go away (column can stay in the DB, ignored). All letter displays derive
    from percent averages via bandForPercent.
21. **Two year figures, side by side (user, 2026-07-05, resolves O-11):** when a student sat
    Round Two, the parent sees BOTH — "تێکڕای خوولی یەکەم" (Round One average, originals only)
    AND "تێکڕای خوولی دووەم" (Round Two average, with remedial substituted; the effective
    pass/fail number). Students who passed Round One show only the Round One figure. Exact
    EN/AR wording finalized with translations at build time.

## 3. Open decisions

All original O-items RESOLVED → folded into §2 locked decisions 12–20. Remaining:

- **O-4. Report-card presentation** of side-by-side original + remedial (layout detail, decide
  at P5 review).
- ~~O-11~~ RESOLVED → locked decision 21.

## 4. Design sketch (recommendation — review before build)

### Schema (Scholify is demo-data-only; no backfill needed)
**AS BUILT (P1, migration 075) — one change from the original sketch:** remedial entries live
in their own `remedial_grades` table, NOT as `grades` rows with a `remedial_for_period`
column. Reason found at build time: a student retaking BOTH terms of a subject would produce
two grades rows sharing (student_id, subject, <remedial term name>, academic_year) — colliding
on the grades identity unique index shipped as audit fix 072 (and PostgREST upserts can't
target partial/expression indexes, so weakening 072 was not an option).
- `terms.kind text NOT NULL DEFAULT 'regular' CHECK (kind IN ('regular','remedial'))` +
  partial unique index → at most ONE remedial term per school.
- `remedial_grades`: (school, student, teacher, class, subject, academic_year, for_period,
  exam_value NULL-until-filed, carry_name, carry_value default 0, carry_missing bool,
  is_released/released_at/released_by like grades). UNIQUE (student, subject, academic_year,
  for_period). Total /100 = exam_value + carry_value.
- `schools.grading_config` additions (JSONB, no DDL):
  `passPercent` (default 50);
  `remedial: { examMarkType: <name>, carryMarkType: <name>|null }` — controller-validated
  against `mark_types`: grade-applicable, maxes must sum to EXACTLY 100 (decision 12).

### Canonical formula chain — ALL THREE lockstep copies
(backend `gradeCalc.ts`, web `marks.ts`, mobile `gpa.ts`)
1. `subjectPercent(row)` — existing.
2. Term average = `averagePercent(subject percents)` — existing (M-3a aligns live pages).
3. `effectiveTermValue(subject, term)` = remedial percent ?? original percent. **NEW**
4. `subjectYearValue` = mean of effective values over regular terms present. **NEW**
5. Year average = mean over subjects of subjectYearValue. **NEW**
6. `isSubjectFailed = subjectYearValue < passPercent`. **NEW**

### Surfaces
- Parent web + mobile + admin StudentBrief: subject-first year average; remedial marks shown
  beside originals; fail indicator per subject.
- **Remedial list** (admin + teacher): after regular terms are filed/released — per student ×
  subject × term-to-retake. This is the operational artifact schools run the process with.
- Teacher grading: "Remedial" in term picker, auto-carried component, exam mark entry (O-2).
- Transcript/report card: side-by-side + per-year summary (O-1, O-4).

### Phases (sketch)
- **P1** ✅ DONE (2026-07-05, ⚠️ migration 075 not yet run). Schema (075: terms.kind +
  remedial_grades table + partial unique indexes, schema.sql mirrored) + config
  (grading_config passPercent/remedial; `/grade-config` now returns both + the remedial term;
  updateGradingConfig made merge-safe so mode saves can't clobber them) + PUT
  /admin/remedial-config (validates exam+carry mark types sum to exactly 100; creates/renames
  the single remedial term; academics.oversee) + deleteTerm refuses the remedial term +
  dedicated "Remedial term (Round Two)" Settings card (term name, exam/carry pickers with live
  sum check, pass mark, EN/AR/KU) + remedial badge (no delete) in the general terms list.
  Verified: backend+frontend tsc clean, tenant-scoping clean.
- **P2** ✅ DONE (2026-07-05). Year math added to ALL THREE lockstep copies (backend
  gradeCalc.ts, web marks.ts, mobile gpa.ts): `remedialTotal(exam, carry)` (/100, null until
  filed), `subjectYear(regularTerms, originalByTerm, remedialByTerm)` → `{ roundOne, final,
  satRemedial }` (terms-present divisor; remedial substitutes per corrected term),
  `failedTerms()` (graded AND below pass mark; Round Two gate = isFailing(roundOne), callers
  compose), `isFailing()`. GradingConfig gained `passPercent` + `remedial` on all three
  (backend `loadGradingConfig` now also queries the remedial term; web/mobile fields optional
  so existing defaults stay valid). Verified: tsc clean ×3 + runtime spot-check reproducing
  every worked example from the user's clarifications (80.5 / 57.5 / 47.5-still-fails / 87 /
  single-term-85).
- **P3** ✅ DONE (2026-07-05), web-first. Backend: GET /teacher/remedial-roster (idempotent
  build-on-read sync per class+subject+current-year — inserts entries for Round One failures
  per failed term with carry auto-copied via getMarkValue; refreshes carry while unfiled,
  freezes after filing; deletes stale unfiled entries; keeps filed-but-no-longer-required ones
  visible) + PUT /teacher/remedial-grades/:id (exam mark only, 0..examMax, gated by the
  remedial term's OWN filing window via getOpenWindowForTerm, lands unreleased + notifies
  admins like normal filing; subjectAllowedForClass auth on both). Guards: teacher upsertGrade
  and admin uploadGrades (xlsx) both reject the remedial term as grading_period (grades rows
  never carry the remedial period). Web GradingPage: picking the remedial term switches the
  form to the pre-built Round Two roster (student, retake-for-term, Round One avg, carried
  mark or carry-missing warning, exam input with live /100 total, per-row save; reuses the
  filing-window banner). Mobile: remedial term filtered OUT of the teacher term picker —
  **mobile remedial filing = deferred enhancement**. EN/AR/KU keys added. Verified: tsc ×3 +
  tenant-scoping clean.
- **P4** ✅ DONE (2026-07-05). Backend: sync logic extracted to utils/remedial.ts
  `syncClassRemedial` (whole class or one subject; also computes per-subject `final` with
  filed retakes substituted) — teacher roster now delegates to it; GET /admin/remedial-overview
  (per class, all subjects — runs the same sync so the list exists before teachers open
  anything) + POST /admin/remedial-release (filed-only guard `.not('exam_value','is',null)`,
  parent notifications, releaseGrades parity); getStudentBrief returns `remedial` rows (all,
  released or not); GET /parent/remedial-grades (released-only, same child/feature gates as
  grades). Web: NEW /admin/remedial page (class picker → remedial list: retake-for, Round One,
  carry, exam, Round Two/final with pass-mark coloring, status chips, release selected/all) in
  App routes + Sidebar (feature grades + academics.oversee); parent GradesPage + admin
  StudentBriefPage gained the Year summary table (Round One column always; Round Two column
  only when retakes exist; red below passPercent; retake detail lines) and their year
  average/Full Year Mark switched to the OFFICIAL subject-first mean of finals. Mobile parent
  GradesScreen: same year summary + official year average (OTA-safe). EN/AR/KU on web+mobile.
  Verified: tsc ×3 + tenant-scoping clean.
- **P5** ✅ DONE (2026-07-05). **Transcript rebuilt to per-year tables** (resolves the layout
  half of O-4): Subject | terms… | Round One | Round Two (column only when retakes exist) |
  Grade (letter of the effective final — decision-16 presentation, no grade-point math), year
  average row "88.4 (B+)", failing values red / passing Round Two green, LIFETIME CUMULATIVE
  REMOVED (decision 19); term columns ordered by terms.order_index; parent path shows Round
  Two data only when the remedial term itself is published for that year (its own gate,
  decision 14). **Round Two report card**: requesting the remedial term from any card endpoint
  (admin single, bulk class, parent download) now renders the retake card — one row per
  released retake, corrected term's ORIGINAL value in its own column side-by-side with exam +
  carried marks and the /100 total + letter; overall = official post-substitution year average
  across ALL subjects; empty → 404 "No released Round Two marks"; publish/remark machinery
  reused unchanged (remedial term is publishable like any term from the Report Cards page).
  **Parent web + mobile**: "Round Two card" download button in the year summary once the
  remedial term is published. Verified: tsc ×3 + tenant-scoping clean + runtime PDF smoke test
  (synthetic 2-year transcript with retakes + a Round Two card in Kurdish rendered real bytes).
- **P6** ✅ DONE (2026-07-05). Letters are now PURE PRESENTATION of percent averages
  everywhere (decisions 16/19/20): parent web + mobile — per-subject/term/year letters =
  bandForPercent of the percent average, "(4.0)" displays and the lifetime Cumulative GPA
  cards REMOVED, year-average row shows number + letter in both modes ("88.4 (B+)"), year
  summary now renders in letters-only mode too; mobile teacher grade history letter-only.
  Report card PDF: overall = "Overall %: X · Grade: letter" (band of the average — the old
  averaged-grade-points GPA figure is gone), subject cells letter-only; gradePoint dropped
  from ReportCardSubject. Settings: bands editor = Min % + Letter only (Points column
  removed; "Load default scale"); backend accepts gradePoint optionally (legacy clients),
  stores 0; grade_scale_bands.grade_point column stays in the DB, ignored. Verified: tsc ×3 +
  tenant-scoping + PDF smoke render.
- **Deferred:** promotion/retention automation; mobile teacher remedial filing; M-4/M-5/M-6
  and the audit LOW pile continue separately.

## 5. Standing invariants (from the audit rhythm)
- schema.sql stays truthful to prod; changes land as idempotent migrations.
- Grade-math changes go to ALL THREE lockstep copies.
- Verify: `npx tsc --noEmit` backend+frontend(+mobile), `npm run check:tenant-scoping`.
- User runs migrations; deploy-order warnings called out explicitly.
