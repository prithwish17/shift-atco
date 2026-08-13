/**
 * ROSTER SCRAPER API — merge-aware
 *
 * Reference copy of the standalone Apps Script that serves the WSO duty
 * rosters.  Kept in the repo so the scrape contract is reviewable next to the
 * code that consumes it; the deployed copy lives in the Apps Script project.
 *
 * ── What changed from the previous version ──────────────────────────────────
 *
 * Vertically merged cells were being lost.  `getValues()` puts a merged cell's
 * text in its TOP-LEFT cell only and returns "" for every other cell it covers,
 * so the sheet's two-sector/three-controller shape —
 *
 *     UBN │ DIPTESH GARAI          │ MANORANJAN CHATTERJEE ┐  one controller
 *     UKE │ KUMARI SANGITA         │                       ┘  covering both
 *
 * — was emitted as "Manoranjan is on UBN", and UKE lost him entirely.  The
 * roster then read as two controllers on UBN and one on UKE.
 *
 * Merged cells are now resolved against the sheet's merge map and attributed to
 * every sector they span, as a combined unit label: "UBN+UKE".  The webapp folds
 * that into a cell spanning both rows (src/lib/rosterGrid.ts).
 *
 * No database migration is needed: "UBN+UKE" differs from "UBN", so the covering
 * controller is a row in its own right rather than a duplicate, and the cells
 * below a merge still come back "" and are skipped — nobody is emitted twice.
 *
 * Also now emitted: `row_index`, the cell's row within the scanned grid, so the
 * webapp can reproduce the sheet's own unit ordering instead of imposing a
 * canonical one.  Ignored by the current edge function until the `rosters` table
 * carries a column for it — harmless in the meantime.
 *
 * Unchanged: the Config lookup, date canonicalisation, the day/night column
 * mapping, `isAccUnit`, and the special-row ranges.
 */

/** Set to true to make ?date= filter strictly.  See honourRequestedDate_ below. */
var STRICT_DATE_FILTER = false;

/** The block scanned for the main grid.  Column D is the unit label, E..K the data. */
var GRID_RANGE = "D13:K40";

function doGet(e) {
  // Safeguard for manual runs in editor
  if (!e || !e.parameter) {
    return jsonOut_({
      error: "Script must be run via URL. Use the 'testRoster' function to debug in the editor."
    });
  }

  const targetTeam = e.parameter.team ? e.parameter.team.toString().trim().toUpperCase() : "";
  const targetShift = e.parameter.shift ? e.parameter.shift.toString().trim().toUpperCase() : "";
  const requestedDate = e.parameter.date ? e.parameter.date.toString().trim() : "";

  try {
    const masterSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Config");
    if (!masterSheet) throw new Error("Tab named 'Config' not found.");

    const configData = masterSheet.getDataRange().getValues();
    let ssId = "", tabName = "", logicType = "";
    let found = false;

    for (let i = 1; i < configData.length; i++) {
      let sheetTeam = configData[i][0].toString().trim().toUpperCase();
      let sheetShift = configData[i][1].toString().trim().toUpperCase();
      if (sheetTeam === targetTeam && sheetShift === targetShift) {
        ssId = configData[i][2];
        tabName = configData[i][3];
        logicType = configData[i][4];
        found = true;
        break;
      }
    }

    if (!found) throw new Error(`No match for Team: ${targetTeam} | Shift: ${targetShift}`);

    const ss = SpreadsheetApp.openById(ssId);
    const sheet = ss.getSheetByName(tabName);
    if (!sheet) throw new Error(`Tab '${tabName}' not found in roster sheet.`);

    const metadata = {
      // Always ISO, regardless of how this tab's B2 happens to be formatted.
      date: isoDateFromCell_(sheet.getRange("B2"), ss.getSpreadsheetTimeZone()),
      shift: sheet.getRange("B3").getDisplayValue(),
      team: sheet.getRange("B4").getDisplayValue()
    };

    // Opt-in: only answer when the sheet actually holds the requested date.
    if (honourRequestedDate_(requestedDate, metadata.date)) {
      return jsonOut_([]);
    }

    let flatRoster = [];

    if (logicType === "DAY_SHIFT") {
      parseDayShift(sheet, metadata, flatRoster);
    } else if (logicType === "NIGHT_SHIFT") {
      parseNightShift(sheet, metadata, flatRoster);
    }

    return jsonOut_(flatRoster);

  } catch (err) {
    return jsonOut_({ error: err.message });
  }
}

