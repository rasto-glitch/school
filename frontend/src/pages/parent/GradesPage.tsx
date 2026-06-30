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
import { getMarkNames, getMarkValue, gradeTotal, subjectPercent, bandForPercent, averageGpa } from '../../utils/marks';
import type { GradingConfig } from '../../utils/marks';

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
  // Grade point for one subject (null if no band matches / no marks).
  const points = (g: Grade) => bandForPercent(subjectPercent(g, cfg.markMaxes), cfg.bands)?.gradePoint ?? null;

  useEffect(() => {
    if (!selectedChild) return;
    setLoading(true);
    setError(false);
    parentApi.getGrades(selectedChild)
      .then(r => setGrades(r.data || []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
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

  // Cumulative GPA across everything on file (equal-weight) — deliberately
  // NOT filtered by the year picker; the cumulative is the lifetime number.
  const cgpa = averageGpa(grades.map(g => points(g)).filter((p): p is number => p != null));

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
          {showGpa && cgpa != null && (
            <Card className="flex items-center justify-between !py-4">
              <div className="flex items-center gap-2">
                <GraduationCap className="w-5 h-5 text-violet-600" />
                <span className="font-semibold text-gray-900">{t('grades.cumulative_gpa')}</span>
              </div>
              <span className="text-2xl font-extrabold text-violet-700">{cgpa.toFixed(2)}</span>
            </Card>
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
            const termAvgs = terms.map(term => termAverage(subjects, byYear[yr][term], markNames));
            const validTermAvgs = termAvgs.filter(a => a > 0);
            const overallYearAvg = validTermAvgs.length === 0 ? 0
              : Math.round((validTermAvgs.reduce((a, b) => a + b, 0) / validTermAvgs.length) * 10) / 10;

            // GPA per term + for the whole year (equal-weight average of points)
            const termGpas = terms.map(term =>
              averageGpa(subjects.map(s => byYear[yr][term][s] ? points(byYear[yr][term][s]) : null)
                .filter((p): p is number => p != null)));
            const yearGpa = averageGpa(terms.flatMap(term =>
              subjects.map(s => byYear[yr][term][s] ? points(byYear[yr][term][s]) : null))
              .filter((p): p is number => p != null));

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
                              const total = g ? gradeTotal(g, markNames) : 0;
                              const band = g ? bandForPercent(subjectPercent(g, cfg.markMaxes), cfg.bands) : null;
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
                                        {showPct && (total > 0 ? <MarkBadge value={total} /> : (!showGpa && <span className="text-gray-300">—</span>))}
                                        {showGpa && (band ? <GpaBadge letter={band.letter} points={band.gradePoint} /> : (!showPct && <span className="text-gray-300">—</span>))}
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
                                  {showPct && (termAvgs[ti] > 0 ? <MarkBadge value={termAvgs[ti]} /> : (!showGpa && <span className="text-gray-300">—</span>))}
                                  {showGpa && <GpaValue value={termGpas[ti]} />}
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
                    {showGpa && !showPct ? t('grades.year_gpa') : t('grades.year_average')}
                  </span>
                  <div className="flex items-center gap-2">
                    {showPct && (overallYearAvg > 0 ? <MarkBadge value={overallYearAvg} /> : (!showGpa && <span className="text-gray-300 text-sm">—</span>))}
                    {showGpa && <GpaValue value={yearGpa} />}
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

function termAverage(subjects: string[], termData: Record<string, Grade>, markNames: string[]): number {
  const totals = subjects.map(s => termData[s] ? gradeTotal(termData[s], markNames) : 0).filter(t => t > 0);
  if (totals.length === 0) return 0;
  return Math.round((totals.reduce((a, b) => a + b, 0) / totals.length) * 10) / 10;
}

// Insertion-order preserving set of strings
class LinkedSet {
  private map = new Map<string, true>();
  add(v: string) { this.map.set(v, true); }
  values(): string[] { return Array.from(this.map.keys()); }
}

// Subject GPA: letter + grade point, e.g. "A (4.0)".
function GpaBadge({ letter, points }: { letter: string; points: number }) {
  return (
    <span className="inline-block px-2 py-0.5 rounded-lg text-sm font-semibold text-violet-700 bg-violet-50">
      {letter} ({points.toFixed(1)})
    </span>
  );
}

// An averaged GPA value (term / year), e.g. "3.50".
function GpaValue({ value }: { value?: number | null }) {
  if (value == null) return <span className="text-gray-300">—</span>;
  return (
    <span className="inline-block px-2 py-0.5 rounded-lg text-sm font-bold text-violet-700 bg-violet-50">
      {value.toFixed(2)}
    </span>
  );
}

function MarkBadge({ value }: { value?: number | null }) {
  if (value == null || value === 0) return <span className="text-gray-300">—</span>;
  const color = value >= 90 ? 'text-green-700 bg-green-50'
    : value >= 75 ? 'text-blue-700 bg-blue-50'
    : value >= 60 ? 'text-amber-700 bg-amber-50'
    : 'text-red-700 bg-red-50';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-lg text-sm font-semibold ${color}`}>
      {value}
    </span>
  );
}
