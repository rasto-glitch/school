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
