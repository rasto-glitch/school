// Active employees list for one role sub-tab of the new EmployeesManagement
// layout. Fetches via the role-specific list endpoint, normalizes rows into
// a shared shape, and renders the SortableTable. Click on a row opens the
// employee's profile page.
//
// The role-specific second column varies by role (classes for teacher,
// position for staff, username for the four account roles).

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Search, UserPlus } from 'lucide-react';
import { adminApi } from '../../../services/api';
import { useDebounce } from '../../../hooks/useDebounce';
import { thumbnailUrl } from '../../../utils/storageImage';
import Input from '../../../components/common/Input';
import Button from '../../../components/common/Button';
import LoadingSpinner from '../../../components/common/LoadingSpinner';
import SortableTable, { type SortableColumn } from '../../../components/common/SortableTable';
import type { EmployeeRole } from '../../../types/employeeRecords';

interface Row {
  id: string;
  role: EmployeeRole;
  fullName: string;
  photoUrl: string | null;
  phone: string | null;
  hireDate: string | null;
  /** Role-specific column value. */
  extra: string;
}

interface Props {
  role: EmployeeRole;
}


interface RawRecord {
  id: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  phoneNumber?: string | null;
  phone?: string | null;
  hireDate?: string | null;
  position?: string | null;
  isActive?: boolean;
  role?: string;
  /** staff_members rows expose the linked user's role (null when the row has
   *  no underlying user). Used to filter out teachers / admins that share
   *  the staff_members table for salary tracking. */
  userRole?: string | null;
  officialPhoto?: string | null;
  profilePicture?: string | null;
  teacherClasses?: { classes?: { name?: string } }[];
}

async function loadRows(role: EmployeeRole): Promise<Row[]> {
  if (role === 'teacher') {
    const r = await adminApi.getTeachers('list');
    return ((r.data || []) as RawRecord[]).map(rec => ({
      id: rec.id,
      role: 'teacher',
      fullName: rec.fullName || '',
      photoUrl: rec.officialPhoto ?? rec.profilePicture ?? null,
      phone: rec.phoneNumber ?? null,
      hireDate: rec.hireDate ?? null,
      extra: (rec.teacherClasses || [])
        .map(tc => tc.classes?.name)
        .filter(Boolean)
        .join(', '),
    }));
  }
  if (role === 'staff') {
    const r = await adminApi.getStaff('active');
    // staff_members is a union: pure staff PLUS teachers / supervisors /
    // admins linked for salary tracking. The Active Staff sub-tab should
    // show only the pure ones (no underlying user, or the user IS a staff
    // role). Cross-linked teachers / admins appear in their own sub-tabs.
    return ((r.data || []) as RawRecord[])
      .filter(rec => rec.userRole == null || rec.userRole === 'staff')
      .map(rec => ({
        id: rec.id,
        role: 'staff',
        fullName: rec.fullName || '',
        photoUrl: rec.officialPhoto ?? null,
        phone: rec.phoneNumber ?? rec.phone ?? null,
        hireDate: rec.hireDate ?? null,
        extra: rec.position ?? '',
      }));
  }
  const r = await adminApi.getAccounts();
  return ((r.data || []) as RawRecord[])
    .filter(rec => rec.role === role && rec.isActive)
    .map(rec => ({
      id: rec.id,
      role,
      fullName: `${rec.firstName || ''} ${rec.lastName || ''}`.trim() || rec.username || '',
      photoUrl: rec.officialPhoto ?? null,
      phone: rec.phone ?? null,
      hireDate: rec.hireDate ?? null,
      extra: rec.username || '',
    }));
}

export default function ActiveEmployeeList({ role }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 250);

  const load = async () => {
    setLoading(true);
    try {
      setRows(await loadRows(role));
    } catch {
      toast.error(t('admin.list.failed_load', 'Failed to load employees'));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [role]);

  const filtered = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.fullName.toLowerCase().includes(q)
      || r.extra.toLowerCase().includes(q)
      || (r.phone ?? '').toLowerCase().includes(q),
    );
  }, [rows, debounced]);

  const columns: SortableColumn<Row>[] = [
    {
      key: 'avatar',
      label: '',
      headerClassName: 'w-12',
      // Render the avatar as a CSS background-image rather than an <img>.
      // Many <img> elements in a scroll container get promoted to their own
      // layers and re-rasterize during scroll, which forces a full-viewport
      // repaint every frame (janky). A background-image paints into the row's
      // own layer and scrolls on the compositor. We still request a 56px
      // Supabase thumbnail; the initials/bg show through if it fails to load.
      render: r => r.photoUrl
        ? <div
            className="w-7 h-7 rounded-full bg-primary-100 bg-cover bg-center"
            style={{ backgroundImage: `url("${thumbnailUrl(r.photoUrl, 56) ?? r.photoUrl}")` }}
            aria-hidden
          />
        : <div className="w-7 h-7 rounded-full bg-primary-100 text-primary-700 font-bold text-xs flex items-center justify-center">{r.fullName[0]?.toUpperCase() || '?'}</div>,
    },
    {
      key: 'name',
      label: t('admin.list.col_name', 'Name'),
      render: r => <span className="font-medium text-gray-900">{r.fullName || '—'}</span>,
      sortValue: r => r.fullName,
    },
    {
      key: 'extra',
      // Role-specific column: classes (teacher), position (staff), or
      // username (account roles). Inlined here so i18next's TFunction
      // resolves the (key, defaultValue) overload at the call site;
      // wrapping it in a helper that types t narrowly breaks the Vercel
      // build under stricter TS settings.
      label: role === 'teacher'
        ? t('admin.list.col_classes', 'Classes')
        : role === 'staff'
          ? t('admin.list.col_position', 'Position')
          : t('admin.list.col_username', 'Username'),
      render: r => <span className="text-gray-700">{r.extra || '—'}</span>,
      sortValue: r => r.extra,
    },
    {
      key: 'phone',
      label: t('admin.list.col_phone', 'Phone'),
      render: r => <span className="text-gray-600">{r.phone || '—'}</span>,
      sortValue: r => r.phone || '',
    },
    {
      key: 'hireDate',
      label: t('admin.list.col_hire', 'Hire date'),
      render: r => <span className="text-gray-600 whitespace-nowrap">{r.hireDate || '—'}</span>,
      sortValue: r => r.hireDate || '',
    },
  ];

  const goToProfile = (row: Row) => navigate(`/admin/employees/${row.role}/${row.id}`);
  const goToWizard = () => navigate(`/admin/employees?top=add&sub=${role}`);

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <Input
            placeholder={t('admin.list.search_ph', 'Search by name, phone or column…')}
            icon={<Search className="w-4 h-4" />}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Button onClick={goToWizard} icon={<UserPlus className="w-4 h-4" />}>
          {t('admin.list.add_new', 'Add new')}
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><LoadingSpinner /></div>
      ) : (
        <SortableTable<Row>
          rows={filtered}
          columns={columns}
          rowKey={r => r.id}
          onRowClick={goToProfile}
          emptyMessage={t('admin.list.empty', 'No employees')}
          emptyDescription={t('admin.list.empty_hint', 'Add one with the Add new button above.')}
          defaultSort={{ key: 'hireDate', dir: 'desc' }}
        />
      )}
    </div>
  );
}
