import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
    <PageLayout title={t('admin.all_teachers_title')} subtitle={t('admin.teachers_total', { count: teachers.length })}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3 items-center">
          <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />} onClick={() => navigate('/admin/dashboard')}>{t('common.back')}</Button>
          <Button variant="primary" size="sm" onClick={() => navigate('/admin/employees')}>{t('admin.add_edit_teachers')}</Button>
        </div>

        <Input placeholder={t('admin.search_name_subject')} icon={<Search className="w-4 h-4" />} value={search} onChange={e => setSearch(e.target.value)} />

        {loading ? <LoadingSpinner /> : filtered.length === 0 ? (
          <EmptyState title={t('admin.no_teachers_found')} icon={<Users className="w-8 h-8 text-gray-400" />} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(tc => (
              <button key={tc.id} type="button" onClick={() => navigate(`/admin/employees/teacher/${tc.id}`)} className="text-left w-full">
                <Card className="hover:shadow-md hover:border-primary-200 transition-all cursor-pointer h-full">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-green-700 font-bold text-sm">{tc.fullName?.[0]}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900">{tc.fullName}</p>
                      {tc.subjects && tc.subjects.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {tc.subjects.map(s => <Badge key={s.id} color="primary">{s.name}</Badge>)}
                        </div>
                      ) : tc.subject ? <Badge color="primary">{tc.subject}</Badge> : null}
                      <p className="text-xs text-gray-500 mt-1">{tc.phoneNumber || '—'}</p>
                      {(tc as any).teacherClasses?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(tc as any).teacherClasses.map((trc: any) => (
                            <span key={trc.classId} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                              {trc.classes?.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              </button>
            ))}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
