/**
 * ATCO MASTER API — CAP Kolkata Master, "ATCO LIST" sheet
 *
 * Reference copy of the standalone Apps Script that serves the ATCO master
 * list. Kept in the repo so the contract is reviewable next to the code that
 * consumes it (supabase/functions/fetch-atco-master); the deployed copy lives
 * in the Apps Script project.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The app had no Kolkata joining date. `profiles.date_of_joining` is a single
 * unlabelled field, self-entered by each employee, and exists only for people
 * with an app account — so it could not tell "joined AAI" from "joined
 * Kolkata", and did not cover the roster.
 *
 * The master list has both, in adjacent columns:
 *
 *     DOJ_AAI  (column J)  joined AAI
 *     DOJ      (column K)  joined Kolkata      <- what SARC needs
 *
 * SARC uses the Kolkata date to decide which ratings count: a rating earned at
 * a previous station is not a Kolkata rating, so only ratings on or after this
 * date anchor the stress-allowance requirement.
 *
 * ── Contract ────────────────────────────────────────────────────────────────
 *
 *   GET  <webapp-url>            -> { generated_at, count, data: [ ... ] }
 *   GET  <webapp-url>?emp=10012  -> the same, filtered to one employee
 *
 * Every row:
 *   { emp_id, name, doj_aai, doj_kolkata, transfer_status, transferred_out }
 *
 * Only the fields nothing else supplies. Designation, licence number, email and
 * the rest already arrive from their own syncs.
 *
 * Dates are emitted as ISO `yyyy-MM-dd`, or null. The sheet holds them as
 * day-first text (`18-06-2014`) in some rows and as real Dates in others
 * depending on how they were pasted, so both are normalised here rather than
 * left for the consumer to guess at.
 */

/**
 * The CAP Kolkata Master spreadsheet, opened by ID rather than as the container.
 *
 * This script is deployed from a separate spreadsheet, because the master is
 * view-only to us. `getActiveSpreadsheet()` would therefore return the wrong
 * book entirely — the one the script happens to be attached to.
 *
 * View access is enough to read it. The web app must be deployed with
 * **Execute as: me**, so it runs with the credentials of an account that can
 * see the master; deployed as "user accessing the web app" it would fail for
 * the edge function, which is not signed in to Google at all.
 *
 * From
 * https://docs.google.com/spreadsheets/d/1DIpl9RHw6zdKsJDoanxZCKH_72Ohzl4flGsD4spmO9U/edit
 *
 * Override without editing this file by setting a Script Property named
 * SOURCE_SPREADSHEET_ID (Project Settings → Script Properties).
 */
var DEFAULT_SOURCE_SPREADSHEET_ID = '1DIpl9RHw6zdKsJDoanxZCKH_72Ohzl4flGsD4spmO9U';

/** Sheet holding the master list, within that spreadsheet. */
var SHEET_NAME = 'ATCO LIST';

function sourceSpreadsheetId_() {
  var override = PropertiesService.getScriptProperties()
    .getProperty('SOURCE_SPREADSHEET_ID');
  return (override && override.trim()) || DEFAULT_SOURCE_SPREADSHEET_ID;
}

/** Timezone the sheet's dates are written in. */
var TIMEZONE = 'Asia/Kolkata';

/**
 * Header text -> output field. Matched case-insensitively after trimming, so
 * the sheet's own capitalisation and spacing can drift without breaking this.
 * Column letters in the comments are the layout as of 2026-08-14.
 *
 * Deliberately narrow. Designation, licence number, email, DOS and stream are
 * already synced from their own sources, and duplicating them here would give
 * two writers to one column. `SHIFT` is left out for a stronger reason: it
 * disagrees with the attendance roster's own Team column for 85 of 363
 * controllers, and the SARC home rate turns on that — so publishing it would
 * only invite something to read the wrong one.
 */
var COLUMNS = {
  'EMPLOYEE NO': 'emp_id',              // B
  'NAME': 'name',                       // C
  'DOJ_AAI': 'doj_aai',                 // J
  'DOJ': 'doj_kolkata',                 // K  <- the Kolkata joining date
  'TRANSFER STATUS': 'transfer_status'  // N
};

var DATE_FIELDS = ['doj_aai', 'doj_kolkata'];

function doGet(e) {
  try {
    var wanted = e && e.parameter && e.parameter.emp
      ? normaliseEmpId_(e.parameter.emp)
      : null;

    var rows = readMaster_().filter(function (row) {
      return !wanted || row.emp_id === wanted;
    });

    return json_({
      generated_at: new Date().toISOString(),
      count: rows.length,
      data: rows
    });
  } catch (err) {
    return json_({ error: String(err && err.message ? err.message : err), data: [] });
  }
}

