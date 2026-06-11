import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env.test') });

// Live deployment targets. Override via env if you point at staging/local later.
const WEB_BASE = process.env.WEB_BASE_URL ?? 'https://school-xi-blush.vercel.app';
const API_BASE = process.env.API_BASE_URL ?? 'https://school-production-3ccc.up.railway.app';

export default defineConfig({
  testDir: './tests',
  // Tests run strictly in order — admin creates the world the other roles
  // live in, so day 1 must finish before day 2 starts. fullyParallel: false +
  // workers: 1 enforces that across files.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'results/html', open: 'never' }],
    ['json', { outputFile: 'results/results.json' }],
  ],
  outputDir: 'results/artifacts',
  use: {
    baseURL: WEB_BASE,
    // Always capture artefacts. We want to be able to look back at any step
    // when triaging a finding — screenshots on every action, video on failure,
    // trace on first-retry. Disk is cheap.
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // Surface uncaught console errors and unhandled responses in test output.
    extraHTTPHeaders: {
      'X-E2E-Test': 'scholify-e2e',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
