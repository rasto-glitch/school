import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Search, User, FileText, Star, Share2, Lock, History, CalendarDays } from 'lucide-react';
import { teacherApi } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import { useAuthStore } from '../../store/authStore';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import Modal from '../../components/common/Modal';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import HealthSafetyPanel, { type StudentHealthBrief } from '../../components/common/HealthSafetyPanel';
import type { Student, Class, Report, Grade, Mark } from '../../types';

// PR 2 — the teacher's per-student view shifts from "only my work" to
// the broader handoff view via /teacher/students/:id/history. Reports
// carry an _origin tag so we know which row is the teacher's own
// (always present) vs Tier-A same-subject vs cross-subject shared.
interface ReportWithOrigin extends Report {
  _origin?: 'own' | 'tier_a' | 'shared';
}
interface EnrollmentEntry {
  academicYear: string;
  gradeLevel: string;
  classId: string | null;
  className: string | null;
  status: string;
  startedOn: string | null;
  endedOn: string | null;
}
interface StudentHistory {
  student: Student & { dateOfBirth?: string; homeAddress?: string };
  handoffEnabled: boolean;
  reports: ReportWithOrigin[];
  grades: Grade[];
  enrollmentHistory: EnrollmentEntry[];
  health?: StudentHealthBrief | null;
}

function totalMarks(marks?: Mark[] | null): number {
  return (marks || []).reduce((s, m) => s + (Number(m.value) || 0), 0);
}

// Group reports by academic year, falling back to "—" for legacy rows
// that pre-date migration 041 (shouldn't exist on a clean install, but
// the UI shouldn't crash if any do).
function groupReportsByYear(reports: ReportWithOrigin[]): Array<{ year: string; rows: ReportWithOrigin[] }> {
  const byYear = new Map<string, ReportWithOrigin[]>();
  for (const r of reports) {
    const key = r.academicYear || '—';
    const arr = byYear.get(key) ?? [];
    arr.push(r);
    byYear.set(key, arr);
  }
  return Array.from(byYear.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([year, rows]) => ({ year, rows }));
}

function groupGradesByYear(grades: Grade[]): Array<{ year: string; rows: Grade[] }> {
  const byYear = new Map<string, Grade[]>();
  for (const g of grades) {
    const key = g.academicYear || '—';
    const arr = byYear.get(key) ?? [];
    arr.push(g);
    byYear.set(key, arr);
  }
  return Array.from(byYear.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([year, rows]) => ({ year, rows }));
}

