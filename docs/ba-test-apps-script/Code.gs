/**
 * BA TEST LIST FEED — "VECC_Randomiser" workbook, BAT_REPORT tab
 *
 * Replaces the old Home-tab script, which read a single flat block of names out
 * of G12:H and had no idea standby existed. The randomiser now writes a report
 * with three labelled sections, so this script reads the sections instead of
 * fixed cells:
 *
 *   BA TEST REPORT - NSCBI Airport Kolkata
 *   Team: D | Duty: Night | Date: 08-Sep-2026
 *
 *   SELECTED FOR BA TEST (MAIN LIST)
 *   SL NO | ATCO NAME | EMP NO | STATUS     | SIGNATURE
 *   1     | ...       | ...    | Compulsory |
 *
 *   STANDBY LIST
 *   SL NO | ATCO NAME | EMP NO | STATUS  | SIGNATURE
 *   1     | ...       | ...    | STANDBY |
 *
 *   ALL PRESENT ATCOs
 *   SL NO | ATCO NAME | EMP NO | ATTENDANCE | SIGNATURE
 *
 * Nothing is hard-coded to a row number. Each section is found by its title in
 * column A and read until the block runs out of names, so a re-run of the
 * randomiser that produces 9 main names instead of 15 needs no script change.
 *
 * ── Endpoint ────────────────────────────────────────────────────────────────
 *   GET /exec → {
 *     team, shift, date, date_display, generated_at, sheet,
 *     counts:       { main, standby, present },
 *     main_list:    [{ sl_no, name, employee_number, status, list_type }],
 *     standby_list: [{ sl_no, name, employee_number, status, list_type }],
 *     present_list: [{ sl_no, name, employee_number, attendance }],
 *     employees:    main_list          // legacy key, see below
 *   }
 *
 *   `employees` is kept so an older deployment of the fetch-ba-test edge
 *   function keeps working during the changeover. It carries the MAIN list
 *   only — standby people must not land in the "you are selected" list on an
 *   app build that cannot yet tell the two apart.
 *
 * ── Deployment ──────────────────────────────────────────────────────────────
 *   Extensions → Apps Script, paste this in, then Deploy → New deployment →
 *   Web app, "Execute as: Me", "Who has access: Anyone with the link".
 *   Copy the /exec URL into the app: Admin → Settings → BA Test List Google
 *   Sheet URL (app_settings key `ba_test_sheet_url`).
 *
 *   Deploying is what publishes a change — saving the editor is not enough.
 *   Use "Manage deployments → edit → New version" to keep the same URL.
 */

// ── Config ───────────────────────────────────────────────────────────────────

var SPREADSHEET_ID = '1XvnHWRRwfspUfhzFn3ytPoJ4mPT4R3UYgN6Q7c-5FZo';
var SHEET_NAME     = 'BAT_REPORT';

/**
 * Section titles as they appear in column A, most specific pattern first.
 * `columns` names the 4th column of that block — the randomiser calls it
 * STATUS on the two selection lists and ATTENDANCE on the roll call.
 */
var SECTIONS = [
  { key: 'standby', title: /STANDBY/i,                          extra: 'status'     },
  { key: 'present', title: /ALL\s+PRESENT/i,                    extra: 'attendance' },
  { key: 'main',    title: /MAIN\s+LIST|SELECTED\s+FOR\s+BA/i,  extra: 'status'     }
];

var MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function baOpenSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);

  // Fallback: a tab whose name merely contains BAT_REPORT / BA REPORT, then
  // the first tab. Better a slightly wrong sheet than a hard failure at 05:40.
  if (!sheet) {
    var tabs = ss.getSheets();
    for (var i = 0; i < tabs.length; i++) {
      if (/BAT[_\s-]*REPORT/i.test(tabs[i].getName())) { sheet = tabs[i]; break; }
    }
  }
  if (!sheet) sheet = ss.getSheets()[0];

  return sheet;
}

