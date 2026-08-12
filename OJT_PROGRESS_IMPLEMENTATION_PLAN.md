# OJT Progress Tracking — Architecture & Implementation Plan

Status: **implemented** (phases 1–4) · Author: engineering · Date: 2026-08-11

> Built as specified below, with three implementation-level departures recorded
> in §11. Phase 5 remains unbuilt by design.

Turns the two tabs of the "Training status check" Google Sheet into a first-class,
twice-daily-synced OJT progress engine inside the app, with supervisor-editable
start dates that outrank the sheet, a colour-coded burn-rate ratio, and a GM (ATM)
extension prompt.

---

## 1. Scope

**In scope**

| Requirement | Where it lands |
| --- | --- |
| Scrape both sheets daily at 13:00 & 19:00 IST | `fetch-ojt-data` edge fn + 2 pg_cron jobs |
| Pull name, emp id, unit, required/performed hours & days (Extracted Data) | sync landing columns |
| Pull name, emp id, date of start of OJT (OJT data) | sync landing columns |
| Join the two sheets on employee id | in-function join, keyed `(emp_id, unit)` |
| `required_months = required_hours / 15` → deadline from start date | computed column |
| `hours_left`, `days_left`, `ratio = hours_left / days_left` | SQL view + TS module |
| Colour-code the ratio (≤0.4 / ≤1 / >1) | shared band function |
| GM (ATM) extension prompt when `days_left < 15` and `ratio > 1` | derived flag + UI banner |
| App edit of start-of-OJT date, absolute over sheet | override column, PIN policy |
| Last-edited-wins for everything else | override columns, LWW policy |
| Supervisor page: all trainees, list **and** card view | `/supervisor/ojt-progress` |
| Employee panel: own progress only | `/employee/ojt-progress` + dashboard card |

**Explicitly out of scope** (designed for, not built): a full GM extension
request/approval workflow. The schema reserves `deadline_override` +
`deadline_override_reason` so an approved extension can be recorded later without
a migration rewrite. Phase 5 sketches it.

---

## 2. What the source data actually says

Every formula below was derived and then **verified against all 132 rows** of the
two CSVs (script: `scratchpad/verify.mjs`, evaluated as of 2026-08-11). This
section is findings, not assumptions.

### 2.1 The `/15` rule holds exactly

Required-hours values present: 10, 15, 30, 45, 60, 75, 90, 120, 180, 210 →
0.667, 1, 2, 3, 4, 5, 6, 8, 12, 14 months. Matches the sheet's
"Maximum duration (in months)" column on every row.

### 2.2 Deadline formula — confirmed on 131/132 rows

```
deadline = EDATE(start_of_ojt, required_months) − 1 day
```

`EDATE` = same day-of-month N months later, **clamped to month end**
(31-12-2025 + 5m → 31-05-2026; 31-07-2026 + 4m → 30-11-2026). `date-fns`
`addMonths` already has this behaviour, as does Postgres `+ interval`.

> **Sheet bug #1 — fractional months.** The one mismatch is BIJAN KUMAR BHAT
> (10 h → 0.667 months). The sheet's `EDATE` truncates the fraction to 0 months
> and returns a deadline of **16-06-2026 for an OJT starting 17-06-2026** — a
> deadline one day *before* the start. Our engine adds whole months, then
> `round(frac × 30)` days: 06-07-2026. **Our number will differ from the sheet
> here, and ours is the correct one.**

### 2.3 Hours left — the sheet's column is unusable

```
hours_left = max(0, required_hours − performed_hours)
```

Performed hours arrive as `HH:MM:SS` or `HH:MM` (`86:30:00` → 86.5, `12:45` → 12.75).

> **Sheet bug #2 — 24-hour display wrap.** 54 of 132 rows disagree with the
> sheet's "Hours left" column, and **all 54 are explained by modulo 24**: the
> cell is formatted `h:mm` instead of `[h]:mm`, so 90 h renders as `18:00`,
> 77.25 h as `5:15`. The underlying sheet arithmetic is right; the displayed
> value is not. Anyone comparing our UI against the sheet will see differences
> on ~41% of rows. **This needs to be said out loud at rollout.**