function readMaster_() {
  var id = sourceSpreadsheetId_();

  var book;
  try {
    book = SpreadsheetApp.openById(id);
  } catch (err) {
    throw new Error(
      'Cannot open the master spreadsheet (' + id + '). Check the ID is right and ' +
      'that the account this web app executes as has at least view access. ' +
      'Underlying error: ' + (err && err.message ? err.message : err)
    );
  }

  var sheet = book.getSheetByName(SHEET_NAME);
  if (!sheet) {
    var names = book.getSheets().map(function (s) { return s.getName(); });
    throw new Error(
      'Sheet "' + SHEET_NAME + '" not found in "' + book.getName() + '". ' +
      'Available: ' + names.join(', ')
    );
  }

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  // Resolve columns by header text, not by position, so inserting a column
  // upstream cannot silently shift the joining date onto some other field.
  var header = values[0];
  var index = {};
  for (var c = 0; c < header.length; c++) {
    var key = String(header[c] || '').trim().toUpperCase();
    if (COLUMNS[key] !== undefined && index[COLUMNS[key]] === undefined) {
      index[COLUMNS[key]] = c;
    }
  }

  if (index.emp_id === undefined) throw new Error('No "EMPLOYEE NO" column found');
  if (index.doj_kolkata === undefined) throw new Error('No "DOJ" column found');

  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var empId = normaliseEmpId_(row[index.emp_id]);
    if (!empId) continue;

    var record = { emp_id: empId };
    for (var field in index) {
      if (field === 'emp_id') continue;
      var raw = row[index[field]];
      record[field] = DATE_FIELDS.indexOf(field) !== -1
        ? toIsoDate_(raw)
        : (String(raw === null || raw === undefined ? '' : raw).trim() || null);
    }

    // "OUT" marks a controller posted away from Kolkata. They keep a row but no
    // joining date, and must not appear as current staff.
    record.transferred_out =
      String(record.transfer_status || '').trim().toUpperCase() === 'OUT';

    out.push(record);
  }

  return out;
}

/** Employee numbers are compared as digits — the sheet stores some as numbers. */
function normaliseEmpId_(value) {
  return String(value === null || value === undefined ? '' : value)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Normalise to ISO `yyyy-MM-dd`.
 *
 * Handles a real Date, an ISO string, and the day-first text the sheet mostly
 * holds (`18-06-2014`, `1/3/2021`). Day-first is the only reading applied: this
 * is an Indian roster and the sheet is unambiguous about it. Anything else
 * returns null rather than being guessed at.
 */
function toIsoDate_(value) {
  if (value === null || value === undefined || value === '') return null;

  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime())
      ? null
      : Utilities.formatDate(value, TIMEZONE, 'yyyy-MM-dd');
  }

  var text = String(value).trim();
  if (!text) return null;

  var iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];

  var dayFirst = text.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (!dayFirst) return null;

  var day = Number(dayFirst[1]);
  var month = Number(dayFirst[2]);
  var year = Number(dayFirst[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  var probe = new Date(year, month - 1, day);
  if (probe.getDate() !== day || probe.getMonth() !== month - 1) return null;

  return year + '-' + pad2_(month) + '-' + pad2_(day);
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Run from the editor to sanity-check before deploying.
 *
 * The first run prompts for authorisation to read the master spreadsheet —
 * accept it as the same account the web app will execute as. Expect roughly
 * 522 rows, ~374 with a Kolkata DOJ, ~148 transferred out.
 */
function testReadMaster() {
  var rows = readMaster_();
  var withDoj = rows.filter(function (r) { return r.doj_kolkata; }).length;
  var out = rows.filter(function (r) { return r.transferred_out; }).length;

  Logger.log('source: %s', sourceSpreadsheetId_());
  Logger.log('rows: %s | with Kolkata DOJ: %s | transferred out: %s', rows.length, withDoj, out);

  var undated = rows.filter(function (r) {
    return !r.transferred_out && !r.doj_kolkata;
  });
  if (undated.length) {
    // These become exempt in SARC and raise a blocking pre-flight error, so
    // they are worth seeing here rather than discovering in the statement.
    Logger.log('WARNING — current staff with no Kolkata DOJ: %s', undated.length);
    Logger.log('  %s', JSON.stringify(undated.slice(0, 10).map(function (r) {
      return r.emp_id + ' ' + r.name;
    })));
  }

  Logger.log('sample: %s', JSON.stringify(rows.slice(0, 3), null, 2));
}
