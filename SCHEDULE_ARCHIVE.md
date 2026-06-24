# Schedule archiving → audit-log Google Sheet

Keeps `employee_schedules` to a rolling **2 months** in Supabase. Everything older
is shipped to your existing **audit-log Google Sheet** (the one behind
`app_settings.supervisor_audit_log_webapp_url`) and then deleted from the DB.
Archived months are retrievable on demand via an API link.

## Pieces

| Piece | File | Role |
|---|---|---|
| Archiver (write) | `supabase/functions/archive-schedules/index.ts` | Pages old rows → POSTs to the audit-log sheet → deletes from DB (confirm-before-delete). |
| Monthly cron | `supabase/migrations/20260622110000_schedule_archive_cron.sql` | Queues the archiver on the **1st of each month** (02:00 UTC = 07:30 IST). |
| Retrieval (read) | `api/schedule-archive.ts` | `GET /api/schedule-archive?...` → reads rows back from the sheet. |
| Sheet script | *(you paste — see below)* | `doPost` appends archived rows; `doGet` serves them back. |

**Window:** keeps current + previous calendar month + **all future dates**
(future rosters are never archived). Tune via the `monthsToKeep` payload (default 2).

## Step 1 — Add the script to your audit-log sheet

Open the audit-log spreadsheet → **Extensions → Apps Script**. You already have a
`doPost` that handles `type: "audit_log"`. Add a `schedule_archive` branch to it,
add a `doGet`, and the helpers below. (If you have no `doGet` yet, paste it whole;
if you do, merge the `schedule_archive` branch in.)

```javascript
// ── In your existing doPost(e), add this branch before your audit_log handling ──
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.type === 'schedule_archive') return handleScheduleArchive_(body);

    // … your existing audit_log handling stays here …

    return jsonOut_({ status: 'success' });
  } catch (err) {
    return jsonOut_({ status: 'error', message: String(err) });
  }
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.type === 'schedule_archive') return getScheduleArchive_(p);
  return jsonOut_({ status: 'error', message: 'unknown type' });
}

// ── Append archived schedule rows to a "Schedule Archive" tab ──
function handleScheduleArchive_(body) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Schedule Archive');
  if (!sh) {
    sh = ss.insertSheet('Schedule Archive');
    sh.appendRow(['employee_code', 'employee_name', 'duty_date', 'duty_code', 'duty_description', 'archived_at']);
  }
  var rows = body.rows || [];
  if (!rows.length) return jsonOut_({ status: 'success', appended: 0 });
  var values = rows.map(function (r) {
    return [
      "'" + r.employee_code,            // leading quote keeps codes/dates as text
      r.employee_name,
      "'" + r.duty_date,
      r.duty_code,
      r.duty_description,
      body.archivedAt || new Date().toISOString()
    ];
  });
  sh.getRange(sh.getLastRow() + 1, 1, values.length, 6).setValues(values);
  return jsonOut_({ status: 'success', appended: values.length });
}

// ── Serve archived rows back, filtered by from/to/employee, de-duplicated ──
function getScheduleArchive_(p) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Schedule Archive');
  if (!sh || sh.getLastRow() < 2) return jsonOut_({ status: 'success', data: [] });

  var values = sh.getDataRange().getValues();
  values.shift(); // drop header
  var from = p.from || '0000-00-00';
  var to = p.to || '9999-99-99';
  var emp = p.employee || '';

  var byKey = {}; // dedupe: last archived_at wins for a given employee+date
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var code = String(row[0]).replace(/^'/, '');
    var date = fmtDate_(row[2]);
    if (date < from || date > to) continue;
    if (emp && code !== emp) continue;
    byKey[code + '|' + date] = {
      employee_code: code,
      employee_name: row[1],
      duty_date: date,
      duty_code: row[3],
      duty_description: row[4],
      archived_at: row[5]
    };
  }
  return jsonOut_({ status: 'success', data: Object.keys(byKey).map(function (k) { return byKey[k]; }) });
}

function fmtDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v).replace(/^'/, '').slice(0, 10);
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
```

Then **Deploy → Manage deployments → Edit → New version** (so the web app picks up
the new code) with access **"Anyone"** (same as the existing audit-log deployment).
Confirm `app_settings.supervisor_audit_log_webapp_url` holds that `…/exec` URL.

## Step 2 — Deploy the app pieces

```sh
cd shift-atco
supabase functions deploy archive-schedules          # the archiver
supabase db push                                     # registers the monthly cron
# api/schedule-archive.ts deploys automatically with the next Vercel deploy
```

## Step 3 — Backfill now (optional, instead of waiting for the 1st)

Queue an immediate run (drains on the next `process-cron-queue` tick):

```sql
INSERT INTO public.cron_job_queue (job_name, edge_function_name, payload, triggered_by, priority)
VALUES ('archive-schedules-monthly', 'archive-schedules',
        jsonb_build_object('__cron_job_name','archive-schedules-monthly','monthsToKeep',2),
        'manual', 10);
```

Then `VACUUM (FULL, ANALYZE) public.employee_schedules;` to reclaim the freed disk.

## Retrieving archived data (the "API link")

```
GET /api/schedule-archive?month=2026-01
GET /api/schedule-archive?from=2025-12-01&to=2026-02-28
GET /api/schedule-archive?month=2026-01&employee=EMP001
```

Requires a logged-in user (same `Authorization: Bearer <token>` as other `/api`
routes). Returns `{ rows: [...], count, from, to }`. Build a small admin "View
archived schedules" screen against this, or just hit the URL with a token.

## Notes

- **Confirm-before-delete:** rows are deleted from the DB only after the sheet
  confirms the append, so a mid-run failure never loses data — it resumes next run.
  The only edge case (append succeeds, delete fails) makes a duplicate in the sheet,
  which `getScheduleArchive_` de-duplicates on read.
- **Re-sync safety:** `fetch-schedule` upserts whatever the source returns. If your
  source sheet starts returning months older than the cutoff again, they'll be
  re-added and re-archived on the next 1st. If that ever produces churn, add a
  `duty_date >= cutoff` filter in `fetch-schedule` before the upsert and it stops.
- Change retention by editing `monthsToKeep` in the cron payload (migration) or the
  default in `archive-schedules/index.ts`.
```
