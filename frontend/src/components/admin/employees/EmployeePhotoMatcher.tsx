// Post-bulk-upload photo matcher. After teachers are created we know each
// one's id + name + username, so the admin can drop a whole folder of photos
// once and we auto-match each file to a teacher by filename (against the
// username or full name, punctuation/case-insensitive). Matched faces show as
// thumbnails in a grid; anything unmatched sits in a tray to assign by hand.
// Upload reuses the existing per-employee photo endpoint (H-2 hardened), run
// with a small concurrency pool. Nothing here is destructive — teachers with
// no photo just stay as they are.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Camera, Check, X, Upload, ImagePlus } from 'lucide-react';
import { adminApi } from '../../../services/api';
import Card from '../../common/Card';
import Button from '../../common/Button';

export interface MatchTarget { id: string; fullName: string; username: string; }
type Status = 'idle' | 'uploading' | 'done' | 'error';
interface Pic { file: File; url: string; }

const stripExt = (fn: string) => fn.replace(/\.[^.]+$/, '');
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const mkPic = (file: File): Pic => ({ file, url: URL.createObjectURL(file) });

export default function EmployeePhotoMatcher({
  role, targets, onDone,
}: {
  role: 'teacher' | 'driver';
  targets: MatchTarget[];
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const bulkInputRef = useRef<HTMLInputElement>(null);
  const [assigned, setAssigned] = useState<Record<string, Pic>>({});
  const [unmatched, setUnmatched] = useState<Pic[]>([]);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);

  // Revoke every object URL we created (assigned + tray) on unmount. We track
  // the live sets in a ref so the cleanup sees the latest, not a stale closure.
  const liveUrls = useRef<{ assigned: Record<string, Pic>; unmatched: Pic[] }>({ assigned: {}, unmatched: [] });
  liveUrls.current = { assigned, unmatched };
  useEffect(() => () => {
    Object.values(liveUrls.current.assigned).forEach(a => URL.revokeObjectURL(a.url));
    liveUrls.current.unmatched.forEach(a => URL.revokeObjectURL(a.url));
  }, []);

  // candidate filename-key → teacher id. First teacher to claim a key wins
  // (collisions are rare; manual assignment covers them).
  const candidateToId = new Map<string, string>();
  for (const tg of targets) {
    const afterAbbrev = tg.username.includes('_') ? tg.username.slice(tg.username.indexOf('_') + 1) : tg.username;
    for (const cand of [tg.fullName, tg.username, afterAbbrev]) {
      const k = norm(cand);
      if (k && !candidateToId.has(k)) candidateToId.set(k, tg.id);
    }
  }

  const addFiles = (files: File[]) => {
    const next = { ...assigned };
    const leftovers: Pic[] = [];
    for (const file of files) {
      const id = file.type.startsWith('image/') ? candidateToId.get(norm(stripExt(file.name))) : undefined;
      if (id && !next[id]) next[id] = mkPic(file);
      else leftovers.push(mkPic(file));
    }
    setAssigned(next);
    if (leftovers.length) setUnmatched(u => [...u, ...leftovers]);
  };

  const assignTo = (id: string, file: File) => {
    setAssigned(prev => {
      if (prev[id]) URL.revokeObjectURL(prev[id].url);
      return { ...prev, [id]: mkPic(file) };
    });
  };

  const clearOne = (id: string) => {
    setAssigned(prev => {
      if (!prev[id]) return prev;
      URL.revokeObjectURL(prev[id].url);
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  // Assign a tray photo to a teacher via the per-card dropdown. Reuse the tray
  // item's existing object URL rather than minting a new one.
  const assignFromTray = (pic: Pic, id: string) => {
    setAssigned(prev => {
      if (prev[id]) URL.revokeObjectURL(prev[id].url);
      return { ...prev, [id]: pic };
    });
    setUnmatched(u => u.filter(p => p !== pic));
  };

  const matchedCount = Object.keys(assigned).length;

  const upload = async () => {
    const ids = Object.keys(assigned);
    if (ids.length === 0) { toast.info(t('admin.bulk_emp.photos.none_selected', 'No photos selected.')); return; }
    setUploading(true);
    setStatus(Object.fromEntries(ids.map(id => [id, 'idle' as Status])));

    let cursor = 0;
    let ok = 0;
    let failed = 0;
    const worker = async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++];
        setStatus(s => ({ ...s, [id]: 'uploading' }));
        try {
          await adminApi.uploadEmployeePhoto(role, id, assigned[id].file);
          setStatus(s => ({ ...s, [id]: 'done' }));
          ok++;
        } catch {
          setStatus(s => ({ ...s, [id]: 'error' }));
          failed++;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker));

    setUploading(false);
    setDone(true);
    if (failed === 0) {
      toast.success(t('admin.bulk_emp.photos.uploaded', { count: ok, defaultValue: '{{count}} photo(s) uploaded.' }));
    } else {
      toast.warn(t('admin.bulk_emp.photos.uploaded_partial', { ok, failed, defaultValue: '{{ok}} uploaded, {{failed}} failed.' }));
    }
    onDone?.();
  };

  return (
    <Card>
      <div className="flex items-start gap-3 mb-4">
        <div className="w-9 h-9 bg-primary-100 rounded-lg flex items-center justify-center flex-shrink-0">
          <Camera className="w-5 h-5 text-primary-700" />
        </div>
        <div className="flex-1">
          <h2 className="font-semibold text-gray-900">
            {t('admin.bulk_emp.photos.title', 'Add teacher photos')}
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {t('admin.bulk_emp.photos.subtitle', 'Optional. Drop all the photos at once — each is matched to a teacher by its file name (their name or username). Fix any leftovers below, then upload.')}
          </p>
        </div>
        <span className="text-xs font-semibold bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full flex-shrink-0">
          {t('admin.bulk_emp.photos.matched_of', { matched: matchedCount, total: targets.length, defaultValue: '{{matched}} of {{total}} matched' })}
        </span>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <input
          ref={bulkInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={e => { addFiles(Array.from(e.target.files ?? [])); if (bulkInputRef.current) bulkInputRef.current.value = ''; }}
          className="hidden"
        />
        <Button type="button" variant="outline" disabled={uploading} onClick={() => bulkInputRef.current?.click()}>
          <ImagePlus className="w-4 h-4 mr-1.5" />
          {t('admin.bulk_emp.photos.select_all', 'Select all photos')}
        </Button>
      </div>

      {/* Teacher grid — one slot per created teacher. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {targets.map(tg => {
          const a = assigned[tg.id];
          const st = status[tg.id];
          return (
            <div key={tg.id} className="border border-gray-200 rounded-xl p-3 flex items-center gap-3">
              <div className="w-14 h-14 rounded-lg bg-gray-100 overflow-hidden flex items-center justify-center flex-shrink-0 relative">
                {a
                  ? <img src={a.url} alt={tg.fullName} className="w-full h-full object-cover" />
                  : <span className="text-gray-400 font-bold">{(tg.fullName || '?')[0]}</span>}
                {st === 'done' && (
                  <span className="absolute inset-0 bg-green-600/70 flex items-center justify-center">
                    <Check className="w-6 h-6 text-white" />
                  </span>
                )}
                {st === 'error' && (
                  <span className="absolute inset-0 bg-red-600/70 flex items-center justify-center">
                    <X className="w-6 h-6 text-white" />
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900 truncate">{tg.fullName}</p>
                <p className="text-xs text-gray-500 truncate">{tg.username}</p>
                <div className="mt-1 flex items-center gap-2">
                  <PhotoPicker disabled={uploading} hasPhoto={!!a} onPick={f => assignTo(tg.id, f)} />
                  {a && !uploading && (
                    <button type="button" onClick={() => clearOne(tg.id)} className="text-xs text-gray-400 hover:text-red-600">
                      {t('admin.bulk_emp.photos.clear', 'Remove')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Unmatched tray — photos whose name didn't match anyone. */}
      {unmatched.length > 0 && (
        <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-sm text-amber-900 font-medium mb-2">
            {t('admin.bulk_emp.photos.unmatched', { count: unmatched.length, defaultValue: "{{count}} photo(s) didn't match — assign them" })}
          </p>
          <div className="space-y-2">
            {unmatched.map((pic, i) => (
              <div key={i} className="flex items-center gap-2 bg-white border border-amber-200 rounded-lg p-2">
                <img src={pic.url} alt={pic.file.name} className="w-10 h-10 rounded object-cover flex-shrink-0" />
                <span className="text-xs text-gray-600 truncate flex-1">{pic.file.name}</span>
                <select
                  defaultValue=""
                  disabled={uploading}
                  onChange={e => { if (e.target.value) assignFromTray(pic, e.target.value); }}
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-300"
                >
                  <option value="">{t('admin.bulk_emp.photos.assign_to', 'Assign to…')}</option>
                  {targets.filter(tg => !assigned[tg.id]).map(tg => (
                    <option key={tg.id} value={tg.id}>{tg.fullName}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <Button type="button" loading={uploading} disabled={matchedCount === 0 || done} onClick={upload}>
          <Upload className="w-4 h-4 mr-1.5" />
          {t('admin.bulk_emp.photos.upload_n', { count: matchedCount, defaultValue: 'Upload {{count}} photo(s)' })}
        </Button>
        {done && (
          <span className="text-sm text-green-700 font-medium">{t('admin.bulk_emp.photos.finished', 'Done.')}</span>
        )}
      </div>
    </Card>
  );
}

// Per-card hidden file input + button, so each teacher can be set/replaced
// individually (e.g. to fix a wrong auto-match).
function PhotoPicker({
  disabled, hasPhoto, onPick,
}: {
  disabled: boolean;
  hasPhoto: boolean;
  onPick: (f: File) => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => ref.current?.click()}
        className="text-xs font-medium text-primary-600 hover:text-primary-700 disabled:opacity-50"
      >
        {hasPhoto ? t('admin.bulk_emp.photos.change', 'Change') : t('admin.bulk_emp.photos.add', 'Add photo')}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        onChange={e => { const f = e.target.files?.[0]; if (f) onPick(f); if (ref.current) ref.current.value = ''; }}
        className="hidden"
      />
    </>
  );
}
