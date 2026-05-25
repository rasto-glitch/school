import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Star, Check, Send, StickyNote } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import EmptyState from '../../components/common/EmptyState';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import type { PendingGrade } from '../../types';
import { getMarkNames, gradeTotal } from '../../utils/marks';
import { format, parseISO } from 'date-fns';

// One pending grade row in the review queue. The admin can edit each mark
// value, attach a parent-visible note, then release. Releasing is what makes
// the grade (and any note) visible to the parent.
function GradeCard({ grade, onReleased }: { grade: PendingGrade; onReleased: (id: string) => void }) {
  const { t } = useTranslation();
  const markNames = useMemo(() => getMarkNames(grade), [grade]);

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

  // Persist mark edits + note (called on release, and via the explicit Save Note button)
  const persist = async () => {
    await adminApi.updateGrade(grade.id, {
      marks: marks.map(m => ({ name: m.name, value: parseFloat(m.value) || 0 })),
      adminNote: note.trim() || null,
    });
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
      // Save any pending mark/note edits first, then release.
      if (dirty || note.trim() !== (grade.adminNote ?? '')) await persist();
      await adminApi.releaseGrades([grade.id]);
      toast.success(t('grade_review.released_one'));
      onReleased(grade.id);
    } catch {
      toast.error(t('common.error'));
      setReleasing(false);
    }
  };

  return (
    <Card className="!p-0 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-gray-50 border-b border-gray-100">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 truncate">{grade.students?.fullName || '—'}</p>
          <p className="text-xs text-gray-500 truncate">
            {[grade.classes?.name, grade.subject, grade.gradingPeriod].filter(Boolean).join(' · ')}
            {grade.teachers?.fullName ? ` — ${grade.teachers.fullName}` : ''}
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
  const [grades, setGrades] = useState<PendingGrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [releasingAll, setReleasingAll] = useState(false);

  const load = () => {
    setLoading(true);
    adminApi.getPendingGrades()
      .then(r => setGrades(r.data || []))
      .catch(() => toast.error(t('common.error')))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const onReleased = (id: string) => setGrades(prev => prev.filter(g => g.id !== id));

  const releaseAll = async () => {
    if (grades.length === 0) return;
    if (!confirm(t('grade_review.confirm_release_all', { count: grades.length }))) return;
    setReleasingAll(true);
    try {
      await adminApi.releaseGrades(grades.map(g => g.id));
      toast.success(t('grade_review.released_all', { count: grades.length }));
      setGrades([]);
    } catch {
      toast.error(t('common.error'));
    } finally {
      setReleasingAll(false);
    }
  };

  return (
    <PageLayout title={t('grade_review.title')} subtitle={t('grade_review.subtitle')}>
      {loading ? <LoadingSpinner /> : grades.length === 0 ? (
        <EmptyState title={t('grade_review.empty')} icon={<Check className="w-8 h-8 text-gray-400" />} />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">{t('grade_review.pending_count', { count: grades.length })}</p>
            <Button variant="secondary" onClick={releaseAll} loading={releasingAll} icon={<Star className="w-4 h-4" />}>
              {t('grade_review.release_all')}
            </Button>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {grades.map(g => <GradeCard key={g.id} grade={g} onReleased={onReleased} />)}
          </div>
        </div>
      )}
    </PageLayout>
  );
}
