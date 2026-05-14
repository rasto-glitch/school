# E2E tests

Playwright tests that drive a real Chromium browser against the deployed (or local) frontend.

## Setup (one-time)

```powershell
cd tests/e2e
npm install
npx playwright install chromium
copy .env.test.example .env.test
# then edit .env.test and fill in BASE_URL, TEST_SCHOOL_ABBREVIATION,
# ADMIN_USERNAME, ADMIN_PASSWORD. Leave the other *_USERNAME / *_PASSWORD
# blank — the bootstrap fills them in.
```

## Bootstrap (creates test users + fixtures)

```powershell
npm run bootstrap
```

Drives the admin UI to create four test users (parent, teacher, supervisor,
reception), a class, a subject, a curriculum row, and one student wired to
the e2e parent. Writes the resulting credentials back into `.env.test`.

Idempotent — safe to re-run; duplicates are detected and skipped.

## Run feature specs

```powershell
npm test            # everything except the bootstrap
npm run test:all    # bootstrap + everything (full reset, if you wiped users)
npm run test:debug  # Playwright Inspector
npm run report      # open HTML report from last run
```

Screenshots land in `screenshots/`. Failure traces + video in `test-results/`.

## Scope

In-scope roles right now: parent, teacher, admin, supervisor, reception.
Out of scope until later: driver (manually tested), accountant (will be its own audit).
Reception scope is limited to appointments for now.
