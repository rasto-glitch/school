import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, GraduationCap, FileText } from 'lucide-react';
import { adminApi } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import Modal from '../../components/common/Modal';
import type { Class } from '../../types';
import { getMarkValue, gradeTotal, collectMarkNames, type GradeLike } from '../../utils/marks';

// 3-level map: { academicYear → { gradingPeriod → { subjectName → gradeRecord } } }
function buildGradeMap(grades: any[]): Record<string, Record<string, Record<string, any>>> {
  const map: Record<string, Record<string, Record<string, any>>> = {};
  for (const g of grades) {
    const year   = g.academicYear   || 'Unknown Year';
    const period = g.gradingPeriod  || 'Unknown Term';
    if (!map[year]) map[year] = {};
    if (!map[year][period]) map[year][period] = {};
    map[year][period][g.subject] = g;
  }
  return map;
}

export default function GraduatedStudentsTab() {
  const { t } = useTranslation();
  const [students, setStudents] = useState<any[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [classFilter, setClassFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcript, setTranscript] = useState<{ student: any; grades: any[] } | null>(null);

  const debouncedSearch = useDebounce(search, 400);

  useEffect(() => {
    adminApi.getClasses().then(r => setClasses(r.data || []));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    adminApi.getGraduatedStudents(debouncedSearch || undefined)
      .then(r => setStudents(r.data || []))
      .finally(() => setLoading(false));
  }, [debouncedSearch]);

  useEffect(() => { load(); }, [load]);

  const filtered = classFilter ? students.filter(s => s.classId === classFilter) : students;

  const openTranscript = async (id: string) => {
    setTranscriptOpen(true);
    setTranscriptLoading(true);
    setTranscript(null);
    try {
      const r = await adminApi.getStudentBrief(id);
      setTranscript(r.data);
    } finally {
      setTranscriptLoading(false);
    }
  };

  const gradeMap = transcript ? buildGradeMap(transcript.grades) : {};
  const academicYears = Object.keys(gradeMap).sort();

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-48">
          <Input
            placeholder={t('admin.grad_students.search_ph')}
            icon={<Search className="w-4 h-4" />}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="w-48">
          <Select
            options={classes.map(c => ({ value: c.id, label: c.name }))}
            placeholder={t('admin.arch_students.all_classes')}
            value={classFilter}
            onChange={e => setClassFilter(e.target.value)}
          />
        </div>
        {!loading && (
          <span className="text-sm text-gray-400">
            {t('admin.grad_students.students_count', { count: filtered.length })}
          </span>
        )}
      </div>

      {/* Student grid */}
      {loading ? (
        <div className="flex justify-center py-16"><LoadingSpinner /></div>
      ) : filtered.length === 0 ? (
        <Card className="text-center py-16">
          <GraduationCap className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">
            {classFilter ? t('admin.grad_students.none_in_class') : t('admin.grad_students.none_yet')}
          </p>
          <p className="text-xs text-gray-400 mt-1">{t('admin.grad_students.none_hint')}</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(s => (
            <button key={s.id} onClick={() => openTranscript(s.id)} className="text-left w-full">
              <Card className="hover:shadow-md hover:border-primary-200 transition-all cursor-pointer h-full">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-indigo-700 font-bold text-sm">{s.fullName?.[0]}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900 truncate">{s.fullName}</p>
                    <p className="text-xs text-gray-500">{s.classes?.name || t('admin.grad_students.no_class_recorded')}</p>
                    {s.parents?.fullName && (
                      <p className="text-xs text-gray-400 truncate">{t('admin.grad_students.parent_label', { name: s.parents.fullName })}</p>
                    )}
                  </div>
                  <FileText className="w-4 h-4 text-gray-300 flex-shrink-0" />
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}

      {/* Transcript Modal */}
      <Modal
        isOpen={transcriptOpen}
        onClose={() => { setTranscriptOpen(false); setTranscript(null); }}
        title={t('admin.grad_students.transcript_title')}
        size="lg"
      >
        {transcriptLoading ? (
          <div className="flex justify-center py-10"><LoadingSpinner /></div>
        ) : transcript ? (
          <div className="space-y-6">
            {/* Student header */}
            <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
              <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-indigo-700 font-bold text-lg">{transcript.student?.fullName?.[0]}</span>
              </div>
              <div>
                <p className="font-bold text-gray-900 text-lg">{transcript.student?.fullName}</p>
                <p className="text-sm text-gray-500">{transcript.student?.classes?.name || '—'}</p>
                {transcript.student?.parents?.fullName && (
                  <p className="text-xs text-gray-400">{t('admin.grad_students.parent_label', { name: transcript.student.parents.fullName })}</p>
                )}
              </div>
            </div>

            {/* Grades — grouped by academic year */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">{t('admin.arch_students.academic_grades')}</p>
              {academicYears.length === 0 ? (
                <p className="text-sm text-gray-400">{t('admin.arch_students.no_grades')}</p>
              ) : (
                <div className="space-y-8">
                  {academicYears.map(year => {
                    const periodMap = gradeMap[year];
                    const periods = Object.keys(periodMap).sort();

                    const termTotals = periods.map(period => {
                      const termGrades = Object.values(periodMap[period] || {}) as GradeLike[];
                      const markNames = collectMarkNames(termGrades);
                      return termGrades.reduce((sum, g) => sum + gradeTotal(g, markNames), 0);
                    });
                    const yearMark = periods.length
                      ? (termTotals.reduce((a, b) => a + b, 0) / periods.length).toFixed(1)
                      : '—';

                    return (
                      <div key={year}>
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-sm font-bold text-gray-800">{year}</span>
                          <div className="flex-1 h-px bg-gray-200" />
                        </div>

                        <div className="space-y-4">
                          {periods.map(period => {
                            const termBySubject = periodMap[period] || {};
                            const termGrades = Object.values(termBySubject) as GradeLike[];
                            const markNames = collectMarkNames(termGrades);
                            const subjectNames = Object.keys(termBySubject).sort();
                            return (
                              <div key={period}>
                                <p className="text-xs font-semibold text-gray-500 mb-2">{period}</p>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-xs border-collapse">
                                    <thead>
                                      <tr className="bg-gray-50">
                                        <th className="text-left px-3 py-2 font-medium text-gray-500 border border-gray-200">{t('admin.arch_students.subject')}</th>
                                        {markNames.map(n => (
                                          <th key={n} className="text-center px-3 py-2 font-medium text-gray-500 border border-gray-200">{n}</th>
                                        ))}
                                        <th className="text-center px-3 py-2 font-semibold text-indigo-600 border border-gray-200">{t('admin.arch_students.total')}</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {subjectNames.length === 0 ? (
                                        <tr>
                                          <td colSpan={Math.max(2, markNames.length + 2)} className="px-3 py-3 border border-gray-200 text-center text-gray-400">{t('admin.arch_students.no_grades_row')}</td>
                                        </tr>
                                      ) : subjectNames.map(subjectName => {
                                        const g = termBySubject[subjectName] as GradeLike;
                                        return (
                                          <tr key={subjectName} className="hover:bg-gray-50">
                                            <td className="px-3 py-2 border border-gray-200 text-gray-700">{subjectName}</td>
                                            {markNames.map(n => {
                                              const v = getMarkValue(g, n);
                                              return (
                                                <td key={n} className="px-3 py-2 border border-gray-200 text-center font-medium">{v ?? '—'}</td>
                                              );
                                            })}
                                            <td className="px-3 py-2 border border-gray-200 text-center font-semibold text-indigo-600">{gradeTotal(g, markNames)}</td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <div className="mt-3 flex items-center justify-between bg-indigo-50 rounded-xl px-4 py-3">
                          <span className="text-sm text-gray-600">
                            {t('admin.arch_students.full_year_mark', { year, count: periods.length })}
                          </span>
                          <span className="text-xl font-bold text-indigo-600">{yearMark}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        ) : null}
      </Modal>
    </div>
  );
}
