// Keys that must never appear in API responses regardless of where they
// arrive from. Acts as a transform-layer backstop: even if a controller
// forgets an explicit column projection and does `.select()` / `.select('*')`
// on `users`, the hash never reaches the client because toCC() strips it
// here. Add anything sensitive whose presence in a response would be a bug:
// passwords, raw tokens, server-side secret fields, etc.
const SENSITIVE_KEYS = new Set<string>([
  'password_hash', 'passwordHash',
  'password',
  'token_hash', 'tokenHash',
  'reset_token_hash', 'resetTokenHash',
  'refresh_token_hash', 'refreshTokenHash',
]);

/** Convert snake_case keys to camelCase recursively. Strips sensitive keys. */
export function toCC(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(toCC);
  if (obj !== null && typeof obj === 'object' && !(obj instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k)) continue;
      const camel = k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      // The camelCased key may also be a sensitive identifier (e.g.
      // `password_hash` → `passwordHash`); double-check on the way out.
      if (SENSITIVE_KEYS.has(camel)) continue;
      out[camel] = toCC(v);
    }
    return out;
  }
  return obj;
}
