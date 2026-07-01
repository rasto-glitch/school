import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Search, FileText } from 'lucide-react';
import { supervisorApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Select from '../../components/common/Select';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import HealthSafetyPanel, { type StudentHealthBrief } from '../../components/common/HealthSafetyPanel';
import type { Report, Grade } from '../../types';
import { format, parseISO, differenceInYears } from 'date-fns';

export default function SupervisorStudentReportsPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [students, setStudents] = useState<any[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState(searchParams.get('id') || '');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  const [brief, setBrief] = useState<{ student: any; reports: Report[]; grades: Grade[]; health?: StudentHealthBrief | null } | null>(null);
  const [search, setSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supervisorApi.getAllStudents({ limit: '500' }).then(r => setStudents(r.data?.students || r.data || []));
  }, []);

  useEffect(() => {
    if (!selectedStudentId) { setBrief(null); return; }
    setLoading(true);
    setSelectedYear('');
    setSelectedSubject('');
    supervisorApi.getStudentBrief(selectedStudentId)
      .then(r => setBrief(r.data))
      .finally(() => setLoading(false));
  }, [selectedStudentId]);

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
    setSearch(name);
    setShowDropdown(false);
  };

  // ---- Grades ----
  const allGrades = brief?.grades || [];
  const gradeYears = [...new Set(allGrades.map(g => g.academicYear).filter(Boolean))].sort() as string[];
  const filteredGrades = selectedYear ? allGrades.filter(g => g.academicYear === selectedYear) : allGrades;

  const gradesByPeriod: Record<string, Grade[]> = {};
  for (const g of filteredGrades) {
    const period = g.gradingPeriod || t('supervisor.unknown_term');
    if (!gradesByPeriod[period]) gradesByPeriod[period] = [];
    gradesByPeriod[period].push(g);
  }
  const gradePeriods = Object.keys(gradesByPeriod).sort();
  const gradeSubjects = [...new Set(filteredGrades.map(g => g.subject))].sort();
  const termTotals = gradePeriods.map(p =>
    gradesByPeriod[p].reduce((sum, g) =>
      sum + (g.dailyGrade || 0) + (g.quizGrade || 0) + (g.monthlyExamGrade || 0) + (g.termExamGrade || 0), 0)
  );
  const yearMark = termTotals.length > 0
    ? (termTotals.reduce((a, b) => a + b, 0) / termTotals.length).toFixed(1)
    : null;

  // ---- Reports ----
  const subjects = [...new Set(brief?.reports?.map(r => r.subject) || [])];
  const filteredReports = selectedSubject
    ? brief?.reports?.filter(r => r.subject === selectedSubject) || []
    : brief?.reports || [];

  // ---- Student info ----
  const s = brief?.student;
  const name = s?.fullName || s?.full_name || '—';
  const dob = s?.dateOfBirth || s?.date_of_birth;
  const age = dob ? differenceInYears(new Date(), parseISO(dob)) : null;
  const className = s?.classes?.name || '—';
  const parentName = s?.parents?.fullName || s?.parents?.full_name || '—';
  const parentPhone = s?.parents?.phoneNumber || s?.parents?.phone_number || '—';
  const picture = s?.profilePicture || s?.profile_picture;

  return (
    <PageLayout title={t('supervisor.student_reports')} subtitle={t('supervisor.student_reports_subtitle')}>
      <div className="space-y-6">
        {/* Search */}
        <div className="relative max-w-md" ref={searchRef}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              className="w-full border border-gray-300 rounded-xl pl-10 pr-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent min-h-[44px]"
              placeholder={t('supervisor.search_student_ph')}
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
              <p className="text-sm text-gray-500">{t('supervisor.no_students_for', { query: search })}</p>
            </div>
          )}
        </div>

        {!selectedStudentId && !loading && (
          <EmptyState
            title={t('supervisor.search_student_title')}
            description={t('supervisor.search_student_desc')}
            icon={<FileText className="w-8 h-8 text-gray-400" />}
          />
        )}

        {loading && <LoadingSpinner />}

        {brief && s && (
          <div className="space-y-6">
            {/* Student card */}
            <Card>
              <div className="flex items-start gap-5">
                <div className="w-16 h-16 bg-primary-100 rounded-2xl flex items-center justify-center flex-shrink-0">
                  {picture ? (
                    <img src={picture} alt="" className="w-16 h-16 rounded-2xl object-cover" />
                  ) : (
                    <span className="text-2xl font-bold text-primary-700">{name[0]}</span>
                  )}
                </div>
                <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="font-semibold text-gray-500 block text-xs uppercase">{t('common.name')}</span>
                    <span className="text-gray-900 font-medium">{name}</span>
                  </div>
                  {age !== null && (
                    <div>
                      <span className="font-semibold text-gray-500 block text-xs uppercase">{t('supervisor.age')}</span>
                      <span className="text-gray-900 font-medium">{t('supervisor.age_years', { count: age })}</span>
                    </div>
                  )}
                  <div>
                    <span className="font-semibold text-gray-500 block text-xs uppercase">{t('common.class')}</span>
                    <span className="text-gray-900 font-medium">{className}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-gray-500 block text-xs uppercase">{t('common.parent')}</span>
                    <span className="text-gray-900 font-medium">{parentName}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-gray-500 block text-xs uppercase">{t('supervisor.contact')}</span>
                    <span className="text-gray-900 font-medium">{parentPhone}</span>
                  </div>
                </div>
              </div>
            </Card>

            <HealthSafetyPanel health={brief.health} />

            {/* Grades */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900 text-lg">{t('grades.title')}</h2>
                {gradeYears.length > 1 && (
                  <div className="w-44">
                    <Select
                      options={gradeYears.map(y => ({ value: y, label: y }))}
                      placeholder={t('supervisor.all_years')}
                      value={selectedYear}
                      onChange={e => setSelectedYear(e.target.value)}
                    />
                  </div>
                )}
              </div>
              {filteredGrades.length === 0 ? (
                <Card><p className="text-sm text-gray-500 text-center py-4">{t('teacher.no_grades')}</p></Card>
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
                                {[[t('common.subject'),'s'], [t('grades.daily'),'c'], [t('grades.quiz'),'c'], [t('supervisor.monthly_exam'),'c'], [t('supervisor.term_exam'),'c'], [t('common.total'),'c']].map(([h, align]) => (
                                  <th key={h} className={`px-3 py-2 font-medium text-gray-500 border border-gray-200 ${align === 's' ? 'text-left' : 'text-center'}`}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {gradeSubjects.map(subj => {
                                const g = gradesByPeriod[period]?.find(r => r.subject === subj);
                                if (!g) return null;
                                const total = (g.dailyGrade || 0) + (g.quizGrade || 0) + (g.monthlyExamGrade || 0) + (g.termExamGrade || 0);
                                return (
                                  <tr key={subj} className="hover:bg-gray-50">
                                    <td className="px-3 py-2 border border-gray-200 text-gray-700 font-medium">{subj}</td>
                                    <td className="px-3 py-2 border border-gray-200 text-center">{g.dailyGrade ?? '—'}</td>
                                    <td className="px-3 py-2 border border-gray-200 text-center">{g.quizGrade ?? '—'}</td>
                                    <td className="px-3 py-2 border border-gray-200 text-center">{g.monthlyExamGrade ?? '—'}</td>
                                    <td className="px-3 py-2 border border-gray-200 text-center">{g.termExamGrade ?? '—'}</td>
                                    <td className="px-3 py-2 border border-gray-200 text-center font-semibold text-primary-700">{total.toFixed(1)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                    {yearMark && (
                      <div className="flex items-center justify-between bg-indigo-50 rounded-xl px-4 py-3 mt-2">
                        <span className="text-sm text-gray-600">
                          {t('supervisor.full_year_mark')}{selectedYear && ` — ${selectedYear}`}
                          {` (${t('supervisor.terms_count', { count: gradePeriods.length })})`}
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
                <h2 className="font-semibold text-gray-900 text-lg">{t('reports.title')}</h2>
                <div className="w-48">
                  <Select
                    options={subjects.map(sub => ({ value: sub, label: sub }))}
                    placeholder={t('common.all_subjects')}
                    value={selectedSubject}
                    onChange={e => setSelectedSubject(e.target.value)}
                  />
                </div>
              </div>
              {filteredReports.length === 0 ? (
                <Card><p className="text-sm text-gray-500 text-center py-4">{t('supervisor.no_reports_available')}</p></Card>
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
                          <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{t('reports.attendance')}</p>
                          <p className="text-sm text-gray-700">{r.attendanceNotes}</p>
                        </div>
                      )}
                      {r.behaviorNotes && (
                        <div className="mb-3">
                          <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{t('reports.behavior')}</p>
                          <p className="text-sm text-gray-700">{r.behaviorNotes}</p>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        {r.quizMarks != null && (
                          <div className="bg-blue-50 rounded-xl p-3">
                            <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{t('supervisor.quiz_marks')}</p>
                            <p className="text-xl font-bold text-blue-600">{r.quizMarks}</p>
                          </div>
                        )}
                        {r.examMarks != null && (
                          <div className="bg-green-50 rounded-xl p-3">
                            <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{t('supervisor.exam_marks')}</p>
                            <p className="text-xl font-bold text-green-600">{r.examMarks}</p>
                          </div>
                        )}
                      </div>
                      {r.teacherNotes && (
                        <div className="bg-gray-50 rounded-xl p-3">
                          <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{t('reports.teacher_notes')}</p>
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
    </PageLayout>
  );
}
