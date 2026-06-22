// Inline edit-identity panel for the employee profile page. Opens below
// the header when the operator clicks Edit; closes on Save (with a
// re-fetch in the parent) or Cancel.
//
// Branches by role: teacher / staff have a single fullName field and
// role-specific extras (classes / position); account roles use first +
// last name and add username display + email. Driver role redirects to
// the standalone DriversManagement page because that's still where
// transport-specific fields live.
//
// Photo upload is included via ProfessionalPhotoField (which uploads on
// pick, separately from the form submit) so a fresh photo persists even
// if the operator Cancels the rest of the form.

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { Save, X, ExternalLink } from 'lucide-react';
import Card from '../../common/Card';
import Input from '../../common/Input';
import Button from '../../common/Button';
import EmployeeHRFields, { hrPayload, type EmployeeHRFormFields } from '../EmployeeHRFields';
import ProfessionalPhotoField, { type EmployeePhotoRole } from '../ProfessionalPhotoField';
import { adminApi } from '../../../services/api';
import type { EmployeeProfile } from '../../../types/employeeDocs';
import type { Class } from '../../../types';

interface Props {
  profile: EmployeeProfile;
  onSaved: () => void;
  onCancel: () => void;
}

type TeacherStaffFields = {
  fullName: string;
  phoneNumber: string;
  emergencyContact: string;
  /** Only used for staff role. */
  position: string;
} & EmployeeHRFormFields;

type AccountFields = {
  fullName: string;
  phone: string;
  email: string;
  emergencyContact: string;
} & EmployeeHRFormFields;

function hrDefaults(p: EmployeeProfile): EmployeeHRFormFields {
  return {
    address: p.hr.address ?? '',
    hireDate: p.hr.hireDate ?? '',
    nationalId: p.hr.nationalId ?? '',
    dateOfBirth: p.hr.dateOfBirth ?? '',
    maritalStatus: p.hr.maritalStatus ?? '',
    gender: p.hr.gender ?? '',
    employmentType: p.hr.employmentType ?? '',
    qualifications: p.hr.qualifications ?? '',
    notes: p.hr.notes ?? '',
  };
}

export default function EditIdentityPanel({ profile, onSaved, onCancel }: Props) {
  const { t } = useTranslation();

  if (profile.role === 'driver') {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-amber-900">
              {t('admin.profile.edit_driver_title', 'Drivers are managed separately')}
            </p>
            <p className="text-sm text-amber-800 mt-1">
              {t('admin.profile.edit_driver_body', 'License, vehicle, bus number and student assignment live on the Drivers page.')}
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <Button variant="ghost" size="sm" icon={<X className="w-4 h-4" />} onClick={onCancel}>
              {t('common.cancel')}
            </Button>
            <Link to="/admin/drivers">
              <Button size="sm" icon={<ExternalLink className="w-4 h-4" />}>
                {t('admin.profile.open_drivers_page', 'Open Drivers page')}
              </Button>
            </Link>
          </div>
        </div>
      </Card>
    );
  }

  const isAccountRole =
    profile.role === 'supervisor' || profile.role === 'admin'
    || profile.role === 'reception' || profile.role === 'accountant';

  if (isAccountRole) {
    return <AccountEditForm profile={profile} onSaved={onSaved} onCancel={onCancel} />;
  }
  // teacher | staff
  return <TeacherStaffEditForm profile={profile} onSaved={onSaved} onCancel={onCancel} />;
}

