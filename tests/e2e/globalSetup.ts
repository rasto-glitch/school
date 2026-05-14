// Runs once at the start of every test command. For each role with
// credentials in .env.test, logs in via the UI (with "Remember me" so the
// JWT lands in localStorage) and saves the resulting auth state to
// `storage/<role>.json`. Subsequent test runs reuse the cached state
// instead of re-driving the login form — that keeps us well under the
// backend's 15-attempts-per-15-min rate limit.
//
// Skips roles whose storage file is fresh (<6h old) and whose credentials
// have not changed. Skips entirely when creds are missing (e.g. before
// bootstrap has created the non-admin users).

import { chromium, FullConfig } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { ROLES, TestRole, credsFor, loginAs, storagePathFor } from './helpers/auth';

const STORAGE_DIR = path.resolve(__dirname, 'storage');
const TTL_MS = 6 * 60 * 60 * 1000;  // 6 hours

function isFresh(file: string): boolean {
  try {
    const stat = fs.statSync(file);
    return Date.now() - stat.mtimeMs < TTL_MS;
  } catch {
    return false;
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  // Load the env file the rest of the suite reads — config.ts also loads
  // it, but globalSetup runs in its own process and needs its own copy.
  dotenv.config({ path: path.resolve(__dirname, '.env.test') });

  fs.mkdirSync(STORAGE_DIR, { recursive: true });

  const baseURL = process.env.BASE_URL;
  if (!baseURL) {
    console.warn('[globalSetup] BASE_URL missing — skipping all storageState setup.');
    return;
  }

  const toRefresh: TestRole[] = [];
  for (const role of ROLES) {
    if (!credsFor(role)) {
      console.log(`[globalSetup] ${role}: no credentials in env, skipping (run bootstrap first)`);
      continue;
    }
    if (isFresh(storagePathFor(role))) {
      console.log(`[globalSetup] ${role}: storage state fresh, reusing`);
      continue;
    }
    toRefresh.push(role);
  }

  if (toRefresh.length === 0) return;

  console.log(`[globalSetup] refreshing storage state for: ${toRefresh.join(', ')}`);
  const browser = await chromium.launch();
  try {
    for (const role of toRefresh) {
      const context = await browser.newContext({ baseURL });
      const page = await context.newPage();
      try {
        await loginAs(page, role, { rememberMe: true });
        await context.storageState({ path: storagePathFor(role) });
        console.log(`[globalSetup] ${role}: saved`);
      } catch (err) {
        // Don't throw — let the role-specific spec fail loudly with a useful
        // error instead of a confusing "test never ran" report from globalSetup.
        console.warn(`[globalSetup] ${role}: login failed (${(err as Error).message.split('\n')[0]})`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}
