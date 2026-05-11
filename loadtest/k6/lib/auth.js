import http from 'k6/http';
import { check, fail } from 'k6';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000';
export const ABBR = (__ENV.ABBR || 'load').toLowerCase();
export const PASSWORD = __ENV.PASSWORD || 'Test1234!';

// One JWT per VU, lazily fetched on first iteration. Cached for the VU's lifetime.
let cachedToken = null;
let cachedUserId = null;

export function loginAs(role, index) {
  if (cachedToken) return { token: cachedToken, userId: cachedUserId };

  const username = `${ABBR}_${role}${index}`;
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ username, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } }
  );

  const ok = check(res, {
    'login 200': (r) => r.status === 200,
    'token present': (r) => !!r.json('token'),
  });
  if (!ok) {
    fail(`login failed for ${username}: status=${res.status} body=${res.body}`);
  }
  cachedToken = res.json('token');
  cachedUserId = res.json('user.id');
  return { token: cachedToken, userId: cachedUserId };
}

export function authHeaders(token) {
  return { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
}

// Pick a user index for this VU. Each VU gets a stable index in [1, pool].
export function vuIndex(pool) {
  return ((__VU - 1) % pool) + 1;
}
