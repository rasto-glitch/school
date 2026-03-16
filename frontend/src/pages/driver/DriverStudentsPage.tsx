import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, MapPin, Phone, User, MessageCircle } from 'lucide-react';
import { driverApi } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Modal from '../../components/common/Modal';
import EmptyState from '../../components/common/EmptyState';
import ErrorMessage from '../../components/common/ErrorMessage';
import { CardListSkeleton } from '../../components/common/Skeleton';
import type { Student } from '../../types';

function ContactActions({ phone }: { phone: string }) {
  const { t } = useTranslation();
  const digits = phone.replace(/\D/g, '');
  return (
    <div className="flex gap-2 mt-1">
      <a
        href={`tel:${phone}`}
        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-green-50 text-green-700 text-sm font-medium hover:bg-green-100 transition-colors"
      >
        <Phone className="w-4 h-4" />
        {t('common.call')}
      </a>
      <a
        href={`https://wa.me/${digits}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700 text-sm font-medium hover:bg-emerald-100 transition-colors"
      >
        <MessageCircle className="w-4 h-4" />
        WhatsApp
      </a>
    </div>
  );
}

function StudentDetailModal({ student, onClose }: { student: Student; onClose: () => void }) {
  const { t } = useTranslation();
  const openMap = () => {
    if (student.homeLatitude && student.homeLongitude) {
      window.open(`https://www.google.com/maps?q=${student.homeLatitude},${student.homeLongitude}`, '_blank');
    } else if (student.homeAddress) {
      window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(student.homeAddress)}`, '_blank');
    }
  };

  return (
    <Modal isOpen onClose={onClose} size="sm">
      <div className="space-y-5">
        {/* Avatar + name */}
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-primary-700 font-bold text-xl">{student.fullName[0]}</span>
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">{student.fullName}</h3>
          </div>
        </div>

        <hr className="border-gray-100" />

        {/* Address */}
        {student.homeAddress && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{t('common.address')}</p>
            <button
              onClick={openMap}
              className="flex items-start gap-2 text-sm text-primary-600 hover:text-primary-700 text-left"
            >
              <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{student.homeAddress}</span>
            </button>
          </div>
        )}

        {/* Parent */}
        {student.parents && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{t('driver.guardian')}</p>
            <p className="text-sm font-semibold text-gray-800 mb-2">{student.parents.fullName}</p>
            {student.parents.phoneNumber && (
              <>
                <p className="text-sm text-gray-500">{student.parents.phoneNumber}</p>
                <ContactActions phone={student.parents.phoneNumber} />
              </>
            )}
          </div>
        )}

        {/* Emergency contact */}
        {student.emergencyContact && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{t('driver.emergency')}</p>
            <p className="text-sm text-gray-500">{student.emergencyContact}</p>
            <ContactActions phone={student.emergencyContact} />
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function DriverStudentsPage() {
  const { t } = useTranslation();
  const [students, setStudents] = useState<Student[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [selected, setSelected] = useState<Student | null>(null);
  const debouncedSearch = useDebounce(search, 400);

  useEffect(() => {
    setLoading(true);
    setError(false);
    driverApi.getStudents(debouncedSearch || undefined)
      .then(r => setStudents(r.data || []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [debouncedSearch, retryKey]);

  return (
    <PageLayout title={t('driver.students_title')} subtitle={t('driver.students_subtitle')}>
      <div className="space-y-4">
        <Input
          placeholder={t('driver.search_students')}
          icon={<Search className="w-4 h-4" />}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        {loading ? <CardListSkeleton count={5} /> : error ? (
          <ErrorMessage onRetry={() => setRetryKey(k => k + 1)} />
        ) : students.length === 0 ? (
          <EmptyState title={t('driver.no_students')} icon={<User className="w-8 h-8 text-gray-400" />} />
        ) : (
          <div className="grid gap-3">
            {students.map(s => (
              <button
                key={s.id}
                onClick={() => setSelected(s)}
                className="w-full text-left"
              >
                <Card className="hover:shadow-md hover:border-primary-200 transition-all cursor-pointer active:scale-[0.99]">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-primary-700 font-bold text-sm">{s.fullName[0]}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900">{s.fullName}</p>
                      {s.parents?.fullName && (
                        <p className="text-sm text-gray-500">{t('driver.parent_label', { name: s.parents.fullName })}</p>
                      )}
                      {s.homeAddress && (
                        <p className="text-xs text-gray-400 truncate">{s.homeAddress}</p>
                      )}
                    </div>
                    <MapPin className="w-4 h-4 text-gray-300 flex-shrink-0" />
                  </div>
                </Card>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <StudentDetailModal student={selected} onClose={() => setSelected(null)} />
      )}
    </PageLayout>
  );
}
