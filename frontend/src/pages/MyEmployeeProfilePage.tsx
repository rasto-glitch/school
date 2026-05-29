import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Plus, Trash2, Edit2, ShieldAlert } from 'lucide-react';
import { meApi } from '../services/api';
import PageLayout from '../components/layout/PageLayout';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import Input from '../components/common/Input';
import Modal from '../components/common/Modal';
import LoadingSpinner from '../components/common/LoadingSpinner';
import EmptyState from '../components/common/EmptyState';
import { REDACTED } from '../types/employeeRecords';
import type { EmergencyContact, ExtendedProfile } from '../types/employeeRecords';

// /me/profile — self-service employee record editor (Wave 2.5).
// The employee edits their own low + medium PII fields and emergency
// contacts. Religion + SSN remain HR-officer-only on both read and write —
// the inputs are intentionally absent here, not just disabled.
//
// Accessible to every authenticated role except parent (the backend
// returns 403 for parents, which we surface as a clean empty state).

const errMsg = (e: unknown) => (e as { response?: { data?: { error?: string } } })?.response?.data?.error;

interface MeProfile {
  ownerType: string;
  ownerId: string;
  account: {
    username: string; email: string | null;
    firstName: string | null; lastName: string | null; phone: string | null;
  } | null;
  extendedProfile: ExtendedProfile | null;
  emergencyContacts: EmergencyContact[];
}

interface ExtFormState {
  placeOfBirth: string; nationality: string; bloodType: string;
  languagesSpoken: string; dependentsCount: string;
  bankName: string; bankIban: string; taxId: string;
  motherFullName: string; fatherFullName: string; spouseName: string;
}
const EMPTY_EXT: ExtFormState = {
  placeOfBirth: '', nationality: '', bloodType: '',
  languagesSpoken: '', dependentsCount: '',
  bankName: '', bankIban: '', taxId: '',
  motherFullName: '', fatherFullName: '', spouseName: '',
};

function shapeFromProfile(p: ExtendedProfile | null): ExtFormState {
  if (!p) return EMPTY_EXT;
  const str = (v: string | null | undefined) => (v == null || v === REDACTED ? '' : v);
  return {
    placeOfBirth: str(p.placeOfBirth),
    nationality: str(p.nationality),
    bloodType: str(p.bloodType),
    languagesSpoken: (p.languagesSpoken ?? []).join(', '),
    dependentsCount: p.dependentsCount == null ? '' : String(p.dependentsCount),
    bankName: str(p.bankName),
    bankIban: str(p.bankIban),
    taxId: str(p.taxId),
    motherFullName: str(p.motherFullName),
    fatherFullName: str(p.fatherFullName),
    spouseName: str(p.spouseName),
  };
}

interface ContactFormState {
  fullName: string; relationship: string; phone: string;
  altPhone: string; email: string; address: string; priority: string;
}
const EMPTY_CONTACT: ContactFormState = {
  fullName: '', relationship: '', phone: '', altPhone: '',
  email: '', address: '', priority: '1',
};

