import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Replace, Calendar, Star, Check, X, UserX, Bell } from 'lucide-react';
import { adminApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import FeatureNotEnabled from '../../components/common/FeatureNotEnabled';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

interface Absentee { teacherId: string; fullName: string; leaveType: string }
interface SubRow {
  id: string; periodIndex: number; classId: string; className: string | null;
  subjectId: string | null; subjectName: string | null;
  originalTeacherId: string | null; originalTeacherName: string | null;
  substituteTeacherId: string | null; substituteTeacherName: string | null;
  status: string; note: string | null;
}
interface TeacherOpt { id: string; fullName: string }
interface Candidate { teacherId: string; fullName: string; qualified: boolean }
interface Lesson {
  classId: string; className: string | null; subjectId: string | null; subjectName: string | null;
  periodIndex: number; roomName: string | null;
  existing: { id: string; substituteTeacherId: string | null; substituteTeacherName: string | null; status: string } | null;
  candidates: Candidate[];
}

export default function SubstitutionsPage() {
  const { t } = useTranslation();
  const { school } = useAuthStore();
  // Part of the Schedule 2.0 premium suite (`timetable` flag).
  if (school?.features?.timetable !== true) return <FeatureNotEnabled title={t('nav.substitutions', 'Substitutes')} />;
  return <SubstitutionsInner />;
}

function SubstitutionsInner() {
  const { t } = useTranslation();
  const [date, setDate] = useState(todayStr());
  const [dayOfWeek, setDayOfWeek] = useState<number | null>(null);
  const [absentees, setAbsentees] = useState<Absentee[]>([]);
  const [board, setBoard] = useState<SubRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherOpt[]>([]);
  const [selectedTeacherId, setSelectedTeacherId] = useState('');
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [notifyParents, setNotifyParents] = useState(false);
  const [loadingLessons, setLoadingLessons] = useState(false);

  const loadBoard = useCallback(() => {
    return adminApi.getSubstitutions(date).then(r => {
      setDayOfWeek(r.data.dayOfWeek);
      setAbsentees(r.data.absentees || []);
      setBoard(r.data.substitutions || []);
      setTeachers(r.data.teachers || []);
    }).catch(() => {});
  }, [date]);

  useEffect(() => { loadBoard(); }, [loadBoard]);

  const loadLessons = useCallback((teacherId: string) => {
    if (!teacherId) { setLessons([]); return Promise.resolve(); }
    setLoadingLessons(true);
    return adminApi.getSubstituteLessons(teacherId, date).then(r => {
      const ls: Lesson[] = r.data.lessons || [];
      setLessons(ls);
      // Pre-select the top-ranked candidate for each open lesson.
      const next: Record<string, string> = {};
      for (const l of ls) {
        const key = `${l.classId}:${l.periodIndex}`;
        if (!l.existing && l.candidates[0]) next[key] = l.candidates[0].teacherId;
      }
      setChoice(next);
    }).finally(() => setLoadingLessons(false));
  }, [date]);

  const pickTeacher = (id: string) => { setSelectedTeacherId(id); loadLessons(id); };

  const assign = async (l: Lesson) => {
    const key = `${l.classId}:${l.periodIndex}`;
    const substituteTeacherId = choice[key];
    if (!substituteTeacherId) { toast.error(t('substitutions.pick_sub', 'Choose a substitute first.')); return; }
    try {
      await adminApi.assignSubstitution({
        date, classId: l.classId, periodIndex: l.periodIndex, substituteTeacherId,
        originalTeacherId: selectedTeacherId || null, subjectId: l.subjectId, notifyParents,
      });
      toast.success(t('substitutions.assigned', 'Substitute assigned.'));
      await Promise.all([loadLessons(selectedTeacherId), loadBoard()]);
    } catch (e: any) { toast.error(e.response?.data?.error || t('substitutions.failed', 'Could not assign the substitute.')); }
  };

  const unassign = async (id: string) => {
    try {
      await adminApi.deleteSubstitution(id);
      await Promise.all([selectedTeacherId ? loadLessons(selectedTeacherId) : Promise.resolve(), loadBoard()]);
    } catch (e: any) { toast.error(e.response?.data?.error || t('substitutions.failed', 'Could not assign the substitute.')); }
  };

  const dayName = dayOfWeek != null ? t(`common.days.${DAY_NAMES[dayOfWeek]}`) : '';

  return (
    <PageLayout title={t('substitutions.title', 'Substitutes')}>
      <div className="space-y-6">
        {/* Date + absentees */}
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-gray-500" />
              <input type="date" value={date} onChange={e => { setDate(e.target.value); setSelectedTeacherId(''); setLessons([]); }}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              {dayName && <span className="text-sm text-gray-500">{dayName}</span>}
            </div>
          </div>
          <div className="mt-4">
            <p className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-2 flex items-center gap-1.5"><UserX className="w-3.5 h-3.5" /> {t('substitutions.on_leave', 'On leave today')}</p>
            {absentees.length === 0 ? (
              <p className="text-sm text-gray-400">{t('substitutions.none_on_leave', 'No staff recorded on leave for this date.')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {absentees.map(a => (
                  <button key={a.teacherId} type="button" onClick={() => pickTeacher(a.teacherId)}
                    className={`inline-flex items-center gap-1.5 rounded-full pl-3 pr-2.5 py-1 text-xs font-medium border ${selectedTeacherId === a.teacherId ? 'bg-primary-600 text-white border-primary-600' : 'bg-rose-50 text-rose-700 border-rose-200 hover:border-rose-300'}`}>
                    {a.fullName}
                    <span className={`text-[10px] ${selectedTeacherId === a.teacherId ? 'text-primary-100' : 'text-rose-400'}`}>{t(`substitutions.leaveType.${a.leaveType}`, a.leaveType)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="text-xs font-medium text-gray-600">{t('substitutions.cover_for', 'Cover lessons for')}</label>
            <select value={selectedTeacherId} onChange={e => pickTeacher(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">{t('substitutions.pick_teacher', 'Select a teacher…')}</option>
              {teachers.map(tc => <option key={tc.id} value={tc.id}>{tc.fullName}</option>)}
            </select>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer ml-auto">
              <input type="checkbox" checked={notifyParents} onChange={e => setNotifyParents(e.target.checked)} className="rounded border-gray-300" />
              <Bell className="w-3.5 h-3.5 text-gray-400" /> {t('substitutions.notify_parents', 'Notify parents')}
            </label>
          </div>
        </Card>

        {/* Absent teacher's lessons + candidate covers */}
        {selectedTeacherId && (
          <Card className="!p-0 overflow-hidden">
            <div className="p-4 border-b border-gray-100 bg-gray-50">
              <h2 className="font-semibold text-gray-800">{t('substitutions.lessons_title', 'Lessons to cover')}</h2>
            </div>
            {loadingLessons ? (
              <div className="p-10 text-center text-gray-400 text-sm">{t('common.loading_more', 'Loading…')}</div>
            ) : lessons.length === 0 ? (
              <div className="p-10 text-center text-gray-400 text-sm">{t('substitutions.no_lessons', 'This teacher has no lessons on {{day}}.', { day: dayName })}</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {lessons.map(l => {
                  const key = `${l.classId}:${l.periodIndex}`;
                  return (
                    <div key={key} className="p-4 flex flex-wrap items-center gap-3">
                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 text-blue-700 text-xs font-bold shrink-0">P{l.periodIndex}</span>
                      <div className="min-w-[140px]">
                        <div className="font-medium text-gray-900">{l.className}</div>
                        <div className="text-xs text-gray-500">{[l.subjectName, l.roomName].filter(Boolean).join(' · ') || '—'}</div>
                      </div>
                      {l.existing ? (
                        <div className="ml-auto flex items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">
                            <Check className="w-3.5 h-3.5" /> {l.existing.substituteTeacherName || t('substitutions.assigned', 'Substitute assigned.')}
                          </span>
                          <button type="button" onClick={() => unassign(l.existing!.id)} className="text-gray-300 hover:text-rose-500" title={t('substitutions.unassign', 'Remove')}><X className="w-4 h-4" /></button>
                        </div>
                      ) : (
                        <div className="ml-auto flex items-center gap-2">
                          {l.candidates.length === 0 ? (
                            <span className="text-xs text-amber-600">{t('substitutions.no_candidates', 'No free teacher available')}</span>
                          ) : (
                            <>
                              <select value={choice[key] || ''} onChange={e => setChoice(c => ({ ...c, [key]: e.target.value }))}
                                className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm min-w-[180px]">
                                {l.candidates.map(c => <option key={c.teacherId} value={c.teacherId}>{c.qualified ? '★ ' : ''}{c.fullName}</option>)}
                              </select>
                              <Button type="button" size="sm" onClick={() => assign(l)}>{t('substitutions.assign', 'Assign')}</Button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="px-4 py-2 text-[11px] text-gray-400 flex items-center gap-1.5"><Star className="w-3 h-3 text-amber-500" /> {t('substitutions.qualified_hint', '★ marks teachers who teach this subject.')}</div>
              </div>
            )}
          </Card>
        )}

        {/* Board: every cover recorded for the date */}
        <Card className="!p-0 overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex items-center gap-2 bg-gray-50">
            <Replace className="w-4 h-4 text-gray-600" />
            <h2 className="font-semibold text-gray-800">{t('substitutions.board_title', 'Covers for this date')}</h2>
          </div>
          {board.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">{t('substitutions.board_empty', 'No substitutions recorded for this date yet.')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                    <th className="px-4 py-2 font-semibold">P</th>
                    <th className="px-3 py-2 font-semibold">{t('substitutions.class', 'Class')}</th>
                    <th className="px-3 py-2 font-semibold">{t('substitutions.subject', 'Subject')}</th>
                    <th className="px-3 py-2 font-semibold">{t('substitutions.absent', 'Absent')}</th>
                    <th className="px-3 py-2 font-semibold">{t('substitutions.substitute', 'Substitute')}</th>
                    <th className="px-3 py-2 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {board.map(s => (
                    <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-2 font-semibold text-gray-700">P{s.periodIndex}</td>
                      <td className="px-3 py-2 text-gray-900">{s.className}</td>
                      <td className="px-3 py-2 text-gray-600">{s.subjectName || '—'}</td>
                      <td className="px-3 py-2 text-gray-600">{s.originalTeacherName || '—'}</td>
                      <td className="px-3 py-2 font-medium text-emerald-700">{s.substituteTeacherName || '—'}</td>
                      <td className="px-3 py-2 text-center">
                        <button type="button" onClick={() => unassign(s.id)} className="text-gray-300 hover:text-rose-500"><X className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </PageLayout>
  );
}
