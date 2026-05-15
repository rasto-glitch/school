const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export async function postPublic<T extends Record<string, unknown>>(path: string, body: T): Promise<void> {
  const res = await fetch(`${API_URL}/api/public/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(data.error || 'Request failed');
  }
}

// Unauthenticated calls to /api/auth/<path>. Used by the reset-password and
// confirm-email pages — the token in the URL IS the authentication.
export async function postAuth<T extends Record<string, unknown>, R = unknown>(path: string, body: T): Promise<R> {
  const res = await fetch(`${API_URL}/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || 'Request failed');
  }
  return data as R;
}
