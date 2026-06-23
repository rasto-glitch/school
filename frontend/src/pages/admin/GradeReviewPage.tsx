import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { ChevronLeft, ChevronRight, Send, StickyNote, Check, Users, GraduationCap } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import Select from '../../components/common/Select';
import EmptyState from '../../components/common/EmptyState';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import GradeImportExport from '../../components/admin/GradeImportExport';
import type { GradeReviewOverview, GradeReviewClass, GradeReviewStudent, GradeReviewPending } from '../../types';
import { format, parseISO } from 'date-fns';

// Thin coloured bar: green when complete, primary when partial, grey when none.
function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const color = total === 0 ? 'bg-gray-200' : pct >= 100 ? 'bg-green-500' : pct > 0 ? 'bg-primary-500' : 'bg-gray-200';
  return (
    <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
      <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// Leaf: one pending grade with editable marks + parent-visible note + release.
function GradeCard({ grade, onReleased, onSaved }: {
  grade: GradeReviewPending;
  onReleased: (ids: string[]) => void;
  onSaved: (patch: Partial<GradeReviewPending>) => void;
}) {
  const { t } = useTranslation();
  const [marks, setMarks] = useState(() => grade.marks.map(m => ({ name: m.name, value: String(m.value ?? '') })));
  const [note, setNote] = useState(grade.adminNote ?? '');
  const [savingNote, setSavingNote] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [dirty, setDirty] = useState(false);

  const total = marks.reduce((s, m) => s + (parseFloat(m.value) || 0), 0);

  const setMarkValue = (i: number, v: string) => {
    setMarks(prev => prev.map((m, idx) => idx === i ? { ...m, value: v } : m));
    setDirty(true);
  };

  const persist = async () => {
    const payloadMarks = marks.map(m => ({ name: m.name, value: parseFloat(m.value) || 0 }));
    await adminApi.updateGrade(grade.id, { marks: payloadMarks, adminNote: note.trim() || null });
    onSaved({ marks: payloadMarks, adminNote: note.trim() || null });
  };

  const saveNote = async () => {
    setSavingNote(true);
    try {
      await persist();
      setDirty(false);
      toast.success(t('grade_review.saved'));
    } catch {
      toast.error(t('common.error'));
    } finally {
      setSavingNote(false);
    }
  };

  const release = async () => {
    setReleasing(true);
    try {
      if (dirty || note.trim() !== (grade.adminNote ?? '')) await persist();
      await adminApi.releaseGrades([grade.id]);
      toast.success(t('grade_review.released_one'));
      onReleased([grade.id]);
    } catch {
      toast.error(t('common.error'));
      setReleasing(false);
    }
  };

  return (
    <Card className="!p-0 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-gray-50 border-b border-gray-100">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 truncate">{grade.subject}</p>
          <p className="text-xs text-gray-500 truncate">
            {[grade.gradingPeriod, grade.teacherName].filter(Boolean).join(' · ')}
          </p>
        </div>
        <span className="text-xs text-gray-400 flex-shrink-0">{format(parseISO(grade.createdAt), 'MMM d')}</span>
      </div>

      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {marks.length === 0 && <p className="text-sm text-gray-400 col-span-full">{t('grade_review.no_marks')}</p>}
          {marks.map((m, i) => (
            <label key={i} className="block">
              <span className="block text-xs font-medium text-gray-500 mb-1 truncate">{m.name}</span>
              <input
                type="number"
                inputMode="decimal"
                className="input-field !py-1.5"
                value={m.value}
                onChange={e => setMarkValue(i, e.target.value)}
              />
            </label>
          ))}
        </div>
        {marks.length > 0 && (
          <p className="text-sm text-gray-600">
            {t('grades.total')}: <span className="font-bold text-gray-900">{total.toFixed(1)}</span>
          </p>
        )}

        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 mb-1">
            <StickyNote className="w-3.5 h-3.5" /> {t('grade_review.note_label')}
          </label>
          <textarea
            className="input-field min-h-[64px] resize-none"
            placeholder={t('grade_review.note_ph')}
            value={note}
            onChange={e => { setNote(e.target.value); setDirty(true); }}
          />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button variant="secondary" onClick={saveNote} loading={savingNote} disabled={releasing}>
            {t('grade_review.save')}
          </Button>
          <Button onClick={release} loading={releasing} icon={<Send className="w-4 h-4" />}>
            {t('grade_review.release')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function GradeReviewPage() {
  const { t } = useTranslation();
  const [overview, setOverview] = useState<GradeReviewOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [term, setTerm] = useState('');
  const [classId, setClassId] = useState<string | null>(null);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [releasingAll, setReleasingAll] = useState(false);

  const fetchOverview = (tm: string) => {
    setLoading(true);
    adminApi.getGradeReviewOverview(tm || undefined)
      .then(r => { setOverview(r.data); setTerm(r.data?.selectedTerm || ''); })
      .catch(() => toast.error(t('common.error')))
      .finally(() => setLoading(false));
  };
  useEffect(() => { fetchOverview(term); /* eslint-disable-next-line */ }, []);

  const onTermChange = (tm: string) => { setClassId(null); setStudentId(null); fetchOverview(tm); };

  // Local state updates so we don't refetch on every save/release.
  const mutateStudent = (sid: string, fn: (s: GradeReviewStudent) => GradeReviewStudent) =>
    setOverview(ov => ov && {
      ...ov,
      classes: ov.classes.map(c => ({ ...c, students: c.students.map(s => s.studentId === sid ? fn(s) : s) })),
    });

  const handleReleased = (sid: string, ids: string[]) =>
    mutateStudent(sid, s => {
      const pending = s.pending.filter(p => !ids.includes(p.id));
      return { ...s, pending, pendingCount: pending.length };
    });

  const handleSaved = (sid: string, gradeId: string, patch: Partial<GradeReviewPending>) =>
    mutateStudent(sid, s => ({ ...s, pending: s.pending.map(p => p.id === gradeId ? { ...p, ...patch } : p) }));

  const selectedClass: GradeReviewClass | undefined = overview?.classes.find(c => c.classId === classId);
  const selectedStudent: GradeReviewStudent | undefined = selectedClass?.students.find(s => s.studentId === studentId);

  const releaseAllForStudent = async (s: GradeReviewStudent) => {
    const ids = s.pending.map(p => p.id);
    if (ids.length === 0) return;
    setReleasingAll(true);
    try {
      await adminApi.releaseGrades(ids);
      toast.success(t('grade_review.released_all', { count: ids.length }));
      handleReleased(s.studentId, ids);
    } catch {
      toast.error(t('common.error'));
    } finally {
      setReleasingAll(false);
    }
  };

  const classPending = (c: GradeReviewClass) => c.students.reduce((n, s) => n + s.pendingCount, 0);

  return (
    <PageLayout title={t('grade_review.title')} subtitle={t('grade_review.subtitle')}>
      {loading ? <LoadingSpinner /> : !overview ? (
        <EmptyState title={t('common.error')} icon={<Check className="w-8 h-8 text-gray-400" />} />
      ) : (
        <div className="space-y-4">
          {/* Bulk import / export (report-card grid) */}
          <GradeImportExport terms={overview.terms} onImported={() => fetchOverview(term)} />

          {/* Term selector + breadcrumb */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <nav className="flex items-center gap-1 text-sm text-gray-500 min-w-0">
              <button className="hover:text-primary-600 font-medium" onClick={() => { setClassId(null); setStudentId(null); }}>
                {t('grade_review.all_classes')}
              </button>
              {selectedClass && (
                <>
                  <ChevronRight className="w-4 h-4 flex-shrink-0" />
                  <button className="hover:text-primary-600 font-medium truncate" onClick={() => setStudentId(null)}>
                    {selectedClass.className}
                  </button>
                </>
              )}
              {selectedStudent && (
                <>
                  <ChevronRight className="w-4 h-4 flex-shrink-0" />
                  <span className="text-gray-900 font-semibold truncate">{selectedStudent.fullName}</span>
                </>
              )}
            </nav>
            {overview.terms.length > 0 && (
              <div className="w-44">
                <Select
                  options={overview.terms.map(tm => ({ value: tm, label: tm }))}
                  value={term}
                  onChange={e => onTermChange(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* Level 1 — classes */}
          {!selectedClass && (
            overview.classes.length === 0 ? (
              <EmptyState title={t('grade_review.no_classes')} icon={<GraduationCap className="w-8 h-8 text-gray-400" />} />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {overview.classes.map(c => {
                  const pend = classPending(c);
                  return (
                    <button key={c.classId} onClick={() => setClassId(c.classId)} className="text-left">
                      <Card className="hover:shadow-md transition-shadow">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <h3 className="font-semibold text-gray-900 truncate">{c.className}</h3>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {pend > 0 && (
                              <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-semibold">
                                {t('grade_review.pending_badge', { count: pend })}
                              </span>
                            )}
                            <ChevronRight className="w-4 h-4 text-gray-400" />
                          </div>
                        </div>
                        <ProgressBar done={c.studentsComplete} total={c.totalStudents} />
                        <p className="text-xs text-gray-500 mt-1.5">
                          {t('grade_review.students_complete', { done: c.studentsComplete, total: c.totalStudents })}
                        </p>
                      </Card>
                    </button>
                  );
                })}
              </div>
            )
          )}

          {/* Level 2 — students in the selected class */}
          {selectedClass && !selectedStudent && (
            <div className="space-y-2">
              <button onClick={() => setClassId(null)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-primary-600">
                <ChevronLeft className="w-4 h-4" /> {t('grade_review.all_classes')}
              </button>
              {selectedClass.students.length === 0 ? (
                <EmptyState title={t('grade_review.no_students')} icon={<Users className="w-8 h-8 text-gray-400" />} />
              ) : (
                selectedClass.students.map(s => (
                  <button key={s.studentId} onClick={() => setStudentId(s.studentId)} className="w-full text-left">
                    <Card className="!py-3 hover:shadow-md transition-shadow">
                      <div className="flex items-center justify-between gap-3 mb-1.5">
                        <p className="font-medium text-gray-900 truncate">{s.fullName}</p>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {s.pendingCount > 0 && (
                            <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-semibold">
                              {t('grade_review.pending_badge', { count: s.pendingCount })}
                            </span>
                          )}
                          <ChevronRight className="w-4 h-4 text-gray-400" />
                        </div>
                      </div>
                      <ProgressBar done={s.gradedSubjects} total={s.totalSubjects} />
                      <p className="text-xs text-gray-500 mt-1.5">
                        {t('grade_review.subjects_graded', { done: s.gradedSubjects, total: s.totalSubjects })}
                      </p>
                    </Card>
                  </button>
                ))
              )}
            </div>
          )}

          {/* Level 3 — the student's pending grades */}
          {selectedStudent && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <button onClick={() => setStudentId(null)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-primary-600">
                  <ChevronLeft className="w-4 h-4" /> {selectedClass?.className}
                </button>
                {selectedStudent.pending.length > 0 && (
                  <Button variant="secondary" onClick={() => releaseAllForStudent(selectedStudent)} loading={releasingAll} icon={<Send className="w-4 h-4" />}>
                    {t('grade_review.release_student')}
                  </Button>
                )}
              </div>
              {selectedStudent.pending.length === 0 ? (
                <EmptyState title={t('grade_review.no_pending_student')} icon={<Check className="w-8 h-8 text-gray-400" />} />
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {selectedStudent.pending.map(g => (
                    <GradeCard
                      key={g.id}
                      grade={g}
                      onReleased={ids => handleReleased(selectedStudent.studentId, ids)}
                      onSaved={patch => handleSaved(selectedStudent.studentId, g.id, patch)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </PageLayout>
  );
}
