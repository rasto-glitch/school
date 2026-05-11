// Pre-flight: log in via REST to get a JWT before the socket handshake.
// Artillery passes the JWT through the engine's `query.token` and exposes the
// chosen driverId as `{{ driverId }}` to the scenario flow.

const http = require('http');
const https = require('https');
const { URL } = require('url');

function postJson(targetUrl, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const lib = u.protocol === 'https:' ? https : http;
    const data = JSON.stringify(body);
    const req = lib.request(
      {
        method: 'POST',
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
          catch (e) { resolve({ status: res.statusCode, body: raw }); }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

let counter = 0;
const pool = parseInt(process.env.PARENT_POOL || '600', 10);

module.exports = {
  preLogin: async (context, _events, done) => {
    const idx = (counter++ % pool) + 1;
    const abbr = context.vars.abbr || 'load';
    const password = context.vars.password || 'Test1234!';
    const base = context.vars.target; // artillery resolves config.target into context

    try {
      const { status, body } = await postJson(`${base}/api/auth/login`, {
        username: `${abbr}_parent${idx}`,
        password,
      });
      if (status !== 200 || !body.token) {
        return done(new Error(`login failed: ${status} ${JSON.stringify(body)}`));
      }
      context.vars.jwt = body.token;

      const ids = (context.vars.driverIds || '').split(',').filter(Boolean);
      if (!ids.length) return done(new Error('DRIVER_IDS env var is empty'));
      context.vars.driverId = ids[Math.floor(Math.random() * ids.length)];
      done();
    } catch (e) {
      done(e);
    }
  },
};