export default function StudentsPage() {
  const { t } = useTranslation();
  const handoffEnabled = useAuthStore(s => s.school?.features?.teacher_report_handoff !== false);
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<StudentHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [yearFilter, setYearFilter] = useState<string>('');
  // Per-report sharing-in-flight set, so we can disable the toggle while the
  // PATCH is pending without blocking the rest of the UI.
  const [pendingShareIds, setPendingShareIds] = useState<Set<string>>(new Set());
  const debouncedSearch = useDebounce(search, 400);

  useEffect(() => { teacherApi.getClasses().then(r => setClasses(r.data || [])); }, []);

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (debouncedSearch) params.search = debouncedSearch;
    if (classFilter) params.classId = classFilter;
    teacherApi.getStudents(params).then(r => setStudents(r.data || [])).finally(() => setLoading(false));
  }, [debouncedSearch, classFilter]);

  useEffect(() => {
    if (!selectedId) { setHistory(null); setYearFilter(''); return; }
    setHistoryLoading(true);
    setHistory(null);
    teacherApi.getStudentHistory(selectedId)
      .then(r => setHistory(r.data))
      .catch(() => setHistory(null))
      .finally(() => setHistoryLoading(false));
  }, [selectedId]);

  const closeModal = () => { setSelectedId(null); };

  const allYears = useMemo(() => {
    if (!history) return [] as string[];
    const set = new Set<string>();
    history.reports.forEach(r => r.academicYear && set.add(r.academicYear));
    history.grades.forEach(g => g.academicYear && set.add(g.academicYear));
    history.enrollmentHistory.forEach(e => e.academicYear && set.add(e.academicYear));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [history]);

  const reportsByYear = useMemo(() => {
    if (!history) return [];
    const filtered = yearFilter ? history.reports.filter(r => r.academicYear === yearFilter) : history.reports;
    return groupReportsByYear(filtered);
  }, [history, yearFilter]);

  const gradesByYear = useMemo(() => {
    if (!history) return [];
    const filtered = yearFilter ? history.grades.filter(g => g.academicYear === yearFilter) : history.grades;
    return groupGradesByYear(filtered);
  }, [history, yearFilter]);

  // Origin-aware label for a single report.
  const reportBadge = (r: ReportWithOrigin) => {
    if (r._origin === 'own') return null; // own reports don't need a badge
    if (r._origin === 'tier_a') {
      return (
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-700">
          {t('teacher.history_tier_a_badge', { teacher: r.teacherNameSnapshot || '—' })}
        </span>
      );
    }
    if (r._origin === 'shared') {
      return (
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 inline-flex items-center gap-1">
          <Share2 className="w-2.5 h-2.5" />
          {t('teacher.history_shared_badge', { teacher: r.teacherNameSnapshot || '—', subject: r.subject })}
        </span>
      );
    }
    return null;
  };

  const onToggleShare = async (r: ReportWithOrigin, next: boolean) => {
    if (r._origin !== 'own') return;
    setPendingShareIds(prev => new Set(prev).add(r.id));
    try {
      const resp = await teacherApi.setReportShare(r.id, next);
      const after = Boolean(resp.data?.sharedWithOtherTeachers);
      setHistory(h => h ? {
        ...h,
        reports: h.reports.map(x => x.id === r.id ? { ...x, sharedWithOtherTeachers: after } : x),
      } : h);
      toast.success(after ? t('teacher.share_toggled_on') : t('teacher.share_toggled_off'));
    } catch (e: any) {
      toast.error(e?.response?.data?.error || t('teacher.share_toggle_failed'));
    } finally {
      setPendingShareIds(prev => {
        const n = new Set(prev); n.delete(r.id); return n;
      });
    }
  };

  return (
    <PageLayout title={t('nav.students')} subtitle={t('teacher.students_subtitle')}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-48">
            <Input placeholder={t('teacher.search_students')} icon={<Search className="w-4 h-4" />} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="w-48">
            <Select options={classes.map(c => ({ value: c.id, label: c.name }))} placeholder={t('common.all_classes')} value={classFilter} onChange={e => setClassFilter(e.target.value)} />
          </div>
        </div>

        {loading ? <LoadingSpinner /> : students.length === 0 ? (
          <EmptyState title={t('teacher.no_students_found')} icon={<User className="w-8 h-8 text-gray-400" />} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {students.map(s => (
              <Card key={s.id} hover onClick={() => setSelectedId(s.id)}>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                    {s.profilePicture ? (
                      <img src={s.profilePicture} alt="" className="w-12 h-12 rounded-full object-cover" />
                    ) : (
                      <span className="text-primary-700 font-bold">{s.fullName[0]}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{s.fullName}</p>
                    <p className="text-xs text-gray-500">{s.classes?.name || t('common.no_class')}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Student detail modal — now shows the broader handoff history */}
      <Modal isOpen={!!selectedId} onClose={closeModal} title={history?.student.fullName} size="lg">
        {historyLoading ? (
          <LoadingSpinner />
        ) : history && (
          <div className="space-y-5">
            {/* Basic info — no parent phone */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-gray-500">{t('common.class')}:</span> <span className="font-medium">{history.student.classes?.name || '—'}</span></div>
              <div><span className="text-gray-500">{t('teacher.phone_label')}</span> <span className="font-medium">{history.student.phoneNumber || '—'}</span></div>
              <div><span className="text-gray-500">{t('teacher.emergency_label')}</span> <span className="font-medium">{history.student.emergencyContact || '—'}</span></div>
              <div><span className="text-gray-500">{t('common.address')}:</span> <span className="font-medium">{history.student.homeAddress || '—'}</span></div>
            </div>

            <HealthSafetyPanel health={history.health} />

            {/* Year filter for the entire history view */}
            {allYears.length > 1 && (
              <div className="flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-gray-400" />
                <select
                  className="text-sm border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  value={yearFilter}
                  onChange={e => setYearFilter(e.target.value)}
                >
                  <option value="">{t('teacher.history_all_years')}</option>
                  {allYears.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            )}

            {/* Enrollment timeline */}
            {history.enrollmentHistory.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <History className="w-4 h-4 text-indigo-600" />
                  <h3 className="font-semibold text-gray-900">{t('teacher.history_progression_title')}</h3>
                </div>
                <div className="space-y-1.5">
                  {history.enrollmentHistory
                    .filter(e => !yearFilter || e.academicYear === yearFilter)
                    .map(e => (
                      <div key={e.academicYear} className="flex items-center gap-2 text-xs">
                        <span className="font-medium text-gray-700 w-24">{e.academicYear}</span>
                        <span className="text-gray-600">{e.className || e.gradeLevel}</span>
                        <span className="ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                          {t(`teacher.history_status_${e.status}`, e.status)}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Grades — released, all teachers (history endpoint already filters) */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Star className="w-4 h-4 text-amber-500" />
                <h3 className="font-semibold text-gray-900">{t('grades.title')}</h3>
                <span className="text-xs text-gray-400">({history.grades.length})</span>
              </div>
              {gradesByYear.length === 0 ? (
                <p className="text-sm text-gray-400">{t('teacher.no_grades')}</p>
              ) : (
                <div className="space-y-3">
                  {gradesByYear.map(({ year, rows }) => (
                    <div key={year}>
                      <p className="text-xs font-semibold text-gray-500 mb-1">{year}</p>
                      <div className="space-y-2">
                        {rows.map(g => {
                          const tot = totalMarks(g.marks);
                          return (
                            <div key={g.id} className="bg-gray-50 rounded-xl p-3">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-medium text-gray-700">
                                  {g.subject}
                                  {g.gradingPeriod && <span className="text-xs text-gray-400 ml-2">{g.gradingPeriod}</span>}
                                </span>
                                {tot > 0 && (
                                  <span className="text-sm font-bold text-primary-600">{tot.toFixed(1)}</span>
                                )}
                              </div>
                              {(g.marks || []).length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                  {(g.marks || []).map((m, i) => (
                                    <div key={i} className="bg-white border border-gray-200 rounded-lg px-2 py-0.5 text-xs">
                                      <span className="text-gray-500">{m.name}: </span>
                                      <span className="font-semibold text-gray-800">{m.value}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Reports — Tier A + shared + own; share toggle on own */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <FileText className="w-4 h-4 text-purple-600" />
                <h3 className="font-semibold text-gray-900">{t('reports.title')}</h3>
                <span className="text-xs text-gray-400">({history.reports.length})</span>
              </div>
              {reportsByYear.length === 0 ? (
                <p className="text-sm text-gray-400">{t('teacher.no_reports')}</p>
              ) : (
                <div className="space-y-3">
                  {reportsByYear.map(({ year, rows }) => (
                    <div key={year}>
                      <p className="text-xs font-semibold text-gray-500 mb-1">{year}</p>
                      <div className="space-y-2">
                        {rows.map(r => {
                          const isOwn = r._origin === 'own';
                          const sharing = pendingShareIds.has(r.id);
                          return (
                            <div key={r.id} className="bg-gray-50 rounded-xl p-3 text-sm">
                              <div className="flex justify-between mb-1 gap-2 flex-wrap">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium text-gray-700">{r.subject}</span>
                                  {reportBadge(r)}
                                </div>
                                <span className="text-xs text-gray-400">{r.reportDate || (r.createdAt || '').slice(0, 10)}</span>
                              </div>
                              {(r.marks || []).length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mb-1.5">
                                  {(r.marks || []).map((m, i) => (
                                    <div key={i} className="bg-white border border-gray-200 rounded-lg px-2 py-0.5 text-xs">
                                      <span className="text-gray-500">{m.name}: </span>
                                      <span className="font-semibold text-gray-800">{m.value}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {r.attendanceNotes && <p className="text-xs text-gray-600 mt-1"><span className="text-gray-400">{t('reports.attendance')}:</span> {r.attendanceNotes}</p>}
                              {r.behaviorNotes && <p className="text-xs text-gray-600 mt-1"><span className="text-gray-400">{t('reports.behavior')}:</span> {r.behaviorNotes}</p>}
                              {r.teacherNotes && <p className="text-xs text-gray-600 mt-1">{r.teacherNotes}</p>}
                              {isOwn && handoffEnabled && (
                                <button
                                  type="button"
                                  disabled={sharing}
                                  onClick={() => onToggleShare(r, !r.sharedWithOtherTeachers)}
                                  className="inline-flex items-center gap-1.5 mt-2 text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-60"
                                  title={r.sharedWithOtherTeachers ? t('teacher.share_unshare_title') : t('teacher.share_share_title')}
                                >
                                  {r.sharedWithOtherTeachers ? (
                                    <>
                                      <Share2 className="w-3.5 h-3.5 text-emerald-600" />
                                      <span>{t('teacher.share_currently_shared')}</span>
                                    </>
                                  ) : (
                                    <>
                                      <Lock className="w-3.5 h-3.5 text-gray-400" />
                                      <span>{t('teacher.share_currently_private')}</span>
                                    </>
                                  )}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {!history.handoffEnabled && (
                <p className="text-xs text-gray-400 mt-3">{t('teacher.handoff_off_notice')}</p>
              )}
            </div>
          </div>
        )}
      </Modal>
    </PageLayout>
  );
}
