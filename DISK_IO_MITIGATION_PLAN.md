# Supabase Disk IO budget — why it runs out, and the plan

Written 2026-10-21 from the code in this repo. I could not query production from
here, so every finding below is backed by code, and each one names the query in
[`sql/disk_io_diagnostics.sql`](sql/disk_io_diagnostics.sql) that confirms or
rules it out. **Run Phase 0 first**: it decides which later phases are worth it.

## What the budget is

The project is on the free plan (see `STORAGE_RECLAMATION.md`), so it runs on
**Nano** compute: 0.5 GB RAM, a disk baseline of 43 Mbps (~5 MB/s) and 250 IOPS,
and burst credits that cover roughly **30 minutes a day** above that. When the
credits run out the disk is throttled to baseline, queries slow, the 8 s API
statement timeout starts firing, and edge functions time out.

Two things spend the credits:

1. **Reads that miss RAM.** With 0.5 GB of RAM, most of it not Postgres's own
   cache, any table or index that has fallen out of memory is re-read from disk.
   The smaller the working set, the fewer reads go to disk.
2. **Writes.** Each one writes the heap tuple, every index entry, the WAL and,
   later, the dirty page. A row on a table with 9 indexes costs about 10 writes.

## Findings, most likely cause first

| # | Finding | Kind | Likely impact | Confirm with |
|---|---|---|---|---|
| 0 | **Production has no `(duty_date, …)` index on `employee_schedules`**: every date read is a full scan | missing index | **High** | `pg_indexes` (found 2026-10-21) |
| 1 | Leave sync failure loop (Oct 15–17) and the 171 MB it left behind | acute + leftover | **High** | §11, §6 |
| 2 | Syncs redo whole datasets on every run, stacked in the same windows | scheduled bursts | **High** | §2, §3, §12 |
| 3 | `employee_schedules` has 9 indexes; 3 are pure duplicates | working set + writes | Medium | §7 |
| 4 | Pollers fire every 1–2 min whether or not there is work | constant background | Medium-low | §9, §14 |
| 5 | Front-end polling (notifications every 30 s, refetch on focus) | read load | Medium-low | §2, §4 |
| 6 | `rosters` has no retention; `api_call_logs` carries 8 indexes | slow growth | Low | §6, §7, §13 |

Ruled out or already fixed: Realtime (unused); the nightly full rewrite of
`employee_schedules` (fixed 2026-09-20, `sync_employee_schedules` skips unchanged
rows); unbounded `cron.job_run_details` (purged daily since June; §10 confirms
the purge job succeeds); the in-DB archive tables (dropped).

### 0. Every date read of `employee_schedules` is a full table scan

Found on 2026-10-21 by listing production's indexes after the Phase 2 index
migration. `idx_employee_schedules_date_code (duty_date, employee_code)` from
`20260909120000_large_page_read_indexes.sql` does not exist. Neither did the
older `(duty_date)` index, or Phase 2 would have kept it.

Without either, every day or month filter on `duty_date` reads the whole table
and sorts it. The partial `idx_schedules_date_code` does not serve these
queries (checked with EXPLAIN). The month pages read in keyset pages of 1,000
rows, ordered by `(duty_date, employee_code)`, so one month-grid load scans the
table about once per page.

Fix: create the index (Phase 1, step 0), then check whether any other
migration never reached production.

### 1. The leave sync failure loop, and its leftovers

`supabase/migrations/20261017100000_leave_sync_commit_timeout.sql` records the
problem. From 2026-10-15, **every** `fetch-leave-data` commit hit the statement
timeout, because a stale-stats nested loop made 47 million comparisons. Each
failed run left its ~9,700 staged rows behind. By 10-17,
`leave_sheet_sync_staging` held **400k rows, 171 MB**: about a third of a
database capped at 500 MB, on a machine with 0.5 GB of RAM.

The queue made it worse. Since 2026-09-29, `cron_job_queue.max_attempts`
defaults to 3 (`20260922120000_fix_cron_queue_health.sql:26`), so every failing
leave sync ran three times, re-staging and re-timing-out each time.

The fix is in the repo (commit `b4d7b67`), but two things still need checking:

- **Is it deployed?** Both the migration and the `fetch-leave-data` function have
  to be live (§11).
