import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MapPin, Users } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';

export default function DriverDashboard() {
  const { t } = useTranslation();
  const { user } = useAuthStore();

  return (
    <PageLayout title={t('driver.dashboard_title')} subtitle={t('driver.dashboard_subtitle', { name: user?.firstName })}>
      <div className="space-y-6 max-w-lg">
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 bg-blue-50 rounded-xl">
              <Users className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">{t('driver.student_info')}</h2>
              <p className="text-sm text-gray-500">{t('driver.student_info_desc')}</p>
            </div>
          </div>
          <Link to="/driver/students">
            <Button fullWidth variant="outline">{t('driver.see_all_students')}</Button>
          </Link>
        </Card>

        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 bg-green-50 rounded-xl">
              <MapPin className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">{t('driver.start_your_ride')}</h2>
              <p className="text-sm text-gray-500">{t('driver.start_your_ride_desc')}</p>
            </div>
          </div>
          <Link to="/driver/drive">
            <Button fullWidth>{t('driver.start_drive')}</Button>
          </Link>
        </Card>
      </div>
    </PageLayout>
  );
}