/**
 * NIGHT SHIFT LOGIC
 *
 * Column layout across GRID_RANGE (D=0):
 *   E(1) F(2) G(3)  =  RSR / ACC-PLR / ACC-ALPHA, 1st half
 *   H(4)            =  the sheet's black divider column — no data
 *   I(5) J(6) K(7)  =  RSR / ACC-PLR / ACC-ALPHA, 2nd half
 */
function parseNightShift(sheet, meta, results) {
  // 1. Supervision (WSO/CMD)
  extractRange(sheet, "E10:K11", "SUPERVISION", "HQ", results, meta);

  // 2. Main grid
  const scan = readGrid_(sheet, GRID_RANGE);

  scan.grid.forEach(function (row, r) {
    const unit = row[0];
    if (!unit) return;

    if (isAccUnit(unit)) {
      extractCols_(scan, r, [1], "RSR (1st Half)", results, meta);
      extractCols_(scan, r, [5], "RSR (2nd Half)", results, meta);
      extractCols_(scan, r, [2], "ACC-PLR (1st Half)", results, meta);
      extractCols_(scan, r, [6], "ACC-PLR (2nd Half)", results, meta);
      extractCols_(scan, r, [3], "ACC-ALPHA (1st Half)", results, meta);
      extractCols_(scan, r, [7], "ACC-ALPHA (2nd Half)", results, meta);
    } else {
      // Specific split units (TWR, SMC, CLD, TWR-A, MCD, FMP, WSO-A, …)
      extractCols_(scan, r, [1, 2, 3], "1st Half", results, meta);
      extractCols_(scan, r, [5, 6, 7], "2nd Half", results, meta);
    }
  });

  // 3. Special rows
  extractRange(sheet, "A32:A45", "Extra Duty", "SPECIAL", results, meta);
  extractRange(sheet, "A46:A65", "Duty Change", "SPECIAL", results, meta);
}

/**
 * DAY SHIFT LOGIC
 *
 * Column layout across GRID_RANGE (D=0):
 *   E(1) F(2)  =  RSR          (two sub-columns)
 *   G(3) H(4)  =  ACC PLR
 *   I(5) J(6)  =  ACC ALPHA
 *   K(7)       =  REMARK       (not currently emitted)
 */
function parseDayShift(sheet, meta, results) {
  extractRange(sheet, "E10:K11", "SUPERVISION", "HQ", results, meta);

  const scan = readGrid_(sheet, GRID_RANGE);

  scan.grid.forEach(function (row, r) {
    const unit = row[0];
    if (!unit) return;

    if (isAccUnit(unit)) {
      extractCols_(scan, r, [1, 2], "RSR", results, meta);
      extractCols_(scan, r, [3, 4], "ACC PLR", results, meta);
      extractCols_(scan, r, [5, 6], "ACC ALPHA", results, meta);
    } else {
      // K(7) is excluded here: on day rosters it is the REMARK column, not a
      // seventh duty slot.  Reading it as one turned the sheet's merged
      // "GO THROUGH TRAINING & REMARKS FOR DUTY AND DB PLAN" banner into a
      // controller whose unit label named all seventeen rows it spans.
      extractCols_(scan, r, [1, 2, 3, 4, 5, 6], "Duty", results, meta);
    }

    // The REMARK column, under its own position so it can never land in the
    // duty matrix.  Anchored to its own row: a note merged down the side of the
    // sheet belongs to the block, not to a list of sectors.
    extractCols_(scan, r, [7], "REMARK", results, meta, { anchorOnly: true });
  });

  extractRange(sheet, "A32:A45", "Extra Duty", "SPECIAL", results, meta);
  extractRange(sheet, "A46:A65", "Duty Change", "SPECIAL", results, meta);
}

/** MERGE-AWARE GRID READING **/

/**
 * Reads the grid once, together with the merge map and the unit label of every
 * row, so a merged cell can name every sector it covers.
 *
 * Returns { grid, spans, unitAt } where `spans` maps "r,c" to the number of rows
 * the merge anchored there covers.
 */
function readGrid_(sheet, rangeA1) {
  const range = sheet.getRange(rangeA1);
  const grid = range.getValues();
  const top = range.getRow();
  const left = range.getColumn();
  const rowCount = grid.length;
  const colCount = grid[0] ? grid[0].length : 0;

  const spans = {};
  range.getMergedRanges().forEach(function (m) {
    // Horizontal-only merges need no help: getValues() already puts the text
    // where we read it.
    if (m.getNumRows() < 2) return;

    const r = m.getRow() - top;
    const c = m.getColumn() - left;

    // A merge that starts above or left of the scanned block keeps its text
    // outside the block too, so our cell is "" and is skipped either way.
    if (r < 0 || c < 0 || r >= rowCount || c >= colCount) return;

    spans[r + ',' + c] = m.getNumRows();
  });

  return {
    grid: grid,
    spans: spans,
    unitAt: grid.map(function (row) { return row[0]; })
  };
}

