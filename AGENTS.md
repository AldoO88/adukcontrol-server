# AGENTS.md — eduk-control-backend

Express + MongoDB backend for a school attendance system with biometric (RFID / facial) device triggers and Firebase push notifications to tutors.

## Commands

- `npm run dev` — nodemon on `server.js` (default port 5000).
- `npm start` — `node server.js` for production.
- `npm run lint` — **no-op placeholder** (`echo "No linter configured yet"`). Do not treat its exit status as meaningful. No ESLint/Prettier is installed; there is no formatter configured.
- There is **no test framework, no test script, and no test directory**. Don't suggest `npm test`.

## Entry points & layout

- `server.js` — sole entrypoint. Wires middleware, mounts routes, connects DB, calls `notificationService.initializeFirebase()`, starts HTTP listener, registers `SIGTERM`/`SIGINT`/`uncaughtException` shutdown. Exported as `app` for testing tools even though none exist yet.
- `config/db.js` — Mongoose connection (exits the process on failure).
- `routes/` ↔ `controllers/` are 1:1 (`auth`, `student`, `attendance`).
- `middlewares/` — `auth` (JWT), `deviceAuth` (shared API key), `errorHandler`.
- `services/notification.js` — Firebase Admin SDK wrapper; safe to call when Firebase is unconfigured (logs warning, returns null).
- `utils/` — `AppError`, `asyncHandler`, `apiResponse` (standard `{ success, message, data }` envelope).
- `models/` — `User`, `Student`, `AttendanceLog`, `Enrollment`, `Group`.

## API surface

All under `/api/v1`:

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/register` | none | Creates a `User`. Roles: `admin`, `control_escolar`, `maestro`, `prefecto`. |
| POST | `/auth/login` | none | Returns `{ user, token }`. |
| GET | `/auth/me` | JWT | |
| POST | `/students` | JWT + `admin`/`control_escolar` | `matricula` and `tarjeta_rfid` are unique, uppercased on save. |
| GET | `/students` | JWT + any role | Paginated (`page`, `limit` max 100), filter by `status`, `group`, free-text `search`. |
| GET | `/students/:id` | JWT + any role | |
| POST | `/attendance/device-trigger` | **device API key** | Called by hardware. See below. |
| GET | `/attendance/logs` | JWT + any role | Paginated (`limit` max 200), filter by `student_id`, `tipo`, `from`, `to`. |

Health: `GET /health` (unauthenticated). Root: `GET /` returns service banner.

## Two distinct auth systems

1. **User JWT** — `Authorization: Bearer <token>`. Token payload uses `sub` for user id. Verified in `middlewares/auth.js#protect`; role gate via `authorize(...roles)`.
2. **Device API key** — consumed by `POST /api/v1/attendance/device-trigger`. Header `X-Device-Api-Key` (or `X-Api-Key`, or `body.api_key`) must match `DEVICE_TRIGGER_API_KEY` via `crypto.timingSafeEqual`. Rate-limited separately at 300 req/min (stricter than the 200/15min global limiter).

`app.set('trust proxy', 1)` is set so rate limiting works correctly behind a reverse proxy — keep it.

## `device-trigger` quirks (controllers/attendance.js)

- Identifier is matched case-insensitively against `Student.tarjeta_rfid` OR `Student.matricula`, only for `status: 'activo'`.
- `tipo` (`entrada`/`salida`) is **auto-determined** by the last `AttendanceLog` for that student — alternates. The body does not accept `tipo`.
- `fecha_hora` is optional (defaults to `now`) and must be ISO 8601 if provided.
- `dispositivo` is stored as `${tipo_dispositivo || 'desconocido'}@${dispositivo_id}`.
- Push notification dispatch runs in **`process.nextTick`** after the response is sent; the log is created first, then `notificacion_enviada` is flipped to `true` only on successful delivery. Expect logs to lag behind API success.

## Required environment (.env)

`MONGO_URI`, `JWT_SECRET` (≥32 chars), `JWT_EXPIRE`, `JWT_COOKIE_EXPIRE`, `FIREBASE_SERVICE_ACCOUNT_PATH`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, `DEVICE_TRIGGER_API_KEY`, `PORT`, `NODE_ENV`, `CORS_ORIGIN`. Defaults: `PORT=5000`, `NODE_ENV=development`, `CORS_ORIGIN=*`.

Firebase service account JSON (`config/firebase-service-account.json`) is **gitignored** and must be provisioned locally. The server starts and serves traffic even if the file is missing — notifications just no-op with a warning.

## Data model constraints

- `User.role` ∈ `admin | control_escolar | maestro | prefecto`. Static `ROLES` is exposed on the model.
- `Student.status` ∈ `activo | baja_temporal | baja_definitiva`.
- `AttendanceLog.tipo` ∈ `entrada | salida`. `tipo_dispositivo` ∈ `rfid | facial | mixto`.
- `Group.grado` ∈ `{1, 2, 3}`. `ciclo_escolar` must match `^\d{4}-\d{4}$` (e.g. `2024-2025`); enforced on both `Group` and `Enrollment`.
- `Enrollment` has a unique compound index `(student_id, ciclo_escolar)` — a student can only have one enrollment per school year. `estatus_ciclo` ∈ `inscrito | baja | egresado | trasladado`.
- Mongoose `__v` is globally disabled (`versionKey: false`).

## Conventions

- CommonJS (`require`), `'use strict'` at the top of every file.
- Errors flow through `utils/AppError` + `utils/asyncHandler`; throw `new AppError(msg, code)` inside handlers, never call `next(err)` manually from async code.
- Validation lives in `routes/*.js` via `express-validator`; controllers re-check `validationResult` and throw `AppError(..., 400)`.
- `utils/apiResponse.success|created|error` is the only place that writes the response body shape. Keep the `{ success, message, data }` envelope consistent.
- `morgan` is dev/`combined` only — disabled when `NODE_ENV === 'test'` (even though no tests exist yet).
- Body limit is 1 MB for both JSON and urlencoded.
- All timestamps in model use `timestamps: true`; do not add manual `createdAt`/`updatedAt`.

## Known dead weight

- `xss-clean` is listed in `package.json` dependencies but is **not** wired into `server.js`. Sanitization is currently provided by `express-mongo-sanitize` + `hpp` only. Removing `xss-clean` is safe; do not assume it is active.

## Things you should NOT do

- Do not add a `lint` script that just `echo`s — wire a real linter (e.g. ESLint flat config) or leave it alone and update this file.
- Do not add `xss-clean` middleware back without testing — it has known compatibility issues with modern Express 4.
- Do not move the `process.nextTick` notification dispatch inline; the device must get a fast 201 even if FCM is slow.
- Do not change `app.set('trust proxy', 1)` without also revising the rate limiter; removing it breaks the per-IP accounting behind a proxy.
- Do not commit `config/firebase-service-account.json` or any populated `.env` file (both are gitignored — keep it that way).
