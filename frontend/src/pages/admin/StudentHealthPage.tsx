import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import {
  HeartPulse, Search, ChevronLeft, Plus, Trash2, Pencil, Save, BadgeAlert, Bell,
} from 'lucide-react';
import { adminApi, healthApi, type HealthEmergencyContact, type HealthImmunization } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import FeatureNotEnabled from '../../components/common/FeatureNotEnabled';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import Modal from '../../components/common/Modal';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';

interface StudentRow { id: string; fullName: string; classes?: { name?: string } | null }
interface ClassRow { id: string; name: string }
interface Visit {
  id: string; visitedAt: string; category: string; temperatureC: number | null;
  complaint: string; assessment: string; treatment: string; outcome: string;
  parentNotified: boolean; parentNotifiedAt: string | null;
}

const BLOOD_TYPES = ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown'];
const CATEGORIES = ['injury', 'illness', 'medication', 'mental_health', 'routine', 'other'];
const OUTCOMES = ['returned_to_class', 'sent_home', 'referred_external', 'kept_observation'];

// ISO ⇄ datetime-local helpers (the <input type=datetime-local> value has no tz).
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const emptyProfile = {
  bloodType: '' as string,
  allergies: '' as string,
  chronicConditions: '', medications: '', dietaryNotes: '', notes: '',
  physicianName: '', physicianPhone: '',
  emergencyContacts: [] as HealthEmergencyContact[],
  immunizations: [] as HealthImmunization[],
};

export default function StudentHealthPage() {
  const { t } = useTranslation();
  const { school } = useAuthStore();
  // Premium `student_health` flag (master-provisioned).
  if (school?.features?.student_health !== true) return <FeatureNotEnabled title={t('nav.student_health', 'Student Health')} />;
  return <StudentHealthInner />;
}