/**
 * The unit a cell belongs to.
 *
 * A plain cell belongs to its own row.  A vertically merged cell belongs to
 * every sector it spans, joined as "UBN+UKE" — the webapp reads that as one
 * controller covering both and renders it as a spanning cell.
 */
function unitForCell_(scan, r, c) {
  const span = scan.spans[r + ',' + c];
  if (!span) return scan.unitAt[r];

  const parts = [];
  for (let i = r; i < r + span && i < scan.unitAt.length; i++) {
    const label = scan.unitAt[i];
    if (!label || !label.toString().trim()) continue;
    const text = label.toString().trim();
    // A merge can start on a row whose label already names several sectors
    // ("UKN" then "UKN+UKW"), which would otherwise yield "UKN+UKN+UKW".
    if (parts.indexOf(text) === -1) parts.push(text);
  }

  return parts.length > 1 ? parts.join('+') : scan.unitAt[r];
}

/**
 * Emits the named columns of one grid row, resolving merges as it goes.
 *
 * `opts.anchorOnly` keeps the cell on its own row's label instead of naming
 * every row a merge covers.  Used for the REMARK column, where a note merged
 * down the side of the sheet belongs to the block, not to a list of sectors.
 */
function extractCols_(scan, r, cols, pos, targetArray, meta, opts) {
  const anchorOnly = opts && opts.anchorOnly;

  cols.forEach(function (c) {
    const cell = scan.grid[r][c];
    if (!cell || cell.toString().trim() === "") return;

    const unit = anchorOnly ? scan.unitAt[r] : unitForCell_(scan, r, c);

    cell.toString().split('\n').forEach(function (n) {
      if (!n.trim()) return;
      targetArray.push({
        date: meta.date,
        shift: meta.shift,
        team: meta.team,
        unit: (unit && unit.toString().trim()) || "N/A",
        employee_name: n.trim(),
        position: pos,
        // Lets the webapp reproduce the sheet's own row order.
        row_index: r
      });
    });
  });
}

/** HELPER FUNCTIONS **/

/**
 * Validates if the given unit should receive ACC/RSR specific positions.
 * Supports combinations like "OCCN& OCC-S" or "UKN+UKW".
 */
function isAccUnit(unitStr) {
  if (!unitStr) return false;
  const u = unitStr.toString().toUpperCase();
  // We use 'OCC' to safely catch 'OCCN', 'OCC-S', or 'OCCN& OCC-S'
  const allowed = ["UKN", "UKW", "UGT", "UKE", "UBS", "URP", "UBN", "UKJ", "OCC"];
  return allowed.some(a => u.includes(a));
}

/**
 * Flat ranges with a fixed unit — supervision and the special-duty lists.
 * These carry no unit column and no meaningful merges, so they stay simple.
 */
function extractRange(sheet, rangeStr, pos, unit, targetArray, meta) {
  const values = sheet.getRange(rangeStr).getValues();
  values.forEach(row => extractNames(row, pos, unit, targetArray, meta));
}

function extractNames(cells, pos, unit, targetArray, meta) {
  cells.forEach(cell => {
    if (cell && cell.toString().trim() !== "") {
      const names = cell.toString().split('\n');
      names.forEach(n => {
        if (n.trim()) {
          targetArray.push({
            date: meta.date,
            shift: meta.shift,
            team: meta.team,
            unit: unit || "N/A",
            employee_name: n.trim(),
            position: pos
          });
        }
      });
    }
  });
}

/** DATE HANDLING **/

function jsonOut_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Reads a date cell and always returns "yyyy-MM-dd".
 *
 * getDisplayValue() was the original bug: it hands back the cell's *formatted*
 * text, which differs per tab.  getValue() returns a real Date when the cell is
 * a genuine date; only when the cell holds text do we fall back to parsing it.
 *
 * If the value cannot be understood it is returned unchanged rather than
 * dropped, so the problem shows up in the sync log instead of vanishing.
 */
