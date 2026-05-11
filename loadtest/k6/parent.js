// Parent flow — dashboard reads, occasional bus check.
// Run: k6 run -e BASE_URL=https://your-test-backend loadtest/k6/parent.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, loginAs, authHeaders, vuIndex } from './lib/auth.js';

export const options = {
  scenarios: {
    parents: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 50 },
        { duration: '5m', target: 200 },
        { duration: '2m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<800'],
  },
};

const PARENT_POOL = parseInt(__ENV.PARENT_POOL || '600', 10);

export default function () {
  const { token } = loginAs('parent', vuIndex(PARENT_POOL));
  const h = authHeaders(token);

  const responses = http.batch([
    ['GET', `${BASE_URL}/api/parent/children`, null, { ...h, tags: { name: 'parent.children' } }],
    ['GET', `${BASE_URL}/api/parent/announcements`, null, { ...h, tags: { name: 'parent.announcements' } }],
    ['GET', `${BASE_URL}/api/parent/grades`, null, { ...h, tags: { name: 'parent.grades' } }],
    ['GET', `${BASE_URL}/api/parent/homework`, null, { ...h, tags: { name: 'parent.homework' } }],
    ['GET', `${BASE_URL}/api/parent/notifications/unread-count`, null, { ...h, tags: { name: 'parent.unread' } }],
  ]);
  responses.forEach((r) => check(r, { '2xx': (x) => x.status >= 200 && x.status < 300 }));

  // 30% of iterations: check bus location (commute-time behavior)
  if (Math.random() < 0.3) {
    const bus = http.get(`${BASE_URL}/api/parent/bus-location`, { ...h, tags: { name: 'parent.bus' } });
    check(bus, { 'bus 2xx': (r) => r.status >= 200 && r.status < 300 });
  }

  sleep(5 + Math.random() * 10);
}
