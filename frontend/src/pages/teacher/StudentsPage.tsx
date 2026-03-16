import { useEffect, useState } from 'react';
import { Search, User } from 'lucide-react';
import { teacherApi } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import Modal from '../../components/common/Modal';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import type { Student, Class } from '../../types';

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [selected, setSelected] = useState<Student | null>(null);
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
              <Card key={s.id} hover onClick={() => setSelected(s)}>
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
      <Modal isOpen={!!selected} onClose={() => setSelected(null)} title={selected?.fullName} size="lg">
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-gray-500">Class:</span> <span className="font-medium">{selected.classes?.name}</span></div>
              <div><span className="text-gray-500">Parent:</span> <span className="font-medium">{(selected as any).parents?.fullName || 'N/A'}</span></div>
              <div><span className="text-gray-500">Phone:</span> <span className="font-medium">{selected.phoneNumber || 'N/A'}</span></div>
              <div><span className="text-gray-500">Emergency:</span> <span className="font-medium">{selected.emergencyContact || 'N/A'}</span></div>
            </div>

            {(selected as any).reports?.length > 0 && (
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">Reports</h3>
                <div className="space-y-2">
                  {(selected as any).reports.slice(0, 3).map((r: any) => (
                    <div key={r.id} className="p-3 bg-gray-50 rounded-xl text-sm">
                      <div className="flex justify-between mb-1">
                        <span className="font-medium">{r.subject}</span>
                        <span className="text-gray-400">{r.report_date}</span>
                      </div>
                      {r.teacher_notes && <p className="text-gray-600 text-xs">{r.teacher_notes}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </PageLayout>
  );
}
