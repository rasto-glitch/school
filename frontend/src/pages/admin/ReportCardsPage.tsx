import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { FileText, Eye, Download, MessageSquarePlus, Settings as SettingsIcon, RefreshCw, Check, Send, EyeOff } from 'lucide-react';
import { adminApi, reportCardApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import Modal from '../../components/common/Modal';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';

interface RosterRow {
  id: string; fullName: string; className: string | null;
  totalSubjects: number; releasedSubjects: number; hasRemark: boolean;
}
interface Term { id: string; name: string }
interface ClassRow { id: string; name: string }

const LANGS = [
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'العربية' },
  { value: 'ku', label: 'کوردی' },
];

function openBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  // Revoke after a minute — long enough for the new tab to load.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export default function ReportCardsPage() {
  const { t } = useTranslation();

  const [year, setYear] = useState('');
  const [terms, setTerms] = useState<Term[]>([]);
  const [term, setTerm] = useState('');
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [classId, setClassId] = useState('');
  const [lang, setLang] = useState('en');

  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [published, setPublished] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [editing, setEditing] = useState<RosterRow | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Bootstrap: current academic year, terms, classes, config (default lang).
  useEffect(() => {
    adminApi.getSettings().then(r => setYear(r.data?.currentAcademicYear || '')).catch(() => {});
    adminApi.getTerms().then(r => setTerms(r.data || [])).catch(() => {});
    adminApi.getClasses().then(r => setClasses(r.data || [])).catch(() => {});
    reportCardApi.getConfig().then(r => { if (r.data?.defaultLang) setLang(r.data.defaultLang); }).catch(() => {});
  }, []);

  const load = useCallback(() => {
    if (!year.trim() || !term) { toast.error(t('report_cards.pick_year_term', 'Choose an academic year and term.')); return; }
    setLoading(true);
    reportCardApi.getRoster(year.trim(), term, classId || undefined)
      .then(r => { setRoster(r.data?.students ?? []); setPublished(!!r.data?.published); setLoaded(true); })
      .catch((e: any) => toast.error(e.response?.data?.error || t('report_cards.load_failed', 'Could not load the roster.')))
      .finally(() => setLoading(false));
  }, [year, term, classId, t]);

  const togglePublish = async () => {
    setPublishing(true);
    try {
      if (published) {
        await reportCardApi.unpublish(year.trim(), term);
        setPublished(false);
        toast.success(t('report_cards.unpublished', 'Hidden from parents.'));
      } else {
        await reportCardApi.publish(year.trim(), term);
        setPublished(true);
        toast.success(t('report_cards.published_toast', 'Published — parents can now download.'));
      }
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('report_cards.save_failed', 'Could not save.'));
    } finally {
      setPublishing(false);
    }
  };

  const pdf = async (row: RosterRow, mode: 'preview' | 'download') => {
    setBusyId(row.id);
    try {
      const r = await reportCardApi.studentPdf(row.id, year.trim(), term, lang);
      if (mode === 'preview') openBlob(r.data);
      else downloadBlob(r.data, `report-card-${row.fullName}-${year}-${term}.pdf`.replace(/[^a-z0-9.\-]/gi, '_'));
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('report_cards.pdf_failed', 'Could not generate the PDF.'));
    } finally {
      setBusyId(null);
    }
  };

  const termOptions = terms.map(tm => ({ value: tm.name, label: tm.name }));
  const classOptions = [{ value: '', label: t('report_cards.all_classes', 'All classes') }, ...classes.map(c => ({ value: c.id, label: c.name }))];

  return (
    <PageLayout title={t('report_cards.title', 'Report Cards')} subtitle={t('report_cards.subtitle', 'Generate official term report cards from released grades')}>
      <div className="space-y-4">
        {/* Toolbar */}
        <Card>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Input label={t('report_cards.year', 'Academic year')} value={year} onChange={e => setYear(e.target.value)} placeholder="2024-2025" />
            </div>
            <div className="w-44">
              <Select label={t('report_cards.term', 'Term')} options={termOptions} value={term} onChange={e => setTerm(e.target.value)} placeholder={t('report_cards.select_term', 'Select term…')} />
            </div>
            <div className="w-48">
              <Select label={t('report_cards.class', 'Class')} options={classOptions} value={classId} onChange={e => setClassId(e.target.value)} />
            </div>
            <div className="w-36">
              <Select label={t('report_cards.language', 'PDF language')} options={LANGS} value={lang} onChange={e => setLang(e.target.value)} />
            </div>
            <Button icon={<RefreshCw className="w-4 h-4" />} onClick={load} disabled={!year.trim() || !term}>
              {t('report_cards.load', 'Load')}
            </Button>
            <div className="flex-1" />
            <Button variant="outline" icon={<SettingsIcon className="w-4 h-4" />} onClick={() => setShowSettings(true)}>
              {t('report_cards.settings', 'Settings')}
            </Button>
          </div>
        </Card>

        {/* Publish state — parents only see a term's cards once it's published */}
        {loaded && (
          <Card className={published ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}>
            <div className="flex flex-wrap items-center gap-3">
              {published ? <Eye className="w-5 h-5 text-green-600" /> : <EyeOff className="w-5 h-5 text-amber-600" />}
              <div className="flex-1 min-w-[200px]">
                <p className={`text-sm font-medium ${published ? 'text-green-800' : 'text-amber-800'}`}>
                  {published ? t('report_cards.published_state', 'Published — parents can download these cards.') : t('report_cards.unpublished_state', 'Not published — parents cannot see these cards yet.')}
                </p>
                <p className="text-xs text-gray-500">{year} · {term}</p>
              </div>
              <Button
                variant={published ? 'outline' : 'primary'}
                icon={published ? <EyeOff className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                onClick={togglePublish}
                loading={publishing}
              >
                {published ? t('report_cards.unpublish', 'Unpublish') : t('report_cards.publish', 'Publish to parents')}
              </Button>
            </div>
          </Card>
        )}

        {/* Roster */}
        {loading ? (
          <LoadingSpinner />
        ) : !loaded ? (
          <EmptyState
            icon={<FileText className="w-8 h-8" />}
            title={t('report_cards.start_title', 'Pick a term to begin')}
            description={t('report_cards.start_body', 'Choose an academic year, term and class, then Load to see students and generate their report cards.')}
          />
        ) : roster.length === 0 ? (
          <EmptyState
            icon={<FileText className="w-8 h-8" />}
            title={t('report_cards.empty_title', 'No students')}
            description={t('report_cards.empty_body', 'No students match this class for the selected term.')}
          />
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 uppercase">
                    <th className="py-2 pr-3 font-medium">{t('report_cards.student', 'Student')}</th>
                    <th className="py-2 px-3 font-medium">{t('report_cards.class', 'Class')}</th>
                    <th className="py-2 px-3 font-medium">{t('report_cards.released', 'Released')}</th>
                    <th className="py-2 px-3 font-medium">{t('report_cards.remark', 'Remark')}</th>
                    <th className="py-2 pl-3 font-medium text-right">{t('report_cards.actions', 'Actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map(s => {
                    const none = s.releasedSubjects === 0;
                    return (
                      <tr key={s.id} className="border-t border-gray-100">
                        <td className="py-2 pr-3 font-medium text-gray-800">{s.fullName}</td>
                        <td className="py-2 px-3 text-gray-500">{s.className || '—'}</td>
                        <td className="py-2 px-3">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${none ? 'bg-gray-100 text-gray-500' : s.releasedSubjects < s.totalSubjects ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'}`}>
                            {s.releasedSubjects}/{s.totalSubjects}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          {s.hasRemark ? <Check className="w-4 h-4 text-green-600" /> : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="py-2 pl-3">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => setEditing(s)} title={t('report_cards.edit_remark', 'Edit remark')} className="p-1.5 text-gray-400 hover:text-primary-600 transition-colors">
                              <MessageSquarePlus className="w-4 h-4" />
                            </button>
                            <button onClick={() => pdf(s, 'preview')} disabled={busyId === s.id} title={t('report_cards.preview', 'Preview')} className="p-1.5 text-gray-400 hover:text-primary-600 transition-colors disabled:opacity-40">
                              <Eye className="w-4 h-4" />
                            </button>
                            <button onClick={() => pdf(s, 'download')} disabled={busyId === s.id} title={t('report_cards.download', 'Download')} className="p-1.5 text-gray-400 hover:text-primary-600 transition-colors disabled:opacity-40">
                              <Download className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {editing && (
        <RemarkModal
          row={editing} year={year.trim()} term={term}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </PageLayout>
  );
}

function RemarkModal({ row, year, term, onClose, onSaved }: { row: RosterRow; year: string; term: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [homeroom, setHomeroom] = useState('');
  const [principal, setPrincipal] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    reportCardApi.getRemarks(row.id, year, term)
      .then(r => { setHomeroom(r.data?.homeroomComment || ''); setPrincipal(r.data?.principalComment || ''); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [row.id, year, term]);

  const save = async () => {
    setSaving(true);
    try {
      await reportCardApi.upsertRemarks({ studentId: row.id, academicYear: year, term, homeroomComment: homeroom, principalComment: principal });
      toast.success(t('report_cards.remark_saved', 'Remark saved.'));
      onSaved();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('report_cards.save_failed', 'Could not save.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`${t('report_cards.remark', 'Remark')} — ${row.fullName}`} size="lg">
      {loading ? <LoadingSpinner /> : (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('report_cards.homeroom_comment', "Class teacher’s comment")}</label>
            <textarea value={homeroom} onChange={e => setHomeroom(e.target.value)} rows={3} className="input-field w-full text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('report_cards.principal_comment', "Principal’s comment")}</label>
            <textarea value={principal} onChange={e => setPrincipal(e.target.value)} rows={3} className="input-field w-full text-sm" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>{t('report_cards.cancel', 'Cancel')}</Button>
            <Button onClick={save} loading={saving}>{t('report_cards.save', 'Save')}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function SettingsModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [classTeacher, setClassTeacher] = useState('');
  const [principal, setPrincipal] = useState('');
  const [headerNote, setHeaderNote] = useState('');
  const [footerNote, setFooterNote] = useState('');
  const [defaultLang, setDefaultLang] = useState('en');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    reportCardApi.getConfig()
      .then(r => {
        const c = r.data || {};
        setClassTeacher(c.signatories?.classTeacher || '');
        setPrincipal(c.signatories?.principal || '');
        setHeaderNote(c.headerNote || '');
        setFooterNote(c.footerNote || '');
        setDefaultLang(c.defaultLang || 'en');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await reportCardApi.updateConfig({
        signatories: { classTeacher, principal },
        headerNote, footerNote, defaultLang: defaultLang as 'en' | 'ar' | 'ku',
      });
      toast.success(t('report_cards.settings_saved', 'Settings saved.'));
      onClose();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('report_cards.save_failed', 'Could not save.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={t('report_cards.settings_title', 'Report card settings')} size="lg">
      {loading ? <LoadingSpinner /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label={t('report_cards.class_teacher', 'Class teacher name')} value={classTeacher} onChange={e => setClassTeacher(e.target.value)} />
            <Input label={t('report_cards.principal', 'Principal name')} value={principal} onChange={e => setPrincipal(e.target.value)} />
          </div>
          <Input label={t('report_cards.header_note', 'Header note')} value={headerNote} onChange={e => setHeaderNote(e.target.value)} placeholder={t('report_cards.header_ph', 'e.g. End of term report')} />
          <Input label={t('report_cards.footer_note', 'Footer note')} value={footerNote} onChange={e => setFooterNote(e.target.value)} />
          <Select label={t('report_cards.default_language', 'Default PDF language')} options={LANGS} value={defaultLang} onChange={e => setDefaultLang(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>{t('report_cards.cancel', 'Cancel')}</Button>
            <Button onClick={save} loading={saving}>{t('report_cards.save', 'Save')}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