- **Whether the 171 MB is gone.** If the fix migration ran, it is: it copies
  out the rows it keeps, `TRUNCATE`s the staging table and re-inserts them
  (`20261017100000…sql:407-421`), which frees the file. If the migration has not
  run, the bloat is still there, and the `ANALYZE` the fix adds to every commit
  (`:100`) would read the whole file on each leave sync until it is compacted.
  §11 shows the size either way.

### 2. Syncs that redo everything, every run, at the same time

None of the scheduled syncs check whether the source changed, and the queue runs
them back to back in the same few windows (UTC):

| Window (UTC) | What runs |
|---|---|
| 10:30–10:35 | `working-hours-cache-16h`, `roster-night-16h`, `schedule-sync-16h` |
| 12:10–12:35 | `ba-test-fetch-1740`, `working-hours-cache-18h`, `roster-morning-18h`, `schedule-sync-18h`, `leave-sync-18h`, `ba-test-fetch-1805` |
| 14:30–14:35 | `working-hours-cache-20h`, `roster-morning-20h`, `roster-night-20h`, `schedule-sync-20h` |
| 17:30–17:55 | training, ELPA, medical, rating, `leave-sync-daily`, EL, `roster-*-23h` |
| every hour | one of the 22 `sync-roster` runs |

What each one costs:

- **`fetch-schedule` (3×/day)**: sends every row in the feed through
  `INSERT … ON CONFLICT`. The no-op `WHERE` skips the write, but Postgres still
  has to probe the unique index and fetch the heap row for every one, so each run
  **reads the whole table and its unique index**, changed or not.
- **`refresh-working-hours` (3×/day)**: `refresh_working_hours_cache` calls
  `get_working_hours_summary()` **twice per month**
  (`20260430_working_hours_duty_rules_update.sql:308` and `:349`), for 2 months,
  so 4 aggregations over a ~90-day window of `employee_schedules` per run. The
  window functions and `jsonb_agg` probably spill to temp files with Nano's small
  `work_mem`. It also rewrites every cache row, including the large
  `daily_schedule` JSONB, because `computed_at` changes each time (`:339`).
  **There is an ordering bug as well:** the refresh is scheduled at :30 and the
  schedule sync at :32, so the queue runs the refresh first and the cache is always
  one sync behind.
- **`sync-roster` (22×/day)**: a plain PostgREST `.upsert()`
  (`supabase/functions/sync-roster/index.ts:440`) rewrites every fetched row and
  every index on `rosters` (at least 5) on every run, even when nothing changed. This is the same
  problem `employee_schedules` had before 2026-09-20.
- **Daily HR syncs** (training, ELPA, medical, rating, EL, OJT, trainee ×2, ATCO
  master, employee data): each does an unconditional `.upsert()` of every row.
  The tables are small, so this is minor, but it is the same pattern.

### 3. `employee_schedules` carries 9 indexes, 3 of them duplicates

| Index | Columns | Status |
|---|---|---|
| PK | `id` | needed |
| `UNIQUE` constraint | `(employee_code, duty_date)` | needed (the `ON CONFLICT` target) |
| `idx_employee_schedules_code_date` | `(employee_code, duty_date)` | **duplicate of the UNIQUE** |
| `idx_schedules_emp_date_range` | `(employee_code, duty_date)` | **duplicate of the UNIQUE** |
| `idx_employee_schedules_duty_date` | `(duty_date)` | **redundant**: prefix of `idx_employee_schedules_date_code` |
| `idx_employee_schedules_date_code` | `(duty_date, employee_code)` | needed (keyset paging) |
| `idx_schedules_date_code` | `(duty_date, duty_code) WHERE duty_code IS NOT NULL` | check `idx_scan`; the predicate is always true (column is `NOT NULL`) |
| `idx_employee_schedules_employee_name_trgm` | GIN trigram | check `idx_scan` |
| `idx_employee_schedules_employee_code_trgm` | GIN trigram | check `idx_scan` |

Every new or changed row writes all 9 indexes. GIN trigram indexes are the most
expensive kind to maintain, and the only query that can use them is the
`%search%` box on `SupervisorDashboard.tsx:305`. The duplicates also take cache
memory the hot data needs.

### 4. Pollers that fire whether or not there is work

- `process-cron-queue` runs **every minute** (1,440/day). Even when idle, each
  firing writes a `cron.job_run_details` row, a pg_net request and response, and
  a `sync_jobs` heartbeat (`process-cron-queue/index.ts:55`).
