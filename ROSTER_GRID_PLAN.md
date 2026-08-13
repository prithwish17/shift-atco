# Roster Grid Plan — rendering the WSO duty roster faithfully

> Scope: the day-view duty roster grid shown by `ShiftRosterView`
> (employee / supervisor / WSO). Not the month matrix (`rosterMatrix.ts`),
> not the ATC duty grid (`ATCDutyGridCore.tsx`).
>
> Revision 2 — rewritten after reviewing 15 published rosters spanning five
> team templates and all three shifts, plus a live screenshot of the
> `NEW_DELTA_SHIFT_WSO_ROSTER` spreadsheet.

## Status

**Shipped — a real matrix grid, with no change to the Apps Script.** The
scraper already carries both grid coordinates: `unit` is the row label and
`position` is the column label, from a closed set (`RSR`, `ACC PLR`,
`ACC ALPHA`, `Duty`; night adds `(1st Half)` / `(2nd Half)`). That is enough to
rebuild the matrix, so it was built first:

| | |
|---|---|
| `src/lib/rosterGrid.ts` | Pure model: cell grammar, column classification, row ordering, sections |
| `src/lib/__tests__/rosterGrid.test.ts` | 21 tests |
| `src/components/roster/RosterGrid.tsx` | The table — sticky unit column and header, search highlighting in place |
| `src/hooks/useShiftRoster.ts` | Exposes the raw rows alongside the flattened day, same single query |
| `src/components/roster/ShiftRosterView.tsx` | Grid/List toggle, grid by default |
| `supabase/functions/fetch-roster/index.ts` | **Stopped stripping grade and rating** off every name |

**Verified** against the published Bravo Morning roster of 15 Aug 2026: 52 rows,
every name in the correct unit row and rating column, nothing unplaced.

**Row ordering — resolved.** The scraper now emits `row_index`, carried through
both sync paths into `rosters.row_index`, and the grid sorts by it. The
canonical `UNIT_ORDER` list survives only as the fallback for rows synced before
the column existed; indexed and unindexed rows are never interleaved, because
sorting a real position against a stand-in yields an order matching neither.

**Pipeline changes (merge-aware scraper):**

| | |
|---|---|
| `roster-scraper.gs` | Reference copy of the deployed script: merge map, combined unit labels, `row_index` |
| `supabase/migrations/20260813120000_roster_row_index.sql` | `rosters.row_index` + `(date, shift, row_index)` index |
| `supabase/functions/sync-roster/index.ts` | **Stopped stripping grade/rating**; carries `row_index` |
| `supabase/functions/fetch-roster/index.ts` | Same, plus a named error for a dead deployment URL |
| `src/integrations/supabase/types.ts` | `row_index` on `rosters` |
| `src/hooks/useRosters.ts`, `useShiftRoster.ts` | `RosterEntry.row_index`, selected in the day query |
| `src/lib/rosterGrid.ts` | Covering columns, row spans, sheet-order sorting |

`sync-roster` mattered as much as `fetch-roster`: it is a second, parallel
implementation writing the same table on a schedule, and it stripped names with
its own copy of the same regex. Fixing only the manual path would have looked
correct until the next cron run silently reverted it.

**Operational note — a redeploy can mint a new URL.** Updating an existing
deployment keeps the `/exec` address; creating a new one changes it, and the old
address starts answering 404. Both edge functions fall back to a hardcoded
`DEFAULT_APPS_SCRIPT_URL`, so if the address ever changes,
`app_settings.roster_webapp_url` must be updated or the roster silently stops
refreshing. `fetch-roster` now says so explicitly on a 404 rather than reporting
a bare status code.

## Verified against the live deployment

All fifteen team/shift combinations fetched from the deployed script and run
through `buildRosterGrid`:

```
A/Afternoon 2026-08-15  n= 72  units:8r×6c  positions:10r×1c  spans=6  unplaced=0
A/Morning   2026-08-14  n= 71  units:8r×6c  positions: 9r×1c  spans=9  unplaced=0
A/Night     2026-08-11  n= 78  units:7r×8c  positions:11r×2c  spans=2  unplaced=0
…
TOTAL people=1022  spans=86  unplaced=0
```

Confirmed working: ISO dates on every tab; grade and rating intact; `row_index`
present; and 86 covering assignments resolved into spans. Bravo Morning's unit
block renders UKW, UKE, UBS, URP, UKN, UGT, UBN — the sheet's own order, not the
canonical one.

**Four defects the sweep found, all fixed:**

1. **The REMARK column was being read as a seventh duty slot.** On day rosters
   column K is REMARK, and `row.slice(1)` included it. The sheet's merged
   "GO THROUGH TRAINING & REMARKS FOR DUTY AND DB PLAN" banner therefore became
   a controller whose unit label named all seventeen rows it spans. Column K is
   now emitted under its own `REMARK` position, anchored to its own row, and the
   grid renders it as a trailing column.
2. **Runaway and duplicated merge labels.** A merge starting on a row already
   labelled `UKN+UKW` produced `UKN+UKN+UKW`. Labels are now de-duplicated.
3. **SAR / LEAVE / TRAINING / REMARKS were rendering as sectors.** They sit
   inside the scanned rectangle and arrive with a plain duty position, so they
   appeared as units named "LEAVE" and "TRAINING". They are now routed by row
   label into chip and note bands before any column classification, with the
   free text kept verbatim — those lines carry duty timelines, UTC times and
   emoji separators that must not be reformatted.
