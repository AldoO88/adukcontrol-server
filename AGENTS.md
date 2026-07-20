# AGENTS.md — eduk-control-backend

Express + MongoDB backend for **EdukControl**, a multi-tenant SaaS for school attendance with biometric (RFID / facial) device triggers and Firebase push notifications to guardians.

## Commands

- `npm run dev` — nodemon on `app.js` (default port 5000, override with `PORT`).
- `npm start` — `node server.js` for production.
- `npm run lint` — **no-op placeholder** (`echo "No linter configured yet"`). Do not treat its exit status as meaningful. No ESLint/Prettier is installed; there is no formatter configured.
- `node scripts/migrate-to-multitenant.js` — one-shot migration to assign existing data to a default school and sync unique compound indexes. **Make a DB backup first**.
- There is **no test framework, no test script, and no test directory**. Don't suggest `npm test`.

## Entry points & layout

- `server.js` — process entrypoint. Starts the HTTP listener, handles `SIGTERM`/`SIGINT`/`uncaughtException` shutdown. Delegates the app build to `app.js`.
- `app.js` — builds the Express app: loads env, connects Mongo (`db/index.js`), initializes Firebase (`services/notification.service.js`), mounts global middleware (`config/index.js`), mounts routers, attaches error handler (`error-handling/index.js`).
- `routes/` ↔ `controllers/` are 1:1 (`auth`, `schools`, `students`, `groups`, `enrollments`, `attendance`).
- `middleware/` — `jwt.middleware.js` (verifies `Authorization: Bearer`), `authorize.middleware.js` (`authorize(...roles)`), `device.middleware.js` (verifies the device API key with `crypto.timingSafeEqual`).
- `services/notification.service.js` — Firebase Admin SDK wrapper; safe to call when Firebase is unconfigured (logs warning, returns null).
- `models/` — `User`, `School`, `Student`, `AttendanceLog`, `Enrollment`, `Group`.
- `db/index.js` — Mongoose connection (exits the process on failure).
- `error-handling/index.js` — 404 catch-all + central error handler (translates Mongoose `ValidationError`, `CastError`, `11000` duplicate-key to HTTP responses).
- `scripts/migrate-to-multitenant.js` — one-shot migration for the multi-tenant rollout.

## Multi-tenant architecture (MUST FOLLOW)

Every collection that holds school-scoped data **must** include the field below — current models already do, future models must too:

```js
school: {
  type: Schema.Types.ObjectId,
  ref: "School",
  required: [true, "School reference is required."],
  index: true,
}
```

Rules:

1. **Every query is tenant-scoped.** The standard pattern in every controller is:
   ```js
   const filter = req.payload.role === "super_admin"
     ? {}
     : { school: req.payload.schoolId };
   ```
2. **JWT payload carries `schoolId`** (signed at login/signup in `controllers/auth.controller.js`). Never read the tenant from request body or query — only from `req.payload.schoolId`.
3. **`super_admin` is the only cross-tenant role.** It has `school: null` in the DB (the `required` is a function that returns `false` for `super_admin`). It bypasses the tenant filter in every controller.
4. **All `findById` are forbidden.** Use `findOne({ _id, ...tenantFilter })` so a wrong tenant returns 404, not a leak.
5. **Compound unique indexes are scoped per school.** A student's `enrollment_number` is unique within their school, not globally. Don't undo the compound indexes; see the data model table below.
6. **`/api/attendance/device-trigger` is the only endpoint without JWT.** It identifies the tenant by denormalizing `student.school` after looking the student up. The student MUST have a `school` set or the request is rejected with 500.

## API surface

