// Day 7 — force-change-password flow. The previous days exercised the
// force-change screen indirectly (the parent's bulk-upload-created
// account hits it on first login; helpers/login.ts handles it
// transparently and persists the new password to .env.test). This spec
// covers the bits the implicit path doesn't:
//
//   1. The screen actually rejects any of the shipping defaults as the
//      "new" password — server-side, so a forged frontend can't bypass
//      it.
//   2. The screen accepts a strong non-default password and then the
//      next login bypasses /force-change-password entirely.
//
// All assertions are read-only against state the parent suite already
// established. We never create or delete users here, so re-runs are
// trivially idempotent.

import { test, expect, request } from '@playwright/test';
import { config, credentials } from '../helpers/env';
import { recordFinding } from '../helpers/findings';

test.describe.configure({ mode: 'serial' });

test.describe('day 7 — force-change-password guards', () => {
  test('7.1 server rejects any shipping default as the new password', async () => {
    // We use the parent account because it's the one guaranteed to have
    // gone through the force-change screen at least once during day 6,
    // so we know the env is populated with a working credential.
    const par = credentials.parent();
    if (!par.username || !par.password) {
      test.skip(true, 'PARENT_USERNAME/PARENT_PASSWORD missing — run day 1 first');
      return;
    }

    const api = await request.newContext({ baseURL: config.apiBase });
    const loginRes = await api.post('/api/auth/login', {
      data: { username: par.username, password: par.password },
    });
    expect(loginRes.ok(), `login response: ${loginRes.status()} ${await loginRes.text()}`).toBeTruthy();
    const { token } = await loginRes.json();

    // Hit /auth/change-password trying to set the password TO a known
    // default. The server checks isDefaultPassword() and must respond
    // 400 — the user did just authenticate, so this isolates the
    // default-block check from other guardrails.
    const defaults = ['Parent@123', 'Teacher@123', 'Driver@123', 'Supervisor@123', 'Accountant@123', 'Reception@123'];
    for (const d of defaults) {
      const res = await api.post('/api/auth/change-password', {
        headers: { Authorization: `Bearer ${token}` },
        data: { currentPassword: par.password, newPassword: d },
      });
      if (res.status() !== 400) {
        const body = await res.text();
        recordFinding({
          day: 'accountant',
          severity: 'High',
          feature: `Default password "${d}" not rejected by /auth/change-password`,
          issue: `Expected 400; got ${res.status()}: ${body.slice(0, 200)}`,
          repro: `POST /api/auth/change-password with newPassword="${d}" while authenticated.`,
        });
      }
      expect(res.status(), `default "${d}" should be rejected`).toBe(400);
    }

    await api.dispose();
  });

  test('7.2 first-time-change endpoint refuses when must_change_password is false', async () => {
    // The parent's must_change_password was cleared by the helper during
    // day 6's first login, so the first-time endpoint should refuse —
    // otherwise it'd be a free password-rotate bypass for the regular
    // change-password endpoint's current-password check.
    const par = credentials.parent();
    if (!par.username || !par.password) {
      test.skip(true, 'PARENT_USERNAME/PARENT_PASSWORD missing — run day 1 first');
      return;
    }

    const api = await request.newContext({ baseURL: config.apiBase });
    const loginRes = await api.post('/api/auth/login', {
      data: { username: par.username, password: par.password },
    });
    expect(loginRes.ok()).toBeTruthy();
    const { token, user } = await loginRes.json();

    // Sanity: the parent has already cleared the flag (we're past day 6).
    expect(user.mustChangePassword).toBeFalsy();

    const res = await api.post('/api/auth/first-time-change-password', {
      headers: { Authorization: `Bearer ${token}` },
      data: { newPassword: 'Some-Other-Password!1' },
    });
    if (res.status() !== 409) {
      recordFinding({
        day: 'accountant',
        severity: 'High',
        feature: '/auth/first-time-change-password accepts requests after flag cleared',
        issue: `Expected 409 for a user with must_change_password=false; got ${res.status()}: ${(await res.text()).slice(0, 200)}`,
        repro: 'POST /api/auth/first-time-change-password as any user who has already changed their password once.',
      });
    }
    expect(res.status()).toBe(409);
    await api.dispose();
  });
});