- `process-notification-queue` runs **every 2 minutes** (720/day). Even when idle
  it inserts an `api_call_logs` row (8 indexes) and updates `sync_jobs`
  (`process-notification-queue/index.ts:220` → `_shared/logger.ts:232`).

That is ~2,160 HTTP round trips and roughly 10,000 small committed writes a day,
almost all of which find nothing to do. Each write is cheap, but the stream never
stops, and each WAL write is a synchronous disk flush.

### 5. Front-end polling

- `useUnreadCount` every 30 s and `useNotifications` every 60 s
  (`src/hooks/useNotifications.ts:38`, `:57`). That is 3 queries a minute for
  every signed-in user with the app in the foreground (TanStack pauses them in
  background tabs), for data that already arrives by web push.
- Every schedule query refetches every 5 minutes **and on every window focus**
  (`src/lib/scheduleQueryConfig.ts:16`, `:21`). On the PWA, switching back to the
  app counts as a focus. Schedules change about 3 times a day.
- The admin Cron Jobs page fires 4 queries every 15–30 s (`CronJobs.tsx:530–569`).
  One of them, `get_cron_job_health()`, sorts all of `cron.job_run_details` and
  every error row in `api_call_logs` on each call.

These are cheap while the data is cached. They get expensive when findings 1–3
have pushed it out of memory.

### 6. Slow growth

`rosters` is written 22 times a day, and nothing ever deletes old dates from it.
`api_call_logs` has 8 indexes for a log table. Some of them (`trace_id`,
`user_id`, `endpoint`) are probably unused; §7 will show.

---

## The plan

### Phase 0 — Measure (30 min, no code)

1. Run `sql/disk_io_diagnostics.sql` blocks 0–14 and save the output.
2. In **Dashboard → Reports → Database**, open the *Disk IO % consumed* and
   *Disk throughput* charts and check whether the spikes line up with the UTC
   windows above.
3. Run block 15 (reset stats), wait 24 h, then re-run blocks 1–5. Those give
   per-day numbers and the baseline for measuring every later phase.

**Decision gate:** §2 and §3 name the statements actually spending the budget. If
one of them is not covered below, it becomes the top priority.

### Phase 1 — Same day, no code

0. **Create the missing date index** (finding 0). Run this on its own in the SQL
   Editor; `CONCURRENTLY` blocks neither reads nor writes:
   ```sql
   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_employee_schedules_date_code
     ON public.employee_schedules (duty_date, employee_code);
   ```
   Then compare `supabase_migrations.schema_migrations` with
   `supabase/migrations/` for anything else that never ran.
   `idx_rosters_date_id` comes from the same migration.
1. **Confirm the leave fix is live (§11).** If `commit_fix_applied` is false, run
   `supabase db push` and `supabase functions deploy fetch-leave-data`.
2. **Compact the staging table only if it is still large.** If the fix migration
   ran, its `TRUNCATE` already freed the 171 MB and this step is a no-op. If §11
   still shows tens of MB, run it outside the sync windows (not near 12:35 or
   17:50 UTC):
   ```sql
   VACUUM (FULL, ANALYZE) public.leave_sheet_sync_staging;
   ```
   It takes a brief exclusive lock. For any other table §5/§6 show as bloated,
   remember the lock blocks reads too: never during the day on tables pages read
   (`employee_schedules`, `rosters`, `working_hours_cache`).
3. **Check the cleanup jobs (§10).** If `purge-cron-history` or
   `compact-bg-tables` are failing, fix their permissions or run the one-off
   cleanup from `20260622120000_compact_bg_tables_cron.sql` by hand.

### Phase 2 — Low-risk code changes (implemented 2026-10-21, not yet deployed)

Tests: `scripts/db-tests/queue-pollers/run.sh` runs both migrations against a
local Postgres with pg_cron and pg_net faked, twice to prove they re-run cleanly.

