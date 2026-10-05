# Leave register & sheet — runbook

Procedures for the leave register and the ATTENDANCE workbook. The design
behind them is in [SHEET_INDEPENDENCE.md](SHEET_INDEPENDENCE.md).

Where to look:

- **Admin → Settings → Leave sheet lifecycle.** The live workbook, recent syncs,
  held retirements, closed sheets and the archive.
- **Admin → Cron Jobs.** Health of `leave-sync-*`.
- **Supervisor → Leave Backlog → Send to Google Sheets.** Pushes to the sheet.
- **Supervisor → Leave Discrepancy.** Sheet-vs-app conflicts.

---

## 1. Deploying this change (once)

Order matters. Each step is safe to stop after.

1. **Migrations.** Apply `20261005100000_leave_sheet_sources_and_safe_sync.sql`,
   then `20261005110000_leave_register_on_approval.sql`.
   - Every existing sheet row is tagged `ATTENDANCE-2026`.
   - Every approved app request is written into the register. The migration
     prints `Register: N approved request(s), M row(s) written or linked`.
     **Employees whose approved leave was never typed into the sheet will see
     their CL balance drop to the correct figure.** Tell them before it happens.
   - Until step 2, the old edge function keeps syncing (now guarded) and its
     stale-row purge **fails with an error** instead of deleting. That is
     expected and harmless.
2. **Edge functions.** Deploy `fetch-leave-data` and `sync-leave-records`.
3. **Apps Script writer.** Paste `docs/leave-apps-script/Code.gs` into the
   workbook's Apps Script, then **Deploy → Manage deployments → edit → New
   version**. Do the test copy first.
4. **Vercel.** Deploy the app. `LEAVE_SHEET_WEBAPP_URL` and `LEAVE_SHEET_TOKEN`
   are unchanged.
5. **Verify:**
   - Admin → Cron Jobs → run a leave sync.
   - The lifecycle panel should show a `committed` run with few updates, and no
     held retirement.
   - Leave Backlog → Send to Google Sheets should open on *Changed in the app*,
     listing the employees whose approvals the sheet lacks. Read the preview and
     write it.

```sql
-- The last few syncs
select started_at, status, rows_staged, inserted, updated, retire_status, retired, blocked_reason, error
  from leave_sheet_sync_runs order by started_at desc limit 5;
-- What the one-time register backfill wrote
select * from leave_audit_log where action = 'register_backfill_from_requests';
-- Who is waiting to be sent
select * from leave_sheet_push_queue order by last_queued_at;
```

### Rolling back

- **Code:** redeploying the old edge function or app is safe. The old purge
  cannot delete (the delete guard refuses it), and the old push only fills
  cells through the new `Code.gs`.
- **Database:** the migrations only add tables, columns and triggers, and
  replace function bodies. Leaving them in place with old code is the safe
  rollback. Do not drop `archive_deleted_leave_record` or
  `protect_app_authored_leave_records`; they are what stop data loss.

---

## 2. Clearing backlog and updating the sheet

1. **Leave Backlog.** Record each backlog item as today (`backfill_leave_entry`).
   Every entry queues its employee for the sheet.
2. **Send to Google Sheets.** The dialog previews first; nothing is written yet.
   - *Changed in the app (N)* is the default. *Every employee* re-checks the
     whole register against the sheet; merge makes that safe.
   - **Cells to fill:** empty cells (or `NA`) that will get a value.
   - **Sheet differs:** cells where the sheet already holds something else. They
     will **not** be written. Decide which side is right: fix the sheet by hand,
     or amend the app entry.
   - **Cancelled in the app:** entries to delete from the sheet by hand. A push
     never deletes.
   - **No column on the sheet for …:** categories the sheet cannot hold (EL, …).
     Informational.
3. **Write N cells.** It writes exactly what was previewed.
   - If anyone recorded leave in between, you get "preview again": do that.
   - Rows someone was editing at that moment are skipped and stay queued. Send
     again a minute later.
4. **Check.** The workbook's `APP_WRITE_LOG` tab lists every cell written,
   with before and after. `leave_sheet_push_log` holds the same in the database.
5. **Next sync.** When the sheet's feed returns the value, the register row is
   marked `sheet_confirmed_at`.

To undo a write: take the cell and "Before" value from `APP_WRITE_LOG` and put it
back by hand. The next sync then shows the app's value as "behind" on the sheet
and the employee stays queued.

---

## 3. A sync held a retirement

*Lifecycle panel: "N register rows are missing from the sheet and were kept"*

The latest feed lacks more rows than the breaker allows, or carries far fewer
employees than the last good run. Nothing was removed; new and changed rows
were still applied.

1. Open the workbook. Were those rows really removed on purpose, for example
   duplicate entries cleaned up?
   - **Yes:** press *Review and approve*. The rows move to the archive and can
     each be restored.
   - **No** (the tab was filtered, half-pasted, or the feed timed out): fix the
     sheet or wait. The next good sync clears the warning by itself.