function StudentHealthInner() {
  const { t } = useTranslation();
  const catLabel = (c: string) => t(`health.cat_${c}`, c);
  const outLabel = (o: string) => t(`health.out_${o}`, o);

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [search, setSearch] = useState('');
  const [classId, setClassId] = useState('');
  const [results, setResults] = useState<StudentRow[]>([]);
  const [searching, setSearching] = useState(false);

  const [selected, setSelected] = useState<StudentRow | null>(null);
  const [profile, setProfile] = useState(emptyProfile);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const [visits, setVisits] = useState<Visit[]>([]);
  const [editingVisit, setEditingVisit] = useState<Visit | 'new' | null>(null);

  useEffect(() => {
    adminApi.getClasses().then(r => setClasses(r.data || [])).catch(() => {});
  }, []);

  const runSearch = useCallback(() => {
    setSearching(true);
    adminApi.getStudents({ ...(search.trim() ? { search: search.trim() } : {}), ...(classId ? { classId } : {}), limit: '30' })
      .then(r => setResults(r.data?.students ?? []))
      .catch((e: any) => toast.error(e.response?.data?.error || t('health.load_failed', 'Could not load students.')))
      .finally(() => setSearching(false));
  }, [search, classId, t]);

  const loadStudent = (s: StudentRow) => {
    setSelected(s);
    setLoadingProfile(true);
    Promise.all([healthApi.getProfile(s.id), healthApi.listVisits(s.id)])
      .then(([p, v]) => {
        const d = p.data || {};
        setProfile({
          bloodType: d.bloodType || '',
          allergies: (d.allergyTags || []).join(', '),
          chronicConditions: d.chronicConditions || '',
          medications: d.medications || '',
          dietaryNotes: d.dietaryNotes || '',
          notes: d.notes || '',
          physicianName: d.physicianName || '',
          physicianPhone: d.physicianPhone || '',
          emergencyContacts: d.emergencyContacts || [],
          immunizations: d.immunizations || [],
        });
        setVisits(v.data?.visits ?? []);
      })
      .catch((e: any) => toast.error(e.response?.data?.error || t('health.load_failed', 'Could not load the health record.')))
      .finally(() => setLoadingProfile(false));
  };

  const saveProfile = async () => {
    if (!selected) return;
    setSavingProfile(true);
    try {
      await healthApi.saveProfile(selected.id, {
        bloodType: profile.bloodType || null,
        allergyTags: profile.allergies.split(',').map(s => s.trim()).filter(Boolean),
        immunizations: profile.immunizations.filter(i => i.name?.trim()),
        emergencyContacts: profile.emergencyContacts.filter(c => c.name?.trim()),
        physicianName: profile.physicianName,
        physicianPhone: profile.physicianPhone,
        chronicConditions: profile.chronicConditions,
        medications: profile.medications,
        dietaryNotes: profile.dietaryNotes,
        notes: profile.notes,
      });
      toast.success(t('health.saved', 'Health record saved.'));
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('health.save_failed', 'Could not save.'));
    } finally {
      setSavingProfile(false);
    }
  };

  const reloadVisits = () => {
    if (!selected) return;
    healthApi.listVisits(selected.id).then(v => setVisits(v.data?.visits ?? [])).catch(() => {});
  };

  const removeVisit = async (v: Visit) => {
    if (!window.confirm(t('health.confirm_delete_visit', 'Delete this visit record?'))) return;
    try {
      await healthApi.deleteVisit(v.id);
      toast.success(t('health.visit_deleted', 'Visit deleted.'));
      reloadVisits();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('health.save_failed', 'Could not save.'));
    }
  };

  const classOptions = [{ value: '', label: t('health.all_classes', 'All classes') }, ...classes.map(c => ({ value: c.id, label: c.name }))];

  // Emergency-contact + immunization row helpers.
  const setContact = (i: number, patch: Partial<HealthEmergencyContact>) =>
    setProfile(p => ({ ...p, emergencyContacts: p.emergencyContacts.map((c, idx) => idx === i ? { ...c, ...patch } : c) }));
  const setImm = (i: number, patch: Partial<HealthImmunization>) =>
    setProfile(p => ({ ...p, immunizations: p.immunizations.map((c, idx) => idx === i ? { ...c, ...patch } : c) }));

  return (
    <PageLayout title={t('health.title', 'Student Health')} subtitle={t('health.subtitle', 'Clinic records — medical profile and nurse visits')}>
      {!selected ? (
        <div className="space-y-4">
          <Card>
            <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); runSearch(); }}>
              <div className="flex-1 min-w-[200px]">
                <Input label={t('health.search', 'Search student')} value={search} onChange={e => setSearch(e.target.value)} placeholder={t('health.search_ph', 'Name…')} />
              </div>
              <div className="w-52">
                <Select label={t('health.class', 'Class')} options={classOptions} value={classId} onChange={e => setClassId(e.target.value)} />
              </div>
              <Button type="submit" icon={<Search className="w-4 h-4" />} loading={searching}>{t('health.search_btn', 'Search')}</Button>
            </form>
          </Card>

          {results.length === 0 ? (
            <EmptyState
              icon={<HeartPulse className="w-8 h-8" />}
              title={t('health.select_student', 'Find a student')}
              description={t('health.select_student_body', 'Search by name or pick a class to open a student’s health record.')}
            />
          ) : (
            <Card>
              <div className="divide-y divide-gray-100">
                {results.map(s => (
                  <button key={s.id} onClick={() => loadStudent(s)} className="w-full flex items-center justify-between py-2.5 px-1 text-left hover:bg-gray-50 transition-colors">
                    <span className="font-medium text-gray-800">{s.fullName}</span>
                    <span className="text-sm text-gray-500">{s.classes?.name || '—'}</span>
                  </button>
                ))}
              </div>
            </Card>
          )}
        </div>
      ) : loadingProfile ? (
        <LoadingSpinner />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" icon={<ChevronLeft className="w-4 h-4" />} onClick={() => { setSelected(null); setVisits([]); }}>
              {t('health.change_student', 'Change student')}
            </Button>
            <div>
              <p className="font-semibold text-gray-900">{selected.fullName}</p>
              <p className="text-xs text-gray-500">{selected.classes?.name || '—'}</p>
            </div>
          </div>

          {/* Medical profile */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2"><HeartPulse className="w-4 h-4 text-rose-600" />{t('health.profile', 'Medical profile')}</h3>
              <Button icon={<Save className="w-4 h-4" />} onClick={saveProfile} loading={savingProfile}>{t('health.save', 'Save')}</Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Select label={t('health.blood_type', 'Blood type')} value={profile.bloodType}
                options={BLOOD_TYPES.map(b => ({ value: b, label: b === '' ? t('health.not_set', 'Not set') : b === 'unknown' ? t('health.bt_unknown', 'Unknown') : b }))}
                onChange={e => setProfile(p => ({ ...p, bloodType: e.target.value }))} />
              <Input label={t('health.physician_name', 'Physician')} value={profile.physicianName} onChange={e => setProfile(p => ({ ...p, physicianName: e.target.value }))} />
              <Input label={t('health.physician_phone', 'Physician phone')} value={profile.physicianPhone} onChange={e => setProfile(p => ({ ...p, physicianPhone: e.target.value }))} />
            </div>
            <div className="mt-3">
              <Input label={t('health.allergies', 'Allergies (comma-separated)')} value={profile.allergies} onChange={e => setProfile(p => ({ ...p, allergies: e.target.value }))} placeholder={t('health.allergies_ph', 'e.g. peanuts, penicillin')} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <TextArea label={t('health.conditions', 'Chronic conditions')} value={profile.chronicConditions} onChange={v => setProfile(p => ({ ...p, chronicConditions: v }))} />
              <TextArea label={t('health.medications', 'Medications')} value={profile.medications} onChange={v => setProfile(p => ({ ...p, medications: v }))} />
              <TextArea label={t('health.dietary', 'Dietary notes')} value={profile.dietaryNotes} onChange={v => setProfile(p => ({ ...p, dietaryNotes: v }))} />
              <TextArea label={t('health.notes', 'General notes')} value={profile.notes} onChange={v => setProfile(p => ({ ...p, notes: v }))} />
            </div>

            {/* Emergency contacts */}
            <div className="mt-5">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-gray-700">{t('health.emergency_contacts', 'Emergency contacts')}</h4>
                <Button variant="outline" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setProfile(p => ({ ...p, emergencyContacts: [...p.emergencyContacts, { name: '' }] }))}>{t('health.add_contact', 'Add')}</Button>
              </div>
              {profile.emergencyContacts.map((c, i) => (
                <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr,1fr,1fr,1fr,auto] gap-2 mb-2 items-center">
                  <Input placeholder={t('health.contact_name', 'Name')} value={c.name} onChange={e => setContact(i, { name: e.target.value })} />
                  <Input placeholder={t('health.relationship', 'Relationship')} value={c.relationship || ''} onChange={e => setContact(i, { relationship: e.target.value })} />
                  <Input placeholder={t('health.phone', 'Phone')} value={c.phone || ''} onChange={e => setContact(i, { phone: e.target.value })} />
                  <Input placeholder={t('health.alt_phone', 'Alt phone')} value={c.altPhone || ''} onChange={e => setContact(i, { altPhone: e.target.value })} />
                  <button onClick={() => setProfile(p => ({ ...p, emergencyContacts: p.emergencyContacts.filter((_, idx) => idx !== i) }))} className="p-2 text-gray-400 hover:text-rose-600" title={t('health.remove', 'Remove')}><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>

            {/* Immunizations */}
            <div className="mt-5">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-gray-700">{t('health.immunizations', 'Immunizations')}</h4>
                <Button variant="outline" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setProfile(p => ({ ...p, immunizations: [...p.immunizations, { name: '' }] }))}>{t('health.add_immunization', 'Add')}</Button>
              </div>
              {profile.immunizations.map((m, i) => (
                <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr,160px,1fr,auto] gap-2 mb-2 items-center">
                  <Input placeholder={t('health.imm_name', 'Vaccine')} value={m.name} onChange={e => setImm(i, { name: e.target.value })} />
                  <Input type="date" value={m.date || ''} onChange={e => setImm(i, { date: e.target.value })} />
                  <Input placeholder={t('health.imm_notes', 'Notes')} value={m.notes || ''} onChange={e => setImm(i, { notes: e.target.value })} />
                  <button onClick={() => setProfile(p => ({ ...p, immunizations: p.immunizations.filter((_, idx) => idx !== i) }))} className="p-2 text-gray-400 hover:text-rose-600" title={t('health.remove', 'Remove')}><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </Card>

          {/* Nurse visits */}
          <Card>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900">{t('health.visits', 'Nurse visits')}</h3>
              <Button icon={<Plus className="w-4 h-4" />} onClick={() => setEditingVisit('new')}>{t('health.add_visit', 'Add visit')}</Button>
            </div>
            {visits.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">{t('health.no_visits', 'No nurse visits recorded.')}</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {visits.map(v => (
                  <div key={v.id} className="py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-800">{new Date(v.visitedAt).toLocaleString()}</span>
                        <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700">{catLabel(v.category)}</span>
                        <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${v.outcome === 'sent_home' || v.outcome === 'referred_external' ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'}`}>{outLabel(v.outcome)}</span>
                        {v.parentNotified && <span className="inline-flex items-center gap-1 text-[11px] text-gray-500"><Bell className="w-3 h-3" />{t('health.parent_notified', 'Parent notified')}</span>}
                        {v.temperatureC != null && <span className="text-[11px] text-gray-500">{v.temperatureC}°C</span>}
                      </div>
                      {v.complaint && <p className="text-sm text-gray-600 mt-1 truncate">{v.complaint}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => setEditingVisit(v)} className="p-1.5 text-gray-400 hover:text-primary-600" title={t('health.edit_visit', 'Edit')}><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => removeVisit(v)} className="p-1.5 text-gray-400 hover:text-rose-600" title={t('health.delete_visit', 'Delete')}><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {editingVisit && selected && (
        <VisitModal
          studentId={selected.id}
          visit={editingVisit === 'new' ? null : editingVisit}
          catLabel={catLabel}
          outLabel={outLabel}
          onClose={() => setEditingVisit(null)}
          onSaved={() => { setEditingVisit(null); reloadVisits(); }}
        />
      )}
    </PageLayout>
  );
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      <textarea value={value} onChange={e => onChange(e.target.value)} rows={2} className="input-field w-full text-sm" />
    </div>
  );
}

function VisitModal({ studentId, visit, catLabel, outLabel, onClose, onSaved }: {
  studentId: string; visit: Visit | null;
  catLabel: (c: string) => string; outLabel: (o: string) => string;
  onClose: () => void; onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [visitedAt, setVisitedAt] = useState(visit ? toLocalInput(visit.visitedAt) : toLocalInput(new Date().toISOString()));
  const [category, setCategory] = useState(visit?.category || 'illness');
  const [temperature, setTemperature] = useState(visit?.temperatureC != null ? String(visit.temperatureC) : '');
  const [complaint, setComplaint] = useState(visit?.complaint || '');
  const [assessment, setAssessment] = useState(visit?.assessment || '');
  const [treatment, setTreatment] = useState(visit?.treatment || '');
  const [outcome, setOutcome] = useState(visit?.outcome || 'returned_to_class');
  const [parentNotified, setParentNotified] = useState(visit?.parentNotified || false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        visitedAt: visitedAt ? new Date(visitedAt).toISOString() : undefined,
        category,
        temperatureC: temperature.trim() ? Number(temperature) : null,
        complaint, assessment, treatment, outcome, parentNotified,
      };
      if (visit) await healthApi.updateVisit(visit.id, payload);
      else await healthApi.createVisit(studentId, payload);
      toast.success(t('health.visit_saved', 'Visit saved.'));
      onSaved();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('health.visit_failed', 'Could not save the visit.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={visit ? t('health.edit_visit', 'Edit visit') : t('health.add_visit', 'Add visit')} size="lg">
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('health.visit_date', 'Date & time')}</label>
            <input type="datetime-local" value={visitedAt} onChange={e => setVisitedAt(e.target.value)} className="input-field w-full text-sm" />
          </div>
          <Select label={t('health.category', 'Category')} value={category} options={CATEGORIES.map(c => ({ value: c, label: catLabel(c) }))} onChange={e => setCategory(e.target.value)} />
          <Input label={t('health.temperature', 'Temp (°C)')} type="number" value={temperature} onChange={e => setTemperature(e.target.value)} />
        </div>
        <TextArea label={t('health.complaint', 'Complaint')} value={complaint} onChange={setComplaint} />
        <TextArea label={t('health.assessment', 'Assessment')} value={assessment} onChange={setAssessment} />
        <TextArea label={t('health.treatment', 'Treatment given')} value={treatment} onChange={setTreatment} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
          <Select label={t('health.outcome', 'Outcome')} value={outcome} options={OUTCOMES.map(o => ({ value: o, label: outLabel(o) }))} onChange={e => setOutcome(e.target.value)} />
          <label className="flex items-center gap-2 text-sm text-gray-700 pb-2.5 cursor-pointer">
            <input type="checkbox" checked={parentNotified} onChange={e => setParentNotified(e.target.checked)} className="rounded border-gray-300" />
            <BadgeAlert className="w-4 h-4 text-amber-500" />
            {t('health.parent_notified', 'Parent notified')}
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>{t('health.cancel', 'Cancel')}</Button>
          <Button onClick={save} loading={saving}>{t('health.save', 'Save')}</Button>
        </div>
      </div>
    </Modal>
  );
}
