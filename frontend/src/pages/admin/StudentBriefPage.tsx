import { useEffect, useState, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Search, User } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Select from '../../components/common/Select';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import type { Student, Report, Grade } from '../../types';
import { format, parseISO, differenceInYears } from 'date-fns';

export default function StudentBriefPage() {
  const [searchParams] = useSearchParams();
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState(searchParams.get('id') || '');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  const [brief, setBrief] = useState<{ student: any; reports: Report[]; grades: Grade[] } | null>(null);
  const [search, setSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    adminApi.getStudents({ limit: '500' }).then(r => setStudents(r.data?.students || []));
  }, []);

  useEffect(() => {
    if (!selectedStudentId) { setBrief(null); return; }
    setLoading(true);
    setSelectedYear('');
    setSelectedSubject('');
    adminApi.getStudentBrief(selectedStudentId)
      .then(r => setBrief(r.data))
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
  const gradeYears = [...new Set(allGrades.map(g => g.academicYear).filter(Boolean))].sort() as string[];

  const filteredGrades = selectedYear
    ? allGrades.filter(g => g.academicYear === selectedYear)
    : allGrades;

  // Group by gradingPeriod → grades list
  const gradesByPeriod: Record<string, Grade[]> = {};
  for (const g of filteredGrades) {
    const period = g.gradingPeriod || 'Unknown Term';
    if (!gradesByPeriod[period]) gradesByPeriod[period] = [];
    gradesByPeriod[period].push(g);
  }
  const gradePeriods = Object.keys(gradesByPeriod).sort();

  // Subjects that appear in the filtered grades
  const gradeSubjects = [...new Set(filteredGrades.map(g => g.subject))].sort();

  // Full Year Mark: average of each period's total
  const termTotals = gradePeriods.map(p =>
    gradesByPeriod[p].reduce((sum, g) =>
      sum + (g.dailyGrade || 0) + (g.quizGrade || 0) + (g.monthlyExamGrade || 0) + (g.termExamGrade || 0), 0)
  );
  const yearMark = termTotals.length > 0
    ? (termTotals.reduce((a, b) => a + b, 0) / termTotals.length).toFixed(1)
    : null;

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
    <PageLayout title="Student Brief" subtitle="Search and view a student's full profile and academic reports">
      <div className="space-y-6">
        {/* Search — autocomplete */}
        <div className="relative max-w-md" ref={searchRef}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              className="w-full border border-gray-300 rounded-xl pl-10 pr-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent min-h-[44px]"
              placeholder="Type student name to search…"
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
              <p className="text-sm text-gray-500">No students found for "{search}"</p>
            </div>
          )}
        </div>

        {!selectedStudentId && !loading && (
          <EmptyState
            title="Search for a student"
            description="Type a student's name above to load their full profile and academic report."
            icon={<User className="w-8 h-8 text-gray-400" />}
          />
        )}

        {loading && <LoadingSpinner />}

        {brief && s && (
          <div className="space-y-6">
            {/* Profile card */}
            <Card>
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
                    <span className="font-semibold text-gray-500 block text-xs uppercase">Name</span>
                    <span className="text-gray-900 font-medium">{name}</span>
                  </div>
                  {age !== null && (
                    <div>
                      <span className="font-semibold text-gray-500 block text-xs uppercase">Age</span>
                      <span className="text-gray-900 font-medium">{age} years</span>
                    </div>
                  )}
                  <div>
                    <span className="font-semibold text-gray-500 block text-xs uppercase">Class</span>
                    <span className="text-gray-900 font-medium">{className}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-gray-500 block text-xs uppercase">Parents</span>
                    {parentId ? (
                      <Link to={`/admin/parents/${parentId}`} className="text-primary-600 font-medium hover:underline">
                        {parentName}
                      </Link>
                    ) : (
                      <span className="text-gray-900 font-medium">{parentName}</span>
                    )}
                  </div>
                  <div>
                    <span className="font-semibold text-gray-500 block text-xs uppercase">Contact</span>
                    <span className="text-gray-900 font-medium">{parentPhone}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-gray-500 block text-xs uppercase">Address</span>
                    <span className="text-gray-900 font-medium">{address}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-gray-500 block text-xs uppercase">Driver</span>
                    <span className="text-gray-900 font-medium">{driverName}</span>
                  </div>
                </div>
              </div>
            </Card>

            {/* Grades */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900 text-lg">Grades</h2>
                {gradeYears.length > 1 && (
                  <div className="w-44">
                    <Select
                      options={gradeYears.map(y => ({ value: y, label: y }))}
                      placeholder="All Years"
                      value={selectedYear}
                      onChange={e => setSelectedYear(e.target.value)}
                    />
                  </div>
                )}
              </div>

              {filteredGrades.length === 0 ? (
                <Card>
                  <p className="text-sm text-gray-500 text-center py-4">No grades recorded for this student.</p>
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
                                <th className="text-left px-3 py-2 font-medium text-gray-500 border border-gray-200">Subject</th>
                                <th className="text-center px-3 py-2 font-medium text-gray-500 border border-gray-200">Daily</th>
                                <th className="text-center px-3 py-2 font-medium text-gray-500 border border-gray-200">Quiz</th>
                                <th className="text-center px-3 py-2 font-medium text-gray-500 border border-gray-200">Monthly Exam</th>
                                <th className="text-center px-3 py-2 font-medium text-gray-500 border border-gray-200">Term Exam</th>
                                <th className="text-center px-3 py-2 font-medium text-gray-500 border border-gray-200">Total</th>
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

                    {/* Full Year Mark */}
                    {yearMark && (
                      <div className="flex items-center justify-between bg-indigo-50 rounded-xl px-4 py-3 mt-2">
                        <span className="text-sm text-gray-600">
                          Full Year Mark
                          {selectedYear && ` — ${selectedYear}`}
                          {` (${gradePeriods.length} term${gradePeriods.length !== 1 ? 's' : ''})`}
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
                <h2 className="font-semibold text-gray-900 text-lg">Reports</h2>
                <div className="w-48">
                  <Select
                    options={subjects.map(sub => ({ value: sub, label: sub }))}
                    placeholder="All Subjects"
                    value={selectedSubject}
                    onChange={e => setSelectedSubject(e.target.value)}
                  />
                </div>
              </div>

              {filteredReports.length === 0 ? (
                <Card>
                  <p className="text-sm text-gray-500 text-center py-4">No reports available for this student.</p>
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
                          <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Attendance</p>
                          <p className="text-sm text-gray-700">{r.attendanceNotes}</p>
                        </div>
                      )}
                      {r.behaviorNotes && (
                        <div className="mb-3">
                          <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Behaviour</p>
                          <p className="text-sm text-gray-700">{r.behaviorNotes}</p>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        {r.quizMarks != null && (
                          <div className="bg-blue-50 rounded-xl p-3">
                            <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Quiz Marks</p>
                            <p className="text-xl font-bold text-blue-600">{r.quizMarks}</p>
                          </div>
                        )}
                        {r.examMarks != null && (
                          <div className="bg-green-50 rounded-xl p-3">
                            <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Exam Marks</p>
                            <p className="text-xl font-bold text-green-600">{r.examMarks}</p>
                          </div>
                        )}
                      </div>
                      {r.teacherNotes && (
                        <div className="bg-gray-50 rounded-xl p-3">
                          <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Teacher's Notes</p>
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