4. **`(0830 TO 1230)` was not recognised as a time window**, so the whole string
   stayed in the name. The pattern now accepts `TO`, `to` and en/em dashes.

Fixes 1 and 2 are in `roster-scraper.gs` and need a redeploy; 3 and 4 are
frontend and are already live in the build.

**Still proposal:** everything below that depends on formatting, merges,
banners, the reliever sub-table and the duty timelines — none of which the
current scrape carries. That is the rest of this document.

## Two sectors, three controllers

The sheet's most common merge is a band: two sectors, each with its own
controller, plus a third covering both in a vertically merged cell.

| | RSR col 1 | RSR col 2 |
|---|---|---|
| **UBN** | DIPTESH GARAI | **MANORANJAN CHATTERJEE** — merged |
| **UKE** | KUMARI SANGITA PRIYADARSHINI | ↑ *same cell* |

`getValues()` puts a merged cell's text in its **top-left cell only** and returns
`""` for the rest, so the covering controller is attributed to the first sector
and **vanishes from the others**. That is a correctness fault, not a cosmetic
one: the roster reads as "UBN has two people, UKE has one".

**The grid side is done.** A row label naming several sectors is folded into a
`covering` column that spans those rows, with a real `rowSpan`. The distinction
that makes this safe: a combined label is a *merge* only when every sector it
names also exists as its own row. Night rosters carry `UKN+UKW` as a genuine
combined row next to a `UKN` row but no `UKW` row — that is left standing as a
row of its own, never folded.

**The scraper side is not.** The merge map has to come out of the sheet. In the
standalone script, add:

```js
/**
 * "r,c" -> how many rows the merge starting there covers.  Vertical merges only;
 * horizontal ones need no help.
 */
function buildRowSpanMap_(sheet, rangeA1) {
  const range = sheet.getRange(rangeA1);
  const top = range.getRow(), left = range.getColumn();
  const map = {};
  range.getMergedRanges().forEach(function (m) {
    if (m.getNumRows() < 2) return;
    map[(m.getRow() - top) + ',' + (m.getColumn() - left)] = m.getNumRows();
  });
  return map;
}

/** Emits one cell, naming every sector a merged cell covers. */
function extractCols_(grid, r, cols, pos, unitFor, results, meta) {
  cols.forEach(function (c) {
    const cell = grid[r][c];
    if (!cell || !cell.toString().trim()) return;
    cell.toString().split('\n').forEach(function (n) {
      if (!n.trim()) return;
      results.push({
        date: meta.date, shift: meta.shift, team: meta.team,
        unit: unitFor(r, c) || 'N/A',
        employee_name: n.trim(),
        position: pos
      });
    });
  });
}
```

and drive the scan from them:

```js
const RANGE = "D13:K40";
const grid  = sheet.getRange(RANGE).getValues();
const spans = buildRowSpanMap_(sheet, RANGE);
const unitAt = grid.map(function (r) { return r[0]; });

// A merged cell is attributed to every sector it spans: "UBN+UKE".
const unitFor = function (r, c) {
  const span = spans[r + ',' + c];
  if (!span) return unitAt[r];
  const parts = [];
  for (var i = r; i < r + span && i < unitAt.length; i++) {
    if (unitAt[i]) parts.push(unitAt[i].toString().trim());
  }
  return parts.length > 1 ? parts.join('+') : unitAt[r];
};

grid.forEach(function (row, r) {
  if (!row[0]) return;
  if (isAccUnit(row[0])) {
    extractCols_(grid, r, [1, 2], "RSR",       unitFor, results, meta);
    extractCols_(grid, r, [3, 4], "ACC PLR",   unitFor, results, meta);
    extractCols_(grid, r, [5, 6], "ACC ALPHA", unitFor, results, meta);
  } else {
    extractCols_(grid, r, [1, 2, 3, 4, 5, 6, 7], "Duty", unitFor, results, meta);
  }
});
```

No migration and no unique-key change: `"UBN+UKE"` differs from `"UBN"`, so the
covering controller is a row in its own right rather than a duplicate. The rows
below the merge still yield `""` and are skipped, so nobody is emitted twice.

While that loop has `r` in hand, emitting it as a `row_index` would also fix the
row-ordering deviation noted above — the same edit, two problems.

## 0. The one-line diagnosis

The source roster is a **2-D matrix** — unit rows × rating columns, with merged
cells, colour coding, inline banner rows and per-person duty timelines. Every hop
in the current pipeline flattens it a bit more, and by the time it reaches the
screen it is a **1-D alphabetical list of names**. The grid does not look
"lacking" because the rendering is weak; it looks lacking because *the shape was
thrown away three layers upstream* and the renderer has nothing left to draw.

So this is not a UI task. It is a pipeline task with a UI at the end of it.

---

## 1. What the source actually is

### 1.0 Evidence base

| Template (WSO seen) | Shifts reviewed |
|---|---|
| `NEW_ALPHA_SHIFT_WSO_ROSTER` — Sushil Kumar Mandal / Abhinav Kumar Singh | M 4, 9, 14 Aug · A 15 Aug · N 11 Aug |
| `NEW_BRAVO_SHIFT_WSO_ROSTER` — Samar Patra | M 10, 15 Aug · A 11, 16 Aug · N 12 Aug |
| Braj Mohan template | M 11 Aug · A 12 Aug · N 13 Aug |
| `NEW_DELTA_SHIFT_WSO_ROSTER` — Atanu Ghatak / Dipak Mandal | M 12 Aug · A 13 Aug · N 14 Aug |
| Prasenjit Pal template | M 13 Aug · A 14 Aug · N 15 Aug |

