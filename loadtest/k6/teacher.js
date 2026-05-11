// Teacher flow — list students, write grades. Write-heavy.
// Run: k6 run -e BASE_URL=https://your-test-backend loadtest/k6/teacher.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, loginAs, authHeaders, vuIndex } from './lib/auth.js';

export const options = {
  scenarios: {
    teachers: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 10 },
        { duration: '5m', target: 40 },
        { duration: '2m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<1000'],
  },
};

const TEACHER_POOL = parseInt(__ENV.TEACHER_POOL || '40', 10);

export default function () {
  const { token } = loginAs('teacher', vuIndex(TEACHER_POOL));
  const h = authHeaders(token);

  // Pull profile + students once per iteration
  const students = http.get(`${BASE_URL}/api/teacher/students`, { ...h, tags: { name: 'teacher.students' } });
  check(students, { 'students 2xx': (r) => r.status >= 200 && r.status < 300 });

  http.get(`${BASE_URL}/api/teacher/homework`, { ...h, tags: { name: 'teacher.homework' } });
  http.get(`${BASE_URL}/api/teacher/notifications/unread-count`, { ...h, tags: { name: 'teacher.unread' } });

  // Pick first student to upsert a grade for (write path)
  let firstStudentId = null;
  try {
    const arr = students.json();
    if (Array.isArray(arr) && arr.length) firstStudentId = arr[0].id;
  } catch (_) {}

  let firstClassId = null;
  try {
    const arr = students.json();
    if (Array.isArray(arr) && arr.length) firstClassId = arr[0].classId;
  } catch (_) {}

  if (firstStudentId) {
    const body = {
      studentId: firstStudentId,
      classId: firstClassId,
      subject: 'Math',
      gradingPeriod: 'term1',
      marks: [{ name: 'Quiz', value: 8 + Math.floor(Math.random() * 3) }],
    };
    const grade = http.post(
      `${BASE_URL}/api/teacher/grades`,
      JSON.stringify(body),
      { ...h, tags: { name: 'teacher.upsertGrade' } }
    );
    check(grade, { 'grade 2xx': (r) => r.status >= 200 && r.status < 300 });
  }

  sleep(8 + Math.random() * 12);
}
