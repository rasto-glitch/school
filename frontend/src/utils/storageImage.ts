// Turn a Supabase Storage *public object* URL into an on-the-fly resized
// thumbnail URL, so lists that show tiny avatars don't download and decode
// the full-resolution upload (often multi-MB phone photos) just to paint a
// 28px circle. See Supabase Storage image transformations.
//
//   .../storage/v1/object/public/<bucket>/<key>
//   → .../storage/v1/render/image/public/<bucket>/<key>?width=..&height=..&resize=cover
//
// Anything that isn't a Supabase public object URL is returned unchanged.
// If image transformations aren't enabled on the project's plan the render
// endpoint errors — callers should keep the original URL as an <img onError>
// fallback so the avatar still loads (just at full size, i.e. today's behavior).

const PUBLIC_MARKER = '/storage/v1/object/public/';

export function thumbnailUrl(url: string | null | undefined, size: number): string | null {
  if (!url) return null;
  const i = url.indexOf(PUBLIC_MARKER);
  if (i === -1) return url;
  const base = url.slice(0, i);
  const key = url.slice(i + PUBLIC_MARKER.length);
  return `${base}/storage/v1/render/image/public/${key}?width=${size}&height=${size}&resize=cover&quality=70`;
}