### 2.4 Days left is calendar days, not duty days

```
days_left = deadline − today          (verified against the sheet on 131/132 rows)
```

Note the collision: `required_days` / `performed_days` from the sheet are
**duty-day counts** (e.g. 45 required, 191 performed), while `days_left` is
**calendar days to deadline**. They are unrelated quantities. The UI must label
them distinctly — `Duty days 191 / 45` vs `27 days to deadline` — or the page
will be misread.

### 2.5 The natural key is `(emp_id, unit)`, not `emp_id`

**RUDRA PRATAP (10003134) holds two concurrent OJT cycles**: APP+APP(S) — 90 h
from 20-10-2025, and ADC — 60 h from 29-06-2026. Separate start dates, separate
deadlines, separate progress.

This is decisive: `employee_training_records` is `UNIQUE (emp_id)` and
**structurally cannot represent this employee**. Hence a new child table
(§3.1) rather than more columns on the existing one.

Conversely, **MANISH KUMAR is two different people** (10021729 MGR, 10023483 JE),
which is why the join must be on emp id — as specified — and never on name.

Joining the two tabs on `(emp_id, unit)` gives **0 unmatched rows and 0
performed-hours disagreements** across the whole file. The join is clean.

### 2.6 "Not started" must be a flag, never a status

> **Reversed on 2026-08-12 — see §2.6a.** Kept here because it records what the
> data looked like under the original rule.

