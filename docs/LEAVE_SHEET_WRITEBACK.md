# Leave write-back: app → ATTENDANCE-2026 / LEAVE_DATA

The app already **reads** this workbook: an Apps Script web app serves it as JSON
and `supabase/functions/fetch-leave-data` flattens that into
`employee_leave_records`. This document covers the other direction — pushing
leave data from the app back into the tab, at the exact cell each value belongs
in, matched by EMP NO.

Two pieces:

| File | What it is |
| --- | --- |
| [`docs/leave-apps-script/Code.gs`](leave-apps-script/Code.gs) | The receiver. Deploy on the workbook as a web app. |
| [`scripts/leave-sheet-push.mjs`](../scripts/leave-sheet-push.mjs) | The sender. Builds a payload from the CSV export or from Supabase and POSTs it. |

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

Notes:

- **Only the sections you send are touched.** Omit `closedHolidays` and the whole
  CH block is left exactly as it is.
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
  "ok": true, "dryRun": true, "mode": "merge", "sheet": "LEAVE_DATA",
  "employees": { "received": 391, "matched": 391, "changed": 2, "unmatched": 0 },
  "cellsChanged": 3,
  "results": [
    { "empId": "10012524", "name": "SANDIP BASU", "row": 6, "cellsChanged": 1,
      "changes": [{ "cell": "H6", "section": "casualLeave", "from": "", "to": "2026-07-01" }],
      "warnings": [] }
  ],
  "unmatched": []
}
```

`changes` is the row's **net** before/after, so a `replace` that clears a section
and writes it straight back reports nothing.

---

## 4. Modes

**`merge`** (default, and what you want almost always)

- List sections (CL, half-CL): dates already present are recognised and skipped;
  new ones go into the first free column.
- Keyed sections (NH, CH, last year): the slots you send are set. Everything else
  is untouched.
- OPE: a duty date already somewhere in the block updates that pair's comp-off;
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

---

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
node scripts/leave-sheet-push.mjs --url "<exec-url>" --token "<token>" --from csv --csv "$HOME/Downloads/ATTENDANCE-2026 - LEAVE_DATA.csv"
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
node scripts/leave-sheet-push.mjs --url "<exec-url>" --token "<token>" --from supabase --year 2026
```

Read the diff. Add `--commit` when it looks right.

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

- **Half-day CLs cannot be rebuilt from `employee_leave_records`.** That table
  stores a CL row with no half-day marker; the distinction lives in
  `leave_requests.leave_type` (`CL_1ST` / `CL_2ND`). The Supabase sender leaves
  columns R–U alone. Send `halfCasualLeave` explicitly if you need them.
- **`leave_category = 'CH'` rows carry no holiday date** — the legacy importer
  keyed them on the comp-off date only — so they cannot be placed in a CH column.
  The sender uses `COMP_OFF_EARNED` rows instead, which do keep the duty date.
- The `mark` written into a National Holiday column is `NH` by default; the sheet
  only has seven of these and the convention behind them is not documented
  anywhere in the app.
