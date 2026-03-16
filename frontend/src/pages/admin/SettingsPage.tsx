import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { CalendarDays, Settings } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import YearTransitionModal from './YearTransitionModal';

export default function SettingsPage() {
  const [academicYear, setAcademicYear] = useState('');
  const [editYear, setEditYear] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showWizard, setShowWizard] = useState(false);

  useEffect(() => {
    setLoading(true);
    adminApi.getSettings()
      .then(r => {
        const y = r.data?.currentAcademicYear || '';
        setAcademicYear(y);
        setEditYear(y);
      })
      .finally(() => setLoading(false));
  }, []);

  const saveCorrection = async () => {
    setSaving(true);
    try {
      await adminApi.updateSettings({ currentAcademicYear: editYear });
      setAcademicYear(editYear);
      toast.success('Academic year updated');
    } catch {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageLayout title="Settings" subtitle="School-wide configuration">
      <div className="max-w-lg space-y-6">

        {/* Current academic year — quick correction */}
        <Card>
          <div className="flex items-center gap-2 mb-1">
            <Settings className="w-5 h-5 text-primary-600" />
            <h2 className="font-semibold text-gray-900">Academic Year</h2>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Correct the label if it was entered incorrectly. To properly advance the year at the end of term, use the transition wizard below.
          </p>
          {loading ? (
            <div className="h-10 bg-gray-100 rounded-xl animate-pulse" />
          ) : (
            <div className="flex gap-3">
              <div className="flex-1">
                <Input
                  placeholder="e.g. 2024-2025"
                  value={editYear}
                  onChange={e => setEditYear(e.target.value)}
                />
              </div>
              <Button
                onClick={saveCorrection}
                loading={saving}
                disabled={editYear === academicYear}
              >
                Save
              </Button>
            </div>
          )}
        </Card>

        {/* End-of-year transition wizard */}
        <Card>
          <div className="flex items-center gap-2 mb-1">
            <CalendarDays className="w-5 h-5 text-indigo-600" />
            <h2 className="font-semibold text-gray-900">End-of-Year Transition</h2>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Run this once at the end of each school year. The wizard will walk you through graduating students, clearing reports, and advancing the academic year — all in one step.
          </p>
          <Button
            onClick={() => setShowWizard(true)}
            disabled={loading}
            className="bg-indigo-600 hover:bg-indigo-700 focus:ring-indigo-500"
            icon={<CalendarDays className="w-4 h-4" />}
          >
            Begin Year Transition
          </Button>
        </Card>

      </div>

      {showWizard && (
        <YearTransitionModal
          currentYear={academicYear}
          onClose={() => setShowWizard(false)}
          onDone={newYear => {
            setAcademicYear(newYear);
            setEditYear(newYear);
            setShowWizard(false);
          }}
        />
      )}
    </PageLayout>
  );
}
