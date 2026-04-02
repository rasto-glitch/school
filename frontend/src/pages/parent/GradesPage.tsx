import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GraduationCap } from 'lucide-react';
import { parentApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Select from '../../components/common/Select';
import EmptyState from '../../components/common/EmptyState';
import ErrorMessage from '../../components/common/ErrorMessage';
import { GradesTableSkeleton } from '../../components/common/Skeleton';
import type { Student, Grade, Mark } from '../../types';

export default function GradesPage() {
  const { t } = useTranslation();
  const [children, setChildren] = useState<Student[]>([]);
  const [selectedChild, setSelectedChild] = useState('');
  const [grades, setGrades] = useState<Grade[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    parentApi.getChildren().then(r => {
      const kids: Student[] = r.data || [];
      setChildren(kids);
      if (kids.length > 0) setSelectedChild(kids[0].id);
    });
  }, []);

  useEffect(() => {
    if (!selectedChild) return;
    setLoading(true);
    setError(false);
    parentApi.getGrades(selectedChild)
      .then(r => setGrades(r.data || []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [selectedChild, retryKey]);

  // Group: year → term → subject → Grade
  const byYear = grades.reduce((acc, g) => {
    const yr = g.academicYear || 'Current Year';
    const term = g.gradingPeriod || 'Term 1';
    if (!acc[yr]) acc[yr] = {};
    if (!acc[yr][term]) acc[yr][term] = {};
    acc[yr][term][g.subject] = g;
    return acc;
  }, {} as Record<string, Record<string, Record<string, Grade>>>);

  const years = Object.keys(byYear).sort((a, b) => b.localeCompare(a));

  return (
    <PageLayout title={t('grades.title')} subtitle={t('grades.subtitle')}>
      <div className="space-y-6">
        {children.length > 1 && (
          <div className="w-full sm:w-56">
            <Select
              label="Child"
              options={children.map(c => ({ value: c.id, label: c.fullName }))}
              value={selectedChild}
              onChange={e => setSelectedChild(e.target.value)}
            />
          </div>
        )}

        {loading ? <GradesTableSkeleton /> : error ? (
          <ErrorMessage onRetry={() => setRetryKey(k => k + 1)} />
        ) : grades.length === 0 ? (
          <EmptyState title={t('grades.no_grades')} icon={<GraduationCap className="w-8 h-8 text-gray-400" />} />
        ) : (
          years.map(yr => {
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

            // Term averages
            const termAvgs = terms.map(term => termAverage(subjects, byYear[yr][term], markNames));
            const validTermAvgs = termAvgs.filter(a => a > 0);
            const overallYearAvg = validTermAvgs.length === 0 ? 0
              : Math.round((validTermAvgs.reduce((a, b) => a + b, 0) / validTermAvgs.length) * 10) / 10;

            return (
              <Card key={yr} className="p-0 overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                  <h2 className="font-semibold text-gray-900">{yr}</h2>
                </div>

                <div className="overflow-x-auto">
                  <div className="inline-flex gap-0 min-w-full divide-x divide-gray-200">
                    {terms.map((term, ti) => (
                      <div key={term} className="flex-1 min-w-[260px]">
                        <div className="px-4 py-2 bg-primary-50 border-b border-gray-200">
                          <p className="text-xs font-semibold text-primary-700 uppercase tracking-wide">{term}</p>
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
                              return (
                                <tr key={subject} className="hover:bg-gray-50">
                                  <td className="px-4 py-2.5 font-medium text-gray-800 text-sm">{subject}</td>
                                  {markNames.map(name => (
                                    <td key={name} className="px-2 py-2.5 text-center">
                                      <MarkBadge value={g ? getMarkValue(g, name) : null} />
                                    </td>
                                  ))}
                                  <td className="px-2 py-2.5 text-center">
                                    {total > 0 ? <MarkBadge value={total} /> : <span className="text-gray-300">—</span>}
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
                                {termAvgs[ti] > 0
                                  ? <MarkBadge value={termAvgs[ti]} />
                                  : <span className="text-gray-300">—</span>}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t-2 border-gray-200 px-4 py-3 bg-gray-50 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-700">{t('grades.year_average')}</span>
                  {overallYearAvg > 0
                    ? <MarkBadge value={overallYearAvg} />
                    : <span className="text-gray-300 text-sm">—</span>}
                </div>
              </Card>
            );
          })
        )}
      </div>
    </PageLayout>
  );
}

// Collect mark names from a grade, with legacy fallback
function getMarkNames(g: Grade): string[] {
  if (g.marks && g.marks.length > 0) return g.marks.map(m => m.name);
  const legacy: string[] = [];
  if (g.dailyGrade) legacy.push('Daily');
  if (g.quizGrade) legacy.push('Quiz');
  if (g.monthlyExamGrade) legacy.push('Monthly');
  if (g.termExamGrade) legacy.push('Term Exam');
  return legacy;
}

// Get value for a named mark (dynamic or legacy)
function getMarkValue(g: Grade, name: string): number | null {
  if (g.marks && g.marks.length > 0) {
    const m = g.marks.find((m: Mark) => m.name === name);
    return m ? m.value : null;
  }
  // legacy fallback
  if (name === 'Daily') return g.dailyGrade ?? null;
  if (name === 'Quiz') return g.quizGrade ?? null;
  if (name === 'Monthly') return g.monthlyExamGrade ?? null;
  if (name === 'Term Exam') return g.termExamGrade ?? null;
  return null;
}

function gradeTotal(g: Grade, markNames: string[]): number {
  if (g.marks && g.marks.length > 0) {
    return g.marks.reduce((s, m) => s + m.value, 0);
  }
  // legacy fallback — sum only the columns visible in the table
  return markNames.reduce((s, name) => s + (getMarkValue(g, name) || 0), 0);
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
