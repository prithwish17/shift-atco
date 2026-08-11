/**
 * OJT PROGRESS API — "Training status check" workbook
 *
 * Serves both tabs in one response so the app's fetch-ojt-data function can join
 * them atomically. A split fetch could land fresh performed hours against a
 * stale start date, so this deliberately does not support fetching one tab.
 *
 * Response:
 *   {
 *     "generated_at": "2026-08-11T13:00:00.000Z",
 *     "extracted": [ { emp_id, name, designation, unit,
 *                      required_hours, required_days,
 *                      performed_hours, performed_days,
 *                      date_marking_for_ojt } ],
 *     "ojt":       [ { emp_id, name, unit, date_of_start_of_ojt } ]
 *   }
 *
 * Two things this script is careful about, both learned from the source data:
 *
 *   1. DURATIONS ARE READ FROM THE UNDERLYING VALUE, NEVER THE DISPLAYED TEXT.
 *      Some duration cells in this workbook are formatted "h:mm" rather than
 *      "[h]:mm", so their *displayed* text wraps at 24 hours — 90 hours shows as
 *      "18:00". Reading getValues() instead of getDisplayValues() sidesteps that
 *      entirely. Hours are emitted as plain decimals (90, 86.5) so there is
 *      nothing left to misparse downstream.
 *
 *   2. DATES ARE ALWAYS EMITTED AS ISO "yyyy-MM-dd", regardless of how the cell
 *      happens to be formatted — same fix as the roster script.
 *
 * ── Deployment ──────────────────────────────────────────────────────────────
 *   Extensions → Apps Script, paste this in, then Deploy → New deployment →
 *   Web app, "Execute as: Me", "Who has access: Anyone with the link".
 *   Copy the /exec URL into Admin → System Settings → OJT Progress Integration.
 *
 *   Optional shared secret: set ACCESS_TOKEN below to a long random string and
 *   store the URL with "?token=THAT_STRING" appended. The app fetches the saved
 *   URL verbatim, so no application change is needed. Leave it "" to disable.
 */

/** Optional shared secret. Empty string disables the check. */
var ACCESS_TOKEN = "";

/** Tab names. Matched case-insensitively, ignoring spaces. */
var EXTRACTED_SHEET = "Extracted Data";
var OJT_SHEET = "OJT data";

/** Sheets' serial-date epoch. Durations are fractions of a day from here. */
var SHEETS_EPOCH = new Date(1899, 11, 30, 0, 0, 0, 0);

function doGet(e) {
  // Running from the editor gives no `e`; steer to testOjtFeed instead.
  if (!e || !e.parameter) {
    return jsonOut_({
      error: "Run this via its web app URL. Use testOjtFeed() to debug in the editor."
    });
  }

  if (ACCESS_TOKEN && String(e.parameter.token || "") !== ACCESS_TOKEN) {
    return jsonOut_({ error: "Unauthorized" });
  }

  try {
    return jsonOut_(buildPayload_());
  } catch (err) {
    return jsonOut_({ error: String(err && err.message ? err.message : err) });
  }
}

function buildPayload_() {
  var book = SpreadsheetApp.getActiveSpreadsheet();

  return {
    generated_at: new Date().toISOString(),
    extracted: readExtracted_(mustFindSheet_(book, EXTRACTED_SHEET)),
    ojt: readOjt_(mustFindSheet_(book, OJT_SHEET))
  };
}

/* ─── Sheet lookup ─────────────────────────────────────────────────────────── */

