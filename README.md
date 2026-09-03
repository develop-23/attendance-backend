# Employee attendance (Işgär gatnaşyk ulgamy)

A complete web application for tracking employees' check-in and check-out times:
a **React (Vite) + Tailwind** frontend, a **Node.js + Express** backend and a
**PostgreSQL / SQLite** (Prisma ORM) database.

> The interface language is **Turkmen**. The code comments are in English.

---

## Core idea

- The system has two kinds of account: **administrator** and **employee**.
- **Employees enter their own check-in/check-out times** — they sign in with
  their own login/password and add a separate record for each arrival/departure.
- **You can come and go several times a day.** For example:
  `09:00–12:00`, `13:00–17:00`, `19:00–21:30` — all on the same day, and the
  daily total is summed automatically (09:30 in this example).
- The administrator sees the whole table, can correct any record, add employees
  and export the reports to Excel.

---

## Features

- A monthly attendance table in the style of Google Sheets (employee name on the left, days of the month on the right)
- The first column and the header row stay pinned while scrolling (sticky)
- A single cell shows **all** of that day's check-in/check-out records
- Click a cell to add / edit / delete records
- **Overlaps are validated** — the same period is never counted twice
- A separate, convenient page for employees: the days are shown as a vertical list (works on a phone too)
- Automatic calculation: total hours, days worked, lateness, unfinished days, number of records
- **Hours are counted even while an employee has not left yet** — from their check-in until now, refreshed every minute
- Colors: complete — green, late — reddish, unfinished — yellow, weekend — gray
- Search by name, filter for active/inactive employees
- Excel (XLSX) export — 3 sheets: daily table, summary report, one row per record
- Printing: the whole month fits on a single A4 (landscape) sheet
- JWT authentication, passwords hashed with bcrypt, automatic logout on expiry
- Every change is written to the `AuditLog` table
- Settings: work start/end time, lateness threshold, weekend days

---

## Requirements

- **Node.js 18+** (20+ recommended)
- **PostgreSQL 13+** — or SQLite (nothing to install)

---

## 1. Installation

```bash
cd folder

# Backend packages
cd server
npm install

# Frontend packages
cd ../client
npm install
```

## 2. Configuration (.env)

```bash
cd server
cp .env.example .env
```

Open the `.env` file:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/attendance?schema=public"
JWT_SECRET="a-long-random-secret-key"
JWT_EXPIRES_IN="8h"
PORT=4000
CORS_ORIGIN="http://localhost:5173"
```

> ⚠️ **Be sure to change `JWT_SECRET`.** To generate a random key:
> `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

### Switching to SQLite (the simpler option)

If you would rather not install PostgreSQL:

```bash
cd server
npm run use:sqlite     # switches the provider and deletes the old migrations
# in the .env file:  DATABASE_URL="file:./dev.db"
npm run migrate && npm run seed
npm run dev
```

To go back to PostgreSQL: `npm run use:postgres`, then change `.env` and run
`npm run migrate && npm run seed` again.

> ℹ️ The SQLite file is created at `server/prisma/dev.db`. If you delete and
> recreate the database **without stopping** the server, you will get an
> `attempt to write a readonly database` error — restart the server in that case.

## 3. Migration and seed

```bash
cd server
npm run generate     # generate the Prisma client
npm run migrate      # create the tables
npm run seed         # admin + settings + 3 sample employees
```

The seed creates the following accounts:

| Type          | login    | password       |
| ------------- | -------- | -------------- |
| Administrator | `admin`  | `admin123`     |
| Employee      | `aman`   | `employee123`  |
| Employee      | `merjen` | `employee123`  |
| Employee      | `serdar` | `employee123`  |

> 🔴 **Be sure to change the passwords after the first sign-in!**
> Use the **"Açar sözi çalyş"** button in the top bar (both admins and employees).

## 4. Running it

```bash
# Terminal 1 — backend
cd server
npm run dev          # http://localhost:4000
```

```bash
# Terminal 2 — frontend
cd client
npm run dev          # http://localhost:5173
```

Open **http://localhost:5173** in your browser.

---

## Deployment: frontend → Vercel, backend → Railway

The two are hosted separately and talk to each other **through CORS**
(the token travels in the `Authorization` header, no cookies are used).

```
  Browser  ──▶  Vercel (static React)  ─── fetch ──▶  Railway (Express + PostgreSQL)
                davomat.vercel.app                    davomat-server.up.railway.app
```