export default function MyEmployeeProfilePage() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [data, setData] = useState<MeProfile | null>(null);
  const [extForm, setExtForm] = useState<ExtFormState>(EMPTY_EXT);
  const [savingExt, setSavingExt] = useState(false);

  // Emergency contact modal
  const [showContact, setShowContact] = useState(false);
  const [editingContact, setEditingContact] = useState<EmergencyContact | null>(null);
  const [contactForm, setContactForm] = useState<ContactFormState>(EMPTY_CONTACT);
  const [savingContact, setSavingContact] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await meApi.getEmployeeProfile();
      setData(r.data);
      setExtForm(shapeFromProfile(r.data?.extendedProfile ?? null));
      setForbidden(false);
    } catch (e) {
      const status = (e as { response?: { status?: number } }).response?.status;
      if (status === 403 || status === 404) {
        setForbidden(true);
      } else {
        toast.error(errMsg(e) || t('me.failed_load'));
      }
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const setField = <K extends keyof ExtFormState>(k: K, v: string) => setExtForm(f => ({ ...f, [k]: v }));

  const saveExt = async () => {
    setSavingExt(true);
    try {
      await meApi.putExtended({
        placeOfBirth: extForm.placeOfBirth || null,
        nationality: extForm.nationality || null,
        bloodType: extForm.bloodType || null,
        languagesSpoken: extForm.languagesSpoken
          ? extForm.languagesSpoken.split(',').map(s => s.trim()).filter(Boolean)
          : null,
        dependentsCount: extForm.dependentsCount === '' ? null : Number(extForm.dependentsCount),
        bankName: extForm.bankName || null,
        bankIban: extForm.bankIban,
        taxId: extForm.taxId,
        motherFullName: extForm.motherFullName,
        fatherFullName: extForm.fatherFullName,
        spouseName: extForm.spouseName,
      });
      toast.success(t('me.ext_saved'));
      await load();
    } catch (e) {
      toast.error(errMsg(e) || t('me.ext_failed'));
    } finally { setSavingExt(false); }
  };

  const openContact = (c?: EmergencyContact) => {
    if (c) {
      setEditingContact(c);
      setContactForm({
        fullName: c.fullName, relationship: c.relationship ?? '', phone: c.phone ?? '',
        altPhone: c.altPhone ?? '', email: c.email ?? '', address: c.address ?? '',
        priority: String(c.priority),
      });
    } else {
      setEditingContact(null);
      setContactForm(EMPTY_CONTACT);
    }
    setShowContact(true);
  };

  const saveContact = async () => {
    setSavingContact(true);
    try {
      const payload = {
        fullName: contactForm.fullName.trim(),
        relationship: contactForm.relationship || null,
        phone: contactForm.phone || null,
        altPhone: contactForm.altPhone || null,
        email: contactForm.email || null,
        address: contactForm.address || null,
        priority: Number(contactForm.priority) || 1,
      };
      if (editingContact) await meApi.updateEmergencyContact(editingContact.id, payload);
      else await meApi.createEmergencyContact(payload);
      toast.success(t('me.contact_saved'));
      setShowContact(false);
      await load();
    } catch (e) {
      toast.error(errMsg(e) || t('me.contact_failed'));
    } finally { setSavingContact(false); }
  };

  const removeContact = async (c: EmergencyContact) => {
    if (!confirm(t('me.contact_confirm_delete', { name: c.fullName }))) return;
    try {
      await meApi.deleteEmergencyContact(c.id);
      toast.success(t('me.contact_deleted'));
      await load();
    } catch (e) {
      toast.error(errMsg(e) || t('me.contact_failed_delete'));
    }
  };

  if (loading) {
    return (
      <PageLayout title={t('me.title')} subtitle={t('me.subtitle')}>
        <div className="flex justify-center py-16"><LoadingSpinner /></div>
      </PageLayout>
    );
  }

  if (forbidden || !data) {
    return (
      <PageLayout title={t('me.title')} subtitle={t('me.subtitle')}>
        <EmptyState title={t('me.not_an_employee')} description={t('me.not_an_employee_hint')} />
      </PageLayout>
    );
  }

  const isRedacted = !!data.extendedProfile?.redacted;

  return (
    <PageLayout title={t('me.title')} subtitle={t('me.subtitle')}>
      <div className="space-y-4">
        <Card className="bg-blue-50 border-blue-200">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-blue-900">{t('me.banner_title')}</p>
              <p className="text-sm text-blue-800 mt-1">{t('me.banner_body')}</p>
            </div>
          </div>
        </Card>

        {/* Account summary (read-only here; account fields edited from app settings) */}
        <Card>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('me.account')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div><span className="text-gray-500">{t('me.username')}: </span><span className="text-gray-900">{data.account?.username ?? '—'}</span></div>
            <div><span className="text-gray-500">{t('me.email')}: </span><span className="text-gray-900">{data.account?.email ?? '—'}</span></div>
            <div><span className="text-gray-500">{t('me.name')}: </span><span className="text-gray-900">{`${data.account?.firstName ?? ''} ${data.account?.lastName ?? ''}`.trim() || '—'}</span></div>
            <div><span className="text-gray-500">{t('me.phone')}: </span><span className="text-gray-900">{data.account?.phone ?? '—'}</span></div>
          </div>
        </Card>

        {/* Extended profile (low + medium fields). Religion + SSN deliberately
            absent; the row is for HR officers to fill in via the admin
            profile page. */}
        {isRedacted ? (
          <Card className="bg-rose-50 border-rose-200">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-rose-900">{t('me.redacted_title')}</p>
                <p className="text-sm text-rose-700 mt-1">{t('me.redacted_body', { date: data.extendedProfile?.redactedAt ?? '—' })}</p>
              </div>
            </div>
          </Card>
        ) : (
          <>
            <Card>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('me.section_personal')}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('me.mother_name')}</label>
                  <Input value={extForm.motherFullName} onChange={e => setField('motherFullName', e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('me.father_name')}</label>
                  <Input value={extForm.fatherFullName} onChange={e => setField('fatherFullName', e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('me.spouse_name')}</label>
                  <Input value={extForm.spouseName} onChange={e => setField('spouseName', e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('me.dependents')}</label>
                  <Input type="number" value={extForm.dependentsCount} onChange={e => setField('dependentsCount', e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('me.place_of_birth')}</label>
                  <Input value={extForm.placeOfBirth} onChange={e => setField('placeOfBirth', e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('me.nationality')}</label>
                  <Input value={extForm.nationality} onChange={e => setField('nationality', e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('me.blood_type')}</label>
                  <Input value={extForm.bloodType} onChange={e => setField('bloodType', e.target.value)} placeholder="O+" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('me.languages')}</label>
                  <Input value={extForm.languagesSpoken} onChange={e => setField('languagesSpoken', e.target.value)} placeholder={t('me.languages_ph')} />
                </div>
              </div>
            </Card>

            <Card>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('me.section_financial')}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('me.bank_name')}</label>
                  <Input value={extForm.bankName} onChange={e => setField('bankName', e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('me.bank_iban')}</label>
                  <Input value={extForm.bankIban} onChange={e => setField('bankIban', e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('me.tax_id')}</label>
                  <Input value={extForm.taxId} onChange={e => setField('taxId', e.target.value)} />
                </div>
              </div>
              <p className="text-[11px] text-gray-500 mt-3 flex items-center gap-1">
                <ShieldAlert className="w-3 h-3" /> {t('me.encrypted_at_rest')}
              </p>
            </Card>

            <div className="flex justify-end">
              <Button onClick={saveExt} loading={savingExt}>{t('common.save')}</Button>
            </div>
          </>
        )}

        {/* Emergency contacts */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('me.emergency_contacts')}</p>
            <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => openContact()}>{t('me.add_contact')}</Button>
          </div>
          {data.emergencyContacts.length === 0 ? (
            <EmptyState title={t('me.no_contacts')} description={t('me.no_contacts_hint')} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {data.emergencyContacts.map(c => (
                <div key={c.id} className="relative border border-gray-200 rounded-lg p-3">
                  <div className="absolute top-2 right-2 flex gap-1">
                    <button onClick={() => openContact(c)} className="p-1 rounded-md hover:bg-gray-100 text-gray-500"><Edit2 className="w-3.5 h-3.5" /></button>
                    <button onClick={() => removeContact(c)} className="p-1 rounded-md hover:bg-rose-50 text-rose-500"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">#{c.priority}</span>
                    <p className="font-semibold text-gray-900">{c.fullName}</p>
                  </div>
                  {c.relationship && <p className="text-xs text-gray-600">{c.relationship}</p>}
                  {c.phone && <p className="text-xs text-gray-700">{c.phone}{c.altPhone && ` · ${c.altPhone}`}</p>}
                  {c.email && <p className="text-xs text-gray-600">{c.email}</p>}
                  {c.address && <p className="text-xs text-gray-500">{c.address}</p>}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Modal isOpen={showContact} onClose={() => setShowContact(false)} title={editingContact ? t('me.edit_contact') : t('me.add_contact')} size="md">
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('me.contact_name')}</label>
              <Input value={contactForm.fullName} onChange={e => setContactForm({ ...contactForm, fullName: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('me.contact_relationship')}</label>
              <Input value={contactForm.relationship} onChange={e => setContactForm({ ...contactForm, relationship: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('me.contact_priority')}</label>
              <Input type="number" min={1} max={10} value={contactForm.priority} onChange={e => setContactForm({ ...contactForm, priority: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('me.contact_phone')}</label>
              <Input value={contactForm.phone} onChange={e => setContactForm({ ...contactForm, phone: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('me.contact_alt_phone')}</label>
              <Input value={contactForm.altPhone} onChange={e => setContactForm({ ...contactForm, altPhone: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('me.contact_email')}</label>
              <Input value={contactForm.email} onChange={e => setContactForm({ ...contactForm, email: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('me.contact_address')}</label>
              <Input value={contactForm.address} onChange={e => setContactForm({ ...contactForm, address: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <Button variant="ghost" onClick={() => setShowContact(false)}>{t('common.cancel')}</Button>
            <Button onClick={saveContact} loading={savingContact} disabled={!contactForm.fullName.trim()}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>
    </PageLayout>
  );
}
