import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { CalendarClock, Trash2 } from 'lucide-react';
import Modal from '../common/Modal';
import Select from '../common/Select';
import Button from '../common/Button';
import { adminApi } from '../../services/api';

interface FilingWindow { id: string; term: string; opensOn: string; closesOn: string; isOpen: boolean }

// Admin modal to set/clear per-term grade filing windows. While a term's window
// is open, teachers may file grades for it; outside it, the server rejects the
// teacher grade endpoint (the window is AUTHORITATIVE — see migration 060).
export default function SetGradeWindowModal({
  isOpen, onClose, onSaved,
}: { isOpen: boolean; onClose: () => void; onSaved?: () => void }) {
  const { t } = useTranslation();
  const [terms, setTerms] = useState<string[]>([]);
  const [windows, setWindows] = useState<FilingWindow[]>([]);
  const [term, setTerm] = useState('');
  const [opensOn, setOpensOn] = useState('');
  const [closesOn, setClosesOn] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const r = await adminApi.getGradeFilingWindows();
      setTerms(r.data?.terms ?? []);
      setWindows(r.data?.windows ?? []);
    } catch { /* read-only fetch — ignore */ }
  };

  useEffect(() => {
    if (!isOpen) return;
    setTerm(''); setOpensOn(''); setClosesOn('');
    void load();
  }, [isOpen]);

  // Pre-fill the dates when the chosen term already has a window (edit flow).
  useEffect(() => {
    const existing = windows.find(w => w.term === term);
    if (existing) { setOpensOn(existing.opensOn); setClosesOn(existing.closesOn); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  const save = async () => {
    if (!term) { toast.error(t('admin.gradeWindow.pick_term')); return; }
    if (!opensOn || !closesOn) { toast.error(t('admin.gradeWindow.pick_dates')); return; }
    if (closesOn < opensOn) { toast.error(t('admin.gradeWindow.dates_order')); return; }
    setSaving(true);
    try {
      await adminApi.setGradeFilingWindow({ term, opensOn, closesOn });
      toast.success(t('admin.gradeWindow.saved'));
      await load();
      onSaved?.();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || t('admin.gradeWindow.save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const clear = async (w: FilingWindow) => {
    try {
      await adminApi.deleteGradeFilingWindow(w.id);
      toast.success(t('admin.gradeWindow.cleared'));
      await load();
      onSaved?.();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || t('admin.gradeWindow.save_failed'));
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('admin.gradeWindow.title')} size="lg">
      <div className="space-y-5">
        <p className="text-sm text-gray-500">{t('admin.gradeWindow.intro')}</p>

        {windows.length > 0 && (
          <div className="space-y-2">
            {windows.map(w => (
              <div key={w.id} className="flex items-center gap-3 rounded-xl border border-gray-200 p-3">
                <CalendarClock className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{w.term}</p>
                  <p className="text-xs text-gray-500">{w.opensOn} → {w.closesOn}</p>
                </div>
                {w.isOpen
                  ? <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">{t('admin.gradeWindow.open')}</span>
                  : <span className="text-xs text-gray-400">{t('admin.gradeWindow.closed')}</span>}
                <button
                  onClick={() => clear(w)}
                  className="p-1.5 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                  aria-label={t('admin.gradeWindow.clear')}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-3 border-t border-gray-100 pt-4">
          <Select
            label={t('admin.gradeWindow.term')}
            options={terms.map(tm => ({ value: tm, label: tm }))}
            placeholder={terms.length ? t('admin.gradeWindow.pick_term') : t('admin.gradeWindow.no_terms')}
            value={term}
            onChange={e => setTerm(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('admin.gradeWindow.opens')}</label>
              <input type="date" value={opensOn} onChange={e => setOpensOn(e.target.value)} className="input-field w-full text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('admin.gradeWindow.closes')}</label>
              <input type="date" value={closesOn} min={opensOn || undefined} onChange={e => setClosesOn(e.target.value)} className="input-field w-full text-sm" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={onClose}>{t('common.cancel')}</Button>
            <Button size="sm" onClick={save} loading={saving}>{t('admin.gradeWindow.save')}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