### Step 1. Backend → Railway

1. **Create a project:** Railway → *New Project* → *Deploy from GitHub repo*.
2. Set the **Root Directory** to `server`
   (*Settings → Source → Root Directory*). This matters — the repo root also contains `client`.
3. **Add PostgreSQL:** *New → Database → Add PostgreSQL*.
4. **Environment variables** (*Variables*):

   | Name             | Value                                                       |
   | ---------------- | ----------------------------------------------------------- |
   | `DATABASE_URL`   | `${{Postgres.DATABASE_URL}}` — link it to the Postgres service |
   | `JWT_SECRET`     | a long random string (see below)                            |
   | `JWT_EXPIRES_IN` | `8h`                                                        |
   | `CORS_ORIGIN`    | `https://<project>.vercel.app,https://*.vercel.app`         |
   | `TZ`             | `Asia/Ashgabat` — **so the hours of an employee who has not left yet are counted correctly** |

   ```bash
   # generate JWT_SECRET
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

   > **Do not set `PORT` by hand** — Railway provides it.
   > The `https://*.vercel.app` entry in `CORS_ORIGIN` is needed for preview deployments.
   > If you only want the main domain, drop the wildcard line.

5. **The start command** is already declared in `server/railway.json`:
   ```
   npm run start:prod     # = prisma migrate deploy && node src/index.js
   ```
   That is, the migrations are applied automatically on every deploy.
   Health check: `/api/health`.

6. **Expose the domain:** *Settings → Networking → Generate Domain*.
   Copy the address — you will need it for Vercel.

7. **Create the first admin (once).** One of two ways:

   **a) From your local machine (recommended).** On the Postgres service enable
   *Settings → Networking → Public Networking* and take `DATABASE_PUBLIC_URL`:

   ```bash
   cd server
   DATABASE_URL="<public-postgres-url>"    SEED_ADMIN_LOGIN="admin"    SEED_ADMIN_PASSWORD="<strong-password>"    npm run seed
   ```

   **b) From inside Railway.** Temporarily set the *Custom Start Command* to
   `npm run seed && npm run start:prod`, deploy once, then set the command back
   to `npm run start:prod`.
   (Add `SEED_ADMIN_PASSWORD` to the Variables beforehand.)

   > The seed is idempotent — if the admin already exists it changes nothing.

### Step 2. Frontend → Vercel

1. **Import it:** Vercel → *Add New → Project* → this repo.
2. **Root Directory** = `client`.
3. The **Vite** framework preset is detected automatically
   (`client/vercel.json` declares the build command and the SPA `rewrites` —
   so internal addresses like `/employees` do not return a 404 when you press F5).
4. **Environment variable** (*Settings → Environment Variables*):

   | Name           | Value                                          |
   | -------------- | ---------------------------------------------- |
   | `VITE_API_URL` | `https://<railway-domain>` (NO trailing `/`)   |

   > This value is baked into the code **at build time**.
   > If you change it later — **redeploy**, otherwise the old address sticks around.

5. Press *Deploy*.

### Step 3. Connecting the two

Once the Vercel domain is ready, update `CORS_ORIGIN` on Railway to the **real**
domain and redeploy the backend. To verify:

```bash
# 1) Is the backend alive?
curl https://<railway-domain>/api/health

# 2) Is CORS correct? (a request from the Vercel domain)
curl -i -H "Origin: https://<project>.vercel.app" https://<railway-domain>/api/health   | grep -i access-control-allow-origin
```

The second command should return the line
`access-control-allow-origin: https://<project>.vercel.app`.
If it does not — `CORS_ORIGIN` is wrong.

### About the migrations

`server/prisma/migrations/0_init/` is already in the repo (for PostgreSQL), so
the first deploy on Railway creates the tables by itself — you do not need a
local PostgreSQL installation.

If you change the schema later:

```bash
cd server
npm run migrate            # a new migration file is created
git add prisma/migrations && git commit -m "new migration"
git push                   # migrate deploy applies it during the Railway deploy
```

> ⚠️ `npm run use:sqlite` **deletes** the migrations folder (because those were
> written for PostgreSQL). Do not switch to SQLite on the branch you deploy from.

### Deployment problems

