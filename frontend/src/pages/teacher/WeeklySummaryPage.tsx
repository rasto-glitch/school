import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Save, Lock } from 'lucide-react';
import { teacherApi } from '../../services/api';
import { useTeacherProfile } from '../../hooks/useTeacherProfile';
import SubjectBadge from '../../components/common/SubjectBadge';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Select from '../../components/common/Select';
import Button from '../../components/common/Button';
import type { Class, WeeklySummary } from '../../types';
import { format, parseISO } from 'date-fns';

interface Period {
  id: string;
  weekStartDate: string;
  weekEndDate: string;
  isOpen: boolean;
}

export default function WeeklySummaryPage() {
  const { subject: profileSubject, loading: subjectLoading } = useTeacherProfile();
  const [period, setPeriod] = useState<Period | null | undefined>(undefined); // undefined = loading
  const [classes, setClasses] = useState<Class[]>([]);
  const [teacherSubject, setTeacherSubject] = useState('');
  const [selectedClass, setSelectedClass] = useState('');
  const [rows, setRows] = useState<Record<string, Partial<WeeklySummary>>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    teacherApi.getClasses().then(r => setClasses(r.data || []));
    teacherApi.getActivePeriod().then(r => setPeriod(r.data ?? null));
  }, []);

  useEffect(() => {
    if (profileSubject && !teacherSubject) setTeacherSubject(profileSubject);
  }, [profileSubject]);

  useEffect(() => {
    if (!teacherSubject) return;
    setRows({ [teacherSubject]: { subject: teacherSubject } });
  }, [teacherSubject]);

  // Load existing submission for the active period
  useEffect(() => {
    if (!selectedClass || !period?.weekStartDate || !teacherSubject) return;
    teacherApi.getWeeklySummary({ classId: selectedClass, weekStartDate: period.weekStartDate })
      .then(r => {
        const data: WeeklySummary[] = r.data || [];
        const existing = data.find(item => item.subject === teacherSubject);
        if (existing) setRows({ [teacherSubject]: existing });
        else setRows({ [teacherSubject]: { subject: teacherSubject } });
      });
  }, [selectedClass, period?.weekStartDate, teacherSubject]);

  const updateRow = (subject: string, field: string, value: string) => {
    setRows(prev => ({ ...prev, [subject]: { ...prev[subject], [field]: value } }));
  };

  const saveAll = async () => {
    if (!selectedClass) { toast.error('Select a class first'); return; }
    if (!teacherSubject) { toast.error('Your subject is not set'); return; }
    setLoading(true);
    try {
      await teacherApi.upsertWeeklySummary({
        classId: selectedClass,
        subject: teacherSubject,
        ...rows[teacherSubject],
      });
      toast.success('Weekly summary saved!');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save summary');
    } finally {
      setLoading(false);
    }
  };

  const subjects = teacherSubject ? [teacherSubject] : [];

  return (
    <PageLayout title="Weekly Summary">
      <div className="space-y-4">

        {/* Active period banner */}
        {period === undefined ? (
          <div className="h-12 flex items-center"><div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : period ? (
          <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
            <span className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-green-800">
                Active period: {format(parseISO(period.weekStartDate), 'MMM d')} — {format(parseISO(period.weekEndDate), 'MMM d, yyyy')}
              </p>
              <p className="text-xs text-green-600">Submit your weekly summary below</p>
            </div>
            <Lock className="w-3.5 h-3.5 text-green-500 ml-auto" />
          </div>
        ) : (
          <div className="flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3">
            <span className="w-2 h-2 bg-yellow-400 rounded-full flex-shrink-0" />
            <p className="text-sm text-yellow-800 font-medium">No active period. Supervisor hasn't opened a summary period yet.</p>
          </div>
        )}

        {/* Controls */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="w-48">
            <Select
              label="Class"
              options={classes.map(c => ({ value: c.id, label: c.name }))}
              placeholder="Select class"
              value={selectedClass}
              onChange={e => setSelectedClass(e.target.value)}
            />
          </div>
          <div className="flex-1 min-w-44">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Subject</label>
            <SubjectBadge subject={teacherSubject} loading={subjectLoading} />
          </div>
          <Button onClick={saveAll} loading={loading} disabled={!period} icon={<Save className="w-4 h-4" />}>
            Save
          </Button>
        </div>

        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {['Subject', 'Unit', 'Lessons', 'Pages', 'Homework Reminder'].map(h => (
                  <th key={h} className="text-left px-4 py-3 font-semibold text-gray-700 first:rounded-tl-2xl last:rounded-tr-2xl">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {subjects.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-500">Enter your subject above to start filling the summary</td></tr>
              ) : subjects.map((subject, i) => (
                <tr key={subject} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                  <td className="px-4 py-2 font-medium text-gray-900 whitespace-nowrap">{subject}</td>
                  {(['unit', 'lesson', 'pages', 'homeworkReminder'] as const).map(field => (
                    <td key={field} className="px-4 py-2">
                      <input
                        className="w-full border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary-400 bg-white disabled:bg-gray-50 disabled:text-gray-400"
                        value={(rows[subject] as any)?.[field] || ''}
                        onChange={e => updateRow(subject, field, e.target.value)}
                        placeholder={period ? '—' : 'No active period'}
                        disabled={!period}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </PageLayout>
  );
}
