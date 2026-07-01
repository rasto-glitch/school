import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { ClipboardList, Plus, Trash2, RefreshCw, Users, AlertTriangle } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';

interface Requirement {
  id: string; classId: string; className: string | null;
  subjectId: string; subjectName: string | null;
  teacherId: string | null; teacherName: string | null;
  periodsPerWeek: number; maxPerDay: number;
  roomId: string | null; roomName: string | null;
}
interface LoadRow {
  teacherId: string; fullName: string; subject: string | null;
  maxPeriodsPerWeek: number | null; requiredPeriods: number; placedPeriods: number;
}
interface Pick { id: string; name: string }

export default function TeachingPlanPage() {
  const { t } = useTranslation();
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [classes, setClasses] = useState<Pick[]>([]);
  const [subjects, setSubjects] = useState<Pick[]>([]);
  const [rooms, setRooms] = useState<Pick[]>([]);
  const [load, setLoad] = useState<LoadRow[]>([]);
  const [unassigned, setUnassigned] = useState(0);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);

  // Add-row form state.
  const [addSubjectId, setAddSubjectId] = useState('');
  const [addTeacherId, setAddTeacherId] = useState('');
  const [addPeriods, setAddPeriods] = useState('1');
  const [addMaxPerDay, setAddMaxPerDay] = useState('2');
  const [addRoomId, setAddRoomId] = useState('');

  const reload = () =>
    adminApi.getTeachingPlan().then(r => {
      const d = r.data;
      setRequirements(d.requirements || []);
      setClasses(d.classes || []);
      setSubjects(d.subjects || []);
      setRooms(d.rooms || []);
      setLoad(d.load || []);
      setUnassigned(d.unassignedPeriods || 0);
      setSelectedClassId(prev => prev || (d.classes?.[0]?.id ?? ''));
    }).finally(() => setLoading(false));

  useEffect(() => { reload(); }, []);

  const teacherOptions = useMemo(() => load.map(l => ({ id: l.teacherId, name: l.fullName })), [load]);
  const classReqs = useMemo(
    () => requirements.filter(r => r.classId === selectedClassId).sort((a, b) => (a.subjectName || '').localeCompare(b.subjectName || '')),
    [requirements, selectedClassId],
  );
  const usedSubjectIds = useMemo(() => new Set(classReqs.map(r => r.subjectId)), [classReqs]);
  const availableSubjects = useMemo(() => subjects.filter(s => !usedSubjectIds.has(s.id)), [subjects, usedSubjectIds]);
  const classTotal = useMemo(() => classReqs.reduce((sum, r) => sum + (r.periodsPerWeek || 0), 0), [classReqs]);

  const upsert = async (payload: { classId: string; subjectId: string; teacherId: string | null; periodsPerWeek: number; maxPerDay: number; roomId: string | null }) => {
    try {
      await adminApi.upsertTeachingRequirement(payload);
      await reload();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('teachingPlan.save_failed', 'Could not save the requirement.'));
    }
  };

  const saveField = (r: Requirement, patch: Partial<Requirement>) => upsert({
    classId: r.classId,
    subjectId: r.subjectId,
    teacherId: patch.teacherId !== undefined ? patch.teacherId : r.teacherId,
    periodsPerWeek: patch.periodsPerWeek !== undefined ? patch.periodsPerWeek : r.periodsPerWeek,
    maxPerDay: patch.maxPerDay !== undefined ? patch.maxPerDay : r.maxPerDay,
    roomId: patch.roomId !== undefined ? patch.roomId : r.roomId,
  });

  const removeRow = async (r: Requirement) => {
    if (!window.confirm(t('teachingPlan.confirm_delete', 'Remove {{subject}} from this class?', { subject: r.subjectName || '' }))) return;
    try { await adminApi.deleteTeachingRequirement(r.id); await reload(); }
    catch (e: any) { toast.error(e.response?.data?.error || t('teachingPlan.save_failed', 'Could not save the requirement.')); }
  };

  const addRow = async () => {
    if (!selectedClassId || !addSubjectId) { toast.error(t('teachingPlan.pick_subject', 'Pick a subject first.')); return; }
    await upsert({
      classId: selectedClassId,
      subjectId: addSubjectId,
      teacherId: addTeacherId || null,
      periodsPerWeek: Number(addPeriods) || 0,
      maxPerDay: Number(addMaxPerDay) || 2,
      roomId: addRoomId || null,
    });
    setAddSubjectId(''); setAddTeacherId(''); setAddPeriods('1'); setAddMaxPerDay('2'); setAddRoomId('');
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
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('teachingPlan.save_failed', 'Could not save the requirement.'));
    } finally { setSeeding(false); }
  };

  const capInput = (l: LoadRow) => (
    <input
      type="number" min={0} defaultValue={l.maxPeriodsPerWeek ?? ''}
      placeholder="—"
      onBlur={async e => {
        const raw = e.target.value.trim();
        const next = raw === '' ? null : Number(raw);
        if (next === (l.maxPeriodsPerWeek ?? null)) return;
        try { await adminApi.setTeacherLoadCap(l.teacherId, next); await reload(); }
        catch (err: any) { toast.error(err.response?.data?.error || t('teachingPlan.save_failed', 'Could not save the requirement.')); }
      }}
      className="w-16 border border-gray-200 rounded px-2 py-1 text-xs text-center"
    />
  );

  return (
    <PageLayout title={t('teachingPlan.title', 'Teaching plan')}>
      <div className="space-y-6">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 bg-primary-100 rounded-lg flex items-center justify-center flex-shrink-0"><ClipboardList className="w-5 h-5 text-primary-700" /></div>
              <div>
                <h2 className="font-semibold text-gray-900">{t('teachingPlan.subtitle', 'Weekly teaching load (بەشە وانە)')}</h2>
                <p className="text-sm text-gray-500 mt-0.5 max-w-2xl">{t('teachingPlan.intro', 'For each class, set how many periods a week each subject needs, who teaches it, and its daily cap. This demand drives the timetable and the per-teacher load below.')}</p>
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={seed} loading={seeding}>
              {t('teachingPlan.seed', 'Seed from curriculum')}
            </Button>
          </div>
        </Card>

        {/* Teacher load board */}
        <Card className="!p-0 overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex items-center gap-2 bg-gray-50">
            <Users className="w-4 h-4 text-gray-600" />
            <h2 className="font-semibold text-gray-800">{t('teachingPlan.load_board', 'Teacher load')}</h2>
            {unassigned > 0 && (
              <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                {t('teachingPlan.unassigned', '{{count}} period(s) with no teacher', { count: unassigned })}
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  <th className="px-4 py-2 font-semibold">{t('supervisor.teacher_col', 'Teacher')}</th>
                  <th className="px-3 py-2 font-semibold text-center">{t('teachingPlan.required', 'Required')}</th>
                  <th className="px-3 py-2 font-semibold text-center">{t('teachingPlan.placed', 'Placed')}</th>
                  <th className="px-3 py-2 font-semibold text-center">{t('teachingPlan.cap', 'Cap')}</th>
                  <th className="px-4 py-2 font-semibold">{t('teachingPlan.status', 'Status')}</th>
                </tr>
              </thead>
              <tbody>
                {load.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">{t('admin.no_teachers_schedule', 'No teachers yet.')}</td></tr>
                ) : load.map(l => {
                  const over = l.maxPeriodsPerWeek != null && l.requiredPeriods > l.maxPeriodsPerWeek;
                  const notPlaced = l.placedPeriods < l.requiredPeriods;
                  return (
                    <tr key={l.teacherId} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-2">
                        <div className="font-medium text-gray-900">{l.fullName}</div>
                        {l.subject && <div className="text-[11px] text-gray-400">{l.subject}</div>}
                      </td>
                      <td className="px-3 py-2 text-center font-semibold text-gray-800">{l.requiredPeriods}</td>
                      <td className={`px-3 py-2 text-center font-medium ${notPlaced ? 'text-amber-600' : l.placedPeriods > l.requiredPeriods ? 'text-rose-600' : 'text-emerald-600'}`}>{l.placedPeriods}</td>
                      <td className="px-3 py-2 text-center">{capInput(l)}</td>
                      <td className="px-4 py-2">
                        {over ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-2 py-0.5">
                            {t('teachingPlan.over_cap', 'Over cap by {{n}}', { n: l.requiredPeriods - (l.maxPeriodsPerWeek ?? 0) })}
                          </span>
                        ) : notPlaced ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                            {t('teachingPlan.under_placed', '{{n}} not yet placed', { n: l.requiredPeriods - l.placedPeriods })}
                          </span>
                        ) : l.requiredPeriods === 0 ? (
                          <span className="text-xs text-gray-400">{t('teachingPlan.no_demand', 'No load')}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                            {t('teachingPlan.balanced', 'OK')}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Per-class requirements */}
        <Card>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <h2 className="font-semibold text-gray-900">{t('teachingPlan.class_subjects', 'Subjects & periods per class')}</h2>
            <select value={selectedClassId} onChange={e => setSelectedClassId(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
              {classes.length === 0 && <option value="">—</option>}
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {selectedClassId && (
              <span className="ml-auto text-xs text-gray-500">{t('teachingPlan.class_total', 'Total: {{count}} periods/week', { count: classTotal })}</span>
            )}
          </div>

          {loading ? (
            <div className="py-10 text-center text-gray-400 text-sm">{t('common.loading_more', 'Loading…')}</div>
          ) : !selectedClassId ? (
            <div className="py-10 text-center text-gray-400 text-sm">{t('teachingPlan.no_classes', 'Add a class first.')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                    <th className="px-3 py-2 font-semibold">{t('teachingPlan.subject', 'Subject')}</th>
                    <th className="px-3 py-2 font-semibold">{t('teachingPlan.teacher', 'Teacher')}</th>
                    <th className="px-3 py-2 font-semibold text-center w-28">{t('teachingPlan.per_week', 'Periods/week')}</th>
                    <th className="px-3 py-2 font-semibold text-center w-24">{t('teachingPlan.max_per_day', 'Max/day')}</th>
                    <th className="px-3 py-2 font-semibold">{t('teachingPlan.room', 'Room')}</th>
                    <th className="px-3 py-2 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {classReqs.map(r => (
                    <tr key={r.id} className="border-b border-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-900">{r.subjectName}</td>
                      <td className="px-3 py-2">
                        <select value={r.teacherId ?? ''} onChange={e => saveField(r, { teacherId: e.target.value || null })}
                          className={`border rounded px-2 py-1 text-xs ${r.teacherId ? 'border-gray-200' : 'border-amber-300 bg-amber-50'}`}>
                          <option value="">{t('teachingPlan.unassigned_teacher', '— unassigned —')}</option>
                          {teacherOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input type="number" min={0} max={60} defaultValue={r.periodsPerWeek}
                          onBlur={e => { const v = Number(e.target.value); if (v !== r.periodsPerWeek) saveField(r, { periodsPerWeek: v }); }}
                          className="w-16 border border-gray-200 rounded px-2 py-1 text-xs text-center" />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input type="number" min={1} max={12} defaultValue={r.maxPerDay}
                          onBlur={e => { const v = Number(e.target.value); if (v && v !== r.maxPerDay) saveField(r, { maxPerDay: v }); }}
                          className="w-14 border border-gray-200 rounded px-2 py-1 text-xs text-center" />
                      </td>
                      <td className="px-3 py-2">
                        <select value={r.roomId ?? ''} onChange={e => saveField(r, { roomId: e.target.value || null })}
                          className="border border-gray-200 rounded px-2 py-1 text-xs">
                          <option value="">{t('teachingPlan.any_room', 'Any')}</option>
                          {rooms.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button type="button" onClick={() => removeRow(r)} className="text-gray-300 hover:text-rose-500"><Trash2 className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  ))}
                  {classReqs.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400 text-sm">{t('teachingPlan.empty_class', 'No subjects yet for this class.')}</td></tr>
                  )}
                  {/* Add row */}
                  <tr className="bg-gray-50/60">
                    <td className="px-3 py-2">
                      <select value={addSubjectId} onChange={e => setAddSubjectId(e.target.value)} className="border border-gray-200 rounded px-2 py-1 text-xs w-full">
                        <option value="">{t('teachingPlan.pick_subject_opt', 'Add subject…')}</option>
                        {availableSubjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select value={addTeacherId} onChange={e => setAddTeacherId(e.target.value)} className="border border-gray-200 rounded px-2 py-1 text-xs">
                        <option value="">{t('teachingPlan.unassigned_teacher', '— unassigned —')}</option>
                        {teacherOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input type="number" min={0} max={60} value={addPeriods} onChange={e => setAddPeriods(e.target.value)} className="w-16 border border-gray-200 rounded px-2 py-1 text-xs text-center" />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input type="number" min={1} max={12} value={addMaxPerDay} onChange={e => setAddMaxPerDay(e.target.value)} className="w-14 border border-gray-200 rounded px-2 py-1 text-xs text-center" />
                    </td>
                    <td className="px-3 py-2">
                      <select value={addRoomId} onChange={e => setAddRoomId(e.target.value)} className="border border-gray-200 rounded px-2 py-1 text-xs">
                        <option value="">{t('teachingPlan.any_room', 'Any')}</option>
                        {rooms.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button type="button" onClick={addRow} disabled={!addSubjectId} className="text-primary-600 hover:text-primary-800 disabled:text-gray-300"><Plus className="w-4 h-4" /></button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </PageLayout>
  );
}