2. To see exactly which rows would go:

```sql
with run as (select id, source_key from leave_sheet_sync_runs
              where status = 'committed' order by started_at desc limit 1)
select r.emp_id, r.leave_category, r.leave_date, r.source_event_type
  from employee_leave_records r, run
 where r.source = 'google_sheets' and r.sheet_source = run.source_key
   and not (coalesce(r.metadata, '{}') ? 'leave_request_id')
   and not (coalesce(r.metadata, '{}') ? 'register_link_request_id')
   and not exists (select 1 from leave_sheet_sync_staging s
                    where s.run_id = run.id and s.emp_id = r.emp_id
                      and s.leave_category = r.leave_category
                      and s.source_event_type = r.source_event_type
                      and s.leave_date = r.leave_date and s.duty_code = r.duty_code)
 order by 1, 3;
```

Thresholds live on the source row: `retire_max_rows` (50), `retire_max_pct` (2)
and `min_employee_ratio` (0.9). Change them with SQL if the defaults prove too
tight.

---

## 4. A sync was rejected or failed

| Message | Meaning | Action |
| --- | --- | --- |
| *The feed looks like a YYYY workbook but the active source … is for …* | The read URL points at another year's workbook | Follow §6. Do not just change the URL. |
| *The feed produced no rows* | Blank tab, broken script or wrong tab name | Check the read feed URL in a browser |
| *Source … is closed* | A run queued before the sheet was closed | Nothing to do |
| *Staging failed … the register is unchanged* | A malformed value in the feed | Read the error; fix the sheet cell |

A rejected or failed run writes **nothing**.

---

## 5. Conflicts (sheet and app disagree)

**Supervisor → Leave Discrepancy**, rows of kind *sheet vs app*: the sheet sent
a different used-date or event kind for a row the app owns or has allocated.

- **Keep app:** the app's value stands. Then correct the sheet, or the conflict
  returns on the next sync.
- **Accept sheet:** the sheet's value is applied; the row stays app-owned.

```sql
select emp_id, leave_category, leave_date, leave_used_on, metadata->'sheet_shadow' as sheet_says
  from employee_leave_records where metadata ? 'sheet_shadow' order by leave_date;
```

---

## 6. Year end: closing the sheet and opening the next

Do this after the last working day of the year, once the new workbook exists.

1. **Final sync.** Admin → Cron Jobs → run the leave sync. Confirm a `committed`
   run with no held retirement.
2. **Final push.** Leave Backlog → Send to Google Sheets → *Changed in the app*.
   Write, then settle any conflicts.
3. **Close.** Admin → Settings → Leave sheet lifecycle → *Close this sheet*.
   Give a reason and type the key.
   - Every row the workbook supplied is now frozen.
   - Its last staged feed is kept as the final snapshot.
   - The push queue is cleared.
4. **Deploy the writer on the new workbook.** Paste `Code.gs`, set a new
   `ACCESS_TOKEN`, deploy. Put the new `/exec` URL and token into Vercel
   (`LEAVE_SHEET_WEBAPP_URL`, `LEAVE_SHEET_TOKEN`) and redeploy.
5. **Read feed.** Deploy the read feed script on the new workbook. Either put
   its URL in the *Read feed URL* field in the next step, or update *Leave Sync
   Webapp URL* in Admin → Settings.
6. **Open the new sheet.** In the panel (no sheet is live), enter the year, e.g.
   2027, and press *Start syncing this workbook*.
7. **First sync.** Run it. Last year's rows are untouched, whatever the new tab
   contains. A carried-over comp-off the clerk marks as taken in the new sheet
   fills in on last year's row.

Closing by mistake? Start syncing the same key again; it reopens.

---

## 7. The sheet is retired for good

Close it (§6 step 3) and do not open another. From then on:

- No sync runs; cron logs *Skipped: no active leave sheet source* as success.
- Send to Google Sheets explains there is no live sheet.
- Approvals, cancellations, backlog clearing and balances work entirely from the
  register.

---

## 8. Restoring a removed row

Admin → Settings → Leave sheet lifecycle → Archive → *Restore*. The row goes
back as an **app-owned** row, so a sheet that still lacks it cannot retire it
again.

```sql
select archive_id, emp_id, leave_category, leave_date, reason, archived_at
  from employee_leave_records_archive
 where restored_at is null
 order by archived_at desc limit 50;
-- then, as an admin (or in the SQL editor):
select restore_archived_leave_record('<archive_id>', 'why');
```

---

## 9. Testing locally

```bash
scripts/db-tests/leave-ledger/run.sh     # migrations + 15 scenario groups on a throwaway PostgreSQL
npx vitest run src/lib/__tests__/leaveSheetWriteback.test.ts src/lib/__tests__/leaveSheetPayload.test.ts
```

Against a copy of the workbook, the CSV round-trip in
[../LEAVE_SHEET_WRITEBACK.md](../LEAVE_SHEET_WRITEBACK.md) §7 still applies. A
correct mapping reports zero changes and zero conflicts.
