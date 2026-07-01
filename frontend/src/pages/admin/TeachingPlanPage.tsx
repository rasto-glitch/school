import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { GraduationCap, Plus, Trash2, RefreshCw, Users, AlertTriangle } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';

interface Line {
  requirementId: string | null; classId: string; className: string | null;
  subjectId: string; subjectName: string | null;
  periodsPerWeek: number; maxPerDay: number; roomId: string | null; roomName: string | null;
}
interface TeacherPlan {
  id: string; fullName: string; subject: string | null;
  target: number | null; load: number; placed: number; lines: Line[];
}
interface Pick { id: string; name: string }
interface UnassignedLine { classId: string; className: string | null; subjectId: string; subjectName: string | null; periodsPerWeek: number }

export default function TeachingPlanPage() {
  const { t } = useTranslation();
  const [teachers, setTeachers] = useState<TeacherPlan[]>([]);
  const [classes, setClasses] = useState<Pick[]>([]);
  const [subjects, setSubjects] = useState<Pick[]>([]);
  const [rooms, setRooms] = useState<Pick[]>([]);
  const [unassignedPeriods, setUnassignedPeriods] = useState(0);
  const [unassignedLines, setUnassignedLines] = useState<UnassignedLine[]>([]);
  const [selectedTeacherId, setSelectedTeacherId] = useState('');
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);

  // Add-line form + "set all lines to N" shortcut.
  const [addSubjectId, setAddSubjectId] = useState('');
  const [addClassId, setAddClassId] = useState('');
  const [addPeriods, setAddPeriods] = useState('1');
  const [fillN, setFillN] = useState('');

  const reload = () =>
    adminApi.getTeachingPlan().then(r => {
      const d = r.data;
      setTeachers(d.teachers || []);
      setClasses(d.classes || []);
      setSubjects(d.subjects || []);
      setRooms(d.rooms || []);
      setUnassignedPeriods(d.unassignedPeriods || 0);
      setUnassignedLines(d.unassignedLines || []);
      setSelectedTeacherId(prev => prev || (d.teachers?.[0]?.id ?? ''));
    }).finally(() => setLoading(false));

  useEffect(() => { reload(); }, []);

  const selected = useMemo(() => teachers.find(t => t.id === selectedTeacherId) || null, [teachers, selectedTeacherId]);

  const failMsg = () => t('teachingPlan.save_failed', 'Could not save the requirement.');

  // Upsert a (class, subject) line owned by the selected teacher.
  const saveLine = async (line: Line, patch: Partial<Line>) => {
    if (!selectedTeacherId) return;
    try {
      await adminApi.upsertTeachingRequirement({
        classId: line.classId, subjectId: line.subjectId, teacherId: selectedTeacherId,
        periodsPerWeek: patch.periodsPerWeek !== undefined ? patch.periodsPerWeek : line.periodsPerWeek,
        maxPerDay: patch.maxPerDay !== undefined ? patch.maxPerDay : line.maxPerDay,
        roomId: patch.roomId !== undefined ? patch.roomId : line.roomId,
      });
      await reload();
    } catch (e: any) { toast.error(e.response?.data?.error || failMsg()); }
  };

  const removeLine = async (line: Line) => {
    if (!line.requirementId) return;
    try { await adminApi.deleteTeachingRequirement(line.requirementId); await reload(); }
    catch (e: any) { toast.error(e.response?.data?.error || failMsg()); }
  };

  const addLine = async () => {
    if (!selectedTeacherId || !addSubjectId || !addClassId) { toast.error(t('teachingPlan.pick_class_subject', 'Pick a class and subject.')); return; }
    try {
      await adminApi.upsertTeachingRequirement({
        classId: addClassId, subjectId: addSubjectId, teacherId: selectedTeacherId,
        periodsPerWeek: Number(addPeriods) || 0, maxPerDay: 2, roomId: null,
      });
      setAddSubjectId(''); setAddClassId(''); setAddPeriods('1');
      await reload();
    } catch (e: any) { toast.error(e.response?.data?.error || failMsg()); }
  };

  // Set every line of the selected teacher to N periods/week (bulk convenience).
  const fillAll = async () => {
    if (!selected) return;
    const n = Number(fillN);
    if (!Number.isFinite(n) || n < 0) { toast.error(t('teachingPlan.fill_invalid', 'Enter a number.')); return; }
    try {
      for (const line of selected.lines) {
        await adminApi.upsertTeachingRequirement({
          classId: line.classId, subjectId: line.subjectId, teacherId: selected.id,
          periodsPerWeek: n, maxPerDay: line.maxPerDay, roomId: line.roomId,
        });
      }
      setFillN('');
      await reload();
    } catch (e: any) { toast.error(e.response?.data?.error || failMsg()); }
  };

  const setTarget = async (teacherId: string, raw: string) => {
    const next = raw.trim() === '' ? null : Number(raw);
    try { await adminApi.setTeacherLoadCap(teacherId, next); await reload(); }
    catch (e: any) { toast.error(e.response?.data?.error || failMsg()); }
  };

  const seed = async () => {
    setSeeding(true);
    try {
      const r = await adminApi.seedTeachingPlan();
      const added = r.data?.added ?? 0;
      toast.success(added > 0
        ? t('teachingPlan.seeded', 'Added {{count}} subject(s) from the curriculum.', { count: added })
        : t('teachingPlan.seed_none', 'Nothing new to add — every curriculum subject is already listed.'));
      if (added > 0) await reload();
    } catch (e: any) { toast.error(e.response?.data?.error || failMsg()); }
    finally { setSeeding(false); }
  };

  return (
    <PageLayout title={t('teachingPlan.title', 'Teaching plan')}>
      <div className="space-y-6">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 bg-primary-100 rounded-lg flex items-center justify-center flex-shrink-0"><GraduationCap className="w-5 h-5 text-primary-700" /></div>
              <div>
                <h2 className="font-semibold text-gray-900">{t('teachingPlan.subtitle', 'Weekly teaching load (بەشە وانە)')}</h2>
                <p className="text-sm text-gray-500 mt-0.5 max-w-2xl">{t('teachingPlan.intro_teacher', 'Pick a teacher and set how many periods a week they teach each of their classes. Their total load adds up automatically. This demand drives the timetable.')}</p>
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={seed} loading={seeding}>
              {t('teachingPlan.seed', 'Seed from curriculum')}
            </Button>
          </div>
        </Card>

        {unassignedPeriods > 0 && (
          <Card className="!bg-amber-50 !border-amber-200">
            <p className="text-sm text-amber-900 font-medium flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {t('teachingPlan.unassigned', '{{count}} period(s) with no teacher', { count: unassignedPeriods })}</p>
            {unassignedLines.length > 0 && (
              <ul className="text-xs text-amber-800 list-disc list-inside mt-1 space-y-0.5 max-h-32 overflow-y-auto">
                {unassignedLines.map((u, i) => <li key={i}>{[u.subjectName, u.className].filter(Boolean).join(' · ')} — {u.periodsPerWeek}</li>)}
              </ul>
            )}
          </Card>
        )}

        {/* Teacher load board */}
        <Card className="!p-0 overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex items-center gap-2 bg-gray-50">
            <Users className="w-4 h-4 text-gray-600" />
            <h2 className="font-semibold text-gray-800">{t('teachingPlan.load_board', 'Teacher load')}</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  <th className="px-4 py-2 font-semibold">{t('supervisor.teacher_col', 'Teacher')}</th>
                  <th className="px-3 py-2 font-semibold text-center">{t('teachingPlan.load', 'Load')}</th>
                  <th className="px-3 py-2 font-semibold text-center">{t('teachingPlan.placed', 'Placed')}</th>
                  <th className="px-3 py-2 font-semibold text-center">{t('teachingPlan.target', 'Target')}</th>
                  <th className="px-4 py-2 font-semibold">{t('teachingPlan.status', 'Status')}</th>
                </tr>
              </thead>
              <tbody>
                {teachers.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">{t('admin.no_teachers_schedule', 'No teachers yet.')}</td></tr>
                ) : teachers.map(tc => {
                  const over = tc.target != null && tc.load > tc.target;
                  const under = tc.target != null && tc.load < tc.target;
                  const notPlaced = tc.placed < tc.load;
                  return (
                    <tr key={tc.id} onClick={() => setSelectedTeacherId(tc.id)}
                      className={`border-b border-gray-50 cursor-pointer ${selectedTeacherId === tc.id ? 'bg-primary-50/60' : 'hover:bg-gray-50/50'}`}>
                      <td className="px-4 py-2">
                        <div className="font-medium text-gray-900">{tc.fullName}</div>
                        {tc.subject && <div className="text-[11px] text-gray-400">{tc.subject}</div>}
                      </td>
                      <td className="px-3 py-2 text-center font-semibold text-gray-800">{tc.load}</td>
                      <td className={`px-3 py-2 text-center font-medium ${notPlaced ? 'text-amber-600' : tc.placed > tc.load ? 'text-rose-600' : 'text-emerald-600'}`}>{tc.placed}</td>
                      <td className="px-3 py-2 text-center" onClick={e => e.stopPropagation()}>
                        <input type="number" min={0} defaultValue={tc.target ?? ''} placeholder="—"
                          onBlur={e => { const raw = e.target.value; if ((raw.trim() === '' ? null : Number(raw)) !== (tc.target ?? null)) setTarget(tc.id, raw); }}
                          className="w-16 border border-gray-200 rounded px-2 py-1 text-xs text-center" />
                      </td>
                      <td className="px-4 py-2">
                        {over ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-2 py-0.5">{t('teachingPlan.over_target', 'Over target by {{n}}', { n: tc.load - (tc.target ?? 0) })}</span>
                        ) : under ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">{t('teachingPlan.under_target', '{{n}} to go', { n: (tc.target ?? 0) - tc.load })}</span>
                        ) : tc.load === 0 ? (
                          <span className="text-xs text-gray-400">{t('teachingPlan.no_demand', 'No load')}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">{t('teachingPlan.on_target', 'On target')}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Selected teacher's lines */}
        <Card>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <h2 className="font-semibold text-gray-900">{t('teachingPlan.lines_title', 'Classes & periods per teacher')}</h2>
            <select value={selectedTeacherId} onChange={e => setSelectedTeacherId(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
              {teachers.length === 0 && <option value="">—</option>}
              {teachers.map(tc => <option key={tc.id} value={tc.id}>{tc.fullName}</option>)}
            </select>
            {selected && (
              <span className="ml-auto text-sm">
                <span className="text-gray-500">{t('teachingPlan.load', 'Load')}: </span>
                <span className="font-semibold text-gray-900">{selected.load}</span>
                {selected.target != null && <span className="text-gray-400"> / {selected.target}</span>}
              </span>
            )}
          </div>

          {loading ? (
            <div className="py-10 text-center text-gray-400 text-sm">{t('common.loading_more', 'Loading…')}</div>
          ) : !selected ? (
            <div className="py-10 text-center text-gray-400 text-sm">{t('teachingPlan.no_teachers', 'No teachers yet.')}</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                      <th className="px-3 py-2 font-semibold">{t('teachingPlan.subject', 'Subject')}</th>
                      <th className="px-3 py-2 font-semibold">{t('teachingPlan.class', 'Class')}</th>
                      <th className="px-3 py-2 font-semibold text-center w-28">{t('teachingPlan.per_week', 'Periods/week')}</th>
                      <th className="px-3 py-2 font-semibold text-center w-24">{t('teachingPlan.max_per_day', 'Max/day')}</th>
                      <th className="px-3 py-2 font-semibold">{t('teachingPlan.room', 'Room')}</th>
                      <th className="px-3 py-2 w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {selected.lines.map(line => (
                      <tr key={`${line.classId}:${line.subjectId}`} className="border-b border-gray-50">
                        <td className="px-3 py-2 font-medium text-gray-900">{line.subjectName}</td>
                        <td className="px-3 py-2 text-gray-700">{line.className}</td>
                        <td className="px-3 py-2 text-center">
                          <input type="number" min={0} max={60} defaultValue={line.periodsPerWeek}
                            key={`p-${line.classId}:${line.subjectId}-${line.periodsPerWeek}`}
                            onBlur={e => { const v = Number(e.target.value); if (v !== line.periodsPerWeek) saveLine(line, { periodsPerWeek: v }); }}
                            className="w-16 border border-gray-200 rounded px-2 py-1 text-xs text-center" />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <input type="number" min={1} max={12} defaultValue={line.maxPerDay}
                            key={`m-${line.classId}:${line.subjectId}-${line.maxPerDay}`}
                            onBlur={e => { const v = Number(e.target.value); if (v && v !== line.maxPerDay) saveLine(line, { maxPerDay: v }); }}
                            className="w-14 border border-gray-200 rounded px-2 py-1 text-xs text-center" />
                        </td>
                        <td className="px-3 py-2">
                          <select value={line.roomId ?? ''} onChange={e => saveLine(line, { roomId: e.target.value || null })}
                            className="border border-gray-200 rounded px-2 py-1 text-xs">
                            <option value="">{t('teachingPlan.any_room', 'Any')}</option>
                            {rooms.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-center">
                          {line.requirementId
                            ? <button type="button" onClick={() => removeLine(line)} className="text-gray-300 hover:text-rose-500" title={t('teachingPlan.clear_line', 'Clear')}><Trash2 className="w-4 h-4" /></button>
                            : null}
                        </td>
                      </tr>
                    ))}
                    {selected.lines.length === 0 && (
                      <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400 text-sm">{t('teachingPlan.empty_teacher', 'This teacher has no classes/subjects yet — add one below or seed from the curriculum.')}</td></tr>
                    )}
                    {/* Add a class/subject line */}
                    <tr className="bg-gray-50/60">
                      <td className="px-3 py-2">
                        <select value={addSubjectId} onChange={e => setAddSubjectId(e.target.value)} className="border border-gray-200 rounded px-2 py-1 text-xs w-full">
                          <option value="">{t('teachingPlan.pick_subject_opt', 'Add subject…')}</option>
                          {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select value={addClassId} onChange={e => setAddClassId(e.target.value)} className="border border-gray-200 rounded px-2 py-1 text-xs w-full">
                          <option value="">{t('teachingPlan.pick_class', 'Class…')}</option>
                          {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input type="number" min={0} max={60} value={addPeriods} onChange={e => setAddPeriods(e.target.value)} className="w-16 border border-gray-200 rounded px-2 py-1 text-xs text-center" />
                      </td>
                      <td className="px-3 py-2" colSpan={2} />
                      <td className="px-3 py-2 text-center">
                        <button type="button" onClick={addLine} disabled={!addSubjectId || !addClassId} className="text-primary-600 hover:text-primary-800 disabled:text-gray-300"><Plus className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {selected.lines.length > 0 && (
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-xs text-gray-500">{t('teachingPlan.fill_all', 'Set every line to')}</span>
                  <input type="number" min={0} max={60} value={fillN} onChange={e => setFillN(e.target.value)} className="w-16 border border-gray-200 rounded px-2 py-1 text-xs text-center" />
                  <Button type="button" size="sm" variant="outline" onClick={fillAll} disabled={fillN.trim() === ''}>{t('teachingPlan.apply', 'Apply')}</Button>
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </PageLayout>
  );
}
