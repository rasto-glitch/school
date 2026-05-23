import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { Camera, Loader2 } from 'lucide-react';
import { adminApi } from '../../services/api';

// Admin-uploaded professional (official) photo, kept on the employee record
// for contracts / the employee profile. Distinct from the employee's own app
// avatar (which they set themselves and which this never overrides). Shown
// only in edit mode — a record id is required to attach the photo to.

export type EmployeePhotoRole = 'teacher' | 'driver' | 'staff' | 'supervisor' | 'admin' | 'reception' | 'accountant';

export default function ProfessionalPhotoField({
  role, employeeId, currentUrl, onUploaded,
}: {
  role: EmployeePhotoRole;
  employeeId: string;
  currentUrl: string | null;
  onUploaded: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(currentUrl);

  // Resync the preview when the selected employee (or their saved photo) changes.
  useEffect(() => { setPreview(currentUrl); }, [currentUrl, employeeId]);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const res = await adminApi.uploadEmployeePhoto(role, employeeId, file);
      const url = res.data?.officialPhoto as string;
      setPreview(url);
      onUploaded(url);
      toast.success('Professional photo updated');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to upload photo');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="border-t border-gray-100 pt-3">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Professional photo</p>
      <div className="flex items-center gap-3">
        <div className="w-16 h-16 rounded-lg bg-gray-100 overflow-hidden flex items-center justify-center flex-shrink-0">
          {preview
            ? <img src={preview} alt="Professional" className="w-full h-full object-cover" />
            : <Camera className="w-6 h-6 text-gray-400" />}
        </div>
        <div className="flex-1">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-2 text-sm font-medium text-primary-600 hover:text-primary-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
            {preview ? 'Replace photo' : 'Upload photo'}
          </button>
          <p className="text-xs text-gray-400 mt-1">Official photo for the employee record. Does not change the employee's own app picture.</p>
        </div>
        <input ref={inputRef} type="file" accept="image/*" onChange={onPick} className="hidden" />
      </div>
    </div>
  );
}
