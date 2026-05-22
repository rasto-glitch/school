import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, GraduationCap, ArrowLeft } from 'lucide-react';
import { adminApi } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import Button from '../../components/common/Button';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import type { Student, Class } from '../../types';

export default function AdminStudentsListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  // Pre-populate search from URL param (e.g. from dashboard search)
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [classFilter, setClassFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;
  const debouncedSearch = useDebounce(search, 400);

  useEffect(() => { adminApi.getClasses().then(r => setClasses(r.data || [])); }, []);

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string> = { page: String(page), limit: String(limit) };
    if (debouncedSearch) params.search = debouncedSearch;
    if (classFilter) params.classId = classFilter;
    adminApi.getStudents(params)
      .then(r => { setStudents(r.data?.students || []); setTotal(r.data?.total || 0); })
      .finally(() => setLoading(false));
  }, [debouncedSearch, classFilter, page]);

  return (
    <PageLayout title={t('admin.all_students_title')} subtitle={t('admin.students_total', { count: total })}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3 items-center">
          <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />} onClick={() => navigate('/admin/dashboard')}>{t('common.back')}</Button>
          <Button variant="primary" size="sm" onClick={() => navigate('/admin/students')}>{t('admin.add_edit_students')}</Button>
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-48">
            <Input placeholder={t('admin.search_by_name')} icon={<Search className="w-4 h-4" />} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <div className="w-48">
            <Select options={classes.map(c => ({ value: c.id, label: c.name }))} placeholder={t('common.all_classes')} value={classFilter} onChange={e => { setClassFilter(e.target.value); setPage(1); }} />
          </div>
        </div>

        {loading ? <LoadingSpinner /> : students.length === 0 ? (
          <EmptyState title={t('admin.no_students_found')} icon={<GraduationCap className="w-8 h-8 text-gray-400" />} />
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {students.map(s => (
                <Card key={s.id} hover onClick={() => navigate(`/admin/student-brief?id=${s.id}`)}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-primary-700 font-bold text-sm">{s.fullName?.[0]}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 truncate">{s.fullName}</p>
                      <p className="text-xs text-gray-500">{(s as any).classes?.name || t('common.no_class')}</p>
                      <p className="text-xs text-gray-400">{(s as any).parents?.fullName || (s as any).parents?.full_name || ''}</p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
            {total > limit && (
              <div className="flex justify-center gap-2">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>{t('common.previous')}</Button>
                <span className="px-3 py-2 text-sm text-gray-600">{t('admin.page_of', { page, total: Math.ceil(total / limit) })}</span>
                <Button variant="outline" size="sm" disabled={page >= Math.ceil(total / limit)} onClick={() => setPage(p => p + 1)}>{t('common.next')}</Button>
              </div>
            )}
          </>
        )}
      </div>
    </PageLayout>
  );
}