function normalizeKey_(text) {
  return String(text == null ? "" : text).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function mustFindSheet_(book, wanted) {
  var target = normalizeKey_(wanted);
  var sheets = book.getSheets();

  for (var i = 0; i < sheets.length; i++) {
    if (normalizeKey_(sheets[i].getName()) === target) return sheets[i];
  }

  var names = sheets.map(function (s) { return s.getName(); }).join(", ");
  throw new Error("Sheet '" + wanted + "' not found. Tabs present: " + names);
}

/**
 * The two tabs put their headers on different rows — "Extracted Data" on row 1,
 * "OJT data" on row 3 beneath two title rows — so find it rather than hard-code
 * it. A header row is the first one that carries an "Employee Id" column.
 */
function findHeaderRow_(values) {
  var limit = Math.min(values.length, 10);

  for (var r = 0; r < limit; r++) {
    for (var c = 0; c < values[r].length; c++) {
      if (normalizeKey_(values[r][c]) === "employeeid") return r;
    }
  }

  throw new Error("No header row containing 'Employee Id' in the first 10 rows.");
}

/** Map of normalised header name → column index. */
function indexHeaders_(headerRow) {
  var map = {};

  for (var c = 0; c < headerRow.length; c++) {
    var key = normalizeKey_(headerRow[c]);
    if (key && !(key in map)) map[key] = c;
  }

  return map;
}

function columnOf_(headers, aliases, sheetName) {
  for (var i = 0; i < aliases.length; i++) {
    var key = normalizeKey_(aliases[i]);
    if (key in headers) return headers[key];
  }

  throw new Error(
    "Column not found on '" + sheetName + "'. Looked for: " + aliases.join(" / ")
  );
}

function cell_(row, index) {
  return index == null || index < 0 || index >= row.length ? "" : row[index];
}

/* ─── Value coercion ───────────────────────────────────────────────────────── */

function text_(value) {
  if (value == null) return "";
  if (value instanceof Date) return isoDate_(value);
  return String(value).trim();
}

/**
 * Duration or number → decimal hours.
 *
 * Sheets hands duration cells to Apps Script as Date objects offset from
 * 1899-12-30, which is why this measures elapsed time from that epoch rather
 * than reading getHours() — the latter wraps for anything past 24 hours, and
 * this workbook routinely runs to 210 hours.
 */
function hours_(value) {
  if (value === "" || value == null) return null;

  if (value instanceof Date) {
    var elapsed = (value.getTime() - SHEETS_EPOCH.getTime()) / 3600000;
    return elapsed >= 0 ? round2_(elapsed) : null;
  }

  if (typeof value === "number") {
    return isFinite(value) && value >= 0 ? round2_(value) : null;
  }

  var raw = String(value).trim();
  if (!raw) return null;

  if (raw.indexOf(":") !== -1) {
    var parts = raw.split(":");
    if (parts.length < 2 || parts.length > 3) return null;

    var h = Number(parts[0]);
    var m = Number(parts[1]);
    var s = parts.length === 3 ? Number(parts[2]) : 0;
    if (!isFinite(h) || !isFinite(m) || !isFinite(s)) return null;

    return round2_(h + m / 60 + s / 3600);
  }

  var parsed = Number(raw);
  return isFinite(parsed) && parsed >= 0 ? round2_(parsed) : null;
}

function integer_(value) {
  if (value === "" || value == null) return null;

  var parsed = Number(value);
  return isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

function round2_(value) {
  return Math.round(value * 100) / 100;
}

/** Always ISO, whatever the cell's display format happens to be. */
function isoDate_(value) {
  if (value === "" || value == null) return null;

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return Utilities.formatDate(
      value,
      SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(),
      "yyyy-MM-dd"
    );
  }

  var raw = String(value).trim();
  if (!raw) return null;

  // Typed as text: "DD-MM-YYYY", "DD/MM/YYYY" or already ISO.
  var parts = raw.split(raw.indexOf("/") !== -1 ? "/" : "-");
  if (parts.length === 3) {
    if (parts[2].length === 4) {
      return parts[2] + "-" + pad2_(parts[1]) + "-" + pad2_(parts[0]);
    }
    if (parts[0].length === 4) {
      return parts[0] + "-" + pad2_(parts[1]) + "-" + pad2_(parts[2]);
    }
  }

  return null;
}

function pad2_(value) {
  var text = String(value).trim();
  return text.length === 1 ? "0" + text : text;
}

/** Uppercased, spaces stripped: "APP + APP(S)" and "APP+APP(S)" are one unit. */
function unit_(value) {
  return String(value == null ? "" : value).toUpperCase().replace(/\s+/g, "").trim();
}

/* ─── Readers ──────────────────────────────────────────────────────────────── */

function readExtracted_(sheet) {
  var values = sheet.getDataRange().getValues();
  var headerIndex = findHeaderRow_(values);
  var headers = indexHeaders_(values[headerIndex]);
  var name = sheet.getName();

  var col = {
    empId: columnOf_(headers, ["Employee Id", "Employee ID", "emp_id"], name),
    name: columnOf_(headers, ["Name"], name),
    designation: columnOf_(headers, ["Designation"], name),
    unit: columnOf_(headers, ["UNIT", "Unit"], name),
    requiredHours: columnOf_(headers, ["Required Hours"], name),
    requiredDays: columnOf_(headers, ["Required Days"], name),
    performedHours: columnOf_(headers, ["Performed Hours"], name),
    performedDays: columnOf_(headers, ["Performed Days"], name),
    markingDate: columnOf_(
      headers,
      ["Date Marking for OJT", "Date of marking for OJT"],
      name
    )
  };

  var rows = [];

  for (var r = headerIndex + 1; r < values.length; r++) {
    var row = values[r];
    var empId = text_(cell_(row, col.empId));
    var unitValue = unit_(cell_(row, col.unit));

    // emp id + unit is the join key; a row missing either cannot be matched.
    if (!empId || !unitValue) continue;

    rows.push({
      emp_id: empId,
      name: text_(cell_(row, col.name)),
      designation: text_(cell_(row, col.designation)),
      unit: unitValue,
      required_hours: hours_(cell_(row, col.requiredHours)),
      required_days: integer_(cell_(row, col.requiredDays)),
      performed_hours: hours_(cell_(row, col.performedHours)),
      performed_days: integer_(cell_(row, col.performedDays)),
      date_marking_for_ojt: isoDate_(cell_(row, col.markingDate))
    });
  }

  return rows;
}

/**
 * Only the start date is taken from this tab. Its Deadline / Days left /
 * Hours left / Current status columns are recomputed by the app, which is the
 * point of the integration — the app fixes the sub-month deadline bug and the
 * 24-hour hours-left wrap that those columns carry.
 */
function readOjt_(sheet) {
  var values = sheet.getDataRange().getValues();
  var headerIndex = findHeaderRow_(values);
  var headers = indexHeaders_(values[headerIndex]);
  var name = sheet.getName();

  var col = {
    empId: columnOf_(headers, ["Employee Id", "Employee ID", "emp_id"], name),
    name: columnOf_(headers, ["Name"], name),
    unit: columnOf_(headers, ["UNIT", "Unit"], name),
    startDate: columnOf_(
      headers,
      ["Date of start of OJT", "Date of Start of OJT", "start_of_ojt"],
      name
    )
  };

  var rows = [];

  for (var r = headerIndex + 1; r < values.length; r++) {
    var row = values[r];
    var empId = text_(cell_(row, col.empId));
    var unitValue = unit_(cell_(row, col.unit));

    if (!empId || !unitValue) continue;

    rows.push({
      emp_id: empId,
      name: text_(cell_(row, col.name)),
      unit: unitValue,
      date_of_start_of_ojt: isoDate_(cell_(row, col.startDate))
    });
  }

  return rows;
}

/* ─── Output ───────────────────────────────────────────────────────────────── */

function jsonOut_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ─── Editor debugging ─────────────────────────────────────────────────────── */

/**
 * Run this from the Apps Script editor before deploying. It logs the row counts,
 * how many rows carry a start date, and the first record from each tab, so a
 * renamed column or a shifted header row shows up immediately.
 */
function testOjtFeed() {
  var payload = buildPayload_();

  var withStart = payload.ojt.filter(function (r) {
    return !!r.date_of_start_of_ojt;
  }).length;

  Logger.log("extracted rows: %s", payload.extracted.length);
  Logger.log("ojt rows: %s (%s with a start date)", payload.ojt.length, withStart);
  Logger.log("first extracted: %s", JSON.stringify(payload.extracted[0], null, 2));
  Logger.log("first ojt: %s", JSON.stringify(payload.ojt[0], null, 2));

  // Rows present in one tab but not the other will not be joined by the app.
  var ojtKeys = {};
  payload.ojt.forEach(function (r) { ojtKeys[r.emp_id + "|" + r.unit] = true; });

  var missing = payload.extracted.filter(function (r) {
    return !ojtKeys[r.emp_id + "|" + r.unit];
  });

  Logger.log("extracted rows with no matching ojt row: %s", missing.length);
  if (missing.length) {
    Logger.log("first few: %s", JSON.stringify(missing.slice(0, 5).map(function (r) {
      return r.emp_id + " " + r.name + " " + r.unit;
    })));
  }

  return payload;
}
