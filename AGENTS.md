# AGENTS.md — eduk-control-backend

Express + MongoDB backend for **EdukControl**, a multi-tenant SaaS for school attendance with biometric (RFID / facial) device triggers and Firebase push notifications to guardians.

## Commands

- `npm run dev` — nodemon on `app.js` (default port 5000, override with `PORT`).
- `npm start` — `node server.js` for production.
- `npm run lint` — **no-op placeholder** (`echo "No linter configured yet"`). Do not treat its exit status as meaningful. No ESLint/Prettier is installed; there is no formatter configured.
- `node scripts/migrate-to-multitenant.js` — one-shot migration to assign existing data to a default school and sync unique compound indexes. **Make a DB backup first**.
- `node scripts/migrate-guardians-to-collection.js` — extracts embedded `Student.guardians` subdocs into the new `Guardian` collection. **Idempotent** (no-op if already migrated).
- `node scripts/migrate-logo-to-logoUrl.js` — renames the School `logo` field to `logoUrl`. **Idempotent** (no-op if already migrated).
- `DRY_RUN=1 node scripts/cleanup-orphan-cloudinary-assets.js` — logs what would be deleted without touching Cloudinary. Drop `DRY_RUN=1` to actually delete. Cleans up orphan assets and old versions in `edukcontrol/schools/<school_id>/`. Run periodically (cron).
- `node scripts/retry-pending-uploads.js` — processes the queue of uploads that failed all inline retries and were persisted to disk. Run periodically (cron every 5-15 min) or after a Cloudinary outage.
- `node scripts/cleanup-old-s3-uploads.js` — deletes S3 objects in `pending-uploads/` older than `S3_CLEANUP_MAX_AGE_DAYS` (default 30). Requires `PENDING_UPLOADS_BACKEND=s3`. Complements the S3 lifecycle policy.
- `node scripts/migrate-cloudinary-folder-structure.js` — one-shot: moves legacy assets from `edukcontrol/schools/logos/` and `edukcontrol/students/` to the new per-school structure. Idempotent. Add `DRY_RUN=1` to simulate.
- There is **no test framework, no test script, and no test directory**. Don't suggest `npm test`.

## Entry points & layout

