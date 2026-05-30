import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { Search, Archive, FileText, Download, RotateCcw } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { toast } from 'react-toastify';
import { adminApi } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import Modal from '../../components/common/Modal';
import type { Class } from '../../types';
import { getMarkValue, gradeTotal, collectMarkNames, type GradeLike } from '../../utils/marks';

// Same grade-map builder used in GraduatedStudentsTab
function buildGradeMap(grades: any[]): Record<string, Record<string, Record<string, any>>> {
  const map: Record<string, Record<string, Record<string, any>>> = {};
  for (const g of grades) {
    const year   = g.academicYear  || 'Unknown Year';
    const period = g.gradingPeriod || 'Unknown Term';
    if (!map[year]) map[year] = {};
    if (!map[year][period]) map[year][period] = {};
    map[year][period][g.subject] = g;
  }
  return map;
}

// values are i18n keys, resolved with t() at render
const REASON_LABEL: Record<string, string> = {
  transferred: 'admin.arch_students.reason_transferred',
  withdrew: 'admin.arch_students.reason_withdrew',
};
const REASON_COLOR: Record<string, string> = {
  transferred: 'bg-blue-100 text-blue-700',
  withdrew:    'bg-amber-100 text-amber-700',
};

// Color treatment for enrollment status pills (migration 030).
const STATUS_PILL: Record<string, string> = {
  enrolled:    'bg-sky-50 text-sky-700',
  promoted:    'bg-emerald-50 text-emerald-700',
  retained:    'bg-amber-50 text-amber-700',
  on_leave:    'bg-violet-50 text-violet-700',
  withdrew:    'bg-gray-100 text-gray-600',
  transferred: 'bg-blue-50 text-blue-700',
  graduated:   'bg-purple-50 text-purple-700',
};

// Human-readable label fallback when the i18n key isn't translated yet.
function defaultStatusLabel(status: string): string {
  switch (status) {
    case 'enrolled':    return 'Enrolled';
    case 'promoted':    return 'Promoted';
    case 'retained':    return 'Retained';
    case 'on_leave':    return 'On leave';
    case 'withdrew':    return 'Withdrew';
    case 'transferred': return 'Transferred';
    case 'graduated':   return 'Graduated';
    default:            return status;
  }
}

