// Pentest H-2 belt-and-suspenders. Supabase Storage's default response policy
// (downgrade-to-text/plain + sandbox CSP + nosniff) already neutralizes the
// active-XSS path for client-claimed text/html, but the backend pattern of
// trusting `file.mimetype` is fragile — any change to bucket settings, a
// migration to a different storage provider, or a custom domain that strips
// those headers reactivates the bug. This helper makes sure the stored
// Content-Type itself is never an actively-rendered type.
//
// Anything outside the allowlist is stored as `application/octet-stream` —
// the file is preserved byte-for-byte, callers can still download it, but
// browsers won't try to render it inline. SVG is deliberately excluded — it's
// XML with script support.

const IMAGE_MIMES = new Set<string>([
  'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp',
  'image/heic', 'image/heif', 'image/bmp', 'image/tiff',
]);

const DOC_MIMES = new Set<string>([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/rtf',
  'text/plain', 'text/csv', 'text/markdown',
]);

const ARCHIVE_MIMES = new Set<string>([
  'application/zip', 'application/x-zip-compressed', 'application/x-7z-compressed',
  'application/x-rar-compressed', 'application/gzip', 'application/x-tar',
]);

const MEDIA_MIMES = new Set<string>([
  'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/mp4', 'audio/aac',
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo',
]);

const STRUCTURED_MIMES = new Set<string>(['application/json']);

const ATTACHMENT_ALLOWLIST = new Set<string>([
  ...IMAGE_MIMES, ...DOC_MIMES, ...ARCHIVE_MIMES, ...MEDIA_MIMES, ...STRUCTURED_MIMES,
]);

function normalize(claimed: string | undefined | null): string {
  if (!claimed) return '';
  return claimed.toLowerCase().split(';')[0].trim();
}

export function safeImageMime(claimed: string | undefined | null): string {
  const lower = normalize(claimed);
  return IMAGE_MIMES.has(lower) ? lower : 'application/octet-stream';
}

export function safeAttachmentMime(claimed: string | undefined | null): string {
  const lower = normalize(claimed);
  return ATTACHMENT_ALLOWLIST.has(lower) ? lower : 'application/octet-stream';
}
