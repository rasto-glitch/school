import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, Clock } from 'lucide-react';
import { receptionApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';

export default function ReceptionDashboard() {
  const navigate = useNavigate();
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  useEffect(() => {
    receptionApi.getPendingAppointmentCount()
      .then(r => setPendingCount(r.data?.count ?? 0))
      .catch(() => {});
  }, []);

  return (
    <PageLayout title="Reception Dashboard" subtitle="Manage parent appointment requests">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => navigate('/reception/appointments')}
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <Calendar className="w-6 h-6 text-primary-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500 font-medium">Appointments</p>
              <p className="text-2xl font-bold text-gray-900">
                {pendingCount === null ? '—' : pendingCount}
              </p>
              <p className="text-xs text-amber-600 font-medium mt-0.5">pending</p>
            </div>
          </div>
        </Card>

        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => navigate('/reception/appointments')}
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <Clock className="w-6 h-6 text-amber-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500 font-medium">Awaiting Response</p>
              <p className="text-xs text-gray-400 mt-1">Click to view all requests</p>
            </div>
          </div>
        </Card>
      </div>
    </PageLayout>
  );
}