| Symptom                                          | Cause and fix                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `Environment variable not found: DATABASE_URL` (`P1012`, `[Context: getConfig]`) | `DATABASE_URL` is not set on Railway — see the section below |
| `P1001: Can't reach database server at postgres.railway.internal` | The internal network is not ready yet, or Postgres is not running — see the section below |
| The container keeps restarting (crash loop) | Usually the same cause as above. Look at the very **beginning** of the log — the `✖ The server did not start` message states the exact reason |
| `Serwer bilen baglanyşyk ýok` in the browser     | `VITE_API_URL` is wrong, or it was set without a redeploy afterwards                   |
| `blocked by CORS policy` in the console          | `CORS_ORIGIN` on Railway does not match the Vercel domain                              |
| F5 on `/employees` → 404                         | `client/vercel.json` was not deployed, or the Root Directory is not `client`            |
| `No migration found` in the Railway log          | `prisma/migrations` was not committed to git                                           |
| `Can't reach database server` in the Railway log | `DATABASE_URL` is not linked to the Postgres service (`${{Postgres.DATABASE_URL}}`)    |
| `Ulanyjy ady ýa-da açar sözi nädogry` (first sign-in) | The seed was not run — see item 7 of step 1                                       |
| The exported file is named `download`            | `Access-Control-Expose-Headers` is missing — an old backend version was deployed       |

### `DATABASE_URL` not found (the most common error)

If the Railway log shows this:

```
error: Environment variable not found: DATABASE_URL.
  -->  prisma/schema.prisma:10
Validation Error Count: 1
[Context: getConfig]
```

then the backend service has no `DATABASE_URL` variable. Adding the PostgreSQL
service **is not enough on its own** — you have to link it to the backend
service by hand:

1. Railway → open the **backend service** (not Postgres!) → **Variables**
2. **New Variable**:
   - Name: `DATABASE_URL`
   - Value: `${{Postgres.DATABASE_URL}}`
3. `Postgres` is the **name** of your database service. If it is called
   something else (for example `postgres-db`), use that name:
   `${{postgres-db.DATABASE_URL}}`
4. Save → Railway redeploys automatically.

To check that the value is linked correctly: click the eye icon next to
`DATABASE_URL` in the Variables list — a real address of the form
`postgresql://postgres:...@postgres.railway.internal:5432/railway` should
appear. If you see the `${{...}}` text itself — the service name is misspelled.

> Before `start:prod` runs, `scripts/check-env.js` checks the configuration and
> **tells you what to do** if there is a problem. So read the
> `✖ The server did not start` message at the very beginning of the Railway log —
> it contains a precise instruction.

### `P1001: Can't reach database server` (internal network)

```
✔ Environment variables checked.
Error: P1001: Can't reach database server at `postgres.railway.internal:5432`
```

`DATABASE_URL` is **correct** (check-env passed), but the database cannot be
reached over the network. Railway's internal network (`*.railway.internal`)
only becomes ready a few hundred milliseconds **after** the container starts.
If `prisma migrate deploy` runs at that very moment it fails, the container
restarts and the whole thing repeats (a crash loop).

That is why the `start:prod` chain includes `scripts/wait-for-db.js` — it waits
until the database answers:

```
…  postgres.railway.internal:5432 is not answering yet (1/20), waiting 1500 ms…
✔ The database is reachable: postgres.railway.internal:5432 (attempt 2)
```

If you need to wait longer, add these under Railway → Variables:

| Name               | Value   | Meaning                              |
| ------------------ | ------- | ------------------------------------ |
| `DB_WAIT_ATTEMPTS` | `40`    | number of attempts (default 20)      |
| `DB_WAIT_DELAY_MS` | `2000`  | delay between attempts (default 1500) |

**If it still does not connect after the wait,** check these in order:

1. **Is the Postgres service running?** Open it on Railway — its status must be
   a green **Active**. If it never deployed or has stopped, restart it.
2. **Is `DATABASE_URL` linked to the right service?** Click the eye icon to see
   the real address.
3. **Switch to the public address** (a reliable fallback):
   - Postgres service → Settings → Networking → enable **Public Networking**
   - On the backend service: `DATABASE_URL` = `${{Postgres.DATABASE_PUBLIC_URL}}`

   The public address goes through `*.proxy.rlwy.net` — a little slower and
   billed for traffic, but free of internal-network problems.

### Other options

You can do without Vercel: run `cd client && npm run build` and put `client/dist`
on any static server (nginx, Caddy). If you proxy `/api` from that server to the
backend, you do not need to set `VITE_API_URL` at all — the app then uses the
relative `/api` address and CORS is not needed.

