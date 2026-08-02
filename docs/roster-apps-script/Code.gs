/**
 * ROSTER SCRAPER API - NIGHT SHIFT PRECISION VERSION
 * Specific Units: TWR, SMC-N & SMC-S, CLD, TWR-A/ AIMS, MCD, FMP, WSO-A
 *
 * Parsing logic (parseDayShift / parseNightShift / extractNames / isAccUnit) is
 * unchanged.  What changed:
 *   1. B2 is no longer read with getDisplayValue().  That returned the cell's
 *      *formatted text*, so every tab emitted whatever format it happened to be
 *      formatted with — "2-Aug-2026", "2-August-26", "9-May-26", "07-30-2026".
 *      Two of those the app could not parse, so Bravo-night and Echo rows were
 *      silently invisible.  Dates are now always emitted as ISO "yyyy-MM-dd".
 *   2. Optional strict `date` filtering (opt-in — see honourRequestedDate_).
 *   3. The manual-run guard returns JSON instead of plain text.
 */

/** Set to true to make ?date= filter strictly.  See honourRequestedDate_ below. */
var STRICT_DATE_FILTER = false;

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
 * UPDATED NIGHT SHIFT LOGIC
 */
function parseNightShift(sheet, meta, results) {
  // 1. Supervision (WSO/CMD)
  extractRange(sheet, "E10:K11", "SUPERVISION", "HQ", results, meta);

  // 2. Main Grid Scanning (D13 down to K40 to capture any new inserted rows dynamically)
  const grid = sheet.getRange("D13:K40").getValues();
  grid.forEach(row => {
    const unit = row[0]; if (!unit) return;

    if (isAccUnit(unit)) {
      // ACC Units Logic - Only applied to UKN, UKW, UGT, etc.
      extractNames([row[1]], "RSR (1st Half)", unit, results, meta);      // Col E
      extractNames([row[5]], "RSR (2nd Half)", unit, results, meta);      // Col I
      extractNames([row[2]], "ACC-PLR (1st Half)", unit, results, meta);  // Col F
      extractNames([row[6]], "ACC-PLR (2nd Half)", unit, results, meta);  // Col J
      extractNames([row[3]], "ACC-ALPHA (1st Half)", unit, results, meta);// Col G
      extractNames([row[7]], "ACC-ALPHA (2nd Half)", unit, results, meta);// Col K
    } else {
      // Specific Split Units (TWR, SMC, CLD, TWR-A, MCD, FMP, WSO-A, etc.)
      // First Half: Columns E, F, G (indices 1, 2, 3)
      extractNames([row[1], row[2], row[3]], "1st Half", unit, results, meta);
      // Second Half: Columns I, J, K (indices 5, 6, 7)
      extractNames([row[5], row[6], row[7]], "2nd Half", unit, results, meta);
    }
  });

  // 3. Special Rows (Expanded ranges slightly to accommodate extra rows above)
  extractRange(sheet, "A32:A45", "Extra Duty", "SPECIAL", results, meta);
  extractRange(sheet, "A46:A65", "Duty Change", "SPECIAL", results, meta);
}

/**
 * DAY SHIFT LOGIC
 */
function parseDayShift(sheet, meta, results) {
  extractRange(sheet, "E10:K11", "SUPERVISION", "HQ", results, meta);

  // Main Grid Scanning (D13 down to K40 to capture any new inserted rows dynamically)
  const grid = sheet.getRange("D13:K40").getValues();
  grid.forEach(row => {
    const unit = row[0]; if (!unit) return;

    if (isAccUnit(unit)) {
      // ACC Units Logic
      extractNames([row[1], row[2]], "RSR", unit, results, meta);
      extractNames([row[3], row[4]], "ACC PLR", unit, results, meta);
      extractNames([row[5], row[6]], "ACC ALPHA", unit, results, meta);
    } else {
      // Specific Split Units Logic
      extractNames(row.slice(1), "Duty", unit, results, meta);
    }
  });

  // Expanded ranges slightly to accommodate extra rows above
  extractRange(sheet, "A32:A45", "Extra Duty", "SPECIAL", results, meta);
  extractRange(sheet, "A46:A65", "Duty Change", "SPECIAL", results, meta);
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

/** TEST RUNNER - Use this to check in the editor! **/
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