All under `/api` (no `/v1` prefix). Auth endpoints are under `/auth` (no `/api` prefix).

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/signup` | none | Creates a `User`. `school` is required unless `role: "super_admin"`. |
| POST | `/auth/login` | none | Returns `{ user, authToken }`. `user` includes `role` and `school`. |
| GET | `/auth/verify` | JWT | Returns the decoded JWT payload (including `schoolId`). |
| GET/POST/PUT/DELETE | `/api/schools/*` | JWT + `super_admin` | Tenant management. Delete is blocked (409) if the school has users or students. |
| POST | `/api/students/register` | JWT + `admin`/`registrar` | `enrollment_number` and `rfid_card` are uppercased on save; unique per school. |
| GET | `/api/students` | JWT + any staff role | Paginated (`page`, `limit` max 100), filter by `status`, `group`, free-text `search`. |
| GET | `/api/students/:studentId` | JWT + any staff role | |
| PUT | `/api/students/:studentId` | JWT + `admin`/`registrar` | `school` cannot be changed by non-`super_admin`. |
| DELETE | `/api/students/:studentId` | JWT + `admin`/`registrar` | |
| GET | `/api/groups` | JWT + any staff role | |
| POST | `/api/groups` | JWT + `admin`/`registrar` | |
| GET/PUT/DELETE | `/api/groups/:groupId` | JWT + role-scoped | |
| GET/POST | `/api/enrollments` | JWT + role-scoped | |
| GET/PUT/DELETE | `/api/enrollments/:enrollmentId` | JWT + role-scoped | |
| POST | `/api/attendance/device-trigger` | **device API key** | Called by hardware. See below. |
| GET | `/api/attendance/logs` | JWT + any staff role | Paginated (`limit` max 200), filter by `student_id`, `event_type`, `from`, `to`. |

Health: `GET /health` (unauthenticated). Root: `GET /` returns service banner.

## Two distinct auth systems

1. **User JWT** — `Authorization: Bearer <token>`. Token payload: `{ _id, email, name, role, schoolId }`. Verified in `middleware/jwt.middleware.js#isAuthenticated`; role gate via `middleware/authorize.middleware.js#authorize(...roles)`.
2. **Device API key** — consumed by `POST /api/attendance/device-trigger`. Header `X-Device-Api-Key` (or `X-Api-Key`, or `body.api_key`) must match `DEVICE_TRIGGER_API_KEY` via `crypto.timingSafeEqual`. Rate-limited separately at 300 req/min.

`app.set('trust proxy', 1)` is set in `config/index.js` so rate limiting works correctly behind a reverse proxy — keep it.

## `device-trigger` quirks (controllers/attendance.controller.js)

- Body shape: `{ identifier, device_type, device_id, event_time? }`. `identifier` is matched case-insensitively against `Student.rfid_card` OR `Student.enrollment_number`, only for `status: 'active'`.
- `event_type` (`entry`/`exit`) is **auto-determined** by the last `AttendanceLog` for that student — alternates. The body does not accept `event_type`.
- `event_time` is optional (defaults to `now`) and must be ISO 8601 if provided.
- `device` is stored as `${device_type || 'unknown'}@${device_id}`.
- `school` is denormalized from `student.school` into the log so tenant queries don't need a join.
- Push notification dispatch runs in **`process.nextTick`** after the response is sent; the log is created first, then `notification_sent` is flipped to `true` only on successful delivery. Expect `notification_sent` to lag behind API success.

## Required environment (.env)

`MONGO_URI`, `SECRET_KEY` (≥32 chars, used for JWT), `FIREBASE_SERVICE_ACCOUNT_PATH`, `DEVICE_TRIGGER_API_KEY`, `PORT` (default 5000), `NODE_ENV` (default `development`), `ORIGIN` (default `http://localhost:5173`).

Firebase service account JSON (`config/firebase-service-account.json`) is **gitignored** and must be provisioned locally. The server starts and serves traffic even if the file is missing — notifications just no-op with a warning.

## Data model constraints

- `User.role` ∈ `super_admin | admin | principal | registrar | teacher | prefect | social_worker`.
- `User.school` is required for every role except `super_admin` (uses a `required: function()` so the validator sees the role at validation time).
- `School.cct` is unique globally; `School.isActive` defaults to `true`.
- `Student.status` ∈ `active | withdrawn_temp | withdrawn_permanent`.
- `AttendanceLog.event_type` ∈ `entry | exit`.
- `Group.grade` ∈ `{1, 2, 3}`. `school_year` must match `^\d{4}-\d{4}$` (e.g. `2024-2025`); enforced on both `Group` and `Enrollment`.
- `Enrollment.cycle_status` ∈ `enrolled | withdrawn | graduated | transferred`.
- Unique compound indexes (per school):
  - `User`: `{ school, email }` unique, partial on `school: ObjectId`; plus `{ email }` unique, partial on `school: null` for super_admins.
  - `Student`: `{ school, enrollment_number }` unique; `{ school, rfid_card }` unique, partial on `rfid_card: string`.
  - `Group`: `{ school, grade, section, school_year }` unique.
  - `Enrollment`: `{ school, student_id, school_year }` unique.
- Mongoose `__v` is globally disabled (`versionKey: false`).

## Conventions

- CommonJS (`require`). Spanish comments in source files (doc-internal); English in user-facing strings (error messages, response bodies, FCM payloads — the frontend localizes).
- Errors flow to `error-handling/index.js`; controllers just `next(error)`. Don't `try/catch`+`res.status` inside async handlers unless transforming the error.
- `tenantFilter(req)` is the standard helper at the top of every controller that touches school-scoped data. Use it.
- `morgan` is `dev`/`combined` only — disabled when `NODE_ENV === 'test'`.
- Body limit is 1 MB for both JSON and urlencoded.
- All timestamps use `timestamps: true`; do not add manual `createdAt`/`updatedAt`.

## Known dead weight

- `xss-clean` is listed in `package.json` dependencies but is **not** wired into `app.js`. Sanitization is currently provided by `express-mongo-sanitize` + `hpp` only. Removing `xss-clean` is safe; do not assume it is active.

## Things you should NOT do

- Do not add a `lint` script that just `echo`s — wire a real linter (e.g. ESLint flat config) or leave it alone and update this file.
- Do not add `xss-clean` middleware back without testing — it has known compatibility issues with modern Express 4.
- Do not move the `process.nextTick` notification dispatch inline; the device must get a fast 201 even if FCM is slow.
- Do not change `app.set('trust proxy', 1)` without also revising the rate limiter; removing it breaks the per-IP accounting behind a proxy.
- Do not commit `config/firebase-service-account.json` or any populated `.env` file (both are gitignored — keep it that way).
- Do not remove the `school` field from any model. Do not weaken the `required: function()` on `User.school`.
- Do not write a query without `tenantFilter(req)` in any controller that handles school-scoped data. This is a security requirement, not a performance one.
- Do not add a new resource/model (e.g. `Notice`, `Report`, `Grade`) without adding the `school: { ref: 'School', required: true, index: true }` field.
- Do not mark `super_admin` users as belonging to a specific school when creating them; leave `school: null` so the cross-tenant filter bypass works.