function isoDateFromCell_(range, timeZone) {
  const raw = range.getValue();

  if (Object.prototype.toString.call(raw) === '[object Date]' && !isNaN(raw.getTime())) {
    return Utilities.formatDate(raw, timeZone || Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  const text = range.getDisplayValue();
  return normalizeDateText_(text) || text;
}

/** Parses the text date shapes seen across the tabs into ISO, else null. */
function normalizeDateText_(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;              // already ISO

  const MONTHS = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
  };
  const pad = function (n) { return ('0' + n).slice(-2); };

  // 2-Aug-2026 | 2-August-26 | 9-May-26
  var m = raw.match(/^(\d{1,2})-([A-Za-z]+)-(\d{2,4})$/);
  if (m) {
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    const day = Number(m[1]);
    if (month && day >= 1 && day <= 31) {
      const year = m[3].length <= 2 ? 2000 + Number(m[3]) : Number(m[3]);
      return year + '-' + pad(month) + '-' + pad(day);
    }
    return null;
  }

  // 07-30-2026 (month first) — falls back to day-first when field 1 can't be a month
  m = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]), year = Number(m[3]);
    if (a >= 1 && a <= 12 && b >= 1 && b <= 31) return year + '-' + pad(a) + '-' + pad(b);
    if (b >= 1 && b <= 12 && a >= 1 && a <= 31) return year + '-' + pad(b) + '-' + pad(a);
    return null;
  }

  // 30/07/2026 (day first)
  m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]), year = Number(m[3]);
    if (b >= 1 && b <= 12 && a >= 1 && a <= 31) return year + '-' + pad(b) + '-' + pad(a);
    if (a >= 1 && a <= 12 && b >= 1 && b <= 31) return year + '-' + pad(a) + '-' + pad(b);
    return null;
  }

  return null;
}

/**
 * Returns true when the request should be answered with an empty array.
 *
 * Each (team, shift) tab holds exactly ONE roster in B2, so this cannot serve
 * arbitrary past/future dates — filtering strictly means any tab that has not
 * been rolled forward yet returns nothing at all.  Left OFF by default for that
 * reason: the sheet's own date stays authoritative and the app records it.
 * Turn STRICT_DATE_FILTER on only once every tab is reliably kept current.
 */
function honourRequestedDate_(requestedDate, sheetDate) {
  if (!STRICT_DATE_FILTER) return false;
  if (!requestedDate || !sheetDate) return false;
  return normalizeDateText_(requestedDate) !== sheetDate;
}

/** TEST RUNNERS — use these to check in the editor **/

function testRoster() {
  const fakeEvent = {
    parameter: {
      team: "C",
      shift: "Night"
    }
  };
  const result = doGet(fakeEvent);
  console.log(result.getContent());
}

/** Checks every team/shift in Config and reports the date each one emits. */
function testAllDates() {
  const configData = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName("Config").getDataRange().getValues();

  for (let i = 1; i < configData.length; i++) {
    const team = configData[i][0], shift = configData[i][1];
    if (!team || !shift) continue;

    const out = doGet({ parameter: { team: team, shift: shift } });
    const parsed = JSON.parse(out.getContent());

    if (parsed.error) {
      console.log('%s / %s -> ERROR: %s', team, shift, parsed.error);
    } else {
      const dates = parsed.length ? Object.keys(parsed.reduce(function (acc, r) {
        acc[r.date] = 1; return acc;
      }, {})) : [];
      const bad = dates.filter(function (d) { return !/^\d{4}-\d{2}-\d{2}$/.test(d); });
      console.log('%s / %s -> %s rows, dates=%s%s',
        team, shift, parsed.length, JSON.stringify(dates),
        bad.length ? '  <-- NOT ISO, fix this tab\'s B2' : '');
    }
  }
}

/**
 * Reports every covering assignment found, per team/shift.
 *
 * Run this once after deploying: each line is a controller the previous version
 * was dropping from all but the first sector.  An empty result across the board
 * means the merges are not being seen — check GRID_RANGE covers the unit block.
 */
function testMerges() {
  const configData = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName("Config").getDataRange().getValues();

  for (let i = 1; i < configData.length; i++) {
    const team = configData[i][0], shift = configData[i][1];
    if (!team || !shift) continue;

    const parsed = JSON.parse(doGet({ parameter: { team: team, shift: shift } }).getContent());
    if (parsed.error) {
      console.log('%s / %s -> ERROR: %s', team, shift, parsed.error);
      continue;
    }

    const covering = parsed.filter(function (r) {
      return r.unit && r.unit.indexOf('+') !== -1;
    });

    console.log('%s / %s -> %s rows, %s covering', team, shift, parsed.length, covering.length);
    covering.forEach(function (r) {
      console.log('    %s  [%s]  %s', r.unit, r.position, r.employee_name);
    });
  }
}