- `server.js` — process entrypoint. Starts the HTTP listener, handles `SIGTERM`/`SIGINT`/`uncaughtException` shutdown. Delegates the app build to `app.js`.
- `app.js` — builds the Express app: loads env, connects Mongo (`db/index.js`), initializes Firebase (`services/notification.service.js`), mounts global middleware (`config/index.js`), mounts routers, attaches error handler (`error-handling/index.js`).
- `routes/` ↔ `controllers/` are 1:1 (`auth`, `schools`, `students`, `groups`, `enrollments`, `attendance`).
- `middleware/` — `jwt.middleware.js` (verifies `Authorization: Bearer`), `authorize.middleware.js` (`authorize(...roles)`), `device.middleware.js` (verifies the device API key with `crypto.timingSafeEqual`).
- `services/notification.service.js` — Firebase Admin SDK wrapper; safe to call when Firebase is unconfigured (logs warning, returns null).
- `models/` — `User`, `School`, `SchoolYear`, `Student`, `AttendanceLog`, `Enrollment`, `Group`, `Grade`, `Subject`, `TeacherSubject`, `Guardian`, `AssetVersion`, `DisciplinaryReport`, `ConductConfig`.
- `db/index.js` — Mongoose connection (exits the process on failure).
- `error-handling/index.js` — 404 catch-all + central error handler (translates Mongoose `ValidationError`, `CastError`, `11000` duplicate-key to HTTP responses).
- `services/dashboard-cache.service.js` — invalidación compartida de las keys de cache del dashboard (`dashboard:*`, `student-grades:*`, `student-kpis:*`) para todos los tutores de un `studentId`. Se llama desde `grades.controller.js` y `disciplinary-reports.controller.js`.
- `services/conduct.service.js` — resuelve la `ConductConfig` de una escuela con fallback a defaults (`minor=5, moderate=10, severe=20, baseline=100, floor=0`).
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
| POST | `/api/schools/with-logo` | JWT + `super_admin` | `multipart/form-data`: crea la escuela y sube el logo en un solo request. Campos: `name`, `cct`, `isActive?` + `logo` (file, JPEG/PNG/WebP/SVG ≤5MB). Si el upload del logo falla, la escuela QUEDA CREADA sin logo (el front puede reintentar el logo por separado). |
| GET/POST/PUT/DELETE | `/api/school-years/*` | JWT + staff (read) / admin,registrar,super_admin (write) | Catálogo de ciclos escolares, tenant-scoped. |
| POST | `/api/school-years/:schoolYearId/activate` | JWT + admin/registrar/super_admin | Marca el ciclo como vigente: desactiva los demás de la escuela y sincroniza `School.current_school_year_id`. |
| POST | `/api/schools/:schoolId/logo` | JWT + `super_admin` | `multipart/form-data` field `logo` (JPEG/PNG/WebP/SVG, ≤5MB). Streams to Cloudinary with `crop: fit` 400x400 WebP/AVIF auto. |
| DELETE | `/api/schools/:schoolId/logo` | JWT + `super_admin` | Borra el asset de Cloudinary y limpia `logoUrl` en la DB. |
| GET | `/api/schools/:schoolId/logo/versions` | JWT + `super_admin` | Lista el historial de versiones del logo (AssetVersion). |
| POST | `/api/schools/:schoolId/logo/rollback` | JWT + `super_admin` | Body: `{ version_id }`. Marca una versión anterior como actual. |
| GET | `/api/students/:studentId/photo/versions` | JWT + staff | Lista el historial de versiones de la foto. |
| POST | `/api/students/:studentId/photo/rollback` | JWT + staff | Body: `{ version_id }`. Marca una versión anterior como actual. |
| POST | `/api/webhooks/cloudinary` | none | Endpoint de notificación para uploads asíncronos de Cloudinary. |
| GET | `/api/uploads/events` | JWT (query, header, or cookie) | SSE stream que notifica al cliente cuando un retry de upload termina. |
| POST | `/api/uploads/retry` | JWT + admin/registrar/super_admin | Reintenta manualmente un upload pendiente para una entidad. |
| POST | `/auth/logout` | none | Limpia la cookie HttpOnly de auth. |
| POST | `/api/students/register` | JWT + `admin`/`registrar` | `enrollment_number` and `rfid_card` are uppercased on save; unique per school. |
| GET | `/api/students` | JWT + any staff role | Paginated (`page`, `limit` max 100), filter by `status`, `group`, free-text `search`. |
| GET | `/api/students/:studentId` | JWT + any staff role | |
| PUT | `/api/students/:studentId` | JWT + `admin`/`registrar` | `school` cannot be changed by non-`super_admin`. |
| DELETE | `/api/students/:studentId` | JWT + `admin`/`registrar` | |
| POST | `/api/students/:studentId/photo` | JWT + `admin`/`registrar`/`super_admin` | `multipart/form-data` field `photo` (JPEG/PNG/WebP, ≤5MB). Streams to Cloudinary with auto face-centered 300x300 WebP. |
| GET | `/api/groups` | JWT + any staff role | |
| POST | `/api/groups` | JWT + `admin`/`registrar` | |
| GET/PUT/DELETE | `/api/groups/:groupId` | JWT + role-scoped | |
| GET | `/api/groups/:groupId/students` | JWT + staff | Estudiantes históricos de un grupo (todos los ciclos). |
| GET/POST | `/api/enrollments` | JWT + role-scoped | |
| GET/PUT/DELETE | `/api/enrollments/:enrollmentId` | JWT + role-scoped | |
| POST | `/api/attendance/device-trigger` | **device API key** | Called by hardware. See below. |
| GET | `/api/attendance/logs` | JWT + any staff role | Paginated (`limit` max 200), filter by `student_id`, `event_type`, `from`, `to`. |
| POST | `/api/disciplinary-reports` | JWT + staff (admin, principal, registrar, teacher, prefect, social_worker) | Crea un reporte de conducta. `points_deduction` se copia de la `ConductConfig` vigente de la escuela. Invalida el cache del dashboard de los tutores del alumno. |
| GET | `/api/disciplinary-reports` | JWT + staff | Lista paginada, filtra por `student_id`, `school_year_id`, `severity`, `status`, `from`, `to`. |
| GET | `/api/disciplinary-reports/:reportId` | JWT + staff | Detalle. |
| PUT | `/api/disciplinary-reports/:reportId/cancel` | JWT + admin / principal / registrar | Soft-cancel: cambia `status` a `cancelled` (no borra). Body opcional: `{ reason }`. Invalida cache. |
| DELETE | `/api/disciplinary-reports/:reportId` | JWT + `super_admin` | Borrado físico. NO usar en el flujo normal — preferir cancel. |
| GET | `/api/guardians/me/students/:studentId/disciplinary-reports` | JWT + tutor dueño | Vista del tutor. Por default NO muestra cancelados (`?include_cancelled=true` para incluirlos). Filtra por `school_year_id`. |
| GET | `/api/conduct-config` | JWT + staff | Devuelve la config efectiva de la escuela (mezcla con defaults si nunca se creó). |
| PUT | `/api/conduct-config` | JWT + admin / registrar / super_admin | Upsert. Body: `{ weights?: { minor?, moderate?, severe? }, baseline?, floor?, school? }` (school solo para super_admin). |

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

