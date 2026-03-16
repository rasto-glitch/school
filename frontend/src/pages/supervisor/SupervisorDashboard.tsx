import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, CheckCircle2, XCircle, Clock, ChevronRight } from 'lucide-react';
import { supervisorApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import LoadingSpinner from '../../components/common/LoadingSpinner';

interface ClassSummary {
  id: string;
  name: string;
  gradeLevel?: string;
  present: number;
  absent: number;
  late: number;
  total: number;
}

export default function SupervisorDashboard() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<ClassSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  useEffect(() => {
    supervisorApi.getAttendanceSummary()
      .then(r => setSummary(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const totals = summary.reduce(
    (acc, c) => ({ present: acc.present + c.present, absent: acc.absent + c.absent, late: acc.late + c.late, total: acc.total + c.total }),
    { present: 0, absent: 0, late: 0, total: 0 }
  );

  return (
    <PageLayout title="Supervisor Dashboard" subtitle={today}>
      <div className="space-y-6">
        {/* Totals */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Total Marked', value: totals.total, icon: Users, color: 'text-gray-700', bg: 'bg-gray-100' },
            { label: 'Present', value: totals.present, icon: CheckCircle2, color: 'text-green-700', bg: 'bg-green-100' },
            { label: 'Absent', value: totals.absent, icon: XCircle, color: 'text-red-700', bg: 'bg-red-100' },
            { label: 'Late', value: totals.late, icon: Clock, color: 'text-amber-700', bg: 'bg-amber-100' },
          ].map(({ label, value, icon: Icon, color, bg }) => (
            <Card key={label} className="flex items-center gap-3">
              <div className={`p-2.5 rounded-xl ${bg} flex-shrink-0`}>
                <Icon className={`w-5 h-5 ${color}`} />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{value}</p>
                <p className="text-xs text-gray-500">{label}</p>
              </div>
            </Card>
          ))}
        </div>

        {totals.absent + totals.late > 0 && (
          <button
            onClick={() => navigate('/supervisor/absent-today')}
            className="w-full flex items-center justify-between bg-red-50 border border-red-200 rounded-2xl px-5 py-4 hover:bg-red-100 transition-colors"
          >
            <div className="flex items-center gap-3">
              <XCircle className="w-5 h-5 text-red-600" />
              <div className="text-left">
                <p className="text-sm font-semibold text-red-800">
                  {totals.absent + totals.late} student{totals.absent + totals.late !== 1 ? 's' : ''} absent or late today
                </p>
                <p className="text-xs text-red-600">Tap to view details and contact parents</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-red-500" />
          </button>
        )}

        {/* Per-class breakdown */}
        <Card>
          <h2 className="font-semibold text-gray-900 mb-4">Today's Attendance by Class</h2>
          {loading ? <LoadingSpinner /> : summary.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No attendance has been marked today.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {summary.map(cls => (
                <button
                  key={cls.id}
                  onClick={() => navigate(`/supervisor/attendance?classId=${cls.id}&date=${new Date().toISOString().split('T')[0]}`)}
                  className="w-full flex items-center gap-4 py-3 hover:bg-gray-50 transition-colors rounded-xl px-2 -mx-2"
                >
                  <div className="flex-1 text-left">
                    <p className="text-sm font-semibold text-gray-900">{cls.name}</p>
                    {cls.gradeLevel && <p className="text-xs text-gray-400">Grade {cls.gradeLevel}</p>}
                  </div>
                  <div className="flex gap-3 text-xs">
                    <span className="text-green-700 font-semibold">{cls.present}P</span>
                    <span className="text-red-700 font-semibold">{cls.absent}A</span>
                    <span className="text-amber-700 font-semibold">{cls.late}L</span>
                  </div>
                  {cls.total === 0 && (
                    <span className="text-xs text-gray-400 italic">Not marked</span>
                  )}
                  <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>
    </PageLayout>
  );
}
