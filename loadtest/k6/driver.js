// Driver flow — sustained location POSTs every 30s. Lowest VU count, highest write rate.
// This is the path most likely to break things (in-memory proximityState Map + socket fan-out).
// Run: k6 run -e BASE_URL=https://your-test-backend loadtest/k6/driver.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, loginAs, authHeaders, vuIndex } from './lib/auth.js';

export const options = {
  scenarios: {
    drivers: {
      executor: 'constant-vus',
      vus: parseInt(__ENV.DRIVER_VUS || '10', 10),
      duration: __ENV.DURATION || '10m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<600'],
  },
};

const DRIVER_POOL = parseInt(__ENV.DRIVER_POOL || '10', 10);
const BASE_LAT = parseFloat(__ENV.BASE_LAT || '50.110');
const BASE_LNG = parseFloat(__ENV.BASE_LNG || '8.680');

export default function () {
  const { token } = loginAs('driver', vuIndex(DRIVER_POOL));
  const h = authHeaders(token);

  // First iteration of this VU: start the drive so bus-location reads work and
  // proximityState resets cleanly. Empty studentRides → backend defaults to "all on bus".
  if (__ITER === 0) {
    http.post(`${BASE_URL}/api/driver/start`, JSON.stringify({ studentRides: [] }),
      { ...h, tags: { name: 'driver.start' } });
  }

  // Drift the lat/long slightly each tick so proximity calculations actually move
  const drift = (__ITER % 200) * 0.0001;
  const body = {
    latitude: BASE_LAT + drift + (Math.random() - 0.5) * 0.0005,
    longitude: BASE_LNG + drift + (Math.random() - 0.5) * 0.0005,
    speed: 30 + Math.random() * 20,
    heading: Math.floor(Math.random() * 360),
    isDriving: true,
  };

  const res = http.post(
    `${BASE_URL}/api/driver/location`,
    JSON.stringify(body),
    { ...h, tags: { name: 'driver.location' } }
  );
  check(res, { 'location 2xx': (r) => r.status >= 200 && r.status < 300 });

  // Real drivers post every 30s
  sleep(30);
}
