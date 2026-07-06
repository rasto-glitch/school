import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { GraduationCap, Download } from 'lucide-react';
import { parentApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Select from '../../components/common/Select';
import EmptyState from '../../components/common/EmptyState';
import ErrorMessage from '../../components/common/ErrorMessage';
import { GradesTableSkeleton } from '../../components/common/Skeleton';
import type { Student, Grade } from '../../types';
import { getMarkNames, getMarkValue, subjectPercent, bandForPercent, averagePercent, subjectYear, remedialTotal, displayPercent, applyCredit, creditFor } from '../../utils/marks';
import type { GradingConfig, CreditAllocation } from '../../utils/marks';

// A released Round Two entry (REMEDIAL_TERM_PLAN.md P4).
interface RemedialRow {
  id: string;
  subject: string;
  forPeriod: string;
  academicYear: string;
  examValue: number | null;
  carryName: string | null;
  carryValue: number;
  carryMissing: boolean;
}

// A credit-mark allocation (نمرەی هاوکاری, 079) from /parent/credit-allocations.
interface CreditRow {
  academicYear: string;
  round: 'round1' | 'round2';
  subject: string;
  amount: number;
}

export default function GradesPage() {
  const { t } = useTranslation();
  const [children, setChildren] = useState<Student[]>([]);
  const [selectedChild, setSelectedChild] = useState('');
  const [grades, setGrades] = useState<Grade[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [cfg, setCfg] = useState<GradingConfig>({ mode: 'scale', bands: [], markMaxes: {} });
  // PR 2 — let the parent narrow the view to one academic year. Default
  // (empty string) shows every year on file. Cumulative GPA still spans
  // the full history regardless of the filter.
  const [yearFilter, setYearFilter] = useState('');
  // Published (year|term) keys, lowercased — a term only gets a "Report card"
  // download button once the school has published it.
  const [publishedKeys, setPublishedKeys] = useState<Set<string>>(new Set());
  const [dl, setDl] = useState<string | null>(null);
  const [tDl, setTDl] = useState(false);

  useEffect(() => {
    parentApi.getChildren().then(r => {
      const kids: Student[] = r.data || [];
      setChildren(kids);
      if (kids.length > 0) setSelectedChild(kids[0].id);
    });
    parentApi.getGradeConfig().then(r => setCfg(r.data)).catch(() => {});
    parentApi.getReportCardTerms()
      .then(r => {
        const s = new Set<string>();
        (r.data?.terms || []).forEach(x => s.add(`${x.academicYear.toLowerCase().trim()}|||${x.term.toLowerCase().trim()}`));
        setPublishedKeys(s);
      })
      .catch(() => {});
  }, []);

  const downloadCard = async (key: string, rawYear: string, rawTerm: string) => {
    if (!selectedChild) return;
    setDl(key);
    try {
      const r = await parentApi.downloadReportCard(selectedChild, rawYear, rawTerm);
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report-card-${rawYear}-${rawTerm}.pdf`.replace(/[^a-z0-9.\-]/gi, '_');
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('grades.report_card_failed', 'Could not download the report card.'));
    } finally {
      setDl(null);
    }
  };

  // Cumulative transcript across all published+released terms (graduates/leavers
  // included as long as they're still on the parent's children list).
  const downloadTranscript = async () => {
    if (!selectedChild) return;
    setTDl(true);
    try {
      const r = await parentApi.downloadTranscript(selectedChild);
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url; a.download = 'transcript.pdf';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('grades.transcript_failed', 'Could not download the transcript.'));
    } finally {
      setTDl(false);
    }
  };

  const showGpa = cfg.mode === 'gpa' || cfg.mode === 'both';
  const showPct = cfg.mode === 'scale' || cfg.mode === 'both';
  // Letters are pure presentation of the percent math (M-3b decision 16):
  // every letter is bandForPercent of a percent AVERAGE — grade points are
  // never averaged, and there is no lifetime cumulative figure (decision 19).
  const letterOf = (v: number | null) => bandForPercent(v, cfg.bands)?.letter ?? null;

  const [remedial, setRemedial] = useState<RemedialRow[]>([]);
  const [credits, setCredits] = useState<CreditRow[]>([]);

  useEffect(() => {
    if (!selectedChild) return;
    setLoading(true);
    setError(false);
    parentApi.getGrades(selectedChild)
      .then(r => setGrades(r.data || []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
    parentApi.getRemedialGrades(selectedChild)
      .then(r => setRemedial(r.data || []))
      .catch(() => setRemedial([]));
    parentApi.getCreditAllocations(selectedChild)
      .then(r => setCredits(r.data || []))
      .catch(() => setCredits([]));
  }, [selectedChild, retryKey]);

  // Group: year → term → subject → Grade. Normalize the labels so case
  // variations ("Term 1" vs "term 1") collapse onto the same row.
  const byYear = grades.reduce((acc, g) => {
    const yr = canonicalLabel(g.academicYear) || 'Current Year';
    const term = canonicalLabel(g.gradingPeriod) || 'Term 1';
    const subj = canonicalLabel(g.subject);
    if (!acc[yr]) acc[yr] = {};
    if (!acc[yr][term]) acc[yr][term] = {};
    acc[yr][term][subj] = g;
    return acc;
  }, {} as Record<string, Record<string, Record<string, Grade>>>);

  const allYears = Object.keys(byYear).sort((a, b) => b.localeCompare(a));
  const years = yearFilter ? allYears.filter(y => y === yearFilter) : allYears;

  return (
    <PageLayout title={t('grades.title')} subtitle={t('grades.subtitle')}>
      <div className="space-y-6">
        <div className="flex flex-wrap gap-3 items-end">
          {children.length > 1 && (
            <div className="w-full sm:w-56">
              <Select
                label={t('common.child')}
                options={children.map(c => ({ value: c.id, label: c.fullName }))}
                value={selectedChild}
                onChange={e => setSelectedChild(e.target.value)}
              />
            </div>
          )}
          {allYears.length > 1 && (
            <div className="w-full sm:w-44">
              <Select
                label={t('grades.academic_year_label')}
                options={[
                  { value: '', label: t('grades.year_filter_all') },
                  ...allYears.map(y => ({ value: y, label: y })),
                ]}
                value={yearFilter}
                onChange={e => setYearFilter(e.target.value)}
              />
            </div>
          )}
        </div>

        {loading ? <GradesTableSkeleton /> : error ? (
          <ErrorMessage onRetry={() => setRetryKey(k => k + 1)} />
        ) : grades.length === 0 ? (
          <EmptyState title={t('grades.no_grades')} icon={<GraduationCap className="w-8 h-8 text-gray-400" />} />
        ) : (
        <>
          {publishedKeys.size > 0 && (
            <div className="flex justify-end">
              <button
                onClick={downloadTranscript}
                disabled={tDl}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-violet-700 hover:text-violet-900 disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                {t('grades.transcript', 'Transcript')}
              </button>
            </div>
          )}
          {years.map(yr => {
            const terms = Object.keys(byYear[yr]).sort();
            const subjects = Array.from(
              new Set(terms.flatMap(t => Object.keys(byYear[yr][t])))
            ).sort();

            // Collect all dynamic mark names used in this year, preserving order of first appearance
            const markNameSet = new LinkedSet();
            for (const term of terms) {
              for (const subj of subjects) {
                const g = byYear[yr][term][subj];
                if (!g) continue;
                getMarkNames(g).forEach(n => markNameSet.add(n));
              }
            }
            const markNames = markNameSet.values();

            // Admin-written notes for this year, shown beneath the table.
            // Only grades the admin actually annotated appear here.
            const notes: { term: string; subject: string; note: string }[] = [];
            for (const term of terms) {
              for (const subj of subjects) {
                const g = byYear[yr][term][subj];
                if (g?.adminNote && g.adminNote.trim()) notes.push({ term, subject: subj, note: g.adminNote.trim() });
              }
            }

            // Term averages
            const termAvgs = terms.map(term => termAverage(subjects, byYear[yr][term], cfg.markMaxes));

            // Official year math (M-3b): per subject — Round One = mean of the
            // ORIGINAL term percents; released Round Two retakes substitute
            // into the final. Year average = mean of subject finals.
            const remForYear = remedial.filter(r => canonicalLabel(r.academicYear) === yr);
            // Credit marks (079): support credits lift a failing round value
            // up to (never past) the pass mark; the official standing uses
            // the round that concluded the subject.
            const passMark = cfg.passPercent ?? 50;
            const yearCredits: CreditAllocation[] = credits
              .filter(c => canonicalLabel(c.academicYear) === yr)
              .map(c => ({ round: c.round, subject: c.subject, amount: c.amount }));
            const yearRows = subjects.map(subject => {
              const originalByTerm: Record<string, number | null> = {};
              for (const term of terms) {
                const g = byYear[yr][term][subject];
                originalByTerm[term] = g ? subjectPercent(g, cfg.markMaxes) : null;
              }
              const retakes = remForYear.filter(r => canonicalLabel(r.subject) === subject);
              const remedialByTerm: Record<string, number | null> = {};
              for (const r of retakes) {
                remedialByTerm[canonicalLabel(r.forPeriod)] = remedialTotal(r.examValue, r.carryValue);
              }
              const y = subjectYear(terms, originalByTerm, remedialByTerm);
              const roundOneCredit = creditFor(yearCredits, 'round1', subject);
              const roundOneEffective = applyCredit(y.roundOne, roundOneCredit, passMark);
              const finalCredit = y.satRemedial ? creditFor(yearCredits, 'round2', subject) : 0;
              const finalEffective = y.satRemedial ? applyCredit(y.final, finalCredit, passMark) : roundOneEffective;
              return { subject, retakes, ...y, roundOneCredit, roundOneEffective, finalCredit, finalEffective };
            });
            const anyRoundTwo = yearRows.some(r => r.satRemedial);
            const appliedCredits = yearRows.flatMap(r => ([
              ...(r.roundOneCredit > 0 ? [{ round: 'round1' as const, subject: r.subject, amount: r.roundOneCredit }] : []),
              ...(r.finalCredit > 0 ? [{ round: 'round2' as const, subject: r.subject, amount: r.finalCredit }] : []),
            ]));
            const overallYearAvg = averagePercent(yearRows.map(r => r.finalEffective).filter((v): v is number => v != null));

            // Round Two report card download — available once the school
            // publishes the remedial term for this year (its own gate).
            const sampleGrade = Object.values(byYear[yr][terms[0]] || {})[0] as Grade | undefined;
            const rawYearForDl = sampleGrade?.academicYear || '';
            const remedialTermName = cfg.remedial?.termName || '';
            const canDlRoundTwo = anyRoundTwo && !!remedialTermName && !!rawYearForDl
              && publishedKeys.has(`${rawYearForDl.toLowerCase().trim()}|||${remedialTermName.toLowerCase().trim()}`);

            return (
              <Card key={yr} className="p-0 overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                  <h2 className="font-semibold text-gray-900">{yr}</h2>
                </div>

                <div className="overflow-x-auto">
                  <div className="inline-flex gap-0 min-w-full divide-x divide-gray-200">
                    {terms.map((term, ti) => {
                      const sample = Object.values(byYear[yr][term])[0] as Grade | undefined;
                      const rawYear = sample?.academicYear || '';
                      const rawTerm = sample?.gradingPeriod || '';
                      const canDownload = !!sample && publishedKeys.has(`${rawYear.toLowerCase().trim()}|||${rawTerm.toLowerCase().trim()}`);
                      const dlKey = `${yr}|${term}`;
                      return (
                      <div key={term} className="flex-1 min-w-[260px]">
                        <div className="px-4 py-2 bg-primary-50 border-b border-gray-200 flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-primary-700 uppercase tracking-wide">{term}</p>
                          {canDownload && (
                            <button
                              onClick={() => downloadCard(dlKey, rawYear, rawTerm)}
                              disabled={dl === dlKey}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 hover:text-primary-900 disabled:opacity-50"
                            >
                              <Download className="w-3.5 h-3.5" />
                              {t('grades.report_card', 'Report card')}
                            </button>
                          )}
                        </div>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-100 bg-white">
                              <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs">{t('grades.subject')}</th>
                              {markNames.map(name => (
                                <th key={name} className="text-center px-2 py-2 font-medium text-gray-500 text-xs">{name}</th>
                              ))}
                              <th className="text-center px-2 py-2 font-medium text-gray-500 text-xs">{t('grades.total')}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {subjects.map(subject => {
                              const g = byYear[yr][term][subject];
                              const pct = g ? subjectPercent(g, cfg.markMaxes) : null;
                              const band = bandForPercent(pct, cfg.bands);
                              return (
                                <tr key={subject} className="hover:bg-gray-50">
                                  <td className="px-4 py-2.5 font-medium text-gray-800 text-sm">{subject}</td>
                                  {markNames.map(name => (
                                    <td key={name} className="px-2 py-2.5 text-center">
                                      <MarkBadge value={g ? getMarkValue(g, name) : null} />
                                    </td>
                                  ))}
                                  <td className="px-2 py-2.5 text-center">
                                    {!g ? <span className="text-gray-300">—</span> : (
                                      <div className="flex flex-col items-center gap-1">
                                        {showPct && (pct != null && pct !== 0 ? <MarkBadge value={pct} /> : (!showGpa && <span className="text-gray-300">—</span>))}
                                        {showGpa && (band ? <LetterBadge letter={band.letter} /> : (!showPct && <span className="text-gray-300">—</span>))}
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 border-gray-200 bg-gray-50">
                              <td className="px-4 py-2.5 font-semibold text-gray-700 text-xs uppercase tracking-wide"
                                colSpan={markNames.length + 1}>
                                {t('grades.term_average')}
                              </td>
                              <td className="px-2 py-2.5 text-center">
                                <div className="flex flex-col items-center gap-1">
                                  {showPct && (termAvgs[ti] != null && termAvgs[ti] !== 0 ? <MarkBadge value={termAvgs[ti]} /> : (!showGpa && <span className="text-gray-300">—</span>))}
                                  {showGpa && <LetterBadge letter={letterOf(termAvgs[ti])} />}
                                </div>
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                      );
                    })}
                  </div>
                </div>

                {/* Year summary — Round One (originals) and, when the student
                    sat retakes, Round Two side-by-side (REMEDIAL_TERM_PLAN P4). */}
                {(terms.length > 1 || anyRoundTwo) && (
                  <div className="border-t border-gray-200 px-4 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        {t('grades.year_summary')}
                      </p>
                      {canDlRoundTwo && (
                        <button
                          onClick={() => downloadCard(`${yr}|round2`, rawYearForDl, remedialTermName)}
                          disabled={dl === `${yr}|round2`}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 hover:text-primary-900 disabled:opacity-50"
                        >
                          <Download className="w-3.5 h-3.5" />
                          {t('grades.round_two_card', 'Round Two card')}
                        </button>
                      )}
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-500">
                          <th className="text-left py-1.5 font-medium">{t('grades.subject')}</th>
                          <th className="text-center py-1.5 font-medium">{t('grades.round_one')}</th>
                          {anyRoundTwo && <th className="text-center py-1.5 font-medium">{t('grades.round_two')}</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {yearRows.map(row => (
                          <tr key={row.subject}>
                            <td className="py-1.5 font-medium text-gray-800">{row.subject}</td>
                            <td className="py-1.5 text-center">
                              {row.roundOne == null ? <span className="text-gray-300">—</span> : (
                                <span className={`font-semibold ${(row.roundOneEffective ?? row.roundOne) < passMark ? 'text-red-600' : 'text-gray-800'}`}>
                                  {fmtWithLetter(row.roundOneEffective ?? row.roundOne, showPct, showGpa, letterOf)}
                                  {row.roundOneCredit > 0 && (
                                    <span className="text-violet-600"> (+{row.roundOneCredit})</span>
                                  )}
                                </span>
                              )}
                            </td>
                            {anyRoundTwo && (
                              <td className="py-1.5 text-center">
                                {!row.satRemedial ? <span className="text-gray-300">—</span> : row.final == null ? <span className="text-gray-300">—</span> : (
                                  <span className={`font-semibold ${(row.finalEffective ?? row.final) < passMark ? 'text-red-600' : 'text-emerald-700'}`}>
                                    {fmtWithLetter(row.finalEffective ?? row.final, showPct, showGpa, letterOf)}
                                    {row.finalCredit > 0 && (
                                      <span className="text-violet-600"> (+{row.finalCredit})</span>
                                    )}
                                  </span>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {appliedCredits.length > 0 && (
                      <p className="mt-2 text-xs text-violet-700 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
                        {t('grades.support_marks', 'Support marks')}{' — '}
                        {(['round1', 'round2'] as const)
                          .map(round => {
                            const list = appliedCredits.filter(c => c.round === round);
                            if (list.length === 0) return null;
                            const label = round === 'round1' ? t('grades.round_one_short', 'Round One') : t('grades.round_two_short', 'Round Two');
                            return `${label}: ${list.map(c => `${c.subject} +${c.amount}`).join(' · ')}`;
                          })
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    )}
                    {anyRoundTwo && (
                      <div className="mt-2 space-y-1">
                        {yearRows.flatMap(row => row.retakes.map(r => (
                          <p key={r.id} className="text-xs text-gray-500">
                            {row.subject} · {t('grades.retake_of', { term: r.forPeriod })}: {r.examValue ?? '—'}
                            {r.carryName ? ` + ${r.carryName} ${r.carryValue}` : ''}
                            {r.examValue != null ? ` = ${remedialTotal(r.examValue, r.carryValue)}` : ''}
                          </p>
                        )))}
                      </div>
                    )}
                  </div>
                )}

                {notes.length > 0 && (
                  <div className="border-t border-gray-200 px-4 py-3 space-y-2">
                    {notes.map((n, i) => (
                      <div key={i} className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                        <p className="text-xs font-semibold text-amber-700 mb-0.5">
                          {t('grades.school_note')} · {n.subject} · {n.term}
                        </p>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{n.note}</p>
                      </div>
                    ))}
                  </div>
                )}

                <div className="border-t-2 border-gray-200 px-4 py-3 bg-gray-50 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-700">
                    {t('grades.year_average')}
                  </span>
                  <div className="flex items-center gap-2">
                    {overallYearAvg != null && overallYearAvg !== 0
                      ? <MarkBadge value={overallYearAvg} />
                      : (!showGpa && <span className="text-gray-300 text-sm">—</span>)}
                    {showGpa && <LetterBadge letter={letterOf(overallYearAvg)} />}
                  </div>
                </div>
              </Card>
            );
          })}
        </>
        )}
      </div>
    </PageLayout>
  );
}

// Trim and title-case so "Term 1", "term 1", and "TERM 1" collapse to a
// single canonical label — without this, case-different period or subject
// values render as duplicate sections.
function canonicalLabel(s: string | null | undefined): string {
  if (!s) return '';
  return s.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

// Mean of subjectPercent across the term's subjects — the SAME number the
// report-card PDF prints (audit M-3): normalized percents, zeros counted,
// subjects with no grade skipped.
function termAverage(subjects: string[], termData: Record<string, Grade>, markMaxes: Record<string, number>): number | null {
  const percents = subjects
    .map(s => termData[s] ? subjectPercent(termData[s], markMaxes) : null)
    .filter((p): p is number => p != null);
  return averagePercent(percents);
}

// Insertion-order preserving set of strings
class LinkedSet {
  private map = new Map<string, true>();
  add(v: string) { this.map.set(v, true); }
  values(): string[] { return Array.from(this.map.keys()); }
}

// A letter derived from a percent average — pure presentation, no grade
// points (M-3b decision 16/20).
function LetterBadge({ letter }: { letter?: string | null }) {
  if (!letter) return <span className="text-gray-300">—</span>;
  return (
    <span className="inline-block px-2 py-0.5 rounded-lg text-sm font-semibold text-violet-700 bg-violet-50">
      {letter}
    </span>
  );
}

// "88.4 (B+)" in both mode, "88.4" in scale mode, "B+" in letters-only mode.
function fmtWithLetter(
  value: number,
  showPct: boolean,
  showGpa: boolean,
  letterOf: (v: number | null) => string | null,
): string {
  // Banding uses the near-exact value; display FLOORS to 1 dp so a failing
  // 49.96 can never print as 50 (CREDIT_MARKS_PLAN.md decision 5).
  const letter = showGpa ? letterOf(value) : null;
  const shown = displayPercent(value);
  if (showPct && letter) return `${shown} (${letter})`;
  if (showPct) return String(shown);
  return letter ?? String(shown);
}

function MarkBadge({ value }: { value?: number | null }) {
  if (value == null || value === 0) return <span className="text-gray-300">—</span>;
  const color = value >= 90 ? 'text-green-700 bg-green-50'
    : value >= 75 ? 'text-blue-700 bg-blue-50'
    : value >= 60 ? 'text-amber-700 bg-amber-50'
    : 'text-red-700 bg-red-50';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-lg text-sm font-semibold ${color}`}>
      {displayPercent(value)}
    </span>
  );
}
