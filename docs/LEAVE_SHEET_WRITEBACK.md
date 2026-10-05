# Leave write-back: app → ATTENDANCE-2026 / LEAVE_DATA

The app already **reads** this workbook: an Apps Script web app serves it as JSON
and `supabase/functions/fetch-leave-data` flattens that into
`employee_leave_records`. This document covers the other direction — pushing
leave data from the app back into the tab, at the exact cell each value belongs
in, matched by EMP NO.

The pieces:

| File | What it is |
| --- | --- |
| [`docs/leave-apps-script/Code.gs`](leave-apps-script/Code.gs) | The receiver. Deploy on the workbook as a web app. |
| [`lib/leaveSheetPayload.ts`](../lib/leaveSheetPayload.ts) | `employee_leave_records` → sheet payload. The inverse of `fetch-leave-data`. |
| [`lib/leave/sheetPush.ts`](../lib/leave/sheetPush.ts) | The endpoint behind the **Send to Google Sheets** button on the Leave Backlog page, served as `/api/leave/sheet-push`. |
| [`scripts/leave-sheet-push.ts`](../scripts/leave-sheet-push.ts) | CLI sender, for the CSV round-trip and for pushing without the UI. |

Both senders build their payload with the same module, so the button and the CLI
cannot disagree about where a row belongs.

> **Since migrations 20261005\*:**
>
> - Merge is **additive**: it fills empty cells and reports every other
>   difference as a conflict; it never clears or overwrites anything (§4).
> - The app sends only what changed in the app, writes exactly what it
>   previewed, and records every write (§5b).
> - The architecture behind this is in
>   [leave/SHEET_INDEPENDENCE.md](leave/SHEET_INDEPENDENCE.md), and the
>   procedures in [leave/RUNBOOK.md](leave/RUNBOOK.md).

---

## 1. The tab, column by column

169 columns, three header rows, 391 employees in rows 4–394. Row 1 carries
merged banners, row 2 the column labels, row 3 a second label row the sheet's own
helper formulas use.

**The script does not hard-code any of this.** It reads rows 1–2 and derives the
map every run, so a closed holiday added next year — which shifts everything to
its right — needs no code change. The letters below are what it resolves *today*;
`?action=layout` prints what it resolves on any given copy.

### Identity — columns A–D, never written

| Column | Field |
| --- | --- |
| A | SL No. |
| **B** | **EMP NO** — the match key |
| **C** | **NAME** — confirmation only |
| D | DESIG. |

EMP NO is the key because all 391 codes are distinct, while two employees are
both called RAJKUMAR. A row is only written when EMP NO matches; if the payload's
name disagrees with column C the employee is **skipped** and reported, unless the
request sets `allowNameMismatch: true`.

### Banner 1 — "CL, RH & NH", columns F–AB

| Columns | Header | Holds | Payload section |
| --- | --- | --- | --- |
| F–Q | `C/L1` … `C/L12` | Date of each casual leave, left-packed | `casualLeave` |
| R–U | `1/2 CL` ×4 | Date of each half-day CL | `halfCasualLeave` |
| V / W | `R/H1` + `C-OFF` | RH date declared / date the day off was taken | `restrictedHolidays[0]` |
| X / Y | `R/H2` + `C-OFF` | same, second RH | `restrictedHolidays[1]` |
| Z, AA, AB | `26-Jan-2026`, `15-Aug-2026`, `2-Oct-2026` | `NH` marker | `nationalHolidays` |

Both R/H columns can carry the **same** RH date — an employee who declared 1-Jan
twice and took the days off on 26-Mar and 27-Mar. The writer fills each slot
once, so a repeated date lands in the second slot rather than overwriting the
first.

### Banners 2–5 — 45 `(duty, comp-off)` column pairs, AC–DN

Every remaining writable column belongs to a pair: the **left** column records
what was worked, the **right** column the date the comp-off was taken.