1. **Only call the pollers when there is work.**
   `supabase/migrations/20261021100000_gate_queue_pollers.sql`:
   - Adds two guards, `cron_queue_has_due_work()` and
     `notification_queue_has_due_work()`. The second also returns false while
     an admin has paused email.
   - Appends `WHERE <guard>` to each processor's existing pg_cron command, in
     place, so URLs, keys and timeouts are kept. Latency is unchanged.
   - Rewrites `get_cron_job_health()`. An idle processor reads healthy while
     pg_cron keeps firing it. It is *missed* when pg_cron stops, *stale* when
     due work has waited 15 min (cron queue) or 10 min (notifications), and
     *failed* when the last firing or run failed.
   - Redefines `manage_cron_job()` so switching a processor off and on, or
     changing its time, from the admin page keeps the guard (and
     process-cron-queue's 150 s timeout).
2. **Stop logging idle runs.** `process-notification-queue` no longer writes
   `api_call_logs` or `sync_jobs` when it has nothing to do.
   **Deploy order: apply the migration first.** The old health view would read a
   quiet processor as missed.
3. **Drop the duplicate indexes.**
   `supabase/migrations/20261021110000_drop_duplicate_schedule_indexes.sql` drops
   `idx_employee_schedules_code_date` and `idx_schedules_emp_date_range` (copies
   of the UNIQUE key) and `idx_employee_schedules_duty_date` (a prefix of
   `idx_employee_schedules_date_code`). Each drop is guarded on the index that
   replaces it. It runs with a 5 s lock timeout; run it outside the sync windows.
   Still to decide on §7 numbers:
   - `idx_schedules_date_code` serves the OPE year-to-date ranking and the
     team-leave track. Keep it unless `idx_scan` is 0 over a day those pages
     were used.
   - The two trigram indexes are a **pair**. The dashboard search ORs
     `employee_name` and `employee_code`, and Postgres can only use indexes for
     an OR when both sides have one, so dropping one makes every search a
     sequential scan. Keep both, or drop both and change the query.
4. **Cut front-end polling.**
   - Notification bell:
     - The unread count polls every 5 min (was 30 s), refreshes on window focus,
       and refreshes at once when a web push arrives (`public/sw.js` posts
       `PUSH_RECEIVED`).
     - The list no longer polls (was 60 s). It refetches when the count changes
       or the bell is opened.
     - Users without push (denied permission, iOS outside the installed app,
       admin feedback notifications) see a new notification within 5 min on one
       page, or at once on focus or navigation.
   - Schedule queries keyed under `schedule` (`SCHEDULE_QUERY_OPTIONS`) refresh
     every 15 min, and on focus once 15 min old. Everything that edits a
     schedule now invalidates them:
     - DutyManagement cell saves, duty-exchange approvals, the Availability
       Finder and the Cover Basket did not before.
     - A `duty_change`, `duty_exchange` or `leave_status` push invalidates them
       in the recipient's open app.
     - One person's own schedule goes stale after 2 min, so reopening the app
       shows a supervisor's edit.
   - Queries keyed outside `schedule` (rosters, leave, team profiles, some
     single-day reads) cannot be reached by an edit. They keep the old 60 s /
     5 min timing (`LIVE_QUERY_OPTIONS`).
   - Admin Cron Jobs page: lists every 60 s, the health RPC every 5 min.

### Phase 3 — Make the syncs change-aware (a few days, one function at a time)

1. **`fetch-schedule`: skip when the feed has not changed.** Hash the normalised
   rows (SHA-256) and store the hash, e.g. in a new `sync_jobs.last_source_hash`
   column. If it matches the last run, skip the RPC batches entirely and log
   "unchanged". Accept `force: true` from the admin button. Also drop rows dated
   before the archive cutoff before sending them, so archived months can never be
   re-inserted (§13 shows whether that is happening now).
   **This changes behaviour; decide it first.**
   - Today every run pushes the whole sheet, which reverts any in-app change the
     sheet disagrees with. That covers DutyManagement edits, cover plans,
     `LEAVE` codes written by leave approval, and duty-exchange swaps. Each is
     reverted at the next sync unless the sheet already matches. A feed-hash
     skip would let those changes stand until the sheet next changes.
   - Both dashboard "Fetch schedule" buttons (`useFetchSchedule`) must send
     `force: true`, or a manual click on an unchanged feed does nothing.
   - The unchanged path must still write a success row to `api_call_logs`. The
     Admin Dashboard's "Automatic Schedule Fetch" badge goes to "Needs Check"
     after 26 h without one.
2. **`refresh-working-hours`: run after a change, and only write what changed.**
   - Have `fetch-schedule` enqueue `refresh-working-hours` when `changed > 0`.
     Replace the three fixed :30 runs with that plus one daily safety run. This
     also fixes the ordering bug.
   - In `refresh_working_hours_cache`, compute the summary **once** into a temp
     table and use it for both the upsert and the delete.
   - Add `WHERE … IS DISTINCT FROM` so unchanged rows, and their TOASTed JSONB,
     are not rewritten.
   - Keep "last refreshed" in `sync_jobs.last_run_at` rather than per-row
     `computed_at`. The page's "computed … ago" badge reads `computed_at` from
     the first row of an unordered select, so it must move to the new source.
   - Until this lands, moving the six refresh crons from :30 to :40 is enough to
     fix the ordering: the queue runs jobs in order of `available_at`.
   - App edits never pass through `fetch-schedule`, so a refresh triggered only
     by sync changes would leave them out of the cache for up to a day. Keep a
     trigger for app edits, or a fixed refresh.
   - The Redis copy (`wh:v2:<month>`, 20 min) is never cleared. Today
     **Force Refresh** reloads the Redis copy and shows "Data refreshed" with
     nothing changed. The admin **Clear All Cache** button sends glob patterns
     to `DEL`, which deletes nothing. Clear the keys after each refresh.
   - `refresh-working-hours` returns 200 when a month fails, so the queue never
     retries it.
3. **`sync-roster`: skip unchanged rows.** Move the upsert into an RPC with the
   same `ON CONFLICT … DO UPDATE … WHERE … IS DISTINCT FROM` pattern as
   `sync_employee_schedules`, or hash each `(date, shift, team)` slice and skip
   the ones that match.
4. **Daily HR syncs**: same hash short-circuit. Do these last; they are small.
   Each sync stamps a per-row `*_synced_at`. Employees see `rating_synced_at`
   as "Last Sync", so a skipped run must still record that it checked.
5. **Leave sync: leave it alone** unless Phase 0 points at it. Per `CLAUDE.md`,
   read `docs/leave/SHEET_INDEPENDENCE.md` first. The newest committed run backs
   held-retirement approvals, so skipping runs is not free there.
6. **Spread the windows.** Move a few of the 12:30–12:35 jobs so one window stops
   absorbing four heavy jobs in a row. Leave `ba-test-fetch-1740` and
   `ba-test-fetch-1805` where they are: they run at shift change on purpose, so
   the incoming shift sees a fresh BA list.

### Phase 4 — Size and retention

- **Rosters retention needs a decision.** Purging old rows breaks pages that read
  them:
  - The Comp-Off page turns Closed Holiday duties into comp-offs from `rosters`,
    for whole years (its picker goes back 3 years). With a start-of-month cutoff
    anything under 4 months makes available comp-offs disappear, and anything
    under the year view rewrites past balances.
  - The Daily Availability Chart needs at least the 6 months schedules keep.
  - Duty Marked, the shift roster, the ATC grid, WSO Attendance and Night Channel
    Allocation lose unit/position detail for older dates.

  So: either an archive read path like schedules have, or keep at least a year
  and accept the comp-off history limit. `rosters.date` is TEXT, and a few
  non-ISO values (e.g. `'23'`) sort above every ISO date, so a `date < cutoff`
  delete never removes them.
- `api_call_logs`: drop the indexes with 0 scans, and consider 14-day retention
  instead of 30 in `purge_old_data`.

### Phase 5 — If it still runs out

If the budget is still exhausted after Phases 1–3 and the §1 cache hit ratio is
still poor, the working set no longer fits in 0.5 GB. The remaining lever is a
paid compute size, which raises both RAM and the IO baseline. Check the current
figures on Supabase's *Compute and Disk* page before choosing.

## How to tell it worked

- *Disk IO % consumed* stays well below 100% through the 12:30 and 17:30 UTC
  windows.
- Cache hit ratio (§1) at 99% or above.
- Per-day `shared_blks_read` and `temp_blks_written` (§2, §3) down against the
  Phase 0 baseline.
- `api_call_logs` stops gaining ~720 "No pending jobs" rows a day (§14).

## Order of work and risk

| Step | Effort | Risk | Notes |
|---|---|---|---|
| Phase 0 | 30 min | none | read-only |
| Phase 1 | 30 min | low | `VACUUM FULL` takes a brief exclusive lock; run it off-window |
| Phase 2.1–2.2 | ½ day | low | health-view rule must change in the same migration |
| Phase 2.3 | 1 h | low | check `idx_scan` first; the UNIQUE constraint stays |
| Phase 2.4 | 1 h | low | front-end only |
| Phase 3.1–3.2 | 1–2 days | medium | `force` flag keeps a manual full sync available |
| Phase 3.3–3.4 | 1–2 days | medium | per-function, verify with §12 |
| Phase 4 | ½ day | low–medium | rosters retention depends on which pages read old data |
