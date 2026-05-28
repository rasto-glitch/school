import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Search, Bus, ArrowLeft } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import type { Driver } from '../../types';

export default function AdminDriversListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi.getDrivers()
      .then(r => setDrivers(r.data || []))
      .finally(() => setLoading(false));
  }, []);

  const q = search.toLowerCase();
  const filtered = search
    ? drivers.filter(d =>
        d.fullName?.toLowerCase().includes(q) ||
        d.licenseNumber?.toLowerCase().includes(q) ||
        d.phoneNumber?.toLowerCase().includes(q) ||
        d.buses?.busNumber?.toLowerCase().includes(q)
      )
    : drivers;

  return (
    <PageLayout title={t('admin.all_drivers_title')} subtitle={t('admin.drivers_total', { count: drivers.length })}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3 items-center">
          <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />} onClick={() => navigate('/admin/dashboard')}>{t('common.back')}</Button>
          <Button variant="primary" size="sm" onClick={() => navigate('/admin/drivers')}>{t('admin.add_edit_drivers')}</Button>
        </div>

        <Input placeholder={t('admin.search_by_name')} icon={<Search className="w-4 h-4" />} value={search} onChange={e => setSearch(e.target.value)} />

        {loading ? <LoadingSpinner /> : filtered.length === 0 ? (
          <EmptyState title={t('admin.no_drivers_found')} icon={<Bus className="w-8 h-8 text-gray-400" />} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(d => (
              <button key={d.id} type="button" onClick={() => navigate(`/admin/employees/driver/${d.id}`)} className="text-left w-full">
                <Card className="hover:shadow-md hover:border-primary-200 transition-all cursor-pointer h-full">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <Bus className="w-5 h-5 text-amber-700" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900">{d.fullName}</p>
                      <p className="text-xs text-gray-500">{t('admin.bus_number', { number: d.buses?.busNumber || t('admin.na') })}</p>
                      <p className="text-xs text-gray-400">{d.phoneNumber || '—'} · {t('admin.license')}: {d.licenseNumber || '—'}</p>
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