**Every one of these is structurally different from the others.** That is the
central design constraint and it drives every decision below.

### 1.1 Document skeleton

```
┌─ Title ──────────────────────────────────────────────────────────────┐
│ DUTY ROSTER FOR {MORNING|AFTERNOON|NIGHT}   Duty on {date}            │
├─ Command block ──────────────────────────────────────────────────────┤
│ WSO   ATANU GHATAK/ JGM - ACC-P+OCC-SAR                               │
│ CMD   DIPAK MANDAL/ JGM - RSR+UBN-SAR                                 │
├─ Matrix A — the UNIT block ──────────────────────────────────────────┤
│ UNIT │  RSR (2 sub-cols) │ ACC PLR (2) │ ACC A (2) │ REMARK           │
│ UBN UKE UKW URP UKN UBS UGT UKJ IATS RELIEVER OCCN & OCC-S            │
├─ Matrix B — tower / support positions ───────────────────────────────┤
│ ARR+DEP & SEQ TSO TWR SMC CLD TWR-A/AIMS ARO AIS MCD FMP WSO-A ...    │
├─ Chip rows ──────────────────────────────────────────────────────────┤
│ SAR (dark green)   LEAVE (blue)                                       │
├─ Free-text rows ─────────────────────────────────────────────────────┤
│ TRAINING (yellow)  REMARKS (orange / grey / green / red)              │
└──────────────────────────────────────────────────────────────────────┘
```

That is the *typical* case. The rest of this section is the ways it varies —
which is the part that matters.

### 1.2 The column set is not fixed

| Template / shift | Column groups |
|---|---|
| Alpha · M/A | `RSR` \| `ACC PLR / PROCEDURAL` \| `ACC A` \| `REMARK` |
| Bravo · M (10 Aug) | `ACC RSR` \| `ACC PLR` \| `ACC A` \| `REMARK` |
| Bravo · M (15 Aug) | `ACC RSR` \| `ACC PLR` \| `ACC A` \| `REMARK` |
| Bravo/Delta · A | `RSR` \| `ACC PLR` \| `ACC A` \| `REMARK` |
| Prasenjit · M (13 Aug) | header cells **blank** — three unlabelled groups \| `REMARK` |
| Night, variant 1 | `RSR (N-1)` \| `ACC D (N-1)` \| `ACC A (N-1)` ‖ `RSR (N-2)` \| `ACC D (N-2)` \| `ACC A (N-2)` |
| Night, variant 2 | `RSR 1ST HALF` \| `ACC D 1ST HALF` \| `ACC A 1ST HALF` ‖ `RSR 2ND HALF` \| … |

Each labelled group spans **two physical sub-columns**. Night doubles the whole
set into two half-shift bands separated by a **solid black divider column** that
carries no data and must be detected and dropped.

Header fill colour is itself template-specific: green (Alpha, Bravo), blue
(Delta, Prasenjit-night), and the Bravo 15/16 Aug sheets use a yellow title bar
and a monospace face throughout.

**Conclusion: the layout must be read from the sheet, never hard-coded.**

### 1.3 Row labels are composite, mutable, and sometimes carry times

Observed labels include `UKN+UKW`, `UGT+UKE`, `WSO-A+FMP`, `WSO-A+FMP/FIC`,
`CMD/FMP`, `FMP+WSO-A`, `OCC/ADS`, `SMC-N & SMC-S`, `ARR+DEP & SEQ`,
`NIGHT Reliever-1`, `NIGHT Reliever-2`, `TWR-A/ AIMS`, `CORR /APP-A`.

Two further wrinkles:

- **Labels carry time ranges:** `UKN (1330-1730)`, `RSR-RELIEVER (1730-0130)`.
- **Label formatting carries meaning:** `CORR /APP-A` is struck through on
  16 Aug (= not in use today); `LEAVE` is underlined on 14 Aug.

So a row label must be parsed into `{ units: string[], timeWindow?, active: bool }`,
not treated as an opaque string.

### 1.4 The `CMD` row is sometimes not the CMD row

On Alpha night (11 Aug) the `CMD` row is repurposed as a **time-band header**:

```
CMD │ 1st HALF: 1330-1530  1730-2130  ‖  2nd HALF: 1530-1730  2130-0130
```

Four time windows, two per half. Any parser that trusts row labels to predict
content type will produce garbage here. **Classify blocks by content, then use
the label as a hint — not the reverse.**

### 1.5 Cell grammar

```
NAME / GRADE - RATING -[SAR]

BIBHAS SARKAR/ JGM - RSR+UBN-          → name, grade JGM, rating RSR+UBN
KRISHNA KANT/ SM -RSR+UBN-SAR          → + SAR flag
AMRITESH KUMAR/ MGR -ADC+ACC-PLR-SAR   → note inconsistent spacing
SAMAR PATRA(0830-1230)                 → name + partial-shift window, no rating
```

- **Grades:** `JGM DGM AGM SM MGR AM JE`
- **Ratings:** `RSR+UBN`, `RSR`, `ACC-PLR`, `ADC+ACC-PLR`, `ADC+ACC-P`, `ALPHA`,
  `ADC/SMC`, `ACC-P+OCC`, `ASR+APP`, `ASR+RSR`, `OCC+ACC-PLR`, `ACC-PLR+ACC-P`
