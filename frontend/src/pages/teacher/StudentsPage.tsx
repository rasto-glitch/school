import { useEffect, useState } from 'react';
import { Search, User, FileText, Star } from 'lucide-react';
import { teacherApi } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import Modal from '../../components/common/Modal';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import type { Student, Class, Report, Grade, Mark } from '../../types';

interface StudentBrief {
  student: Student & { dateOfBirth?: string; homeAddress?: string };
  reports: Report[];
  grades: Grade[];
}

function totalMarks(marks?: Mark[] | null): number {
  return (marks || []).reduce((s, m) => s + (Number(m.value) || 0), 0);
}

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [brief, setBrief] = useState<StudentBrief | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [loading, setLoading] = useState(true);
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
    if (!selectedId) { setBrief(null); return; }
    setBriefLoading(true);
    setBrief(null);
    teacherApi.getStudentBrief(selectedId)
      .then(r => setBrief(r.data))
      .catch(() => setBrief(null))
      .finally(() => setBriefLoading(false));
  }, [selectedId]);

  const closeModal = () => { setSelectedId(null); };

  return (
    <PageLayout title="Students" subtitle="View and manage your students">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-48">
            <Input placeholder="Search students..." icon={<Search className="w-4 h-4" />} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="w-48">
            <Select options={classes.map(c => ({ value: c.id, label: c.name }))} placeholder="All Classes" value={classFilter} onChange={e => setClassFilter(e.target.value)} />
          </div>
        </div>

        {loading ? <LoadingSpinner /> : students.length === 0 ? (
          <EmptyState title="No students found" icon={<User className="w-8 h-8 text-gray-400" />} />
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
                    <p className="text-xs text-gray-500">{s.classes?.name || 'No class'}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Student detail modal */}
      <Modal isOpen={!!selectedId} onClose={closeModal} title={brief?.student.fullName} size="lg">
        {briefLoading ? (
          <LoadingSpinner />
        ) : brief && (
          <div className="space-y-5">
            {/* Basic info — no parent phone */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-gray-500">Class:</span> <span className="font-medium">{brief.student.classes?.name || '—'}</span></div>
              <div><span className="text-gray-500">Phone:</span> <span className="font-medium">{brief.student.phoneNumber || '—'}</span></div>
              <div><span className="text-gray-500">Emergency:</span> <span className="font-medium">{brief.student.emergencyContact || '—'}</span></div>
              <div><span className="text-gray-500">Address:</span> <span className="font-medium">{brief.student.homeAddress || '—'}</span></div>
            </div>

            {/* Grades — this teacher's subject only */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Star className="w-4 h-4 text-amber-500" />
                <h3 className="font-semibold text-gray-900">Grades</h3>
                <span className="text-xs text-gray-400">({brief.grades.length})</span>
              </div>
              {brief.grades.length === 0 ? (
                <p className="text-sm text-gray-400">No grades recorded.</p>
              ) : (
                <div className="space-y-2">
                  {brief.grades.map(g => {
                    const tot = totalMarks(g.marks);
                    return (
                      <div key={g.id} className="bg-gray-50 rounded-xl p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-gray-700">
                            {g.gradingPeriod || '—'}
                            {g.academicYear && <span className="text-xs text-gray-400 ml-2">{g.academicYear}</span>}
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
              )}
            </div>

            {/* Reports — by this teacher only */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <FileText className="w-4 h-4 text-purple-600" />
                <h3 className="font-semibold text-gray-900">Reports</h3>
                <span className="text-xs text-gray-400">({brief.reports.length})</span>
              </div>
              {brief.reports.length === 0 ? (
                <p className="text-sm text-gray-400">No reports submitted.</p>
              ) : (
                <div className="space-y-2">
                  {brief.reports.map(r => (
                    <div key={r.id} className="bg-gray-50 rounded-xl p-3 text-sm">
                      <div className="flex justify-between mb-1">
                        <span className="font-medium text-gray-700">{r.subject}</span>
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
                      {r.attendanceNotes && <p className="text-xs text-gray-600 mt-1"><span className="text-gray-400">Attendance:</span> {r.attendanceNotes}</p>}
                      {r.behaviorNotes && <p className="text-xs text-gray-600 mt-1"><span className="text-gray-400">Behavior:</span> {r.behaviorNotes}</p>}
                      {r.teacherNotes && <p className="text-xs text-gray-600 mt-1">{r.teacherNotes}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </PageLayout>
  );
}
