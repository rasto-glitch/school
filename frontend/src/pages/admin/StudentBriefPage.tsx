import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams, Link } from 'react-router-dom';
import { Search, User, History } from 'lucide-react';
// Transfer wizard hidden until Phase C ships — see FEATURE.md.
// Re-add `Send` to the lucide import, the import below, and the JSX
// `transferOpen` state + button + <TransferWizard /> mount to restore.
// import { Send } from 'lucide-react';
// import TransferWizard from '../../components/admin/TransferWizard';
import { adminApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Select from '../../components/common/Select';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import HealthSafetyPanel, { type StudentHealthBrief } from '../../components/common/HealthSafetyPanel';
import type { Student, Report, Grade } from '../../types';
import { getMarkNames, getMarkValue, gradeTotal } from '../../utils/marks';
import { format, parseISO, differenceInYears } from 'date-fns';

interface EnrollmentHistoryEntry {
  academicYear: string;
  gradeLevel: string;
  classId: string | null;
  className: string | null;
  status: string;
  startedOn: string | null;
  endedOn: string | null;
}

interface ArchivedSnapshot {
  id: string;
  fullName: string;
  dateOfBirth: string | null;
  enrollmentDate: string | null;
  departureDate: string;
  reason: string;
  parentFullName: string | null;
  parentPhone: string | null;
  // Migration 030: prefer enrollmentHistory; classesAttended kept for
  // pre-backfill archives.
  enrollmentHistory?: EnrollmentHistoryEntry[];
  classesAttended?: { year: string; classId: string; className: string }[];
}

export default function StudentBriefPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const archiveEnabled = useAuthStore(s => s.school?.features?.archive === true);
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState(searchParams.get('id') || '');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  const [brief, setBrief] = useState<{ student: any; reports: Report[]; grades: Grade[]; health?: StudentHealthBrief | null } | null>(null);
  const [previousEnrollment, setPreviousEnrollment] = useState<ArchivedSnapshot | null>(null);
  const [search, setSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  // Transfer wizard hidden — see FEATURE.md.
  // const [transferOpen, setTransferOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    adminApi.getAllStudents().then(r => setStudents(r.data?.students || []));
  }, []);

  useEffect(() => {
    if (!selectedStudentId) { setBrief(null); setPreviousEnrollment(null); return; }
    setLoading(true);
    setSelectedYear('');
    setSelectedSubject('');
    setPreviousEnrollment(null);
    adminApi.getStudentBrief(selectedStudentId)
      .then(r => {
        setBrief(r.data);
        const archiveId = r.data?.student?.previousArchiveId;
        if (archiveId) {
          adminApi.getArchivedStudent(archiveId)
            .then(a => setPreviousEnrollment(a.data as ArchivedSnapshot))
            .catch(() => setPreviousEnrollment(null));
        }
      })
      .finally(() => setLoading(false));
  }, [selectedStudentId]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const matchingStudents = search.trim()
    ? students.filter(s => {
        const name = s.fullName || (s as any).full_name || '';
        return name.toLowerCase().includes(search.toLowerCase());
      }).slice(0, 8)
    : [];

  const selectStudent = (id: string, name: string) => {
    setSelectedStudentId(id);
    setSelectedSubject('');
    setSelectedYear('');
    setSearch(name);
    setShowDropdown(false);
  };

  // ---- Grades data ----
  const allGrades = brief?.grades || [];
  const gradeYears = [...new Set(allGrades.map(g => canonicalLabel(g.academicYear)).filter(Boolean))].sort();

  const filteredGrades = selectedYear
    ? allGrades.filter(g => canonicalLabel(g.academicYear) === selectedYear)
    : allGrades;

  // Group by gradingPeriod → grades list. Canonicalize so case variations
  // ("Term 1" vs "term 1") collapse to a single section.
  const gradesByPeriod: Record<string, Grade[]> = {};
  for (const g of filteredGrades) {
    const period = canonicalLabel(g.gradingPeriod) || 'Unknown Term';
    if (!gradesByPeriod[period]) gradesByPeriod[period] = [];
    gradesByPeriod[period].push(g);
  }
  const gradePeriods = Object.keys(gradesByPeriod).sort();

  // Subjects that appear in the filtered grades
  const gradeSubjects = [...new Set(filteredGrades.map(g => canonicalLabel(g.subject)).filter(Boolean))].sort();

  // Discover mark column names from the data — `marks[]` is the source of
  // truth (CLAUDE.md). Fall back to legacy columns only if no marks exist.
  const markNameSet = new Set<string>();
  for (const g of filteredGrades) {
    for (const n of getMarkNames(g)) markNameSet.add(n);
  }
  const markNames = Array.from(markNameSet);

  // Per-term averages (mean of each subject's total within the term).
  const termAverages: Record<string, number> = {};
  for (const p of gradePeriods) {
    const subjectTotals = gradeSubjects
      .map(subj => {
        const g = gradesByPeriod[p].find(r => canonicalLabel(r.subject) === subj);
        return g ? gradeTotal(g, markNames) : 0;
      })
      .filter(t => t > 0);
    termAverages[p] = subjectTotals.length === 0
      ? 0
      : Math.round((subjectTotals.reduce((a, b) => a + b, 0) / subjectTotals.length) * 10) / 10;
  }

  // Full Year Mark: mean of the term averages.
  const validTermAvgs = gradePeriods.map(p => termAverages[p]).filter(a => a > 0);
  const yearMark = validTermAvgs.length === 0
    ? null
    : (validTermAvgs.reduce((a, b) => a + b, 0) / validTermAvgs.length).toFixed(1);

  // ---- Reports data ----
  const subjects = [...new Set(brief?.reports?.map(r => r.subject) || [])];
  const filteredReports = selectedSubject
    ? brief?.reports?.filter(r => r.subject === selectedSubject) || []
    : brief?.reports || [];

  // ---- Student header info ----
  const s = brief?.student;
  const name = s?.fullName || s?.full_name || '—';
  const dob = s?.dateOfBirth || s?.date_of_birth;
  const age = dob ? differenceInYears(new Date(), parseISO(dob)) : null;
  const className = s?.classes?.name || '—';
  const parentId = s?.parents?.id || null;
  const parentName = s?.parents?.fullName || s?.parents?.full_name || '—';
  const parentPhone = s?.parents?.phoneNumber || s?.parents?.phone_number || s?.phoneNumber || s?.phone_number || '—';
  const address = s?.homeAddress || s?.home_address || '—';
  const driverName = s?.drivers?.fullName || s?.drivers?.full_name || '—';
  const picture = s?.profilePicture || s?.profile_picture;

  return (
    <PageLayout title={t('admin.student_brief.title')} subtitle={t('admin.student_brief.subtitle')}>
      <div className="space-y-6">
        {/* Search — autocomplete */}
        <div className="relative max-w-md" ref={searchRef}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              className="w-full border border-gray-300 rounded-xl pl-10 pr-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent min-h-[44px]"
              placeholder={t('admin.student_brief.search_ph')}
              value={search}
              onChange={e => { setSearch(e.target.value); setShowDropdown(true); }}
              onFocus={() => { if (search) setShowDropdown(true); }}
            />
          </div>
          {showDropdown && matchingStudents.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden">
              {matchingStudents.map(st => {
                const stName = st.fullName || (st as any).full_name || '';
                const stClass = (st as any).classes?.name || '';
                return (
                  <button
                    key={st.id}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-primary-50 transition-colors text-left"
                    onMouseDown={() => selectStudent(st.id, stName)}
                  >
                    <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-primary-700 font-bold text-xs">{stName[0]}</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{stName}</p>
                      {stClass && <p className="text-xs text-gray-500">{stClass}</p>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {showDropdown && search.trim() && matchingStudents.length === 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 px-4 py-3">
              <p className="text-sm text-gray-500">{t('admin.student_brief.no_students_found', { query: search })}</p>
            </div>
          )}
        </div>

        {!selectedStudentId && !loading && (
          <EmptyState
            title={t('admin.student_brief.search_title')}
            description={t('admin.student_brief.search_desc')}
            icon={<User className="w-8 h-8 text-gray-400" />}
          />
        )}

        {loading && <LoadingSpinner />}

        {brief && s && (
          <div className="space-y-6">
            {/* Profile card */}
            <Card>
              {/* Transfer student button hidden until Phase C ships — see FEATURE.md.
                  Restore by un-commenting the imports above + the block below.
              <div className="flex items-start justify-end mb-2">
                <button
                  onClick={() => setTransferOpen(true)}
                  className="flex items-center gap-1.5 text-xs text-primary-700 hover:bg-primary-50 rounded-lg px-2.5 py-1.5"
                  title={t('admin.transfer.button_title', 'Start a transfer to another school')}
                >
                  <Send className="w-3.5 h-3.5" /> {t('admin.transfer.button', 'Transfer student')}
                </button>
              </div>
              */}
              <div className="flex items-start gap-6">
                <div className="w-24 h-24 bg-primary-100 rounded-2xl flex items-center justify-center flex-shrink-0">
                  {picture ? (
                    <img src={picture} alt="" className="w-24 h-24 rounded-2xl object-cover" />
                  ) : (
                    <span className="text-3xl font-bold text-primary-700">{name[0]}</span>
                  )}
                </div>
                <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="font-semibold text-gray-500 block text-xs uppercase">{t('admin.student_brief.name')}</span>
                    <span className="text-gray-900 font-medium">{name}</span>
                  </div>
                  {age !== null && (
                    <div>
                      <span className="font-semibold text-gray-500 block text-xs uppercase">{t('admin.student_brief.age')}</span>
                      <span className="text-gray-900 font-medium">{t('admin.student_brief.years', { count: age })}</span>
                    </div>
                  )}
                  <div>
                    <span className="font-semibold text-gray-500 block text-xs uppercase">{t('admin.student_brief.class')}</span>
                    <span className="text-gray-900 font-medium">{className}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-gray-500 block text-xs uppercase">{t('admin.student_brief.parents')}</span>
                    {parentId ? (
                      <Link to={`/admin/parents/${parentId}`} className="text-primary-600 font-medium hover:underline">
                        {parentName}
                      </Link>
                    ) : (
                      <span className="text-gray-900 font-medium">{parentName}</span>
                    )}
                  </div>
                  <div>
                    <span className="font-semibold text-gray-500 block text-xs uppercase">{t('admin.student_brief.contact')}</span>
                    <span className="text-gray-900 font-medium">{parentPhone}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-gray-500 block text-xs uppercase">{t('admin.student_brief.address')}</span>
                    <span className="text-gray-900 font-medium">{address}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-gray-500 block text-xs uppercase">{t('admin.student_brief.driver')}</span>
                    <span className="text-gray-900 font-medium">{driverName}</span>
                  </div>
                </div>
              </div>
              {archiveEnabled && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <Link
                    to={`/admin/students/${selectedStudentId}/attendance-history`}
                    className="inline-flex items-center gap-1.5 text-sm text-primary-600 font-medium hover:underline"
                  >
                    {t('attendance_history.view_link', 'View attendance history')}
                  </Link>
                </div>
              )}
            </Card>

            <HealthSafetyPanel health={brief.health} />

            {previousEnrollment && (
              <Card>
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-amber-100 flex-shrink-0">
                    <History className="w-4 h-4 text-amber-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-900">{t('admin.student_brief.prev_enrollment')}</div>
                    <div className="text-sm text-gray-700 mt-0.5">
                      {t('admin.student_brief.prev_line', { name: previousEnrollment.fullName, reason: previousEnrollment.reason, date: previousEnrollment.departureDate })}
                      {(() => {
                        const history = previousEnrollment.enrollmentHistory ?? [];
                        const legacy = previousEnrollment.classesAttended ?? [];
                        const lastLabel = history.length
                          ? (history[history.length - 1]?.gradeLevel || history[history.length - 1]?.className || null)
                          : (legacy.length ? legacy[legacy.length - 1]?.className : null);
                        return lastLabel ? <> · {t('admin.student_brief.last_class', { name: lastLabel })}</> : null;
                      })()}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {previousEnrollment.parentFullName && <>{t('admin.student_brief.parent_on_file', { name: previousEnrollment.parentFullName })}{previousEnrollment.parentPhone && ` · ${previousEnrollment.parentPhone}`}</>}
                    </div>
                    <Link to={`/admin/archive?id=${previousEnrollment.id}`} className="inline-block mt-2 text-sm text-primary-600 font-medium hover:underline">
                      {t('admin.student_brief.view_archived')}
                    </Link>
                  </div>
                </div>
              </Card>
            )}

            {/* Grades */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900 text-lg">{t('admin.student_brief.grades')}</h2>
                {gradeYears.length > 1 && (
                  <div className="w-44">
                    <Select
                      options={gradeYears.map(y => ({ value: y, label: y }))}
                      placeholder={t('admin.student_brief.all_years')}
                      value={selectedYear}
                      onChange={e => setSelectedYear(e.target.value)}
                    />
                  </div>
                )}
              </div>

              {filteredGrades.length === 0 ? (
                <Card>
                  <p className="text-sm text-gray-500 text-center py-4">{t('admin.student_brief.no_grades')}</p>
                </Card>
              ) : (
                <Card>
                  <div className="space-y-5">
                    {gradePeriods.map(period => (
                      <div key={period}>
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{period}</p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs border-collapse">
                            <thead>
                              <tr className="bg-gray-50">
                                <th className="text-left px-3 py-2 font-medium text-gray-500 border border-gray-200">{t('admin.student_brief.subject')}</th>
                                {markNames.map(n => (
                                  <th key={n} className="text-center px-3 py-2 font-medium text-gray-500 border border-gray-200">{n}</th>
                                ))}
                                <th className="text-center px-3 py-2 font-medium text-gray-500 border border-gray-200">{t('admin.student_brief.total')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {gradeSubjects.map(subj => {
                                const g = gradesByPeriod[period]?.find(r => canonicalLabel(r.subject) === subj);
                                if (!g) return null;
                                const total = gradeTotal(g, markNames);
                                return (
                                  <tr key={subj} className="hover:bg-gray-50">
                                    <td className="px-3 py-2 border border-gray-200 text-gray-700 font-medium">{subj}</td>
                                    {markNames.map(n => {
                                      const v = getMarkValue(g, n);
                                      return (
                                        <td key={n} className="px-3 py-2 border border-gray-200 text-center">{v ?? '—'}</td>
                                      );
                                    })}
                                    <td className="px-3 py-2 border border-gray-200 text-center font-semibold text-primary-700">{total.toFixed(1)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                            <tfoot>
                              <tr className="bg-gray-50 border-t-2 border-gray-200">
                                <td className="px-3 py-2 border border-gray-200 text-xs font-semibold text-gray-700 uppercase tracking-wide" colSpan={markNames.length + 1}>
                                  {t('admin.student_brief.average')}
                                </td>
                                <td className="px-3 py-2 border border-gray-200 text-center font-bold text-indigo-600">
                                  {termAverages[period] > 0 ? termAverages[period].toFixed(1) : '—'}
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </div>
                    ))}

                    {/* Full Year Mark */}
                    {yearMark && (
                      <div className="flex items-center justify-between bg-indigo-50 rounded-xl px-4 py-3 mt-2">
                        <span className="text-sm text-gray-600">
                          {t('admin.student_brief.full_year_mark')}
                          {selectedYear && ` — ${selectedYear}`}
                          {` ${t('admin.student_brief.terms_paren', { count: gradePeriods.length })}`}
                        </span>
                        <span className="text-xl font-bold text-indigo-600">{yearMark}</span>
                      </div>
                    )}
                  </div>
                </Card>
              )}
            </div>

            {/* Reports */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900 text-lg">{t('admin.student_brief.reports')}</h2>
                <div className="w-48">
                  <Select
                    options={subjects.map(sub => ({ value: sub, label: sub }))}
                    placeholder={t('admin.student_brief.all_subjects')}
                    value={selectedSubject}
                    onChange={e => setSelectedSubject(e.target.value)}
                  />
                </div>
              </div>

              {filteredReports.length === 0 ? (
                <Card>
                  <p className="text-sm text-gray-500 text-center py-4">{t('admin.student_brief.no_reports')}</p>
                </Card>
              ) : (
                <div className="space-y-4">
                  {filteredReports.map(r => (
                    <Card key={r.id}>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-semibold text-gray-900">{r.subject}</h3>
                        {r.reportDate && <span className="text-xs text-gray-400">{format(parseISO(r.reportDate), 'MMM d, yyyy')}</span>}
                      </div>
                      {r.attendanceNotes && (
                        <div className="mb-3">
                          <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{t('admin.student_brief.attendance')}</p>
                          <p className="text-sm text-gray-700">{r.attendanceNotes}</p>
                        </div>
                      )}
                      {r.behaviorNotes && (
                        <div className="mb-3">
                          <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{t('admin.student_brief.behaviour')}</p>
                          <p className="text-sm text-gray-700">{r.behaviorNotes}</p>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        {r.quizMarks != null && (
                          <div className="bg-blue-50 rounded-xl p-3">
                            <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{t('admin.student_brief.quiz_marks')}</p>
                            <p className="text-xl font-bold text-blue-600">{r.quizMarks}</p>
                          </div>
                        )}
                        {r.examMarks != null && (
                          <div className="bg-green-50 rounded-xl p-3">
                            <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{t('admin.student_brief.exam_marks')}</p>
                            <p className="text-xl font-bold text-green-600">{r.examMarks}</p>
                          </div>
                        )}
                      </div>
                      {r.teacherNotes && (
                        <div className="bg-gray-50 rounded-xl p-3">
                          <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{t('admin.student_brief.teacher_notes')}</p>
                          <p className="text-sm text-gray-700 leading-relaxed">{r.teacherNotes}</p>
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Cross-school transfer wizard hidden — see FEATURE.md.
      <TransferWizard
        isOpen={transferOpen}
        onClose={() => setTransferOpen(false)}
        studentId={selectedStudentId || null}
        studentName={name !== '—' ? name : null}
        onCompleted={() => { setSelectedStudentId(''); setBrief(null); }}
      />
      */}
    </PageLayout>
  );
}

// Trim and title-case so "Term 1", "term 1", and "TERM 1" collapse to a
// single canonical label.
function canonicalLabel(s: string | null | undefined): string {
  if (!s) return '';
  return s.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