39 rows have 0 performed hours. **13 of them are already in the critical band** —
ALOK SRIVASTAV needs 45 h in 14 days (3.2 h/day). If "OJT not started" replaces
the band (as it does in the sheet's `Current status` column), those 13 people
become invisible. `not_started` is a badge alongside the band, not instead of it.

### 2.6a "Not started" is a status after all (2026-08-12)

The training section rejected §2.6. A trainee with 0 performed hours has not
begun the OJT, so the sheet's start date is a plan, not a clock: the rate those
13 rows were "critical" on measured the calendar running out, not a trainee
falling behind. The proof is the escalation list — all three trainees the
original rule sent to the GM (ATM) had **never logged an hour**. Asking for an
extension to a cycle nobody has started is noise that costs the real
escalations their credibility.

`NOT_STARTED` is therefore a band, resolved **first** — ahead of
`DEADLINE_PASSED`, since a trainee who never entered the cycle cannot have
missed it — and `hours_left`, `days_left` and `ratio` are all `NULL` while it
holds. `requires_gm_extension` follows for free: it tests for `CRITICAL`, which
a `NOT_STARTED` row can no longer be. The `not_started` boolean survives
unchanged as the raw flag, which is what Trainee Details filters on.

`deadline` is deliberately *not* suppressed. It is a fact derived from the sheet
(start date + required months), not a countdown, and the supervisor edit dialog
needs it to preview the effect of entering a start date.

### 2.7 Negative-ratio trap

For the 10 rows already past deadline with hours outstanding, `days_left` is
negative, so `hours_left / days_left` is **negative** — and a naive `ratio <= 0.4`
test paints RAVI KUMAR (37.25 h outstanding, 184 days overdue) **green "on
track"**. `DEADLINE_PASSED` must be evaluated *before* any ratio comparison, and
`ratio` must be `null` when `days_left <= 0`.

### 2.8 Today's cohort under the specified rules

| Band | Rows (original) | Rows (with §2.6a) |
| --- | --- | --- |
| `HOURS_COMPLETE` | 43 | 43 |
| `NOT_STARTED` | — | 39 |
| `ON_TRACK` (≤ 0.4) | 16 | 16 |
| `WATCH` (0.4–1] | 47 | 29 |
| `CRITICAL` (> 1) | 16 | 3 |
| `DEADLINE_PASSED` | 10 | 2 |

**GM (ATM) extension prompts firing today: 3 → 0.** All three — ALOK SRIVASTAV
(45 h / 14 d), MANOJ KUMAR YADAV (30 h / 5 d), NAGMANI KUMAR (45 h / 14 d) —
had zero performed hours, and are `NOT_STARTED` under §2.6a.

---

## 3. Data model

### 3.1 New table `public.employee_ojt_progress`

Migration `20260811100000_employee_ojt_progress.sql`.

A child of `employee_training_records`, keyed `(emp_id, unit)`. `employee_training_records`
stays the per-person record (ratings, licence, ELPA, medical, pre-board/board
milestones); this table holds the many per-unit OJT cycles.

**The central design rule: sheet values and app edits never share a column.**

```sql
CREATE TABLE public.employee_ojt_progress (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  emp_id                 TEXT NOT NULL,
  unit                   TEXT NOT NULL,
  employee_name          TEXT NOT NULL,
  designation            TEXT,

  -- ── sheet landing zone: written ONLY by fetch-ojt-data ──────────────
  sheet_required_hours   NUMERIC(7,2),
  sheet_required_days    INTEGER,
  sheet_performed_hours  NUMERIC(7,2),   -- decimal hours, parsed from HH:MM:SS
  sheet_performed_days   INTEGER,
  sheet_start_date       DATE,           -- "Date of start of OJT" (OJT data tab)
  sheet_marking_date     DATE,           -- "Date of marking for OJT"
  sheet_synced_at        TIMESTAMPTZ,
  sync_batch_id          TEXT,

  -- ── app override zone: written ONLY by update-ojt-progress ──────────
  override_required_hours   NUMERIC(7,2),
  override_required_days    INTEGER,
  override_performed_hours  NUMERIC(7,2),
  override_performed_days   INTEGER,
  override_start_date       DATE,        -- PIN policy: absolute over sheet
  override_updated_at       TIMESTAMPTZ,
  override_updated_by       UUID REFERENCES auth.users(id),
  override_note             TEXT,

  -- ── reserved for the GM extension workflow (Phase 5, unused now) ────
  deadline_override         DATE,
  deadline_override_reason  TEXT,

  profile_linked         BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT employee_ojt_progress_emp_unit_key UNIQUE (emp_id, unit)
);

CREATE INDEX idx_ojt_progress_emp        ON public.employee_ojt_progress(emp_id);
CREATE INDEX idx_ojt_progress_active     ON public.employee_ojt_progress(unit, employee_name)
  WHERE is_archived = FALSE;
```

Why split columns instead of one column plus a timestamp:

1. **Sync stays idempotent.** A re-run, a retry, or a partial failure can never
   destroy a supervisor's edit.
2. **The conflict is showable.** "Sheet says 58:30 · you entered 61:00 on 9 Aug"
   is a UI affordance, not an archaeology exercise.
3. **Revert is trivial** — `NULL` the override.
4. **Audit is free** — both values persist side by side.

### 3.2 Precedence resolution — the two policies

Resolved in a view, `public.v_ojt_progress_resolved`:

| Field | Policy | Rule |
| --- | --- | --- |
| `start_date` | **PIN** | `COALESCE(override_start_date, sheet_start_date)` — once set in-app, the sheet is ignored **permanently** for that row until a supervisor clicks *Revert to sheet*. |
| everything else | **LWW** | `CASE WHEN override_updated_at > sheet_synced_at THEN override_x ELSE sheet_x END` |

This is exactly the split you specified: last-edited-wins as the default, with
start-of-OJT date as a hard exception where the app is absolute. Both are
declarative and live in one view, so no caller can get it wrong.

`resolved_start_date` is what feeds the deadline. An app edit to the start date
therefore moves the deadline, `days_left`, the ratio, the band, and the GM prompt
in one step — which is the point of the feature.

### 3.3 Derived values — split by whether they depend on *today*

| Value | Depends on today? | Where |
| --- | --- | --- |
| `required_months`, `deadline` | no | generated/stored, recomputed on write |
| `hours_left`, `days_requirement_met` | no | generated |
| `days_left`, `ratio`, `band`, `requires_gm_extension` | **yes** | view `v_ojt_progress`, `CURRENT_DATE` |

Storing `days_left` would make it wrong within hours. Computing it in the view
keeps every read correct and lets supervisors filter and sort server-side.

### 3.4 Status taxonomy

Evaluated **in order** — the guard ordering is what prevents §2.7.

```
0. NOT_STARTED           performed_hours = 0 AND required_hours > 0
                                                              → slate (terminal;
                                                hours_left = days_left = ratio = NULL)
1. AWAITING_START_DATE   resolved_start_date IS NULL          → slate
2. HOURS_COMPLETE        hours_left <= 0                      → emerald
3. DEADLINE_PASSED       days_left <= 0 AND hours_left > 0    → rose (terminal, ratio = NULL)
4. ON_TRACK              ratio <= 0.4                         → emerald
5. WATCH                 0.4 < ratio <= 1                     → amber
6. CRITICAL              ratio > 1                            → rose
```

Boundaries are inclusive at the top of each band (`≤ 0.4` green, `≤ 1` amber),
matching "below 0.4 and below" / "above 0.4 and below 1".

Cross-cutting flags, rendered as chips **alongside** the band:

- `not_started` — `performed_hours = 0` (39 rows). Since §2.6a this is also the
  `NOT_STARTED` band, so the UI shows the chip only where the band says
  something else — i.e. never, unless `required_hours` is missing.
- `requires_gm_extension` — `days_left < 15 AND ratio > 1` (3 rows)
- `days_requirement_met` — `performed_days >= required_days`

---

## 4. Ingestion

### 4.1 Apps Script

One web app over the existing spreadsheet returning both tabs in a single
payload, following the `*_webapp_url` convention already used for roster,
leave, training, ELPA, medical and rating data:

```json
{ "extracted": [ { "emp_id": "10024032", "name": "...", "unit": "ADC",
                   "required_hours": 90, "required_days": 45,
                   "performed_hours": "58:30:00", "performed_days": 96 } ],
  "ojt":       [ { "emp_id": "10024032", "name": "...", "unit": "ADC",
                   "start_of_ojt": "01-05-2026" } ] }
```

Both tabs in **one response**, so the join is atomic — you can never land fresh
performed-hours against a stale start date. URL stored in `app_settings` under
key `ojt_data_webapp_url`, surfaced in Admin → System Settings alongside the
existing entries (`src/pages/admin/AdminSettings.tsx`).

### 4.2 Edge function `supabase/functions/fetch-ojt-data/index.ts`

Modelled on `fetch-trainee-data`, minus the fuzzy name matching — emp id is
present on both tabs, so we join on it directly (§2.5).

1. Auth: bearer token, service-role or supervisor/admin/WSO.
2. Read `ojt_data_webapp_url` from `app_settings`; 400 if unset.
3. Fetch, parse, normalise:
   - `parseSheetDate` — reuse the `DD-MM-YYYY` / `DD-Mon-YYYY` / ISO parser
     already proven in `fetch-trainee-data/index.ts`.
   - `parseDuration("86:30:00") → 86.5` (**new** — no existing helper handles
     `HH:MM:SS` durations).
4. Join `extracted × ojt` on `(emp_id, unit)`; count and log leftovers on both sides.
5. Resolve `profile_linked` by looking up `profiles.employee_id`. Rows with no
   profile are **still stored** and counted as `unlinked` — the supervisor sees
   the whole cohort even where the app has no account yet.
6. Upsert on `(emp_id, unit)`, writing **only `sheet_*` columns** and
   `sheet_synced_at`. Override columns are never in the update payload.
7. Rows absent from the sheet for this batch → `is_archived = true` (soft, not
   delete — an archived row keeps its overrides if the person returns).
8. Log to `api_call_logs` with the same shape as the other fetchers.

Returns `{ records, upserted, unmatched, unlinked, archived }`.

### 4.3 Scheduling — 13:00 and 19:00 IST

pg_cron runs in **UTC**; IST is UTC+5:30.

| Job | Cron (UTC) | IST |
| --- | --- | --- |
| `ojt-sync-midday` | `30 7 * * *` | 13:00 |
| `ojt-sync-evening` | `30 13 * * *` | 19:00 |

Migration `20260811110000_ojt_sync_cron.sql`:

- insert both into `sync_jobs`;
- register both as `cron_job_queue` inserts, matching the queue pattern in
  `20260425120000_daily_data_sync_cron_health.sql`;
- **add `'fetch-ojt-data'` to the `v_use_queue` list inside `manage_cron_job()`** —
  easy to miss, and skipping it silently downgrades the jobs to direct HTTP cron,
  losing retry and health tracking.

Both jobs then appear in Admin → Cron Jobs with health status via the existing
`get_cron_job_health()`, and can be triggered manually from the same screen.

### 4.4 Write path `supabase/functions/update-ojt-progress/index.ts`

Mirrors `update-training-record`: bearer auth → role check against `user_roles`
→ service-role write. Column allow-list restricted to the `override_*` set, so
no caller can write the sheet landing zone. Stamps `override_updated_at`,
`override_updated_by`, and emits a `logSupervisorEdit` audit entry.

---

## 5. The computation engine

### 5.1 One specification, two runtimes

`days_left`/`ratio`/`band` are needed **server-side** (filter, sort, count,
alerting) and **client-side** (render without a round-trip). That means two
implementations — a genuine risk of drift.

Mitigation, not hope:

- `src/domain/ojt/progress.ts` — canonical TypeScript. Pure functions, no I/O:
  `requiredMonths`, `computeDeadline`, `computeProgress`, `resolveBand`,
  `requiresGmExtension`.
- `public.v_ojt_progress` — the SQL mirror.
- `src/domain/ojt/__tests__/progress.test.ts` — a **golden fixture generated
  from these two CSVs** (132 rows, expected outputs frozen at a fixed
  `today = 2026-08-11`) asserting the TS module row-for-row. A second test
  executes the SQL view against the same fixture and diffs the two outputs.
  Drift fails CI. `vitest` is already configured; `src/lib/compliance/__tests__/`
  is the existing precedent.

### 5.2 Signature

```ts
export interface OjtProgress {
  requiredHours: number;  performedHours: number;
  requiredDays: number;   performedDays: number;
  startDate: string | null;
  requiredMonths: number;              // requiredHours / 15
  deadline: string | null;             // EDATE(start, months) − 1 day
  hoursLeft: number;                   // max(0, required − performed)
  daysLeft: number | null;             // deadline − today (signed)
  ratio: number | null;                // hoursLeft / daysLeft, NULL when daysLeft <= 0
  band: OjtBand;                       // §3.4, guard-ordered
  notStarted: boolean;
  daysRequirementMet: boolean;
  requiresGmExtension: boolean;        // daysLeft < 15 && ratio > 1
}
```

`getOjtBandClass(band)` returns Tailwind light/dark badge classes in the same
shape as `getTraineeStatusBadgeClass` in `src/lib/traineeMilestones.ts`, so the
new pages inherit house styling for free.

### 5.3 Read RPCs

Migration `20260811120000_ojt_progress_rpcs.sql`:

- `get_ojt_progress_records()` — `SECURITY DEFINER`, gated on
  supervisor/admin/WSO exactly as `get_supervisor_trainee_records()` is. Returns
  every non-archived row joined to `profiles` for station/rating, with all
  derived fields.
- `get_my_ojt_progress()` — returns only rows where
  `emp_id = (SELECT employee_id FROM profiles WHERE id = auth.uid())`. This is
  the employee panel's sole data path; it cannot return another person's row.

Plus RLS on the table: employees `SELECT` own rows; supervisor/admin/WSO
`SELECT` all; writes are service-role only (they go through the edge function).

---

## 6. UI

### 6.1 Supervisor — `/supervisor/ojt-progress`

New page `src/pages/supervisor/OjtProgress.tsx`, route in `src/App.tsx`
(`allowedRoles={['supervisor']}`), sidebar entry in `src/components/AppSidebar.tsx`
beneath the existing "Trainee Details".

Kept **separate** from `/supervisor/trainees`, which tracks a different concern
(pre-board / board milestones). Cross-link both ways; a per-row deep link from
each page to the other.

**Header** — counts as filter chips, driven by §3.4:
`All · On Track · Watch · Critical · Deadline Passed · Completed · Not Started ·
No Start Date · ⚠ Needs GM Extension`. Each chip wears its own band colour, so
the filter row and the Status column read as one vocabulary. The GM chip is
styled as the alert and sorts to the top by default when non-zero.

**View toggle — list ⇄ card**, persisted to `localStorage`, defaulting to card on
mobile and list on desktop:

- **List** — eight columns, each pairing one primary figure with its context
  underneath, so a supervisor scanning reads down a single number rather than
  across four: Trainee (name · unit · emp id · designation) · OJT hours
  (performed/required, completion bar, % and hours left) · Duty days ·
  Deadline (date, days left, start date) · Rate · Status (band, GM warning,
  account warning) · Milestone · Edit.

  Ordered escalations → band severity → burn rate → deadline. Band severity is
  load-bearing: `DEADLINE_PASSED` and `NOT_STARTED` both carry a `NULL` ratio,
  so ordering on the rate alone buried the overdue below the on-track.
- **Card** — one card per cycle: name and unit header, a hours-progress bar,
  the ratio as the dominant coloured figure with `hrs/day` beneath it, deadline
  with countdown, flag chips, and the GM banner inline when it fires.

An employee with two concurrent cycles (RUDRA PRATAP) renders as **two rows /
two cards**, each with its own unit, deadline and ratio. Never merged.

**Edit dialog** — start-of-OJT date, required hours/days, performed hours/days.
Each field shows the sheet value beneath it when an override diverges
("Sheet: 01-04-2026 · synced 2h ago"), with a per-field *Revert to sheet*. The
start-date field carries an explicit note that the app value is absolute and the
sheet will not overwrite it. Saving previews the recomputed deadline and band
before commit, since editing the start date moves the deadline.

**Access:** editing is **supervisor/admin/WSO only** — see §9, Decision 1.

### 6.2 Employee — own data only

- **Dedicated page** `src/pages/employee/OjtProgress.tsx` at
  `/employee/ojt-progress`, fed by `get_my_ojt_progress()`: the full card for
  each of the employee's own cycles — progress bar, hours left, days left, ratio
  with its colour, deadline countdown, and the GM prompt when it fires. Read-only.
- **Dashboard card** in `src/pages/employee/EmployeeDashboard.tsx`, next to the
  existing trainee-milestone card (which already reads
  `profile.linked_training_record` via `extractTraineeMilestone`): a compact
  ratio + days-left summary linking through to the page. Renders nothing for
  non-trainees.

**The GM (ATM) prompt.** When `requiresGmExtension`, both surfaces show a
prominent banner:

> **Action needed — request additional OJT hours.** You have **45:00 hours**
> remaining with **14 days** to your deadline of **25 Aug 2026** (3.2 hrs/day
> required). Approach the GM (ATM) for additional hours **before** the deadline.

Same copy on the supervisor card so both sides see the identical instruction.

---

## 7. Delivery phases

| Phase | Contents | Ships |
| --- | --- | --- |
| **1 — Foundation** | Apps Script; `employee_ojt_progress`; resolution + progress views; RLS; RPCs | Data queryable, nothing user-visible |
| **2 — Ingestion** | `fetch-ojt-data`; both cron jobs; `v_use_queue` entry; Admin settings field | Twice-daily sync live, verified in Admin → Cron Jobs |
| **3 — Engine** | `src/domain/ojt/`; golden fixtures from these CSVs; TS↔SQL parity test | Math locked and CI-guarded |
| **4 — UI** | Supervisor page (list + card + edit); `update-ojt-progress`; employee page + dashboard card | Feature complete as specified |
| **5 — Optional** | Push/email on `requires_gm_extension`; `ojt_extension_requests` + GM approval writing `deadline_override` | Beyond current ask |

Phases 1–3 are independently testable without touching any existing screen.
Phase 4 is the only one that modifies shipped surfaces, and only additively.

---

## 8. Risks

| Risk | Handling |
| --- | --- |
| **Our numbers won't match the sheet** on ~41% of rows (hours left, §2.3) and one deadline (§2.2) | Both are demonstrated sheet bugs. Brief supervisors at rollout; consider fixing the sheet's cell format to `[h]:mm` so the two agree. |
| TS/SQL math drift | Golden-fixture parity test in CI (§5.1) |
| Sheet column headers renamed upstream | Header-name allow-list with aliases (as `fetch-trainee-data` already does); sync fails loudly to `api_call_logs` rather than silently writing nulls |
| `unit` string drift (`APP+APP(S)` vs `APP + APP(S)`) splits a cycle into two rows | Normalise unit (upper, strip inner spaces) before keying; log any newly-seen unit value |
| Sheet is edited *between* the 13:00 and 19:00 syncs with an app edit in between | LWW resolves deterministically by timestamp; start date is immune by PIN |
| An employee's OJT restarts in the same unit | Archived row is reused on re-appearance; **overrides carry over** — Phase 5 should add an explicit "start new cycle" action if this proves common in practice |
| pg_cron timezone assumed UTC | Verified against existing jobs, all UTC. Confirm on the production instance with `SHOW timezone;` before Phase 2 sign-off. |

---

## 9. Decisions I've defaulted — flag if any is wrong

1. **Only supervisor/admin/WSO can edit the start-of-OJT date.** Employees see
   read-only progress. Rationale: the start date sets the deadline, so
   self-service editing would let a trainee move their own deadline — a control
   failure — and it matches the existing permission model on
   `employee_training_records`. Reversible in one policy change if you want
   employees to propose a date for supervisor approval.
2. **Band boundaries inclusive at the top**: `≤ 0.4` green, `> 0.4 … ≤ 1` amber,
   `> 1` red.
3. **Fractional months resolve to `round(frac × 30)` days**, fixing the sheet's
   sub-month deadline bug (affects only 10-hour cycles).
4. **`hours_left` floors at 0**, so over-performing shows `HOURS_COMPLETE`
   rather than a negative figure.
5. **The GM condition uses strict `days_left < 15`** and requires `ratio > 1`;
   it does not fire on rows already past deadline (those are `DEADLINE_PASSED`
   and need a different conversation).
6. **"Prompt them" = in-app banner** on both panels. Push/email notification is
   Phase 5, not built now.
7. **New page rather than a tab** on the existing Trainee Details page, as
   requested — the two track different things.

---

## 10. File manifest

```
supabase/migrations/
  20260811100000_employee_ojt_progress.sql      table, RLS, indexes
  20260811110000_ojt_sync_cron.sql              sync_jobs, 2 cron jobs, v_use_queue
  20260811120000_ojt_progress_rpcs.sql          resolution + progress views, 2 RPCs
  20260812090000_ojt_not_started_band.sql       NOT_STARTED band (§2.6a)
supabase/functions/
  fetch-ojt-data/index.ts                       twice-daily scrape + join + upsert
  update-ojt-progress/index.ts                  override writes, role-gated
src/domain/ojt/
  progress.ts  types.ts  index.ts
  __tests__/progress.test.ts  __tests__/fixtures.ts
src/hooks/
  useOjtProgress.ts                             supervisor list + sync + update
  useMyOjtProgress.ts                           employee, own rows only
src/pages/supervisor/OjtProgress.tsx            list + card + edit dialog
src/pages/employee/OjtProgress.tsx              own progress
modified: src/App.tsx · src/components/AppSidebar.tsx
          src/pages/admin/AdminSettings.tsx · src/pages/employee/EmployeeDashboard.tsx
```

Pre-deploy, per `CLAUDE.md`: `npm run lint` → `npx tsc --noEmit` → `npm run build`
→ `npm run preview` smoke test.

---

## 11. Implementation notes

Three departures from the plan above, all made while building:

1. **Derived values live in views, not generated columns** (§3.3). Postgres
   generated columns must be `IMMUTABLE` and cannot reference other generated
   columns, which rules out `deadline` (it depends on the resolved start date,
   itself a `CASE` over two columns). `v_ojt_progress` computes everything
   instead. Same results, far less machinery, and `ojt_today()` can be `STABLE`.

2. **SQL↔TS parity is a psql script, not a vitest case** (§5.1). Checking the
   real view requires a live database, and adding a Postgres client to the test
   suite for it was not worth the dependency. `sql/ojt_parity_check.sql` loads
   the same 132 golden fixtures, pins `ojt_today()`, diffs the view against the
   TypeScript engine's expected output, and rolls back. Fixture rows use a
   `PARITY-` emp-id prefix, so no real row is read or written:

   ```bash
   psql "$DATABASE_URL" -f sql/ojt_parity_check.sql
   ```

   Regenerate it whenever `src/domain/ojt/__tests__/fixtures.ts` is regenerated.

3. **`get_ojt_progress_records()` also returns the raw `override_*` values.**
   The edit dialog seeds its fields strictly from the override side, because a
   blank field means "follow the sheet". Without the raw values it could not
   distinguish "follows the sheet" from "overridden to the same number", and
   simply reopening a record and pressing Save would have converted every field
   into a silent override.

4. **The ingestion parsers live in `fetch-ojt-data/parse.ts`, not in `index.ts`.**
   `index.ts` cannot be imported outside Deno because it calls `Deno.serve` at
   module scope, which left the parsing — the least-proven part of the system —
   untestable. The pure helpers now sit in a sibling module (edge functions
   deploy multi-file without ceremony), and `vitest.config.ts` includes
   `supabase/functions/**/*.test.ts` so the Apps Script contract is covered.

### Verified

- `npm test` — 131 pass, of which 41 are OJT (27 engine, 14 ingestion).
- The Apps Script payload contract is tested end to end: all 132 rows survive
  `Apps Script shape → extractArray → parseExtractedRow / parseOjtRow` with
  values identical to the golden fixtures, and the join leaves nothing over.
- Golden fixtures: the engine reproduces the spreadsheet's own Deadline and
  Days-left columns on **131 of 132 rows**, the exception being the
  sub-month deadline the sheet places before its own start date (§2.2).
- `sql/ojt_parity_check.sql` — **OJT PARITY OK (132 rows)**: the view and the
  TypeScript engine agree on deadline, days left, hours left, band and the GM
  flag for every row.
- Precedence: PIN holds even when the sheet syncs after the app edit; LWW
  resolves per field in both directions; a pinned start date moves the deadline
  and the band with it.
- Both migrations apply cleanly and are safe to re-apply.
- `npx tsc --noEmit` clean; `npm run build` succeeds; the new code adds no lint
  errors (the repo's 639 pre-existing ones are unchanged).

### Verified against the deployed Apps Script

The live web app was fetched and its payload run through the real `parse.ts`:

- 131 extracted rows and 132 OJT rows, **all parsing**, no duplicate
  `(emp_id, unit)` keys, and every matched row carrying a start date.
- Hours arrive as decimals (`86.25`), dates as ISO — the script's duration and
  date handling works on the real cells.
- **Zero value drift** against the CSV export the golden fixtures were built
  from, and the same three GM (ATM) escalations.
- One row (`10023136 | PLR`) is present on the OJT tab but absent from Extracted
  Data. Rows like this have a start date but no hours requirement, so there is
  nothing to track and they are not imported. `fetch-ojt-data` now counts them
  as `ojt_only` and the supervisor page raises a separate warning toast listing
  the keys — otherwise a trainee deleted from one tab only would vanish from the
  app with no explanation.

### Not yet verified — needs a real environment

- The cron migration was not executed locally (it needs `pg_cron`). Confirm both
  jobs appear healthy in Admin → Cron Jobs after the first scheduled run, and
  confirm the database's timezone is UTC (`SHOW timezone;`) — the 07:30/13:30
  schedules assume it.
- `fetch-ojt-data` has not written to a real database. The parsing and joining
  are proven against live JSON; the upsert and archive paths are not.
