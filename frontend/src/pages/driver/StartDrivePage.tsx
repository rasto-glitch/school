import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { MapPin, Square, Play } from 'lucide-react';
import { driverApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import type { Student } from '../../types';

export default function StartDrivePage() {
  const { t } = useTranslation();
  const [students, setStudents] = useState<Student[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [isDriving, setIsDriving] = useState(false);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    driverApi.getStudents().then(r => setStudents(r.data || [])).finally(() => setLoading(false));
  }, []);

  const sendLocation = () => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        driverApi.updateLocation({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          speed: pos.coords.speed || 0,
          heading: pos.coords.heading || 0,
          isDriving: true,
        }).catch(() => {});
      },
      (err) => { toast.error(`Location error: ${err.message}`); }
    );
  };

  const startDrive = async () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser');
      return;
    }
    try {
      await driverApi.startDrive([...excluded]);
      setIsDriving(true);
      toast.success('Drive started! GPS tracking is active.');
      sendLocation();
      intervalRef.current = setInterval(sendLocation, 20000);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to start drive');
    }
  };

  const stopDrive = async () => {
    try {
      await driverApi.stopDrive();
      if (intervalRef.current) clearInterval(intervalRef.current);
      setIsDriving(false);
      toast.success('Drive ended.');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to stop drive');
    }
  };

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

  const toggleExclude = (id: string) => {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <PageLayout title={t('driver.drive_page_title')} subtitle={t('driver.drive_page_subtitle')}>
      <div className="max-w-lg space-y-6">
        {/* Exclude absent students */}
        <Card>
          <h2 className="font-semibold text-gray-900 mb-3">{t('driver.exclude_absent')}</h2>
          <p className="text-sm text-gray-500 mb-3">{t('driver.exclude_absent_desc')}</p>
          {loading ? <LoadingSpinner size="sm" /> : (
            <div className="space-y-2">
              {students.map(s => (
                <label key={s.id} className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors ${excluded.has(s.id) ? 'bg-red-50' : 'bg-gray-50 hover:bg-gray-100'}`}>
                  <input
                    type="checkbox"
                    checked={excluded.has(s.id)}
                    onChange={() => toggleExclude(s.id)}
                    className="w-4 h-4 text-red-500"
                  />
                  <span className={`text-sm font-medium ${excluded.has(s.id) ? 'line-through text-gray-400' : 'text-gray-900'}`}>{s.fullName}</span>
                  {excluded.has(s.id) && <span className="text-xs text-red-500 ml-auto">{t('common.absent')}</span>}
                </label>
              ))}
            </div>
          )}
        </Card>

        {/* Drive controls */}
        <Card>
          <h2 className="font-semibold text-gray-900 mb-4">{t('driver.drive_status')}</h2>

          {/* Status indicator */}
          <div className={`flex items-center gap-3 p-4 rounded-xl mb-4 ${isDriving ? 'bg-green-50' : 'bg-gray-50'}`}>
            <div className={`relative flex h-3 w-3 ${isDriving ? '' : 'hidden'}`}>
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
            </div>
            <MapPin className={`w-5 h-5 ${isDriving ? 'text-green-600' : 'text-gray-400'}`} />
            <div>
              <p className="font-semibold text-gray-900">{isDriving ? t('driver.currently_driving') : t('driver.not_started')}</p>
              <p className="text-xs text-gray-500">{isDriving ? t('driver.gps_active') : t('driver.gps_inactive')}</p>
            </div>
          </div>

          {!isDriving ? (
            <Button onClick={startDrive} fullWidth size="lg" icon={<Play className="w-5 h-5" />}>
              {t('driver.start_drive')}
            </Button>
          ) : (
            <Button onClick={stopDrive} variant="danger" fullWidth size="lg" icon={<Square className="w-5 h-5" />}>
              {t('driver.stop_drive')}
            </Button>
          )}
        </Card>
      </div>
    </PageLayout>
  );
}
