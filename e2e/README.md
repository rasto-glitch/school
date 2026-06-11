# Scholify E2E

Playwright-driven tests against the live deployment. One file per role
(`01-admin`, `02-teacher`, …), run strictly in order. Day 1 (admin) seeds the
world the other days live in.

## Setup

```bash
cd "e:/school project/e2e"
cp .env.test.example .env.test    # fill in ADMIN_USERNAME + ADMIN_PASSWORD
# drop your bulk-upload sheet at data/students.xlsx
```

Playwright + Chromium are already installed by `npm install`.

## Running

```bash
npm test                    # all days, in order
npm run test:admin          # day 1 only
npm run test:teacher        # day 2 only — requires day 1 to have run first
npm run test:headed         # run with a visible browser instead of headless
npm run report              # open the HTML report after a run
```

Day-1 admin tests create the teacher / supervisor / driver / parent /
accountant accounts and **write their credentials back into `.env.test`**, so
later days log in with the accounts day 1 created. You don't paste them in chat.

## What's in scope

| Day | Role        | What it covers                                                                    |
|-----|-------------|-----------------------------------------------------------------------------------|
| 1   | admin       | onboard: bulk-upload students, create teacher/supervisor/driver/parent/accountant, configure school, walk every admin surface |
| 2   | teacher     | login, classroom, homework, assignments, attendance, grades, chat                 |
| 3   | supervisor  | login, school-wide attendance, fee oversight, announcements, chat                 |
| 4   | driver      | login, route, start-drive, bus tracking, chat                                     |
| 5   | parent      | login, child profile, attendance, grades, tuition, chat, bus tracking             |
| 6   | accountant  | login, GL, journal entries, P&L, AR aging, tuition, late fees                     |

Mobile (Expo) is **not in the automated suite yet** — Playwright drives web
only. If the Expo app publishes a web build, we can add a `mobile-web` project
to `playwright.config.ts`. Otherwise mobile testing stays manual after the web
days pass.

## Where findings land

- **FINDINGS.md** — the single human-readable file. One row per issue with
  severity, repro, screenshot path. The runner writes to it via
  `helpers/findings.ts#recordFinding(...)`. After a run, review and triage.
- **results/html/** — Playwright's HTML report. Click into a failing test to
  replay the trace, watch the video, inspect the network log.
- **results/artifacts/** — raw screenshots, videos, traces per failure.

## Conventions

- All tests login with `helpers/login.ts#login()`. Don't reimplement.
- All findings recorded with `helpers/findings.ts#recordFinding()`. Don't
  write directly to FINDINGS.md from a test.
- Day 1 persists newly-created accounts via `helpers/env.ts#persistEnvVar()`
  so day 2+ reads them as plain `process.env.X`.

## Hygiene

- `.env.test` is gitignored. Never commit. Never paste in chat.
- `data/students.xlsx` is gitignored.
- `results/` and `screenshots/` are gitignored — they hold real production-data
  screenshots from the live deployment.