| Banner | Columns | Pairs | Addressed by |
| --- | --- | --- | --- |
| C-OFF FOR DUTY PERFORMED IN CLOSED HOLIDAYS | AC–BF | 15 | The CH date in the header |
| LAST YEAR C-OFF | BG–BR | 6 (3 dated + 3 spare) | The CH date, else the first free spare |
| C-OFF FOR DUTY PERFORMED AGAINST OPE | BS–DH | 21 | Position, except two reserved slots |
| OPE (from previous station) | DI–DN | 3 | Position |

**Closed holidays (AC–BF)** — one pair per holiday, keyed by date:

| CH | Duty | Comp-off | | CH | Duty | Comp-off |
| --- | --- | --- | --- | --- | --- | --- |
| 23-Jan-2026 | AC | AD | | 26-Jun-2026 | AS | AT |
| 04-Mar-2026 | AE | AF | | 26-Aug-2026 | AU | AV |
| 21-Mar-2026 | AG | AH | | 19-Oct-2026 | AW | AX |
| 31-Mar-2026 | AI | AJ | | 20-Oct-2026 | AY | AZ |
| 03-Apr-2026 | AK | AL | | 08-Nov-2026 | BA | BB |
| 14-Apr-2026 | AM | AN | | 24-Nov-2026 | BC | BD |
| 01-May-2026 | AO | AP | | 25-Dec-2026 | BE | BF |
| 28-May-2026 | AQ | AR | | | | |

**Last year (BG–BR)** — 20-Oct-2025 → BG/BH, 05-Nov-2025 → BI/BJ,
25-Dec-2025 → BK/BL, then three undated spare pairs BM/BN, BO/BP, BQ/BR.

**OPE (BS–DH)** — 21 pairs. The duty date goes in the *left* column, so these are
filled in order, **except** two reserved slots that must be named:

- `CG`/`CH` — labelled **ELECTION** (232 employees hold `29 Apr` here)
- `CK`/`CL` — labelled **ELECTION2**

Send `{"slot": "ELECTION", …}` to target one. An item with no `slot` — or with
`"slot": "OPE"` — takes the next free generic column and never lands in a
reserved one. A `slot` naming something the sheet does not have is reported and
skipped rather than quietly reassigned.

### Never written

| Columns | What |
| --- | --- |
| A–E | Identity + spacer |
| DO–DR | `CL` / `RH` / `C-OFFs` / `OPE C-Offs` — computed balances |
| DS–DT | Filter assistant |
| DU–FM | 45 helper columns, one per pair, showing the pending comp-off date or `NA` |

The writable region resolves to **F:DN**. Anything outside it is refused, and any
cell holding a formula is refused wherever it sits.

---

## 2. What the cells actually contain

The duty column is not free text and not always a date:

| Value | Meaning |
| --- | --- |
| `M` `A` `N` `NO` `G` `M+A` `NO+N` | Duty worked on the holiday — earns a comp-off. Matches `COMP_OFF_ELIGIBLE_DUTY_CODES` in `src/domain/leave/constants.ts`. |
| `CH` | Took the closed holiday off — earns nothing |
| `L` | On leave that day (the comp-off column then reads `CH`) |
| `CO` | Was on a comp-off that day |
| `T` | Training |
| `NA` | Holiday has not happened yet |
| a date | OPE blocks only — the OPE duty date itself |

The comp-off column holds a date, or `CH`, or blank. Legacy rows hold partial
text like `29 Apr`, `27 Jan`, `30 Dec 25`. The writer treats a partial entry as
equal to the same day-and-month, so a sync sending `2026-04-29` against a cell
reading `29 Apr` reports **no change** rather than rewriting several hundred
cells that are not wrong. Text is written through verbatim, so nothing the sheet
already holds becomes unrepresentable.

---

## 3. Payload

`POST` JSON to the `/exec` URL. Field names match the read feed the app already
consumes, plus snake_case aliases.