- **Flags:** trailing `-SAR`
- Spacing around `/` and `-` is inconsistent between sheets. Always retain `raw`.

### 1.6 The duty-timeline grammar — the highest-value target

This is the biggest finding of revision 2, and it is much broader than the
"trainer TO trainee" pattern in revision 1. One grammar recurs in reliever cells,
training rows and remark rows across every template:

```
NAME : POSITION (HHMM-HHMM) POSITION (HHMM-HHMM) …
```

Real examples:

```
SATYANARAYAN : UKN-RSR (1330-1530) UBN / UKE / URP-RSR CKT (1810-2130)
SANMITRA : SMC-DB (1330-1430) URP-PLR (1630-1800) OCC (1830-2030)
DEBAJIT JOTDER: TWR (1330-1730) OCC (2130-0130)
MANIDEEPA ROY : UBN-A (1330-1530) UKE-A (1730-2130)
RAVI BHUSHAN : TWR (1330-1530) TAR DB (1730-2130)
```

Around it sit three further shapes:

**Instructor/trainee**, with varying keywords — `TO`, `UNDER`, `AND`:
```
RSR DB :: BIBHAS TO SULAGNA(0300-0400) RICHA(0600-0730)
RSR DB : RAHUL KUMAR UNDER NITESH SAHA
ANIMESH KUMAR / MAYANK KUMAR / RAUSHAN KUMAR / … : DB UNDER SHIKHA SRIVASTAVA AND RAVI BHUSHAN
```

**Position swaps** — a mid-shift change of duty:
```
SHIKHA SRIVASTAVA AND AYAN BOSE TO SWAP POSITION FROM 1730 UTC
DURGESH WILL RELIEVE SWACCHAND SHASHI FROM 0830-0930UTC AND UBN AS PER COORDINATION
AJEET SINGH WILL TAKE UBN FROM 0130-0330UTC
```

**Per-unit PLR/RSR rotations:**
```
UBN PLR:: RICHA(0130-0230)(0330-0500) ANKIT(0230-0330)(0500-0630) KESHAV(0630-0730)
UKE/UGT PLR:: RAVI SHANKAR(0830-1030) RICHA(1130-1330)
```

**Statements are separated by emoji and bullets**, not punctuation: `●`, `🔴`,
`🟢`, `//`, `/`. The scraper must preserve these code points intact — they are
delimiters, not decoration.

**All times are UTC.** Local display (UTC+05:30) is a free, high-value win.

Parse this and you can answer *"what is Manideepa doing at 1830?"* — which the
spreadsheet fundamentally cannot do, for anyone.

### 1.7 Rows that are not rows

Several block shapes break the unit×column matrix and need their own types:

- **Inline note rows inside the matrix** (Alpha, 15 Aug) — no unit label,
  spanning column groups:
  `EBT : NITESH SAHA POULASTYA DE (Coordinate IATS)` | `**UKE-PLR AND UBS-PLR IN 2 / 3 CKT`
- **Full-width statements inside the matrix** (Alpha night):
  `OCC RELIEVER : NITESH KUMAR SAHA`
- **The RELIEVER sub-table** (Bravo night, 12 Aug) — a nested grid with its own
  header stack: time-band row (`1730-2130` / `2130-0130`) → position sub-header
  (`UBN/UBS/URP` | `OCC` | `UKE/UKW`) → names, followed by a `1ST RELIEVING`
  row pairing units to times (`UBS 1800`, `UBN 1830`, `URP 1900`).
- **Banner rows anywhere in the document** — full-width coloured free text.
  Orange on Delta afternoon, green on Delta morning, grey on Alpha night, red on
  Bravo. These appear *mid-document*, not only at the bottom, so "footer blocks"
  was the wrong model.
- **Chip rows** — `SAR` (dark green) and `LEAVE` (blue) render as name chips in
  fixed-width cells, one name per chip, no rating.
- **A live formula row** — `WEATHER FORECAST: loading... (Source: IMD) //
  loading... (Source: weather.com)`. It was mid-refresh when captured. This must
  never be persisted as content.

### 1.8 Merges and colour carry meaning

- **Vertical merges** mean one person covers several units
  (`MANORANJAN CHATTERJEE` spanning UBN+UKE). Flattening that into repeated rows
  is not merely uglier — it reads as several different people.
- **Light green fill + underline** marks the same person appearing in two places.
  `ASHISH JHA` is highlighted in both the UBS/ACC-A cell and the TWR row on
  15 Aug; `DURBADAL BRAHMACHARI` in both UKN and NIGHT Reliever-2 on 13 Aug.
- **Dark green fill on an empty cell** means blocked / not applicable — the whole
  `UKJ` row on Delta night. Distinct from the dark green *chip* rows.
- **Per-person identity colours.** In Alpha's reliever and training rows, each
  name keeps a consistent colour (`PRABHAT RANJAN` red, `MANIK` blue, `JAI OM`
  green). Useful as a parsing signal for splitting run-on statements.
- **Cell borders** are a separate channel — blue boxes group the tower block on
  Alpha morning, red boxes group cells on the Braj Mohan afternoon sheet.

### 1.9 The grid is a region inside a much larger sheet

From the live `NEW_DELTA_SHIFT_WSO_ROSTER` screenshot, the printable roster
occupies roughly `D7:N50`. Around it:

