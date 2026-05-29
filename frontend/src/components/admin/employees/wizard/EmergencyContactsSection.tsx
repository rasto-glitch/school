// Section 4 of the NewEmployeeWizard. Loads existing contacts (which will
// be empty for a brand-new employee, but stays correct if the operator
// returns to a wizard mid-flow), renders the saved list, and keeps an
// inline add form. After each successful save the form clears and the
// list refreshes; onCountChange reports the count back to the wizard
// shell so the section pill flips to "✓ N contacts".

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Phone, Mail, MapPin, Plus, Trash2 } from 'lucide-react';
import { adminApi } from '../../../../services/api';
import Button from '../../../common/Button';
import LoadingSpinner from '../../../common/LoadingSpinner';
import EmergencyContactFields, {
  EMPTY_CONTACT, type ContactFormState,
} from '../EmergencyContactFields';
import type { EmergencyContact, EmployeeRole } from '../../../../types/employeeRecords';

interface Props {
  role: EmployeeRole;
  employeeId: string;
  /** Reports the number of saved contacts to the wizard shell. */
  onCountChange?: (n: number) => void;
}

export default function EmergencyContactsSection({ role, employeeId, onCountChange }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [showForm, setShowForm] = useState(true);
  const [form, setForm] = useState<ContactFormState>(EMPTY_CONTACT);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await adminApi.listEmergencyContacts(role, employeeId);
      const items: EmergencyContact[] = r.data?.contacts ?? [];
      setContacts(items);
      onCountChange?.(items.length);
      // Hide the form once at least one contact exists — operator opts back in
      // explicitly via "Add another contact".
      setShowForm(items.length === 0);
    } catch {
      toast.error(t('admin.ec.failed_load'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [role, employeeId]);

  const save = async () => {
    setSaving(true);
    try {
      await adminApi.createEmergencyContact(role, employeeId, {
        fullName: form.fullName.trim(),
        relationship: form.relationship || null,
        phone: form.phone || null,
        altPhone: form.altPhone || null,
        email: form.email || null,
        address: form.address || null,
        priority: Number(form.priority) || 1,
      });
      toast.success(t('admin.ec.saved'));
      setForm(EMPTY_CONTACT);
      await load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || t('admin.ec.failed_save'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c: EmergencyContact) => {
    if (!confirm(t('admin.ec.confirm_delete', { name: c.fullName }))) return;
    try {
      await adminApi.deleteEmergencyContact(c.id);
      toast.success(t('admin.ec.deleted'));
      await load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || t('admin.ec.failed_delete'));
    }
  };

  if (loading) return <div className="flex justify-center py-6"><LoadingSpinner /></div>;

  return (
    <div className="space-y-3">
      {contacts.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {contacts.map(c => (
            <div key={c.id} className="relative border border-gray-200 rounded-lg p-3">
              <button
                onClick={() => remove(c)}
                className="absolute top-2 right-2 p-1 rounded-md hover:bg-rose-50 text-rose-500"
                aria-label={t('admin.ec.delete', 'Delete')}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">#{c.priority}</span>
                <p className="font-semibold text-gray-900">{c.fullName}</p>
              </div>
              {c.relationship && <p className="text-sm text-gray-600">{c.relationship}</p>}
              {c.phone && (
                <p className="text-sm text-gray-700 flex items-center gap-1 mt-1">
                  <Phone className="w-3 h-3 text-gray-400" /> {c.phone}{c.altPhone && ` · ${c.altPhone}`}
                </p>
              )}
              {c.email && (
                <p className="text-sm text-gray-700 flex items-center gap-1 mt-1">
                  <Mail className="w-3 h-3 text-gray-400" /> {c.email}
                </p>
              )}
              {c.address && (
                <p className="text-sm text-gray-600 flex items-start gap-1 mt-1">
                  <MapPin className="w-3 h-3 text-gray-400 mt-0.5" /> {c.address}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {showForm ? (
        <div className="border border-gray-200 rounded-lg p-3 space-y-3">
          <EmergencyContactFields value={form} onChange={setForm} />
          <div className="flex justify-end gap-2">
            {contacts.length > 0 && (
              <Button variant="ghost" onClick={() => { setForm(EMPTY_CONTACT); setShowForm(false); }}>
                {t('common.cancel')}
              </Button>
            )}
            <Button onClick={save} loading={saving} disabled={!form.fullName.trim()}>
              {t('admin.wizard.save_contact', 'Save Contact')}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" icon={<Plus className="w-4 h-4" />} onClick={() => setShowForm(true)}>
          {t('admin.wizard.add_another_contact', 'Add another contact')}
        </Button>
      )}
    </div>
  );
}
