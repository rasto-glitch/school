// Centralised env reader so tests don't sprinkle process.env.X with their own
// defaults. Throws loudly at startup if a required var is missing — the test
// run is already going to fail; better to fail before the browser launches.

import * as path from 'path';

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(
      `Missing required env var: ${name}. ` +
      `Copy .env.test.example to .env.test and fill it in.`,
    );
  }
  return v.trim();
}

function optional(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

export const config = {
  webBase: optional('WEB_BASE_URL', 'https://school-xi-blush.vercel.app'),
  apiBase: optional('API_BASE_URL', 'https://school-production-3ccc.up.railway.app'),
  studentsXlsx: path.resolve(
    __dirname,
    '..',
    optional('STUDENTS_XLSX', './data/students.xlsx'),
  ),
};

export const credentials = {
  admin: () => ({ username: required('ADMIN_USERNAME'),      password: required('ADMIN_PASSWORD') }),
  teacher:    () => ({ username: optional('TEACHER_USERNAME'),    password: optional('TEACHER_PASSWORD') }),
  supervisor: () => ({ username: optional('SUPERVISOR_USERNAME'), password: optional('SUPERVISOR_PASSWORD') }),
  driver:     () => ({ username: optional('DRIVER_USERNAME'),     password: optional('DRIVER_PASSWORD') }),
  parent:     () => ({ username: optional('PARENT_USERNAME'),     password: optional('PARENT_PASSWORD') }),
  accountant: () => ({ username: optional('ACCOUNTANT_USERNAME'), password: optional('ACCOUNTANT_PASSWORD') }),
};

// Used by day-1 admin tests to persist newly-created accounts so day-2+ runs
// can read them via the same env-var names. Writes back to .env.test in place.
export function persistEnvVar(name: string, value: string): void {
  // Lazy require — fs is only needed when day-1 actually writes.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs') as typeof import('fs');
  const envPath = path.resolve(__dirname, '..', '.env.test');
  let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const line = `${name}=${value}`;
  const re = new RegExp(`^${name}=.*$`, 'm');
  if (re.test(text)) text = text.replace(re, line);
  else text += (text.endsWith('\n') ? '' : '\n') + line + '\n';
  fs.writeFileSync(envPath, text, 'utf8');
  process.env[name] = value;
}