- **Columns A–B: a control panel** — `DATE`, `SHIFT`, `TEAM` inputs, a
  `GENERATE & MAIL PDF FILE` button, and a computed rating census
  (`AVAIL. ATCOs 58`, `RSR+UBN 15`, `ADC/SMC 11`, `ALPHA 12`, `SAR/AIS 3`,
  `LEAVE 0`, …) plus `EXTRA DUTY` / `NORMAL DUTY` sections.
- **Column C: `ATCOs YET TO BE MARKED IN ROSTER`** — a live validation list, with
  `NO OF TOTAL ATCOs MARKED FOR DUTY 57` / `YET TO BE MARKED 1`.
- **Far right: a column of personal email addresses** (the PDF mail distribution
  list).
- **Tabs:** `HOME · MORNING · AFTERNOON · NIGHT · Sheet22 ·
  DAILY-SHIFT-ATTENDANCE · BA TEST · BA-DAC · ATCO Seniority List ·
  NIGHT PLANNING`, most of them protected.

Three consequences:

1. **The scraper must clip to the roster region**, anchored on the
   `DUTY ROSTER FOR` title cell. `getDataRange()` would pull in the control panel
   and the email list.
2. **Never ingest the email column.** This is personal data with no purpose in
   the app — see §8.
3. **The census and "yet to be marked" list are already computed by the sheet.**
   Import them as metadata rather than reimplementing, and cross-check them
   against our own count as a parser self-test.
4. The sheet was open **View only** for this account, and the tabs are protected
   — which constrains how the Apps Script side can be changed. See §8.

### 1.10 Date formats vary

`13-Aug-2026` · `12-August-26` · `08-15-2026` (MM-DD-YYYY) ·
`16-Aug-2026 (Sunday)` · `10-Aug-2026 (Monday)`.

`toIsoRosterDate` in `fetch-roster/index.ts:26` handles the first three but its
regexes are `^…$`-anchored, so the trailing `(Sunday)` will fail to parse. The
title must be tokenised before the date is matched.

---

## 2. Where the shape is being lost

Four lossy hops, in order:

**Hop 1 — Apps Script.** Returns flat rows `{date, shift, team, unit,
employee_name, position|mark|remark|half}`. No column identity, no merges, no
formatting, no banners, no timelines. The matrix dies here.

**Hop 2 — `supabase/functions/fetch-roster/index.ts:207-213`** actively destroys
the richest part of each cell:

```ts
let empName = (row.employee_name || "").split("/")[0].trim();
empName = empName.replace(/-(SM|DGM|MGR|JE|AM|AGM)$/i, "").trim();
```

`BIBHAS SARKAR/ JGM - RSR+UBN-` → `BIBHAS SARKAR`. Grade and rating — printed
under every name on the real roster — are thrown on the floor. It would also
mangle `SAMAR PATRA(0830-1230)`.

**Hop 3 — the `rosters` table** (`src/integrations/supabase/types.ts:459`) has
seven columns: `date, shift, team, unit, employee_name, position, created_at`.
No column identity, no order, no spans, no colour, no time band, no banners.
Worse, the upsert key
`onConflict: "date,shift,team,employee_name,unit,position"`
(`fetch-roster/index.ts:276`) **collapses legitimate duplicates** — and §1.8 shows
cross-posting is a real, meaningful, frequent occurrence.

**Hop 4 — `src/lib/shiftRoster.ts`.** Re-groups the survivors into four flat
buckets and sorts them alphabetically (`compareMembers`, line 165). Any adjacency
still encoded in row order is now gone. `ShiftRosterView.tsx:187` renders a `<ul>`.

By the time pixels are drawn there is genuinely nothing left to lay out. **Any
renderer built on the current data will be worse than the original, always.**

---

## 3. Target architecture

```
Google Sheet  (5 spreadsheets × 3 shift tabs)
    │  ① dumb, versioned "grid dump" endpoint — clipped to the roster region
    ▼
raw rectangle: values + merges + fills + font colour/weight/style/line + borders
    │  ② pure parser, golden-tested, lives in this repo
    ▼
RosterDocument  (ordered typed blocks, JSONB)
    ├─③a persisted whole → roster_documents      → the grid renders from this
    └─③b projected flat  → rosters (unchanged)   → every existing consumer
    │  ④
    ▼
<RosterGrid> — real <table>, sticky headers, real rowSpan/colSpan
```

### Why this split

- **Apps Script becomes a dumb dumper.** It extracts the rectangle and stops. All
  interpretation moves into this repo, where it is version-controlled, reviewable
  and unit-testable. §1 shows five templates that differ in almost every
  dimension; template drift is the dominant long-term risk, and you want the
  fragile code where the tests are — not behind a Google deployment you
  re-publish by hand, in a spreadsheet you may only have read access to.
- **Document + projection, not one or the other.** The grid needs the whole day at
  once (one row, one query). But `useMyRoster`, the ATC duty grid, working-hours
  and leave all read flat rows today. Breaking them is unacceptable, so the same
  sync writes both. The projection is derived, never hand-maintained.
- **Ordered typed blocks, not sections + footer.** §1.7 killed the "matrix then
  footer" model: banners appear mid-document, notes appear inside the matrix, and
  the reliever block is a nested grid. The document is a **sequence of blocks in
  sheet order**, each with a type. Rendering in source order is what makes an
  unrecognised block degrade gracefully instead of vanishing.

---

## 4. Data model

### 4.1 New table

