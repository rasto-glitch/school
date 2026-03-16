import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Users, ArrowLeft } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import Badge from '../../components/common/Badge';
import type { Teacher } from '../../types';

export default function AdminTeachersListPage() {
  const navigate = useNavigate();
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi.getTeachers()
      .then(r => setTeachers(r.data || []))
      .finally(() => setLoading(false));
  }, []);

  const q = search.toLowerCase();
  const filtered = search
    ? teachers.filter(t =>
        t.fullName?.toLowerCase().includes(q) ||
        t.subject?.toLowerCase().includes(q) ||
        t.phoneNumber?.toLowerCase().includes(q) ||
        (t as any).teacherClasses?.some((tc: any) => tc.classes?.name?.toLowerCase().includes(q))
      )
    : teachers;

  return (
    <PageLayout title="All Teachers" subtitle={`${teachers.length} teachers total`}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3 items-center">
          <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />} onClick={() => navigate('/admin/dashboard')}>Back</Button>
          <Button variant="primary" size="sm" onClick={() => navigate('/admin/teachers')}>+ Add / Edit Teachers</Button>
        </div>

        <Input placeholder="Search by name or subject..." icon={<Search className="w-4 h-4" />} value={search} onChange={e => setSearch(e.target.value)} />

        {loading ? <LoadingSpinner /> : filtered.length === 0 ? (
          <EmptyState title="No teachers found" icon={<Users className="w-8 h-8 text-gray-400" />} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(t => (
              <Card key={t.id}>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-green-700 font-bold text-sm">{t.fullName?.[0]}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900">{t.fullName}</p>
                    {t.subject && <Badge color="primary">{t.subject}</Badge>}
                    <p className="text-xs text-gray-500 mt-1">{t.phoneNumber || '—'}</p>
                    {(t as any).teacherClasses?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {(t as any).teacherClasses.map((tc: any) => (
                          <span key={tc.classId} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                            {tc.classes?.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