`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` — required for the student photo upload endpoint (`POST /api/students/:studentId/photo`). Without them, the upload will fail with a Cloudinary auth error.

`CLOUDINARY_WEBHOOK_SECRET` — required in production to validate `X-Cld-Signature` on incoming webhooks (`POST /api/webhooks/cloudinary`). If unset, the webhook endpoint rejects all requests. Configure the same value in Cloudinary Console → Webhooks.

`PENDING_UPLOADS_DIR` (default `/tmp/eduk-pending-uploads`) — directorio donde se persisten los buffers que fallaron al subirse a Cloudinary, para que el job `scripts/retry-pending-uploads.js` los reprocese.

`CLOUDINARY_NOTIFICATION_URL` (opcional) — URL base pública de tu backend (e.g. `https://api.tu-dominio.com`). Si está configurada, los uploads usan `eager_async: true` + `notification_url` para que Cloudinary procese las transformaciones async y notifique por webhook cuando termine. Si está vacía, el comportamiento es síncrono (default en desarrollo).

`PENDING_UPLOADS_BACKEND` (opcional) — `disk` (default) o `s3`. Si es `s3`, los buffers de uploads fallidos se persisten en S3 en vez de disco. Requiere también: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_PENDING_UPLOADS_BUCKET`.

Firebase service account JSON (`config/firebase-service-account.json`) is **gitignored** and must be provisioned locally. The server starts and serves traffic even if the file is missing — notifications just no-op with a warning.

## Data model constraints

- `User.role` ∈ `super_admin | admin | principal | registrar | teacher | prefect | social_worker`.
- `User.school` is required for every role except `super_admin` (uses a `required: function()` so the validator sees the role at validation time).
- `School.cct` is unique globally; `School.isActive` defaults to `true`. `School.current_school_year_id` is a denormalized ref to the school's active `SchoolYear` (kept in sync exclusively via `POST /api/school-years/:schoolYearId/activate`).
- `PUT /api/schools/:schoolId` only accepts `name` and `isActive` (whitelist). The logo is NOT updated via this endpoint — use `POST /api/schools/:schoolId/logo` (upload/replace) or `DELETE /api/schools/:schoolId/logo` (remove). `logoUrl` is intentionally excluded from the whitelist to prevent a string-from-body update that bypasses Cloudinary.
- `SchoolYear` (`school`, `name` matching `^\d{4}-\d{4}$`, `startDate`, `endDate`, `isActive`) is the source of truth for school cycles. `Group`, `Enrollment`, `Grade` (denormalized from `Enrollment`), and `TeacherSubject` all reference it via `school_year_id` (ObjectId ref) instead of a raw string. Unique per school: `{ school, name }`.
- `Student.status` ∈ `active | withdrawn_temp | withdrawn_permanent`.
- `AttendanceLog.event_type` ∈ `entry | exit`.
- `Group.grade` ∈ `{1, 2, 3}`.
- `Enrollment.cycle_status` ∈ `enrolled | withdrawn | graduated | transferred`.
- Unique compound indexes (per school):
  - `User`: `{ school, email }` unique, partial on `school: ObjectId`; plus `{ email }` unique, partial on `school: null` for super_admins.
  - `Student`: `{ school, enrollment_number }` unique; `{ school, rfid_card }` unique, partial on `rfid_card: string`.
  - `Group`: `{ school, grade, section, school_year_id }` unique.
  - `Enrollment`: `{ school, student_id, school_year_id }` unique.
  - `SchoolYear`: `{ school, name }` unique.
  - `ConductConfig`: `{ school }` unique (un único doc por escuela).
- Mongoose `__v` is globally disabled (`versionKey: false`).

## Guardian Dashboard — KPIs del tutor

`GET /api/guardians/me/dashboard` devuelve, por cada estudiante del tutor, un objeto `kpis` con 3 indicadores del ciclo escolar activo de la escuela (`School.current_school_year_id`):

- **`kpis.attendance`** — `% de Asistencia`:
  - `percentage`: `(días con entry del alumno / días lectivos del ciclo hasta hoy) * 100`, redondeado a 2 decimales. `null` si no hay días lectivos.
  - `attended_days`, `total_school_days`: números crudos para mostrar "9/10" en el front.
  - `source`: `"derived_from_attendance_logs"` por ahora. Cuando se cree un modelo `SchoolDay` (calendario explícito) se prefiere ese lookup.
- **`kpis.cumulative_gpa`** — `Promedio Acumulado` (regla de los 3 trimestres):
  - `null` si ningún trimestre tiene calificaciones.
  - Si solo T1 evaluado (9.0) → `9.0`.
  - Si T1 (9.0) y T2 (8.0) → `8.5` (media de los trimestres evaluados).
  - Se consideran los `period ∈ {1,2,3}` de `Grade`. `period=0` (calificación final) NO entra.
- **`kpis.conduct`** — `Score de Conducta`:
  - `score = max(baseline - sum(points_deduction de reportes activos del año), floor)`.
  - `points_deduction` se congela al crear el reporte (no se recalcula contra cambios futuros en `ConductConfig`).
  - Defaults si la escuela nunca creó su `ConductConfig`: `baseline=100`, `weights={minor:5, moderate:10, severe:20}`, `floor=0`.

Cualquier cambio en `Grade` o `DisciplinaryReport` invalida el cache del dashboard (TTL 5 min) de TODOS los tutores del estudiante afectado vía `services/dashboard-cache.service.js`.

## Conventions

- CommonJS (`require`). Spanish comments in source files (doc-internal); English in user-facing strings (error messages, response bodies, FCM payloads — the frontend localizes).
- Errors flow to `error-handling/index.js`; controllers just `next(error)`. Don't `try/catch`+`res.status` inside async handlers unless transforming the error.
- `tenantFilter(req)` is the standard helper at the top of every controller that touches school-scoped data. Use it.
- `morgan` is `dev`/`combined` only — disabled when `NODE_ENV === 'test'`.
- Body limit is 1 MB for both JSON and urlencoded.
- All timestamps use `timestamps: true`; do not add manual `createdAt`/`updatedAt`.

## Known dead weight

- `xss-clean` is listed in `package.json` dependencies but is **not** wired into `app.js`. Sanitization is currently provided by `express-mongo-sanitize` + `hpp` only. Removing `xss-clean` is safe; do not assume it is active.

## Mobile app integration (FCM)

The mobile app (tutor side) must do two things to keep push notifications working:

1. **On install / first login**, request a token from Firebase Messaging and POST it to `/api/guardians/me/fcm-token` (body: `{ fcm_token, device_id? }`). The endpoint writes the token into every `Guardian` record linked to that user (one tutor can be guardian of several students, so the token is mirrored across all of them).
2. **Subscribe to `onTokenRefresh`** and re-call the same endpoint whenever Firebase fires it. Firebase silently rotates tokens (restore from backup, reinstall, etc.); without this callback the push pipeline breaks without any error.

The backend auto-invalidates `fcm_token` when FCM returns `registration-token-not-registered`, `invalid-registration-token`, or `invalid-argument` during a send. After invalidation, the next event for that student will be a no-op for that device until the app re-registers.

## Things you should NOT do

- Do not add a `lint` script that just `echo`s — wire a real linter (e.g. ESLint flat config) or leave it alone and update this file.
- Do not add `xss-clean` middleware back without testing — it has known compatibility issues with modern Express 4.
- Do not move the `process.nextTick` notification dispatch inline; the device must get a fast 201 even if FCM is slow.
- Do not change `app.set('trust proxy', 1)` without also revising the rate limiter; removing it breaks the per-IP accounting behind a proxy.
- Do not commit `config/firebase-service-account.json` or any populated `.env` file (both are gitignored — keep it that way).
- Do not remove the `school` field from any model. Do not weaken the `required: function()` on `User.school`.
- Do not reintroduce a raw `school_year: String` field on `Group`, `Enrollment`, `Grade`, or `TeacherSubject` — always reference `SchoolYear` via `school_year_id`.
- Do not write a query without `tenantFilter(req)` in any controller that handles school-scoped data. This is a security requirement, not a performance one.
- Do not add a new resource/model (e.g. `Notice`, `Report`, `Grade`) without adding the `school: { ref: 'School', required: true, index: true }` field.
- Do not mark `super_admin` users as belonging to a specific school when creating them; leave `school: null` so the cross-tenant filter bypass works.