```sql
create table roster_documents (
  id            uuid primary key default gen_random_uuid(),
  iso_date      date not null,
  shift         text not null,              -- Morning | Afternoon | Night
  team          text not null,
  template      text not null,              -- NEW_DELTA_SHIFT_WSO_ROSTER, ...
  layout        jsonb not null,             -- RosterDocument, see 4.2
  content_hash  text not null,              -- sha256(layout) — idempotent sync + diffing
  source_url    text,
  fetched_at    timestamptz not null default now(),
  parser_version int not null,
  unique (iso_date, shift, team)
);
create index on roster_documents (iso_date, shift);
```

`content_hash` is doing real work: re-sync becomes a no-op when nothing changed,
and it is what powers "this roster changed 12 minutes ago" (§7.4).

### 4.2 `RosterDocument`

```ts
interface RosterDocument {
  version: 2;
  meta: {
    template: string;
    shift: 'Morning' | 'Afternoon' | 'Night';
    isoDate: string;
    weekday?: string;
    timeZone: 'UTC';               // every time in the sheet is UTC
    census?: Record<string, number>;   // the sheet's own rating counts (§1.9)
    unassigned?: string[];             // "ATCOs yet to be marked"
  };

  /** Sheet order. Rendering walks this array; unknown types fall back to raw. */
  blocks: Block[];

  legend: LegendEntry[];           // derived fill/colour → meaning
}

type Block =
  | { kind: 'command';   rows: { label: string; cell: RosterCell }[] }
  | { kind: 'matrix';    rowHeader: string; columns: ColumnGroup[]; rows: MatrixRow[] }
  | { kind: 'timeBands'; bands: { label: string; windows: TimeWindow[] }[] }
  | { kind: 'reliever';  bands: RelieverBand[]; firstRelieving?: FirstRelieving[] }
  | { kind: 'chips';     label: string; tone: SemanticTone; names: string[] }
  | { kind: 'banner';    label?: string; tone: SemanticTone; raw: string;
                         statements: Statement[] }        // §4.3
  | { kind: 'note';      raw: string; spanFrom?: string; spanTo?: string }
  | { kind: 'raw';       raw: string[][] };               // unrecognised — still shown

interface ColumnGroup {
  key: string;                     // 'acc-plr'
  label: string;                   // 'ACC PLR / PROCEDURAL'  ('' when blank)
  half?: 'N-1' | 'N-2';            // night
  timeWindow?: TimeWindow;
  span: number;                    // physical sub-columns, usually 2
}

interface MatrixRow {
  key: string;                     // 'UKN+UKW'
  units: string[];                 // ['UKN','UKW']   — composite labels split
  label: string;                   // verbatim
  timeWindow?: TimeWindow;         // 'UKN (1330-1730)'
  active: boolean;                 // false when struck through
  cells: RosterCell[];
  remark?: RosterCell;
}

interface RosterCell {
  raw: string;                     // ALWAYS kept verbatim
  name?: string;
  grade?: Grade;                   // JGM | DGM | AGM | SM | MGR | AM | JE
  rating?: string;                 // RSR+UBN, ADC+ACC-PLR, ...
  timeWindow?: TimeWindow;         // 'SAMAR PATRA(0830-1230)'
  flags: CellFlag[];               // 'SAR' | 'CROSS_POSTED' | 'BLOCKED'
  rowSpan: number;                 // from the sheet's merge map
  colSpan: number;
  tone?: SemanticTone;             // mapped, NOT the sheet's raw hex
  sourceStyle?: { bg?: string; fg?: string; bold?: boolean; underline?: boolean };
  employeeId?: string | null;      // resolved via lib/nameMatching
}
```

Three deliberate choices worth defending:

1. **`raw` is always kept, on every block and every cell.** If the parser
   mis-reads something, the user still sees exactly what the sheet said. This is
   an operational document; a parse bug must degrade to "unstyled but correct",
   never to "wrong or missing".
2. **`kind: 'raw'` exists.** Anything unrecognised is rendered as a plain grid in
   its correct position rather than dropped. Silent loss is how you get here.
3. **`meta.census` is imported, not computed.** It gives a free cross-check: if
   our parsed cell count disagrees with the sheet's own census, the parser is
   wrong and should say so loudly.

### 4.3 `Statement` — the duty-timeline model

The payoff from §1.6, and the thing that makes the app worth more than the sheet:

```ts
type Statement =
  | { kind: 'assignment'; person: string; slots: Slot[] }
  | { kind: 'training';   instructors: string[]; trainees: string[];
                          discipline?: string;      // 'RSR DB' | 'PLR DB' | 'TWR DB' | 'EBT' | ...
                          slots: Slot[] }
  | { kind: 'swap';       people: string[]; from: TimeWindow }
  | { kind: 'prose';      text: string }            // anything not matched
  ;

interface Slot { position: string; window: TimeWindow }      // 'UKN-RSR', 1330-1530
interface TimeWindow { from: string; to?: string }           // 'HHMM', UTC
```

Statements are split on `●`, `🔴`, `🟢`, `//` and sentence boundaries, then
matched against the shapes in §1.6. Anything that does not match becomes
`kind: 'prose'` and is rendered verbatim — never dropped, never guessed at.

---

## 5. The parser — `src/lib/rosterSheet/`

Pure functions, zero I/O, driven entirely by fixtures.