```json
{
  "token": "<ACCESS_TOKEN>",
  "mode": "merge",
  "dryRun": true,
  "sheet": "LEAVE_DATA",
  "allowNameMismatch": false,
  "employees": [
    {
      "employee": { "empId": "10014941", "name": "SUMAN CHANDRA HALDER" },

      "casualLeave":       ["2026-03-02", "2026-05-13"],
      "halfCasualLeave":   ["2026-04-08"],
      "restrictedHolidays":[{ "date": "2026-03-03", "leaveApplied": "2026-03-03" }],
      "nationalHolidays":  [{ "date": "2026-01-26", "mark": "NH" }],

      "closedHolidays":    [{ "date": "2026-05-28", "dutyPerformed": "N",  "leaveApplied": "2026-08-20" }],
      "lastYearCompOff":   [{ "date": "2025-10-20", "dutyPerformed": "A",  "leaveApplied": "2026-01-19" }],
      "opeDuty":           [{ "opeDutyDate": "2025-12-03", "leaveApplied": "2026-02-26" },
                            { "opeDutyDate": "2026-04-29", "leaveApplied": "2026-06-21", "slot": "ELECTION" }],
      "opePreviousStation":[{ "opeDutyDate": "2026-07-15", "leaveApplied": "" }]
    }
  ]
}
```

Optional request fields:

| Field | Effect |
| --- | --- |
| `expectedYear` | Refuse, before reading or writing anything, if the workbook's name carries a different year. The app always sends the live source's year. |
| `requestId`, `actor` | Recorded against every written cell in the `APP_WRITE_LOG` tab. |

Notes:

- **Only the sections you send are touched.** Omit `closedHolidays` and the whole
  CH block is left exactly as it is.
- **A missing or blank value is left alone in merge mode.** The app's payload
  omits values it does not have rather than sending `""`.
- Dates are written as real dates, in `d-mmm-yyyy` format, so the read feed and
  the sheet's own formulas keep working. ISO, `2-Mar-2026` and `02/03/2026` are
  all accepted on the way in.
- `nationalHolidays` also accepts a bare `["2026-01-26"]`; the mark defaults to `NH`.
- `closedHolidays` / `lastYearCompOff` accept `slotIndex` to target a specific
  pair, which is how the undated spare columns are reachable.
- `dateOrDutyPerformed` is accepted as an alias for `dutyPerformed`, matching the
  legacy read payload.

### Response

```json
{
  "ok": true, "dryRun": true, "mode": "merge",
  "spreadsheet": "ATTENDANCE-2026", "sheet": "LEAVE_DATA", "requestId": "…",
  "employees": { "received": 391, "matched": 391, "changed": 2, "unmatched": 0 },
  "cellsChanged": 3, "conflicts": 1, "concurrentEdits": 0, "writeLogError": null,
  "results": [
    { "empId": "10012524", "name": "SANDIP BASU", "row": 6, "cellsChanged": 1,
      "changes": [{ "cell": "H6", "section": "casualLeave", "from": "", "to": "2026-07-01" }],
      "conflicts": [{ "cell": "AB6", "section": "closedHolidays", "sheet": "2026-04-01", "app": "2026-04-09" }],
      "warnings": [] }
  ],
  "unmatched": []
}
```

`changes` is the row's **net** before/after, so a `replace` that clears a section
and writes it straight back reports nothing. `conflicts` are cells merge left
alone because the sheet already holds something different.

A result with `"concurrentEdit": true` was not written: someone changed that row
between the writer reading it and writing it.

---

## 4. Modes

**`merge`** (default, and the only mode the app uses). **Additive**:

- It fills a cell that is empty, or that holds the `NA` placeholder of a holiday
  that has not happened yet.
- It never clears a cell.
- It never overwrites a cell holding a different value. That cell is listed
  under `conflicts` and left as the sheet has it.

How each section is filled:

- List sections (CL, half-CL): dates already present are recognised and skipped;
  new ones go into the first free column.
- Keyed sections (NH, CH, last year): the slots you send are filled. Everything
  else is untouched.
  - A last-year entry with no dated column goes to the **spare pair already
    holding its duty date**, otherwise to a free spare.
  - A spare pair's duty cell always carries the duty date.
- OPE: a duty date already somewhere in the block fills that pair's comp-off;
  otherwise it takes the next free generic column.

**`replace`** — same, but a section you *do* send is first emptied:

- CL / half-CL / RH: cleared, then rewritten in payload order, so gaps close up.
- NH / CH / last year / OPE: slots the payload does **not** mention are cleared.