---

## Account types and permissions

| Action                                    | Administrator | Employee        |
| ----------------------------------------- | :-----------: | :-------------: |
| View their own attendance                 |      ✅       |      ✅         |
| **Enter / edit their own times**          |      ✅       |      ✅         |
| Delete their own record                   |      ✅       |      ✅         |
| View the table of all employees           |      ✅       |      ❌         |
| Edit another employee's record            |      ✅       |      ❌         |
| Add / edit / archive employees            |      ✅       |      ❌         |
| **Permanently delete** an employee        |      ✅       |      ❌         |
| Add an administrator                      |      ✅       |      ❌         |
| Change the settings                       |      ✅       |      ❌         |
| Reports and Excel export                  |  ✅ (everyone) | ✅ (themselves only) |

There is no open sign-up — only an administrator creates accounts.
Employees are added on the **Işgärler** page, administrators on the
**Administratorlar** page.

A login has to be **unique** across the `User` and `Employee` tables —
both sign in through the same `/api/auth/login`.

---

## API endpoints

Every protected request requires an `Authorization: Bearer <token>` header.

| Method   | Path                                | Who            | Description                               |
| -------- | ----------------------------------- | -------------- | ----------------------------------------- |
| `POST`   | `/api/auth/login`                   | —              | Admin or employee — returns a token       |
| `GET`    | `/api/auth/me`                      | everyone       | The current account (`type`: admin \| employee) |
| `POST`   | `/api/auth/change-password`         | everyone       | Change your own password                  |
| `GET`    | `/api/employees`                    | everyone       | Admin — all of them, employee — only themselves |
| `POST`   | `/api/employees`                    | admin          | Add an employee (with a login + password) |
| `PUT`    | `/api/employees/:id`                | admin          | Edit / reset the password                 |
| `DELETE` | `/api/employees/:id`                | admin          | To the archive (soft delete)              |
| `DELETE` | `/api/employees/:id?permanent=true` | admin          | **Permanent deletion** (with their records) |
| `GET`    | `/api/attendance?year=&month=`      | everyone       | Records for the month + totals            |
| `POST`   | `/api/attendance`                   | everyone       | **Add a new check-in/check-out record**   |
| `PUT`    | `/api/attendance/:id`               | everyone\*     | Edit a record                             |
| `DELETE` | `/api/attendance/:id`               | everyone\*     | Delete a record                           |
| `GET`    | `/api/reports/monthly?year=&month=` | everyone       | Aggregated monthly report                 |
| `GET`    | `/api/reports/export?year=&month=`  | everyone       | XLSX file (3 sheets)                      |
| `GET`    | `/api/users`                        | admin          | List of administrators                    |
| `POST`   | `/api/users`                        | admin          | Add an administrator                      |
| `PUT`    | `/api/users/:id`                    | admin          | Edit / password / active state            |
| `GET`    | `/api/settings`                     | everyone       | Settings                                  |
| `PUT`    | `/api/settings`                     | admin          | Save the settings                         |
| `GET`    | `/api/health`                       | —              | Server status                             |

\* An employee only edits/deletes **their own** records; an admin can do any of them.

### Sample requests

```bash
# Sign in as an employee
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"login":"aman","password":"employee123"}'

# Add three check-in/check-out records for one day (the employee writes for themselves)
for s in '{"date":"2026-09-01","checkIn":"09:00","checkOut":"12:00"}' \
         '{"date":"2026-09-01","checkIn":"13:00","checkOut":"17:00"}' \
         '{"date":"2026-09-01","checkIn":"19:00","checkOut":"21:30"}'; do
  curl -X POST http://localhost:4000/api/attendance \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer <TOKEN>" -d "$s"
done

# An admin writes for another employee — employeeId is required
curl -X POST http://localhost:4000/api/attendance \
  -H "Content-Type: application/json" -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -d '{"employeeId":2,"date":"2026-09-01","checkIn":"09:30","checkOut":"18:00"}'

# Partially edit a record — the fields that are not sent stay unchanged
curl -X PUT http://localhost:4000/api/attendance/5 \
  -H "Content-Type: application/json" -H "Authorization: Bearer <TOKEN>" \
  -d '{"checkOut":"18:15"}'
```

---

## Database schema

