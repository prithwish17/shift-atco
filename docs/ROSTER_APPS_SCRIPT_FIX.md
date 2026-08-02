# Roster webapp (Google Apps Script) — fixes

Corrected script: [`roster-apps-script/Code.gs`](roster-apps-script/Code.gs) — paste it
over the whole of `Code.gs` in the editor.

The app defends itself against everything below, so the sync works either way.
Applying this removes the problem at source.

---

## What was actually wrong

### The date format (this is the important one)

```js
date: sheet.getRange("B2").getDisplayValue()
```

`getDisplayValue()` returns the cell's **formatted text**, not its value. Every
(team, shift) pair resolves through the `Config` tab to a *different spreadsheet and
tab*, and each of those tabs had B2 formatted differently — so each one emitted its
own date format:

| Tab | B2 emitted | App could parse it? |
|---|---|---|
| most | `2-Aug-2026` | yes |
| Bravo night | `2-August-26`, `9-May-26` | **no — rows invisible** |
| Echo afternoon/night | `07-30-2026` | **no — rows invisible** |

1,376 of 16,875 stored rows (~8.5%) were unreachable by the UI because of this.

The corrected script reads the cell's real value and formats it itself, so B2's
formatting no longer affects the output:

```js
date: isoDateFromCell_(sheet.getRange("B2"), ss.getSpreadsheetTimeZone())
```

`isoDateFromCell_` uses `getValue()` (a real `Date` when the cell is a genuine date)
and only falls back to parsing text when the cell holds a string. Unparseable values
are passed through unchanged rather than dropped, so they surface in the sync log
instead of disappearing.

**Worth doing in the sheets too:** if B2 holds *text* rather than a real date, select
it and apply **Format → Number → Date** on each tab. The script handles either, but
real date cells stop this recurring.

### The `date` parameter

The script never read `e.parameter.date`, so `?date=` was ignored — requesting
2026-07-20, 2026-08-02 and 2026-08-15 all returned identical rows.

**It is deliberately still off by default.** Each tab holds exactly one roster
(B2) — there is no history to query. Filtering strictly would mean any tab that
hasn't been rolled forward yet returns *nothing at all*, which is worse than
returning a stale date the app can record. Several tabs were already behind when
measured (C-night showed 29-Jul while D-afternoon showed 4-Aug).

Support is implemented and gated:

```js
var STRICT_DATE_FILTER = false;   // set true only once every tab is kept current
```

Until then the sheet's own date stays authoritative — which is what the app assumes.

### Team A

Resolved — the permission fix worked. Verified 6/6 clean requests returning 80 rows,
where it previously failed intermittently (~1 in 3) with an HTML
*"You do not have permission to access the requested document"* page. That page came
from Apps Script's infrastructure, not your code, which is why the existing
`try/catch` never caught it.

---

## Unchanged

`parseDayShift`, `parseNightShift`, `extractNames`, `extractRange` and `isAccUnit`
are byte-for-byte identical — all sheet ranges, column indices and unit rules are
untouched. Only date handling, JSON error output and the test helpers changed.

---

## After pasting

**Deploy → Manage deployments → edit (pencil) → Version: New version → Deploy.**
Editing the code alone does not change what the `/exec` URL serves.

Run `testAllDates` in the editor first — it walks every row of `Config` and flags any
tab still emitting a non-ISO date:

```
A / Morning -> 80 rows, dates=["2026-08-01"]
B / Night   -> 60 rows, dates=["2026-08-02"]
```

Then verify over HTTP:

```sh
URL='https://script.google.com/macros/s/<deployment-id>/exec'
for T in A B C D E; do
  echo "--- team $T ---"
  curl -s -L "$URL?team=$T&shift=Night" | head -c 160; echo
done
```

Every `date` field should read `yyyy-MM-dd`.