⚠️ `replace` on `closedHolidays` blanks the duty column for every holiday the
payload omits — including the `NA` and `CH` markers, which come from the roster
and not from `employee_leave_records`. Use `merge` for CH unless you are
deliberately rebuilding the block.

## 5. Guards

| Guard | Behaviour |
| --- | --- |
| `dryRun: true` | Full diff, nothing written |
| Writable region | Only F:DN; anything else is refused and reported |
| Formula cells | Never overwritten, wherever they are; list writers route around them |
| Formula preservation | Row block writes put formulas back as formulas, never as their computed value |
| EMP NO | Must exist on the tab; unknown codes are reported, not created |
| NAME | Must match column C, or the row is skipped |
| Capacity | 13th CL, 3rd RH, 46th comp-off pair → warning, not an overflow into the next column |
| `LockService` | One writer at a time |
| `ACCESS_TOKEN` | POST is refused outright when it is unset |
| Merge is additive | Never clears, never overwrites a different value — reports `conflicts` |
| Concurrent edits | Each changed row is re-read just before the write; a row edited in between is skipped and reported |
| `expectedYear` | A workbook named for another year is refused before anything is touched |
| `APP_WRITE_LOG` tab | Every committed cell, with time, request, actor, before and after |

---

## 5b. Sending from the app

**Leave Backlog → Send to Google Sheets.** It previews first: the dialog shows
employees matched, rows affected, cells to fill, cells where the sheet differs,
leave cancelled in the app that the clerk must remove by hand, and every
individual cell diff. It writes nothing until you press the write button. The
same preview-then-commit shape as the balance recompute on Employee Management.

- **What is sent.** By default, only employees with app changes the sheet has
  not been sent (`leave_sheet_push_queue`, fed by triggers on the register).
  *Every employee* re-checks the whole register.
- **What is written.** Exactly what was previewed. The preview returns a
  fingerprint of the payload, and the write is refused if the register changed
  since.
- **Which workbook.** The year is always the live leave sheet source's
  (`leave_sheet_sources`). A closed sheet is never written to, and `replace` is
  refused.
- **Record.** Every write lands in `leave_sheet_push_log`. An employee leaves
  the queue only once written with no conflicts.

It goes through `api/leave-sheet-push.ts` rather than calling Apps Script from
the browser, for two reasons. The write token must never reach the client — an
`/exec` URL plus its token is a write handle on the whole register, and
`app_settings` (where the read-feed URL lives) is client-readable, so the token
cannot go there either. And Apps Script `/exec` redirects in a way a browser
cannot follow for a cross-origin POST regardless.

Set these in **Vercel → Settings → Environment Variables**:

| Variable | Value |
| --- | --- |
| `LEAVE_SHEET_WEBAPP_URL` | the Apps Script `/exec` URL |
| `LEAVE_SHEET_TOKEN` | its `ACCESS_TOKEN` |
| `LEAVE_SHEET_TAB` | optional; the tab name if it is not `LEAVE_DATA` |

Point them at the **copy** while you are testing, and swap to the real workbook
when you are ready. The endpoint requires an approved `supervisor` or `admin` in
`user_roles` — the same rule as `can_manage_leave_backfill()` — and defaults to a
dry run, so writing takes an explicit `dryRun: false`.

## 6. Deploy

1. Open the workbook → **Extensions → Apps Script**.
2. Paste [`docs/leave-apps-script/Code.gs`](leave-apps-script/Code.gs) in.
3. Set `ACCESS_TOKEN` to a long random string. **Do not skip this** — an
   unauthenticated `/exec` URL is a public write handle on the leave register.
   The read-only feeds get away without one; this does not.
4. **Deploy → New deployment → Web app**, "Execute as: Me", "Who has access:
   Anyone with the link". Copy the `/exec` URL.

Re-deploy (**Deploy → Manage deployments → edit → New version**) after any code
change; the old version keeps serving until you do.

**If the tab is not called `LEAVE_DATA`.** A copy made by pasting into a fresh
workbook ends up with the tab still named `Sheet1`. The script says so rather
than guessing — `Sheet 'LEAVE_DATA' not found. Tabs present: Sheet1`. Either
rename the tab or pass the name: `?action=layout&sheet=Sheet1` on a GET,
`"sheet": "Sheet1"` in a POST, `--sheet Sheet1` on the CLI.