function TeacherStaffEditForm({ profile, onSaved, onCancel }: Props) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [classes, setClasses] = useState<Class[]>([]);
  const [classIds, setClassIds] = useState<string[]>(
    profile.teaching?.classes.map(c => c.id) ?? [],
  );

  const form = useForm<TeacherStaffFields>({
    defaultValues: {
      fullName: profile.fullName,
      phoneNumber: profile.contact.phoneNumber ?? '',
      emergencyContact: profile.contact.emergencyContact ?? '',
      position: profile.employment?.position ?? '',
      ...hrDefaults(profile),
    },
  });

  useEffect(() => {
    if (profile.role !== 'teacher') return;
    adminApi.getClasses().then(r => setClasses(r.data || [])).catch(() => {});
  }, [profile.role]);

  const toggleClass = (id: string) =>
    setClassIds(prev => (prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]));

  const onSubmit = async (data: TeacherStaffFields) => {
    setSubmitting(true);
    try {
      if (profile.role === 'teacher') {
        await adminApi.updateTeacher(profile.ownerId, {
          ...hrPayload(data),
          fullName: data.fullName,
          phoneNumber: data.phoneNumber,
          emergencyContact: data.emergencyContact,
          classIds,
        });
      } else {
        // staff
        await adminApi.updateStaff(profile.ownerId, {
          ...hrPayload(data),
          fullName: data.fullName,
          position: data.position || null,
          emergencyContact: data.emergencyContact || null,
        });
      }
      toast.success(t('admin.profile.saved', 'Identity saved'));
      onSaved();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || t('admin.profile.failed_save', 'Failed to save identity'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            {t('admin.profile.edit_identity', 'Edit identity')}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              {t('admin.teacher_emp.full_name')} <span className="text-rose-600">*</span>
            </label>
            <Input placeholder={t('admin.teacher_emp.full_name')} {...form.register('fullName', { required: true })} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.teacher_emp.primary_phone')}</label>
            <Input placeholder={t('admin.teacher_emp.primary_phone')} {...form.register('phoneNumber')} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.teacher_emp.emergency_contact')}</label>
            <Input placeholder={t('admin.teacher_emp.emergency_contact')} {...form.register('emergencyContact')} />
          </div>
          {profile.role === 'staff' && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.staff_emp.position')}</label>
              <Input placeholder={t('admin.staff_emp.position_ph')} {...form.register('position')} />
            </div>
          )}
        </div>

        {profile.role === 'teacher' && (
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">{t('admin.teacher_emp.assign_classes')}</p>
            <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-xl p-2 space-y-1">
              {classes.length === 0 && (
                <p className="text-xs text-gray-400 px-2 py-1">{t('admin.wizard.no_classes', 'No classes available.')}</p>
              )}
              {classes.map(c => (
                <label key={c.id} className="flex items-center gap-2 cursor-pointer p-1 hover:bg-gray-50 rounded-lg">
                  <input
                    type="checkbox"
                    checked={classIds.includes(c.id)}
                    onChange={() => toggleClass(c.id)}
                    className="w-4 h-4 text-primary-600"
                  />
                  <span className="text-sm text-gray-800">{c.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <EmployeeHRFields register={form.register} />

        <ProfessionalPhotoField
          role={profile.role as EmployeePhotoRole}
          employeeId={profile.ownerId}
          currentUrl={profile.officialPhoto}
          onUploaded={() => { /* photo persisted on pick; profile re-fetch on Save will refresh the header */ }}
        />

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <Button type="button" variant="ghost" icon={<X className="w-4 h-4" />} onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={submitting} icon={<Save className="w-4 h-4" />}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function AccountEditForm({ profile, onSaved, onCancel }: Props) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<AccountFields>({
    defaultValues: {
      fullName: profile.fullName ?? '',
      phone: profile.contact.phoneNumber ?? '',
      email: profile.contact.email ?? '',
      emergencyContact: profile.contact.emergencyContact ?? '',
      ...hrDefaults(profile),
    },
  });

  const onSubmit = async (data: AccountFields) => {
    setSubmitting(true);
    try {
      await adminApi.updateAccount(profile.ownerId, {
        ...hrPayload(data),
        fullName: data.fullName,
        phone: data.phone || null,
        email: data.email || null,
        emergencyContact: data.emergencyContact || null,
      });
      toast.success(t('admin.profile.saved', 'Identity saved'));
      onSaved();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || t('admin.profile.failed_save', 'Failed to save identity'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          {t('admin.profile.edit_identity', 'Edit identity')}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              {t('admin.acct_emp.full_name', 'Full Name')} <span className="text-rose-600">*</span>
            </label>
            <Input placeholder={t('admin.acct_emp.full_name', 'Full Name')} {...form.register('fullName', { required: true })} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.acct_emp.phone')}</label>
            <Input placeholder={t('admin.acct_emp.phone')} {...form.register('phone')} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.acct_emp.email_optional')}</label>
            <Input placeholder={t('admin.acct_emp.email_optional')} {...form.register('email')} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.acct_emp.emergency_contact')}</label>
            <Input placeholder={t('admin.acct_emp.emergency_contact')} {...form.register('emergencyContact')} />
          </div>
        </div>

        <p className="text-xs text-gray-500">
          {t('admin.profile.username_readonly', 'Username and password aren’t edited here — use the Reset Password action separately.')}
        </p>

        <EmployeeHRFields register={form.register} />

        <ProfessionalPhotoField
          role={profile.role as EmployeePhotoRole}
          employeeId={profile.ownerId}
          currentUrl={profile.officialPhoto}
          onUploaded={() => { /* refetch on Save will pick up the new url */ }}
        />

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <Button type="button" variant="ghost" icon={<X className="w-4 h-4" />} onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={submitting} icon={<Save className="w-4 h-4" />}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
