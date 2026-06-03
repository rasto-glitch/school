// Phase 3 — client-side persistence for trusted-device tokens.
//
// The token is keyed by username so a shared browser with multiple
// accounts can keep them apart. On login attempt, we look up the token
// for the username the user typed and replay it; on verify-mfa success
// with rememberDevice=true, the server returns a new token which we
// store. Stale tokens are silently dropped server-side after 30 days,
// so we don't actively expire them client-side.

const KEY_PREFIX = 'scholify.trusted_device.';

function key(username: string): string {
  return KEY_PREFIX + username.trim().toLowerCase();
}

export function getTrustedDeviceToken(username: string): string | undefined {
  try {
    const v = localStorage.getItem(key(username));
    return v || undefined;
  } catch {
    return undefined;
  }
}

export function setTrustedDeviceToken(username: string, token: string): void {
  try { localStorage.setItem(key(username), token); } catch { /* private mode */ }
}

export function clearTrustedDeviceToken(username: string): void {
  try { localStorage.removeItem(key(username)); } catch { /* private mode */ }
}