function baText_(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

/** "10020139", 10020139 and 10020139.0 all come back as "10020139". */
function baEmpNumber_(value) {
  var text = baText_(value);
  if (!text) return null;
  text = text.replace(/\.0+$/, '');
  return text || null;
}

/** "08-Sep-2026" / "8 Sep 2026" / a real Date → "2026-09-08". */
function baIsoDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  var text = baText_(value);
  if (!text) return null;

  var already = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (already) return already[0];

  var named = text.match(/(\d{1,2})[-\/\s]([A-Za-z]{3,})[-\/\s](\d{4})/);
  if (named) {
    var month = MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (month) {
      return named[3] + '-' +
        ('0' + month).slice(-2) + '-' +
        ('0' + named[1]).slice(-2);
    }
  }

  var numeric = text.match(/(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);  // dd-mm-yyyy
  if (numeric) {
    return numeric[3] + '-' +
      ('0' + numeric[2]).slice(-2) + '-' +
      ('0' + numeric[1]).slice(-2);
  }

  return null;
}

/**
 * Pulls "Team: D | Duty: Night | Date: 08-Sep-2026" apart. The banner is read
 * from the whole of the first few rows rather than one cell, so it survives the
 * randomiser splitting it across columns or moving it down a row.
 */
function baParseHeader_(grid) {
  var banner = [];
  for (var r = 0; r < Math.min(grid.length, 4); r++) {
    for (var c = 0; c < grid[r].length; c++) {
      var cell = baText_(grid[r][c]);
      if (cell) banner.push(cell);
    }
  }
  var text = banner.join(' | ');

  var team  = text.match(/Team\s*[:\-]\s*([^|,;]+)/i);
  var duty  = text.match(/(?:Duty|Shift)\s*[:\-]\s*([^|,;]+)/i);
  var date  = text.match(/Date\s*[:\-]\s*([^|,;]+)/i);

  return {
    team:         team ? baText_(team[1]) : '',
    shift:        duty ? baText_(duty[1]) : '',
    date_display: date ? baText_(date[1]) : '',
    date:         date ? baIsoDate_(date[1]) : null
  };
}

/** Is this row the "SL NO | ATCO NAME | ..." column-header row? */
function baIsHeaderRow_(row) {
  return /^SL\.?\s*NO/i.test(baText_(row[0])) || /ATCO\s*NAME/i.test(baText_(row[1]));
}

/** Which section, if any, does this row's column A announce? */
function baSectionAt_(row) {
  var title = baText_(row[0]);
  if (!title || title.length > 80) return null;
  // A data row's column A is the serial number, never a title.
  if (/^\d+$/.test(title)) return null;

  for (var i = 0; i < SECTIONS.length; i++) {
    if (SECTIONS[i].title.test(title)) return SECTIONS[i];
  }
  return null;
}

/**
 * Reads one section's rows, starting just below its title. Stops at the next
 * section title, or once two consecutive rows carry no name — a single blank
 * spacer row inside a block will not truncate the list.
 */
function baReadSection_(grid, startIndex, section) {
  var rows = [];
  var blanks = 0;

  for (var r = startIndex; r < grid.length; r++) {
    var row = grid[r];

    if (baSectionAt_(row)) break;
    if (baIsHeaderRow_(row)) continue;

    var name = baText_(row[1]);
    if (!name) {
      if (++blanks >= 2) break;
      continue;
    }
    blanks = 0;

    var slNo  = parseInt(baText_(row[0]), 10);
    var entry = {
      sl_no:           isNaN(slNo) ? rows.length + 1 : slNo,
      name:            name,
      employee_number: baEmpNumber_(row[2])
    };

    if (section.extra === 'attendance') {
      entry.attendance = baText_(row[3]) || null;
    } else {
      entry.status    = baText_(row[3]) || null;
      entry.list_type = section.key === 'standby' ? 'STANDBY' : 'MAIN';
    }

    rows.push(entry);
  }

  return rows;
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. CORE LOGIC
// ══════════════════════════════════════════════════════════════════════════════

function getStaffData() {
  var sheet = baOpenSheet_();
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), 5);

  if (lastRow < 1) {
    return {
      team: '', shift: 'Not Selected', date: null, date_display: '',
      generated_at: new Date().toISOString(), sheet: sheet.getName(),
      counts: { main: 0, standby: 0, present: 0 },
      main_list: [], standby_list: [], present_list: [], employees: []
    };
  }

  // One read for the whole report. getDisplayValues keeps emp numbers and the
  // date exactly as the sheet shows them.
  var grid = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();

  var header = baParseHeader_(grid);
  var lists  = { main: [], standby: [], present: [] };

  for (var r = 0; r < grid.length; r++) {
    var section = baSectionAt_(grid[r]);
    if (!section) continue;
    lists[section.key] = baReadSection_(grid, r + 1, section);
  }

  return {
    team:         header.team,
    shift:        header.shift || 'Not Selected',
    date:         header.date,
    date_display: header.date_display,
    generated_at: new Date().toISOString(),
    sheet:        sheet.getName(),
    counts: {
      main:    lists.main.length,
      standby: lists.standby.length,
      present: lists.present.length
    },
    main_list:    lists.main,
    standby_list: lists.standby,
    present_list: lists.present,

    // Legacy key — MAIN list only. See the note at the top of this file.
    employees:    lists.main
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. API ENDPOINT
// ══════════════════════════════════════════════════════════════════════════════

function doGet(e) {
  try {
    return ContentService
      .createTextOutput(JSON.stringify(getStaffData()))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. TEST FUNCTIONS (run these from the editor)
// ══════════════════════════════════════════════════════════════════════════════

function testFetchData() {
  var data = getStaffData();
  Logger.log('Team: %s | Shift: %s | Date: %s (%s)',
    data.team, data.shift, data.date, data.date_display);
  Logger.log('Main: %s | Standby: %s | Present: %s',
    data.counts.main, data.counts.standby, data.counts.present);
  Logger.log(JSON.stringify(data, null, 2));
}

/** Prints what each section resolved to, and where. Use when a list comes back empty. */
function testSections() {
  var sheet = baOpenSheet_();
  Logger.log('Sheet: %s | rows: %s | cols: %s',
    sheet.getName(), sheet.getLastRow(), sheet.getLastColumn());

  var grid = sheet.getRange(1, 1, sheet.getLastRow(),
    Math.max(sheet.getLastColumn(), 5)).getDisplayValues();

  Logger.log('Header: %s', JSON.stringify(baParseHeader_(grid)));

  var found = 0;
  for (var r = 0; r < grid.length; r++) {
    var section = baSectionAt_(grid[r]);
    if (!section) continue;
    found++;
    var rows = baReadSection_(grid, r + 1, section);
    Logger.log('Row %s → "%s" → section "%s" → %s entries; first: %s',
      r + 1, grid[r][0], section.key, rows.length,
      rows.length ? JSON.stringify(rows[0]) : '(none)');
  }

  if (!found) {
    Logger.log('No section titles matched. Column A of the first 40 rows:');
    for (var i = 0; i < Math.min(grid.length, 40); i++) {
      Logger.log('  %s: "%s"', i + 1, grid[i][0]);
    }
  }
}
