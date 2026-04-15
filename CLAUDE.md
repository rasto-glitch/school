# School Management System

Monorepo for a multi-tenant school management platform. Six workspaces share one Supabase database.

## Workspaces

| Folder | What it is | Where it runs |
| --- | --- | --- |
| `frontend/` | Main web app (parents, teachers, admin, driver) — Vite + React 19 | Deployed on **Vercel** |
| `backend/` | Express 5 + Socket.io API | Deployed on **Railway** (see `railway.json`, `nixpacks.toml`) |
| `mobile/` | Expo / React Native app | Shipped via **EAS** — OTA channel `preview` |
| `master/` | Master portal (`client/` + `server/`) — superadmin tools | **Local only, never deployed.** Security-sensitive; do not add online deploy targets. |
| `academic/` | Academic portal (`client/` only) — content authoring | Local for now; will go online later |
| `database/` | Supabase SQL schema (`schema.sql`) | Source of truth for all DB changes |

Never assume frontend/backend run locally — they don't, for day-to-day work. When discussing "the backend" or "the API," it's the Railway deployment unless the user says otherwise.

## Deployment & change workflow

After any change, state what the user needs to do next:

- **`frontend/`** → push to main, Vercel auto-deploys
- **`backend/`** → push to main, Railway auto-deploys (entry: `backend/dist/server.js`)
- **`mobile/` JS-only changes** → OTA: `cd mobile && eas update --channel preview --message "<what changed>"`
- **`mobile/` native changes** (new native dep, config plugin, app.json native fields) → full EAS build required, not OTA
- **`database/schema.sql` changes** → user runs the SQL against Supabase manually; schema file is the source of truth
- **`master/`** → local only, no deploy step

Always commit and push after edits unless the user says otherwise.

## Architecture invariants

These are non-obvious and breaking them has caused real bugs:

### Multi-tenancy: `school_id` on every query
Every table is scoped by `school_id`. Backend queries **must** filter by `school_id` from the authenticated user's JWT. Forgetting the filter leaks data across schools. No exceptions.

### Auth: custom JWT, not Supabase Auth
- Backend issues its own JWTs via `backend/src/controllers/auth.controller.ts`.
- Supabase is used purely as hosted Postgres + storage — **not** for auth.
- Backend uses the Supabase **SERVICE ROLE KEY** (bypasses RLS). This key is server-side only; never ship it to a client.

### Grades & reports: dual schema, dynamic `marks[]` is the source of truth
The `grades` and `reports` tables each have **two parallel shapes**:

- **Legacy columns**: `daily_grade`, `quiz_grade`, `monthly_exam_grade`, `term_exam_grade` on grades; `quiz_marks`, `exam_marks` on reports.
- **Dynamic `marks JSONB`**: `[{ name: string, value: number }]` — populated based on admin-defined categories in the `mark_types` table (`applies_to` ∈ `'report' | 'grade' | 'both'`).

Current writes (`teacher.controller.ts` `upsertGrade` / `createReport`) write **only** to `marks[]`. Legacy columns stay at their default (0 / null). Any reader that looks at legacy columns first will render empty data.

**Rule for all readers (web, mobile, reports):**
1. Read `marks[]` first; if non-empty, use it.
2. Fall back to legacy columns only if `marks[]` is missing or empty (for old records written before the migration).
3. Never hardcode mark names like `"Quiz"` or `"Daily"` in the UI — column headers come from the `mark_types` rows the admin configured. Preserve insertion order when collecting mark names across multiple records.

### Mark categories are admin-configured per school
Teachers pick from `mark_types` (fetched via `teacherApi.getMarkTypes('report' | 'grade')`). Do not add UI that hardcodes category names — it will be wrong for any school that configured different categories.

## Tech stack quick reference

- **Database:** Supabase (Postgres) — schema in `database/schema.sql`
- **Backend:** Express 5, Socket.io, JWT, bcryptjs, multer, nodemailer, winston
- **Web frontend:** React 19, React Router 7, Zustand (persist), react-hook-form + zod, axios, socket.io-client, date-fns, tailwind 3, i18next
- **Mobile:** Expo ~55, React Native 0.83, React Navigation 7, Zustand, expo-updates (OTA), expo-location, expo-notifications, react-native-maps
- **Realtime:** Socket.io rooms — `driver:{driverId}` for parents watching a bus, `user:{userId}` for personal notifications

## Bus GPS tracking

Driver posts location every 30s to `POST /api/driver/location`. Backend computes Haversine distance to each of that driver's assigned students' home coordinates and emits proximity alerts at 1 mi / 0.5 mi / 0.1 mi thresholds.

## Before you edit

- If you're touching `grades` / `reports` read or write paths, re-read the dual-schema rule above.
- If you're touching backend queries, verify `school_id` scoping.
- If you're touching the master portal, don't add deployment config.
- If you're touching mobile, decide OTA vs native rebuild before reporting done.