```
src/lib/rosterSheet/
  clipRegion.ts        find the roster rectangle from the title anchor (§1.9)
  detectBlocks.ts      classify each band of rows into a Block by CONTENT (§1.4)
  parseColumns.ts      column groups, half-shift bands, divider-column removal
  parseRowLabel.ts     'UKN+UKW', 'UKN (1330-1730)', strikethrough → active:false
  parseCell.ts         NAME/ GRADE - RATING -SAR  (+ trailing time window)
  parseStatements.ts   §4.3 — the timeline grammar
  parseReliever.ts     the nested sub-table
  buildDocument.ts     → RosterDocument
  toFlatRows.ts        → RosterEntry[]  (the projection)
  __fixtures__/        one JSON dump per template × shift
  __tests__/           golden snapshots
```

**Anchors and content, not indices and labels.** `clipRegion` locates the
rectangle by searching for `/DUTY ROSTER FOR/`. `detectBlocks` then classifies
each band by *what is in it* — because §1.4 proved the `CMD` label can sit above
a time-band header. Row labels are a hint, ranked below content.

**Divider columns.** Night sheets contain a solid black spacer column between the
two half-shift groups. Detect it (uniform dark fill, no values, narrow) and drop
it, or it becomes a phantom empty column in every night roster.

**Golden tests are the deliverable, not an extra.** §1.0 lists five templates ×
three shifts, and night has two label variants — so the fixture target is
**15–18 dumps, not 4**. Snapshot the parsed `RosterDocument` for each. From then
on, template drift is a failing test in CI instead of a blank grid in production.

**Self-check.** After parsing, compare the cell count against `meta.census`.
A mismatch sets a `parseWarnings` field that the UI surfaces. This is nearly free
and catches the entire class of "we silently lost a column".

---

## 6. The renderer — `src/components/roster/RosterGrid.tsx`

A real `<table>`. Not a flex grid, not a list — the semantics (`rowSpan`,
`colSpan`, `<th scope>`) are exactly what this data is, and they bring
accessibility with them.

- **Render `blocks` in order.** Each block type gets a component; `kind: 'raw'`
  gets a plain fallback. This is what keeps an unrecognised sheet readable.
- **Sticky row and column headers.** The unit column pins left, the column-group
  header pins top. *The original loses its headers as soon as you scroll* — the
  first place the app beats the sheet, for two CSS properties.
- **Merges honoured** via `rowSpan`/`colSpan` from the parsed map, so a supervisor
  covering UBN+UKE reads as one cell, as on paper.
- **Cell:** name in medium weight; `grade · rating` beneath in muted small; SAR,
  cross-posted and partial-window as badges — never colour alone.
- **Colour → semantic tokens, with an escape hatch.** Do not pipe the sheet's hex
  values to the screen: they are low-contrast, invisible in dark mode, and
  inconsistent across the five templates (green header here, blue there). Map
  through the derived `legend`, **render that legend visibly** (the original has
  none — people learn it by folklore), and offer a "show original colours" toggle
  so anyone verifying against the sheet can trust it.
- **Times in local and UTC.** Show `1830 UTC · 2400 IST` on hover or as a global
  toggle. Everything in §1.6 is UTC; nobody should be doing that arithmetic.
- **Density toggle** and a **print stylesheet** reproducing the A3 landscape
  layout, so printed output still matches the roster on the wall.
- **Overflow:** `overflow-x: auto` on the table container only. The page body must
  never scroll sideways.

### Mobile

The spreadsheet is unusable on a phone; this is the largest available win.

1. **"My duty" card, pinned above the grid** — resolve the signed-in employee and
   show their cell, unit, rating, who else is in that unit, **their timeline for
   the shift assembled from every `Statement` that names them**, and their
   reliever. This answers the only question most users open the app for, and the
   sheet cannot do it for anybody.
2. Below `sm`, a per-unit accordion by default, with the full table one tap away.

---

## 7. Acceptance: parity first, then better

### 7.1 Must-not-be-worse checklist (blocks release)

Verified cell-by-cell against all 15 reference rosters:

- [ ] Every name appears, in the same row and column
- [ ] Vertical and horizontal merges preserved
- [ ] Grade and rating visible on every duty cell
- [ ] `-SAR`, partial-shift windows and other flags visible
- [ ] Every block rendered in source order — including mid-document banners
- [ ] Column group headers present, including night's two half-shift bands
- [ ] The night divider column does **not** appear as an empty column
- [ ] `REMARK` column values present, including merged spans
- [ ] Composite row labels (`UKN+UKW`, `WSO-A+FMP/FIC`) shown verbatim
- [ ] Struck-through row labels shown as inactive, not dropped
- [ ] The reliever sub-table renders as a table, not as prose
- [ ] Chip rows (`SAR`, `LEAVE`) render as chips
- [ ] Free text rendered verbatim, emoji separators intact
- [ ] A person appearing twice appears twice (regression test for the upsert key)
- [ ] Blocked (dark-green empty) cells visibly distinct from empty cells
- [ ] Unrecognised content surfaced as `kind: 'raw'`, never dropped
- [ ] Parsed cell count agrees with the sheet's own census

### 7.2 Better — information

- A legend for the colour code, which exists nowhere today
- **Per-person duty timeline** assembled from §4.3 statements
- UTC ↔ IST alongside every time
- Deep links: `/roster/2026-08-14/N`, shareable into WhatsApp/Telegram

### 7.3 Better — interaction

- Search **highlights in place** instead of filtering rows away. Filtering a
  matrix destroys its meaning; the current view filters, which is part of why it
  reads as a list.
- Click a person → side sheet: duty, timeline, training, leave, links into the
  existing employee pages
- "Jump to me"

