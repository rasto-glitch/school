// Combined realistic mix — parents 70%, teachers 15%, drivers 10%, admin tail 5%.
// Each role runs as its own k6 scenario with its own VU pool, executed in parallel.
// This is the primary "end-to-end realism" scenario.
//
// Run: k6 run -e BASE_URL=https://your-test-backend loadtest/k6/mix.js
//
// Tune scale with TOTAL_VUS (default 200):
//   k6 run -e BASE_URL=... -e TOTAL_VUS=500 loadtest/k6/mix.js
//
// Pair this with the Artillery Socket.io run for full coverage.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, loginAs, authHeaders, vuIndex } from './lib/auth.js';

const TOTAL = parseInt(__ENV.TOTAL_VUS || '200', 10);
const DURATION = __ENV.DURATION || '10m';
const RAMP = __ENV.RAMP || '2m';

const parentVUs  = Math.max(1, Math.round(TOTAL * 0.70));
const teacherVUs = Math.max(1, Math.round(TOTAL * 0.15));
const driverVUs  = Math.max(1, Math.round(TOTAL * 0.10));
const adminVUs   = Math.max(1, Math.round(TOTAL * 0.05));

export const options = {
  scenarios: {
    parents:  { executor: 'ramping-vus', exec: 'parentFlow',  startVUs: 0, stages: [{ duration: RAMP, target: parentVUs  }, { duration: DURATION, target: parentVUs  }, { duration: '30s', target: 0 }] },
    teachers: { executor: 'ramping-vus', exec: 'teacherFlow', startVUs: 0, stages: [{ duration: RAMP, target: teacherVUs }, { duration: DURATION, target: teacherVUs }, { duration: '30s', target: 0 }] },
    drivers:  { executor: 'constant-vus', exec: 'driverFlow', vus: driverVUs, duration: DURATION },
    admins:   { executor: 'ramping-vus', exec: 'adminFlow',   startVUs: 0, stages: [{ duration: RAMP, target: adminVUs   }, { duration: DURATION, target: adminVUs   }, { duration: '30s', target: 0 }] },
  },
  thresholds: {
    http_req_failed:   ['rate<0.03'],
    http_req_duration: ['p(95)<1200'],
    'http_req_duration{name:login}':         ['p(95)<2000'],
    'http_req_duration{name:driver.location}': ['p(95)<600'],
  },
};

const PARENT_POOL  = parseInt(__ENV.PARENT_POOL  || '600', 10);
const TEACHER_POOL = parseInt(__ENV.TEACHER_POOL || '40',  10);
const DRIVER_POOL  = parseInt(__ENV.DRIVER_POOL  || '10',  10);

export function parentFlow() {
  const { token } = loginAs('parent', vuIndex(PARENT_POOL));
  const h = authHeaders(token);
  const r = http.batch([
    ['GET', `${BASE_URL}/api/parent/children`,                   null, { ...h, tags: { name: 'parent.children' } }],
    ['GET', `${BASE_URL}/api/parent/announcements`,              null, { ...h, tags: { name: 'parent.announcements' } }],
    ['GET', `${BASE_URL}/api/parent/grades`,                     null, { ...h, tags: { name: 'parent.grades' } }],
    ['GET', `${BASE_URL}/api/parent/homework`,                   null, { ...h, tags: { name: 'parent.homework' } }],
    ['GET', `${BASE_URL}/api/parent/notifications/unread-count`, null, { ...h, tags: { name: 'parent.unread' } }],
  ]);
  r.forEach((x) => check(x, { '2xx': (y) => y.status >= 200 && y.status < 300 }));
  if (Math.random() < 0.3) {
    http.get(`${BASE_URL}/api/parent/bus-location`, { ...h, tags: { name: 'parent.bus' } });
  }
  sleep(5 + Math.random() * 10);
}

export function teacherFlow() {
  const { token } = loginAs('teacher', vuIndex(TEACHER_POOL));
  const h = authHeaders(token);
  const students = http.get(`${BASE_URL}/api/teacher/students`, { ...h, tags: { name: 'teacher.students' } });
  http.get(`${BASE_URL}/api/teacher/homework`, { ...h, tags: { name: 'teacher.homework' } });
  let s = null, c = null;
  try { const a = students.json(); if (Array.isArray(a) && a.length) { s = a[0].id; c = a[0].classId; } } catch (_) {}
  if (s) {
    http.post(`${BASE_URL}/api/teacher/grades`, JSON.stringify({
      studentId: s, classId: c, subject: 'Math', gradingPeriod: 'term1',
      marks: [{ name: 'Quiz', value: 8 + Math.floor(Math.random() * 3) }],
    }), { ...h, tags: { name: 'teacher.upsertGrade' } });
  }
  sleep(8 + Math.random() * 12);
}

export function driverFlow() {
  const { token } = loginAs('driver', vuIndex(DRIVER_POOL));
  const h = authHeaders(token);
  if (__ITER === 0) {
    http.post(`${BASE_URL}/api/driver/start`, JSON.stringify({ studentRides: [] }),
      { ...h, tags: { name: 'driver.start' } });
  }
  const drift = (__ITER % 200) * 0.0001;
  http.post(`${BASE_URL}/api/driver/location`, JSON.stringify({
    latitude: 50.110 + drift + (Math.random() - 0.5) * 0.0005,
    longitude: 8.680 + drift + (Math.random() - 0.5) * 0.0005,
    speed: 30 + Math.random() * 20, heading: 0, isDriving: true,
  }), { ...h, tags: { name: 'driver.location' } });
  sleep(30);
}

export function adminFlow() {
  const { token } = loginAs('admin'); // single seeded admin (no suffix)
  const h = authHeaders(token);
  http.batch([
    ['GET', `${BASE_URL}/api/admin/students`,                       null, { ...h, tags: { name: 'admin.students' } }],
    ['GET', `${BASE_URL}/api/admin/appointments/pending-count`,     null, { ...h, tags: { name: 'admin.pending' } }],
    ['GET', `${BASE_URL}/api/admin/announcements`,                  null, { ...h, tags: { name: 'admin.announcements' } }],
  ]);
  sleep(15 + Math.random() * 15);
}
