// Shared upload-safety helpers. File names from clients are untrusted and
// must never be concatenated into Supabase storage keys raw: a name like
// `a.png/../../other/key` would otherwise let a caller write outside its
// schoolId/userId prefix.

// Returns a safe file extension INCLUDING the leading dot (e.g. ".png"),
// or `fallback` when the original name has no usable extension. The result
// is lowercased and stripped to [a-z0-9], max 8 chars, so it can never
// contain path separators or traversal segments.
export function safeExt(
  originalname: string | null | undefined,
  fallback = '',
): string {
  const raw = (originalname || '').split('.').pop() || '';
  const clean = raw.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
  return clean ? `.${clean}` : fallback;
}

// Collapses anything outside [A-Za-z0-9._-] to underscores and caps length.
// Used for human-facing stored filenames (attachments).
export function sanitizeFilename(
  name: string | null | undefined,
  fallback: string,
): string {
  const raw = (name || fallback).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
  return raw || fallback;
}