## 7. Test plan on the copy

Sheet under test:
`https://docs.google.com/spreadsheets/d/1NkMXSlc57a9VEPO_6XgKuy5oLCDpO08R3xHLRJ7FR2M`

**Step 1 — check the map.** Open `?action=layout` (add `&sheet=<tab>` if the tab
was renamed), or run `testLayout()` in the editor. Confirm `writableRange` is
`F:DN`, 15 closed holidays, 6 last-year, 21 OPE with ELECTION at CG and
ELECTION2 at CK, 3 previous-station, and that the CH dates match the headers.
Nothing is written.

Verified against the copy on 22 Aug 2026. The live tab resolves to exactly this
map, and all 391 rows — 9,611 entries — exported through `?action=export` and
written back report **one** changed cell in total: `BZ232`, where the sheet holds
a real date and the CSV had rendered it as `01/10`. See the note below.

**Step 2 — prove idempotency.** Push the CSV export back at the copy as a dry
run. A correct mapping reports **zero changes**:

```bash
npx tsx scripts/leave-sheet-push.ts --url "<exec-url>" --token "<token>" --sheet Sheet1 --from csv --csv "$HOME/Downloads/ATTENDANCE-2026 - LEAVE_DATA.csv"
```

The CSV renders dates as their displayed text, so entries the sheet holds as a
real date come back as `29 Apr` or `15 June`. That is expected and reports no
change — the writer compares a partial entry by day and month.

The one shape it will not match is a bare numeric `dd/mm`, e.g. `01/10`, which is
1 October or 10 January depending on who typed it. Guessing there would be worse
than rewriting it, so a cell like that is normalised to whatever the app sends.
Exactly one cell on the copy is in that state.

Anything non-zero here is a mapping problem — read the `cell` in the diff and
compare it against `?action=layout` before going further.

**Step 3 — write one employee.** Drop `--from csv` for a hand-written payload, or
add `--emp 10012524 --commit` to push a single row, then look at the sheet.

**Step 4 — the real data.** Once the backlog is cleared:

```bash
npx tsx scripts/leave-sheet-push.ts --url "<exec-url>" --token "<token>" --sheet Sheet1 --from supabase --year 2026
```

Read the diff. Add `--commit` when it looks right — or use the button on the
Leave Backlog page, which does the same thing with a preview dialog.

## 8. Going live

Deploy the same script on the real workbook with a **different** `ACCESS_TOKEN`,
and dry-run the whole 391-row payload against it before the first write. The
script is layout-resolved, so no edit is needed for the move — only the URL and
token change.

Two things worth doing before the first real write:

- **File → Version history → Name current version** on the workbook, so there is
  a labelled point to restore.
- Run the app's existing `fetch-leave-data` afterwards and confirm the register
  round-trips.

## 9. Known gaps

- **Half-day CLs typed only into the sheet are invisible to the app.** Approvals
  and backfill write `CL_1ST` / `CL_2ND` register rows, and those are sent to
  columns R–U. But the read feed never reads R–U back, so a half day that exists
  only on the sheet is not in the register.
- **`leave_category = 'CH'` rows carry no holiday date.** The legacy importer
  keyed them on the comp-off date only, so they cannot be placed in a CH column.
  - The sender uses `COMP_OFF_EARNED` rows instead, which do keep the duty date.
  - Legacy last-year `COMP_OFF` entries lost their holiday date the same way.
    They are skipped and reported, never guessed.
- The `mark` written into a National Holiday column is `NH` by default. The
  sheet only has seven of these, and the convention behind them is not
  documented anywhere in the app.
- **Backfill does not check leave balance.** `backfill_leave_entry` never calls
  `deduct_leave_balance()`. That function raises on insufficient balance, so a
  thousand historical entries would abort constantly and leave balances
  half-applied.
  - Balances are derived afterwards by `recompute_leave_balance()` as `12 − CL
    taken in the register` for the year, a half day counting ½.
  - The Leave Backlog page shows that figure and what the pending run would take
    it to, but nothing blocks going past 12.