| Table        | Fields                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| `User`       | id, login (unique), passwordHash, fullName, isActive, createdAt — **administrators only**                        |
| `Employee`   | id, login (unique), passwordHash, fullName, position, isActive, createdAt — **the employee's own account**       |
| `Attendance` | id, employeeId, date, checkIn, checkOut, note, updatedByUserId, updatedByEmployeeId, createdAt, updatedAt         |
| `AuditLog`   | id, userId, employeeId, action, entity, entityId, oldValue, newValue, createdAt                                   |
| `Settings`   | id (=1), workStart, workEnd, lateThresholdMin, weekendDays, updatedAt                                             |

### Several records in one day

Every row in `Attendance` is **one** check-in/check-out. That is why there is
**NO unique index** on `(employeeId, date)`; there is a plain index instead.

Calculation rules:

- **Daily total** = the sum of the durations of all of that day's records
- **Days worked** = the number of days with at least one record
- **Lateness** counts once per day — based on the **earliest** check-in of that day
- **Unfinished day** — a day that has a record with no `checkOut`
- A new record is checked so that it does **not overlap** the other records of
  that day (it is rejected with a `409` error)
- A check-in/check-out time **cannot lie in the future** (see the section below)

### Deleting an employee: archive vs. permanent deletion

There are two ways — both admin-only:

| Way | Button | What happens |
| --- | --- | --- |
| **To the archive** (`DELETE /api/employees/:id`) | "Arhiwe geçir" | `isActive = false`. The employee cannot sign in, but **all of their attendance records are kept** and keep showing up in the reports. They can be brought back at any time with "Dikelt". |
| **Permanently** (`?permanent=true`) | "Hemişelik poz" | The employee and **all of their attendance records** are removed from the database. This cannot be undone. |

A permanent deletion takes the records with it because of the
`onDelete: Cascade` on the `Attendance.employee` relation — which means **the
reports of previous months change too**. That is why the interface shows how
many records will be lost before the deletion and requires a separate checkbox
to confirm.

The information about the deleted employee (name, login, record count) is kept
in the `AuditLog` — so you can still find out who deleted what and when.

The employee list (`GET /api/employees`) also returns an `attendanceCount`
field for every employee.

### An unfinished session (the employee is working right now)

A session with a "Geldi" but no "Gitdi" yet is counted **up to the current
time** and is **refreshed every minute** on screen — so the hours are visible
while the employee is still working.

The calculation rule:

| Situation | Result |
| --- | --- |
| Arrived at 09:00 today, it is now 14:30 | `05:30` — and growing |
| Arrived at 22:00 yesterday, it is now 14:30 (night shift) | `16:30` — counted |
| The check-in time lies in the future (entered by mistake) | `00:00` |
| An open session **older than 24 hours** | `00:00` |

The last row matters: if somebody forgets to record "Gitdi", an open record
from last week would turn into 200+ hours and wreck every report. Anything past
24 hours is not counted and the day is marked **"Tamamlanmadyk"**.

> ⚠️ **Set the `TZ` variable.** If the server runs in UTC (the default on
> Railway) the current time does not match the employee's real time and open
> sessions are counted incorrectly (usually as `00:00`). Railway → Variables:
> `TZ = Asia/Ashgabat`. The frontend uses the browser's own time, so it does
> not have this problem.

### Future times cannot be entered

A check-in/check-out time that has not happened yet cannot be saved:

| Situation (it is now 14:00) | Result |
| --- | --- |
| `Gitdi = 13:00` | ✅ saved |
| `Gitdi = 14:00` (exactly now) | ✅ saved |
| `Gitdi = 14:01` | ❌ `"Gitdi" wagty geljekde bolup bilmez.` |
| `Geldi = 16:00` | ❌ `"Geldi" wagty geljekde bolup bilmez.` |
| `10:00 → 06:00` (night shift) | ❌ the check-out belongs to the **next** day — in the future |

The interface shows the error while you type and the **"Ýatda sakla" button is
disabled**. As the clock moves on (for example 14:00 → 15:01) a `15:00` that
was rejected earlier becomes valid by itself and the button works again — no
page refresh needed.

> ⚠️ **The server-side check depends on `TZ`.** If `TZ` is not set the server
> runs in UTC and does not know the user's real time — in that case the
> server-side check is skipped **so that valid records are not rejected**
> (it still runs in the browser). A warning about this is printed when the
> server starts. Railway → Variables: `TZ = Asia/Ashgabat`.

### Date and time format

The `date` field is stored as **text (String)** instead of `DATE`, and
`checkIn`/`checkOut` instead of `TIME`:

- `date` → `"2026-09-01"` (YYYY-MM-DD)
- `checkIn` / `checkOut` → `"10:40"` (HH:MM)

**Why:** (1) in Prisma, `@db.Date` and `@db.Time` only work on PostgreSQL — that
would remove the option of switching to SQLite; (2) with `DateTime` the day can
shift by twenty-four hours when the server and browser time zones differ.
In the text format sorting, range queries and indexes all work equally well.

Night shifts are supported: if `checkOut < checkIn` (for example `22:00 → 06:00`)
the time worked is treated as carrying over into the next day.

### Partial edits (PATCH-style)

In `PUT` requests, **fields that are not sent stay unchanged**:

- if a field is not sent at all → the old value is kept
- if a field is sent as `""` (an empty string) → it is deliberately cleared (`null`)

---

## Useful commands

```bash
cd server
npm run dev             # start with nodemon
npm run start           # plain start
npm run start:prod      # migrate deploy + server (this is what Railway uses)
npm run generate        # prisma generate
npm run migrate         # prisma migrate dev
npm run migrate:deploy  # production migration
npm run seed            # admin + employees + settings
npm run studio          # Prisma Studio (browse the database)
npm run use:sqlite      # switch to SQLite
npm run use:postgres    # switch back to PostgreSQL
```

---

## Frequent problems

**`✖ JWT_SECRET is not set`** — there is no `server/.env` file. Run `cp .env.example .env`.

**`Can't reach database server`** — PostgreSQL is not running, or `DATABASE_URL`
is wrong. Or switch to SQLite: `npm run use:sqlite`.

**`P3019` — the provider does not match** — the `npm run use:sqlite` /
`use:postgres` command deletes the old migrations itself; run `npm run migrate`
afterwards.

**`the URL must start with the protocol \`file:\`` (or `postgresql:`)** —
`schema.prisma` has changed, but the **generated Prisma client** is still stuck
on the old provider (the provider is "baked into" the client). The fix:

```bash
npm run generate && npm run seed
```

`npm run use:sqlite` / `use:postgres` now regenerates the client itself, so this
usually only happens when `schema.prisma` was edited by hand.

**`attempt to write a readonly database`** (SQLite) — the database file was
deleted/recreated while the server was running. Restart the server.

**`Serwer bilen baglanyşyk ýok` on the frontend** — the backend was not started.

**`Bu wagt aralygy … bilen gabat gelýär`** — there is an overlapping record on
that day. Fix the old record first, or enter a different time.

**The Excel export is empty** — there are no records at all for that month.

---

## Project structure

```
folder/
├── README.md
├── server/
│   ├── .env.example
│   ├── railway.json            # Railway: start command + healthcheck
│   ├── package.json
│   ├── prisma/
│   │   ├── schema.prisma       # database schema
│   │   ├── migrations/         # 0_init — for PostgreSQL, committed to git
│   │   └── seed.js             # admin + sample employees
│   ├── scripts/
│   │   ├── switch-db.js        # postgres ⇄ sqlite
│   │   ├── check-env.js        # check the configuration
│   │   └── wait-for-db.js      # wait until the database is ready
│   └── src/
│       ├── index.js            # the Express application
│       ├── prisma.js
│       ├── middleware/         # auth.js (admin/employee), error.js
│       ├── utils/              # validate.js, audit.js, report.js, accounts.js
│       └── routes/             # auth, employees, attendance, reports, users, settings
└── client/
    ├── index.html
    ├── vercel.json             # Vercel: SPA rewrites + build
    ├── .env.example            # VITE_API_URL
    ├── vite.config.js          # the /api proxy (dev only)
    ├── tailwind.config.js
    └── src/
        ├── main.jsx
        ├── App.jsx             # routing
        ├── api.js              # the API layer + token (VITE_API_URL)
        ├── i18n.js             # the Turkmen texts
        ├── lib/
        │   ├── date.js         # date/time calculations
        │   └── useAttendanceMonth.js  # monthly data + session actions
        ├── context/            # AuthContext, ToastContext
        ├── components/         # Layout, Modal, MonthPicker, AttendanceModal…
        └── pages/
            ├── Login.jsx
            ├── Attendance.jsx      # admin — the whole table
            ├── MyAttendance.jsx    # employee — entering their own times
            ├── Employees.jsx
            ├── Users.jsx
            ├── Reports.jsx
            └── Settings.jsx
```
