import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Save } from 'lucide-react';
import { teacherApi } from '../../services/api';
import { useTeacherProfile } from '../../hooks/useTeacherProfile';
import SubjectBadge from '../../components/common/SubjectBadge';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Select from '../../components/common/Select';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import type { Class, WeeklySummary } from '../../types';
import { format, startOfWeek } from 'date-fns';

export default function WeeklySummaryPage() {
  const { subject: profileSubject, loading: subjectLoading } = useTeacherProfile();
  const [classes, setClasses] = useState<Class[]>([]);
  const [teacherSubject, setTeacherSubject] = useState('');
  const [selectedClass, setSelectedClass] = useState('');
  const [weekDate, setWeekDate] = useState(format(startOfWeek(new Date()), 'yyyy-MM-dd'));
  const [rows, setRows] = useState<Record<string, Partial<WeeklySummary>>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    teacherApi.getClasses().then(r => setClasses(r.data || []));
  }, []);

  // Auto-fill subject when profile loads
  useEffect(() => {
    if (profileSubject && !teacherSubject) setTeacherSubject(profileSubject);
  }, [profileSubject]);

  // Initialize rows when teacher subject or week changes
  useEffect(() => {
    if (!teacherSubject) return;
    setRows({ [teacherSubject]: { subject: teacherSubject } });
  }, [teacherSubject]);

  useEffect(() => {
    if (!selectedClass || !weekDate || !teacherSubject) return;
    teacherApi.getWeeklySummary({ classId: selectedClass, weekStartDate: weekDate })
      .then(r => {
        const data: WeeklySummary[] = r.data || [];
        const existing = data.find(item => item.subject === teacherSubject);
        if (existing) setRows({ [teacherSubject]: existing });
      });
  }, [selectedClass, weekDate, teacherSubject]);

  const updateRow = (subject: string, field: string, value: string) => {
    setRows(prev => ({ ...prev, [subject]: { ...prev[subject], [field]: value } }));
  };

  const saveAll = async () => {
    if (!selectedClass) { toast.error('Select a class first'); return; }
    if (!teacherSubject) { toast.error('Enter your subject first'); return; }
    setLoading(true);
    try {
      await teacherApi.upsertWeeklySummary({
        classId: selectedClass,
        weekStartDate: weekDate,
        subject: teacherSubject,
        ...rows[teacherSubject],
      });
      toast.success('Weekly summary saved!');
    } catch {
      toast.error('Failed to save summary');
    } finally {
      setLoading(false);
    }
  };

  const subjects = teacherSubject ? [teacherSubject] : [];

  return (
    <PageLayout title="Weekly Summary">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="w-48">
            <Select label="Class" options={classes.map(c => ({ value: c.id, label: c.name }))} placeholder="Select class" value={selectedClass} onChange={e => setSelectedClass(e.target.value)} />
          </div>
          <div className="flex-1 min-w-44">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Subject</label>
            <SubjectBadge subject={teacherSubject} loading={subjectLoading} />
          </div>
          <div className="w-44">
            <Input label="Week Starting" type="date" value={weekDate} onChange={e => setWeekDate(e.target.value)} />
          </div>
          <Button onClick={saveAll} loading={loading} icon={<Save className="w-4 h-4" />}>Save</Button>
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
                        className="w-full border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary-400 bg-white"
                        value={(rows[subject] as any)?.[field] || ''}
                        onChange={e => updateRow(subject, field, e.target.value)}
                        placeholder="—"
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