### 7.4 Better — things the spreadsheet cannot do

- **Change diff.** `content_hash` + previous version → "UKW RSR: X replaced Y,
  12 minutes ago". On a safety-critical roster this is arguably the highest-value
  item in the plan.
- **Validation banner.** Unit unassigned; one person in two places with
  *overlapping* time windows (now computable, thanks to §4.3); a position filled
  by someone without the rating for it; the sheet's own "yet to be marked" list
  surfaced. Wire into the existing rule engine
  (`ENTERPRISE_RULE_ENGINE_PLAN.md`, `ROSTER_RULES_COMPILED.md`) rather than
  starting a second rules path.
- Export to PDF/PNG matching the print layout
- Offline read through the existing PWA service worker + Redis cache

---

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| **The sheets are View-only for this account** and tabs are protected (§1.9). Editing the embedded Apps Script in all five may not be possible. | Build the dumper as a **standalone Apps Script project owned by the roster admin**, reading each sheet via `SpreadsheetApp.openById()`. View access is enough to read values and formatting. Do not depend on editing the five spreadsheets. |
| **The existing `GENERATE & MAIL PDF FILE` button already knows the roster region** | Reuse its range definition rather than re-deriving the rectangle. Cheapest possible source of truth for §1.9 clipping. |
| **Five templates, all structurally different** | Content-based block detection (§5), 15–18 golden fixtures, and a `kind: 'raw'` fallback. Degrade to ugly-but-correct, never to blank. |
| **PII in the sheet** — a column of personal email addresses sits beside the grid | Clip to the roster region; assert in the parser that no output field matches an email pattern; fail the sync loudly if one appears. Never store it. |
| **Volatile cells** — the weather row was captured mid-refresh as `loading...` | Mark known-volatile rows and exclude them from `content_hash`, or the diff feature will fire constantly on noise. |
| **Emoji separators** (`●` `🔴` `🟢`) | End-to-end UTF-8; fixtures must include them; snapshot tests will catch any mangling. |
| **Date formats vary**, incl. a `(Sunday)` suffix (§1.10) | Tokenise the title before matching; extend `toIsoRosterDate` and cover every observed spelling with tests. |
| **Upsert key collapses duplicates**, and cross-posting is common (§1.8) | Add a slot discriminator (`row_key` + `col_key`) to the projection's unique key. Migration + backfill. |
| **Payload size** on a free tier | One document per (date, shift); fetch only the selected day; `staleTime` already 5 min in `useShiftRoster`; add Redis per `REDIS_CACHING.md`. Do **not** fetch a month of documents. |
| **Historical dates** have no document | Keep the existing flat-row path as fallback and reuse the current `ShiftRosterDay.source` indicator to say so honestly in the UI. |
| **Name → employee resolution** is fuzzy, and the sheet uses short forms (`MANIK`, `JAI OM`, `SANMITRA`) in free text | Reuse `lib/nameMatching`; resolve optimistically; never block rendering on a match; never let a failed match hide content. |

---

## 9. Phasing

Each phase ships independently and leaves the app working.

| Phase | Work | Exit criteria |
|---|---|---|
| **0** | Confirm §1 against a live dump; locate the PDF-export range; confirm whether a standalone script can read all five sheets | Assumptions verified, not inferred; access route settled |
| **1** | Standalone Apps Script `grid dump v2` — clipped region, values + merges + fills + font styles. Capture fixtures | 15–18 fixture JSONs committed, covering 5 templates × 3 shifts + both night variants |
| **2** | Parser + golden tests. **No UI.** | `npm test` green; `RosterDocument` produced for every fixture; census self-check passes |
| **3** | `roster_documents` table; sync writes document + projection; old path untouched | Documents landing for new dates; every existing consumer unaffected |
| **4** | `RosterGrid` behind a feature flag; §7.1 verified side-by-side against all 15 rosters | Checklist fully ticked |
| **5** | Mobile "my duty" + timeline, search-highlight, legend, UTC/IST, print | Usable one-handed on a phone |
| **6** | Diff, validation banner, drill-down, export | — |

Phases 0–2 are the ones that matter. If the parser and its fixtures are right,
the renderer is a few days of straightforward work. If they are wrong, no amount
of UI polish will save it — which is exactly the situation today.

---

## 10. Files this touches

| File | Change |
|---|---|
| Standalone Apps Script (new, external) | Clipped grid dump v2 across all five spreadsheets |
| `supabase/functions/fetch-roster/index.ts` | Call v2; stop stripping grade/rating (`:207`); tokenise the title before date parsing (`:26`); write document + projection; fix `onConflict` (`:276`) |
| `supabase/migrations/` | `roster_documents`; projection unique-key change |
| `src/lib/rosterSheet/**` | **New** — parser, fixtures, golden tests |
| `src/hooks/useShiftRoster.ts` | Fetch the document; keep flat rows as fallback |
| `src/lib/shiftRoster.ts` | Keep for the fallback path; the grid no longer routes through the bucket/sort logic |
| `src/components/roster/RosterGrid.tsx` | **New** — the table, one component per block type |
| `src/components/roster/ShiftRosterView.tsx` | Host the grid; keep date/shift selection as-is (it works) |
| `src/integrations/supabase/types.ts` | Regenerate |

Not touched: `rosterMatrix.ts` (month view), `ATCDutyGridCore.tsx` (ATC duty
grid), `teamDutyRotation.ts` (rotation rule — correct, and stays the source of
truth for which team is on which shift).