export default function ArchivedStudentsTab() {
  const { t } = useTranslation();
  const [students, setStudents]     = useState<any[]>([]);
  const [classes, setClasses]       = useState<Class[]>([]);
  const [classFilter, setClassFilter] = useState('');
  const [search, setSearch]         = useState('');
  const [reasonFilter, setReasonFilter] = useState('');
  const [loading, setLoading]       = useState(false);
  const [restoring, setRestoring]   = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail]         = useState<any | null>(null);

  const debouncedSearch = useDebounce(search, 400);

  useEffect(() => {
    adminApi.getClasses().then(r => setClasses(r.data || []));
  }, []);

  const selectedClassName = classes.find(c => c.id === classFilter)?.name;
  // Filter by class membership at any point in the student's progression.
  // Prefer the new enrollment_history entries; fall back to the legacy
  // classes_attended JSONB for pre-backfill archives.
  const filtered = classFilter
    ? students.filter(s => {
        const history: any[] = Array.isArray(s.enrollmentHistory) ? s.enrollmentHistory : [];
        if (history.length > 0) {
          return history.some(e =>
            e.classId ? e.classId === classFilter : e.className === selectedClassName);
        }
        const legacy: any[] = Array.isArray(s.classesAttended) ? s.classesAttended : [];
        return legacy.some(c =>
          c.classId ? c.classId === classFilter : c.className === selectedClassName);
      })
    : students;

  const load = useCallback(() => {
    setLoading(true);
    adminApi.getArchivedStudents({ search: debouncedSearch || undefined, reason: reasonFilter || undefined })
      .then(r => setStudents(r.data || []))
      .finally(() => setLoading(false));
  }, [debouncedSearch, reasonFilter]);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (id: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      const r = await adminApi.getArchivedStudent(id);
      setDetail(r.data);
    } finally {
      setDetailLoading(false);
    }
  };

  const exportRecord = async () => {
    if (!detail) return;
    try {
      const r = await adminApi.exportArchivedStudentPdf(detail.id, i18n.language || 'en');
      const url = URL.createObjectURL(r.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `archived-student-${(detail.fullName || 'student').replace(/[^a-z0-9-_]+/gi, '_')}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('admin.arch_students.failed_export'));
    }
  };

  const restore = async () => {
    if (!detail) return;
    if (!confirm(t('admin.arch_students.confirm_restore', { name: detail.fullName }))) return;
    setRestoring(true);
    try {
      const r = await adminApi.restoreArchivedStudent(detail.id);
      toast.success(t('admin.arch_students.restored', { name: detail.fullName, relinked: r.data?.parentRelinked ? t('admin.arch_students.parent_relinked') : '' }), { autoClose: 8000 });
      setDetailOpen(false);
      setDetail(null);
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('admin.arch_students.failed_restore'));
    } finally { setRestoring(false); }
  };

  const gradeMap     = detail ? buildGradeMap(detail.grades || []) : {};
  const academicYears = Object.keys(gradeMap).sort();

  // Academic progression — prefer enrollment_history (migration 030);
  // fall back to synthesising from the legacy classes_attended JSONB for
  // pre-backfill archives so the UI still shows what it can.
  const progression: Array<{
    academicYear: string;
    gradeLevel: string;
    className: string | null;
    status: string;
  }> = (() => {
    const history: any[] = Array.isArray(detail?.enrollmentHistory) ? detail.enrollmentHistory : [];
    if (history.length > 0) {
      return history
        .map(e => ({
          academicYear: String(e.academicYear),
          gradeLevel: String(e.gradeLevel || '—'),
          className: e.className ?? null,
          status: String(e.status || 'enrolled'),
        }))
        .sort((a, b) => a.academicYear.localeCompare(b.academicYear));
    }
    const legacy: any[] = Array.isArray(detail?.classesAttended) ? detail.classesAttended : [];
    return legacy
      .filter(c => c?.year)
      .sort((a, b) => String(a.year).localeCompare(String(b.year)))
      .map(c => ({
        academicYear: String(c.year),
        gradeLevel: c.className ? String(c.className) : '—',
        className: c.className ?? null,
        status: 'enrolled',
      }));
  })();

  const fmt = (d?: string) => d ? format(parseISO(d), 'MMM d, yyyy') : '—';

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-48">
          <Input
            placeholder={t('admin.arch_students.search_ph')}
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
        <div className="w-44">
          <Select
            options={[
              { value: 'transferred', label: t('admin.arch_students.reason_transferred') },
              { value: 'withdrew', label: t('admin.arch_students.reason_withdrew') },
              { value: 'graduated', label: t('admin.arch_students.reason_graduated') },
            ]}
            placeholder={t('admin.arch_students.all_reasons')}
            value={reasonFilter}
            onChange={e => setReasonFilter(e.target.value)}
          />
        </div>
        {!loading && (
          <span className="text-sm text-gray-400">
            {t('admin.arch_students.records_count', { count: filtered.length })}
          </span>
        )}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex justify-center py-16"><LoadingSpinner /></div>
      ) : filtered.length === 0 ? (
        <Card className="text-center py-16">
          <Archive className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">
            {classFilter ? t('admin.arch_students.none_in_class') : t('admin.arch_students.none')}
          </p>
          <p className="text-xs text-gray-400 mt-1">{t('admin.arch_students.none_hint')}</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(s => (
            <button key={s.id} onClick={() => openDetail(s.id)} className="text-left w-full">
              <Card className="hover:shadow-md hover:border-primary-200 transition-all cursor-pointer h-full">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-slate-600 font-bold text-sm">{s.fullName?.[0]}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-900 truncate">{s.fullName}</p>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${REASON_COLOR[s.reason] || 'bg-gray-100 text-gray-600'}`}>
                        {REASON_LABEL[s.reason] ? t(REASON_LABEL[s.reason]) : s.reason}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{t('admin.arch_students.left')}: {fmt(s.departureDate)}</p>
                    {s.parentFullName && (
                      <p className="text-xs text-gray-400 truncate mt-0.5">
                        {s.parentFullName}{s.parentPhone ? ` · ${s.parentPhone}` : ''}
                      </p>
                    )}
                  </div>
                  <FileText className="w-4 h-4 text-gray-300 flex-shrink-0 mt-1" />
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}

      {/* Detail Modal */}
      <Modal
        isOpen={detailOpen}
        onClose={() => { setDetailOpen(false); setDetail(null); }}
        title={t('admin.arch_students.record_title')}
        size="lg"
      >
        {detailLoading ? (
          <div className="flex justify-center py-10"><LoadingSpinner /></div>
        ) : detail ? (
          <div className="space-y-6">

            {/* Header */}
            <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
              <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-slate-600 font-bold text-lg">{detail.fullName?.[0]}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-bold text-gray-900 text-lg">{detail.fullName}</p>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${REASON_COLOR[detail.reason] || 'bg-gray-100 text-gray-600'}`}>
                    {REASON_LABEL[detail.reason] ? t(REASON_LABEL[detail.reason]) : detail.reason}
                  </span>
                </div>
              </div>
            </div>

            {/* Personal info + classes side by side */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {/* Personal info */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('admin.arch_students.personal_info')}</p>
                <dl className="space-y-2">
                  <InfoRow label={t('admin.arch_students.date_of_birth')}   value={fmt(detail.dateOfBirth)} />
                  <InfoRow label={t('admin.arch_students.enrolled')}         value={fmt(detail.enrollmentDate)} />
                  <InfoRow label={t('admin.arch_students.left_school')}      value={fmt(detail.departureDate)} />
                  <InfoRow label={t('admin.arch_students.parent_guardian')} value={detail.parentFullName || '—'} />
                  <InfoRow label={t('admin.arch_students.parent_phone')}     value={detail.parentPhone || '—'} />
                  <InfoRow label={t('admin.arch_students.archived_by')}      value={detail.archivedByName ? `${detail.archivedByName}${detail.archivedByRole ? ` (${detail.archivedByRole})` : ''}` : '—'} />
                </dl>
              </div>

              {/* Academic progression (migration 030) */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('admin.arch_students.academic_progression', 'Academic progression')}</p>
                {progression.length === 0 ? (
                  <p className="text-sm text-gray-400">{t('admin.arch_students.no_progression', 'No progression recorded.')}</p>
                ) : (
                  <div className="space-y-2">
                    {progression.map(row => (
                      <div key={row.academicYear} className="flex items-start gap-2">
                        <span className="text-xs font-medium text-gray-500 w-24 shrink-0 pt-0.5">{row.academicYear}</span>
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="text-xs font-medium text-gray-900">{row.gradeLevel}</span>
                          {row.className && (
                            <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">{row.className}</span>
                          )}
                          <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_PILL[row.status] || 'bg-gray-100 text-gray-600'}`}>
                            {t(`admin.arch_students.status_${row.status}`, defaultStatusLabel(row.status))}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Grades */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">{t('admin.arch_students.academic_grades')}</p>
              {academicYears.length === 0 ? (
                <p className="text-sm text-gray-400">{t('admin.arch_students.no_grades')}</p>
              ) : (
                <div className="space-y-8">
                  {academicYears.map(year => {
                    const periodMap = gradeMap[year];
                    const periods   = Object.keys(periodMap).sort();

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

            <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
              <button
                onClick={exportRecord}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                <Download className="w-4 h-4" /> {t('admin.arch_students.download_pdf', 'Download PDF')}
              </button>
              <button
                onClick={restore}
                disabled={restoring}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60"
              >
                <RotateCcw className="w-4 h-4" /> {restoring ? t('admin.arch_students.restoring') : t('admin.arch_students.restore')}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <dt className="text-xs text-gray-400 w-28 shrink-0 pt-0.5">{label}</dt>
      <dd className="text-sm text-gray-800 font-medium">{value}</dd>
    </div>
  );
}
