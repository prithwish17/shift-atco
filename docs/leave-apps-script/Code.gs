/**
 * LEAVE DATA WRITE-BACK API — "ATTENDANCE-2026" workbook, LEAVE_DATA tab
 *
 * The companion to the read-only feed the app already consumes
 * (supabase/functions/fetch-leave-data). This one goes the other way: the app
 * POSTs leave data and the script drops each value into the exact cell the
 * sheet keeps it in, matched by EMP NO with NAME as a confirmation.
 *
 * ── Why it resolves the layout instead of hard-coding columns ────────────────
 *   The tab is 169 columns wide and its shape is described by two header rows:
 *   row 1 carries merged banners ("C-OFF FOR DUTY PERFORMED IN CLOSED
 *   HOLIDAYS"), row 2 the per-column labels ("C/L1", "23-Jan-2026 CH-1",
 *   "C-OFF valid till 22-Apr-2026"). Every closed holiday added next year
 *   shifts everything to its right. So the script reads those two rows and
 *   derives the map each run — the same script works on the live workbook and
 *   on a copy, before and after columns move.
 *
 * ── What it will not touch ──────────────────────────────────────────────────
 *   1. Any column outside the resolved writable region (F..DN today). The
 *      per-employee totals (CL / RH / C-OFFs / OPE C-Offs) and the 45-column
 *      pending-comp-off helper block to their right are computed, never sent.
 *   2. Any cell holding a formula, wherever it is. Checked per cell, per run.
 *   3. Anything at all when dryRun is set — you get the full diff and no write.
 *
 * ── Endpoints ───────────────────────────────────────────────────────────────
 *   GET  ?action=layout                → the resolved column map (audit this first)
 *   GET  ?action=employees             → every EMP NO / NAME / row on the tab
 *   GET  ?action=export&empId=10014941 → one employee's data as a POST payload
 *   POST { token, mode, dryRun, employees: [...] }  → writes; see the doc at
 *        docs/LEAVE_SHEET_WRITEBACK.md for the payload contract.
 *
 * ── Deployment ──────────────────────────────────────────────────────────────
 *   Extensions → Apps Script, paste this in, then Deploy → New deployment →
 *   Web app, "Execute as: Me", "Who has access: Anyone with the link".
 *
 *   Set ACCESS_TOKEN to a long random string before deploying anything that can
 *   write. Unlike the read-only feeds, an unauthenticated /exec URL here is a
 *   public write handle on the leave register.
 */

/** Shared secret. Required for POST; also checked on GET when set. */
var ACCESS_TOKEN = "";

/** Default tab. Overridable per request with `sheet`. */
var SHEET_NAME = "LEAVE_DATA";

/** Applied to date cells we fill that had no date format of their own. */
var DATE_FORMAT = "d-mmm-yyyy";

/** Written into a National Holiday column when the payload gives no mark. */
var NH_MARK = "NH";

/** Rows searched for the "EMP NO" header before giving up. */
var HEADER_SCAN_ROWS = 6;

/** OPE columns carrying this label are positional; the rest are reserved. */
var GENERIC_OPE_LABEL = "ope";

/** Changes listed individually in the response before it switches to counts. */
var MAX_REPORTED_CHANGES = 2000;

/* ─── Entry points ─────────────────────────────────────────────────────────── */

function doGet(e) {
  // Running from the editor gives no `e`; steer to testLayout instead.
  if (!e || !e.parameter) {
    return jsonOut_({
      error: "Run this via its web app URL. Use testLayout() to debug in the editor."
    });
  }

  if (!authorised_(e.parameter.token)) return jsonOut_({ error: "Unauthorized" });

  try {
    var action = String(e.parameter.action || "layout").toLowerCase();
    var sheet = mustFindSheet_(SpreadsheetApp.getActiveSpreadsheet(),
                               e.parameter.sheet || SHEET_NAME);
    var layout = resolveLayout_(sheet);

    if (action === "layout") return jsonOut_(describeLayout_(sheet, layout));
    if (action === "employees") return jsonOut_({
      sheet: sheet.getName(),
      employees: readEmployees_(sheet, layout).list
    });
    if (action === "export") {
      var empId = String(e.parameter.empId || "").trim();
      if (!empId) throw new Error("action=export needs &empId=");
      return jsonOut_(exportEmployee_(sheet, layout, empId));
    }

    throw new Error("Unknown action '" + action + "'. Use layout, employees or export.");
  } catch (err) {
    return jsonOut_({ error: errorText_(err) });
  }
}

function doPost(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return jsonOut_({ error: "POST a JSON body. Use testDryRun() to debug in the editor." });
  }

  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut_({ error: "Body is not valid JSON: " + errorText_(err) });
  }

  var token = body.token || (e.parameter && e.parameter.token);
  if (!ACCESS_TOKEN) return jsonOut_({ error: "ACCESS_TOKEN is not set — refusing to write." });
  if (!authorised_(token)) return jsonOut_({ error: "Unauthorized" });

  // One writer at a time; two concurrent syncs would each write a row region
  // read before the other's changes landed.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return jsonOut_({ error: "Another write is in progress — retry in a moment." });
  }

  try {
    return jsonOut_(writePayload_(body));
  } catch (err) {
    return jsonOut_({ error: errorText_(err) });
  } finally {
    lock.releaseLock();
  }
}

function authorised_(token) {
  return !ACCESS_TOKEN || String(token || "") === ACCESS_TOKEN;
}

/* ─── Layout resolution ────────────────────────────────────────────────────── */

/**
 * Reads rows 1-2 and returns every column the writer is allowed to reach.
 *
 * Blocks are found by their row-1 banner and then walked two columns at a time.
 * A pair is only accepted while the second column's header starts with "C-OFF",
 * which is what stops the walk at the end of each block — the last banner
 * ("OPE (from previous station)") otherwise fills right across the totals and
 * helper columns, and those must stay out of the writable region.
 */
function resolveLayout_(sheet) {
  var lastCol = sheet.getLastColumn();
  var scanRows = Math.min(HEADER_SCAN_ROWS, sheet.getLastRow());
  if (scanRows < 2) throw new Error("Sheet '" + sheet.getName() + "' has no header rows.");

  var range = sheet.getRange(1, 1, scanRows, lastCol);
  var values = range.getValues();
  var display = range.getDisplayValues();

  var headerIdx = -1;
  for (var r = 0; r < values.length && headerIdx < 0; r++) {
    for (var c = 0; c < values[r].length; c++) {
      if (key_(values[r][c]) === "empno") { headerIdx = r; break; }
    }
  }
  if (headerIdx < 0) {
    throw new Error("No header row containing 'EMP NO' in the first " + scanRows + " rows of '" +
                    sheet.getName() + "'.");
  }

  // Labels come from the displayed text — a header like "23-Jan-2026 CH-1" is
  // sometimes a real date wearing a custom format, and getValues() would hand
  // back a Date with the " CH-1" part lost.
  var header = display[headerIdx];
  var headerValues = values[headerIdx];
  var banner = fillRight_(headerIdx > 0 ? display[headerIdx - 1] : []);

  var layout = {
    headerRow: headerIdx + 1,
    firstDataRow: headerIdx + 2,
    lastCol: lastCol,
    header: header,
    banner: banner,
    slNoCol: findHeader_(header, "slno"),
    empNoCol: mustFindHeader_(header, "empno"),
    nameCol: mustFindHeader_(header, "name"),
    desigCol: findHeader_(header, "desig"),
    cl: [],
    halfCl: [],
    rh: [],
    nh: [],
    ch: [],
    lastYear: [],
    ope: [],
    opePrevious: []
  };

  // ── Block 1: CL, RH & NH ──
  var numbered = [];
  for (var c = 0; c < header.length; c++) {
    var k = key_(header[c]);
    var m = k.match(/^cl(\d+)$/);
    if (m) numbered.push({ col: c, n: Number(m[1]) });
    else if (k === "12cl") layout.halfCl.push(c);
  }
  numbered.sort(function (a, b) { return a.n - b.n; });
  layout.cl = numbered.map(function (x) { return x.col; });

  for (var n = 1; n <= 9; n++) {
    var rhCol = findHeader_(header, "rh" + n);
    if (rhCol < 0) break;
    layout.rh.push({
      index: n,
      dateCol: rhCol,
      appliedCol: key_(header[rhCol + 1] || "").indexOf("coff") === 0 ? rhCol + 1 : -1
    });
  }

  var firstBlock = bannerRange_(banner, "CL, RH & NH");
  if (firstBlock) {
    for (var d = firstBlock.start; d <= firstBlock.end; d++) {
      if (layout.cl.indexOf(d) >= 0 || layout.halfCl.indexOf(d) >= 0) continue;
      if (rhColumn_(layout, d)) continue;
      var nhDate = headerDate_(headerValues[d], header[d]);
      if (nhDate) layout.nh.push({ date: nhDate, col: d, label: text_(header[d]) });
    }
  }

  // ── Blocks 2-5: the (duty, comp-off) column pairs ──
  layout.ch = pairBlock_(banner, header, headerValues, "closed holidays", true);
  layout.lastYear = pairBlock_(banner, header, headerValues, "last year", true);
  layout.ope = pairBlock_(banner, header, headerValues, "against ope", false);
  layout.opePrevious = pairBlock_(banner, header, headerValues, "previous station", false);

  layout.writable = writableColumns_(layout);
  var bounds = columnBounds_(layout.writable);
  layout.firstWritableCol = bounds.first;
  layout.lastWritableCol = bounds.last;

  if (layout.firstWritableCol < 0) {
    throw new Error("Resolved no writable columns on '" + sheet.getName() + "' — check the header rows.");
  }

  return layout;
}

/** Merged banner cells only carry their value in the first column; spread it. */
function fillRight_(row) {
  var out = [];
  var carried = "";
  for (var c = 0; c < row.length; c++) {
    var v = text_(row[c]);
    if (v) carried = v;
    out.push(carried);
  }
  return out;
}

/** Start and end columns of the banner containing `needle`. */
function bannerRange_(banner, needle) {
  var target = key_(needle);
  var start = -1;
  for (var c = 0; c < banner.length; c++) {
    if (key_(banner[c]).indexOf(target) !== -1) { start = c; break; }
  }
  if (start < 0) return null;

  var same = key_(banner[start]);
  var end = start;
  while (end + 1 < banner.length && key_(banner[end + 1]) === same) end++;
  return { start: start, end: end, label: banner[start] };
}

/**
 * Walks a banner's columns as (duty, comp-off) pairs.
 *
 * `dated` blocks are addressed by the holiday date in the duty column's header
 * ("23-Jan-2026 CH-1"); undated ones (OPE) are positional, so their slots are
 * identified by label instead — "OPE" slots take whatever comes next in order,
 * "ELECTION" and friends are reserved and only filled when a payload item names
 * them.
 */
function pairBlock_(banner, header, headerValues, needle, dated) {
  var range = bannerRange_(banner, needle);
  var slots = [];
  if (!range) return slots;

  for (var c = range.start; c + 1 <= range.end && c + 1 < header.length; c += 2) {
    if (key_(header[c + 1]).indexOf("coff") !== 0) break;
    slots.push({
      index: slots.length,
      dutyCol: c,
      appliedCol: c + 1,
      label: text_(header[c]),
      slotKey: key_(header[c]) || "",
      date: dated ? headerDate_(headerValues[c], header[c]) : null,
      generic: key_(header[c]) === GENERIC_OPE_LABEL
    });
  }

  return slots;
}

function rhColumn_(layout, col) {
  for (var i = 0; i < layout.rh.length; i++) {
    if (layout.rh[i].dateCol === col || layout.rh[i].appliedCol === col) return true;
  }
  return false;
}

/** The hard guard: the only columns any writer is ever allowed to reach. */
function writableColumns_(layout) {
  var set = {};
  var mark = function (col) { if (col != null && col >= 0) set[col] = true; };

  layout.cl.forEach(mark);
  layout.halfCl.forEach(mark);
  layout.nh.forEach(function (x) { mark(x.col); });
  layout.rh.forEach(function (x) { mark(x.dateCol); mark(x.appliedCol); });

  [layout.ch, layout.lastYear, layout.ope, layout.opePrevious].forEach(function (slots) {
    slots.forEach(function (s) { mark(s.dutyCol); mark(s.appliedCol); });
  });

  return set;
}

function columnBounds_(writable) {
  var first = -1, last = -1;
  for (var col in writable) {
    var c = Number(col);
    if (first < 0 || c < first) first = c;
    if (c > last) last = c;
  }
  return { first: first, last: last };
}

function describeLayout_(sheet, layout) {
  var emps = readEmployees_(sheet, layout);
  var slots = function (list) {
    return list.map(function (s) {
      return {
        index: s.index,
        label: s.label,
        date: s.date || null,
        generic: !!s.generic,
        dutyCell: a1_(s.dutyCol),
        compOffCell: a1_(s.appliedCol)
      };
    });
  };

  return {
    sheet: sheet.getName(),
    headerRow: layout.headerRow,
    dataRows: { first: layout.firstDataRow, last: sheet.getLastRow(), employees: emps.list.length },
    identity: {
      slNo: a1_(layout.slNoCol),
      empNo: a1_(layout.empNoCol),
      name: a1_(layout.nameCol),
      designation: a1_(layout.desigCol)
    },
    writableRange: a1_(layout.firstWritableCol) + ":" + a1_(layout.lastWritableCol),
    casualLeave: layout.cl.map(a1_),
    halfCasualLeave: layout.halfCl.map(a1_),
    restrictedHolidays: layout.rh.map(function (r) {
      return { index: r.index, dateCell: a1_(r.dateCol), compOffCell: a1_(r.appliedCol) };
    }),
    nationalHolidays: layout.nh.map(function (h) {
      return { date: h.date, label: h.label, cell: a1_(h.col) };
    }),
    closedHolidays: slots(layout.ch),
    lastYearCompOff: slots(layout.lastYear),
    opeDuty: slots(layout.ope),
    opePreviousStation: slots(layout.opePrevious),
    duplicateEmpIds: emps.duplicates
  };
}

/* ─── Employee index ───────────────────────────────────────────────────────── */

/**
 * EMP NO is the key — all 391 rows carry a distinct 8-digit code, whereas two
 * employees share the name RAJKUMAR. NAME is kept as a confirmation only.
 */
function readEmployees_(sheet, layout) {
  var lastRow = sheet.getLastRow();
  var count = lastRow - layout.firstDataRow + 1;
  var list = [];
  var byId = {};
  var duplicates = [];

  if (count <= 0) return { list: list, byId: byId, duplicates: duplicates };

  var width = Math.max(layout.empNoCol, layout.nameCol, layout.slNoCol) + 1;
  var rows = sheet.getRange(layout.firstDataRow, 1, count, width).getValues();

  for (var i = 0; i < rows.length; i++) {
    var empId = empKey_(rows[i][layout.empNoCol]);
    if (!empId) continue;

    var entry = {
      empId: empId,
      name: text_(rows[i][layout.nameCol]),
      slNo: layout.slNoCol >= 0 ? text_(rows[i][layout.slNoCol]) : "",
      row: layout.firstDataRow + i
    };

    list.push(entry);
    if (byId[empId]) duplicates.push({ empId: empId, rows: [byId[empId].row, entry.row] });
    else byId[empId] = entry;
  }

  return { list: list, byId: byId, duplicates: duplicates };
}

/** Digits only, leading zeros dropped, so "010014941" and 10014941 agree. */
function empKey_(value) {
  var raw = value instanceof Date ? "" : String(value == null ? "" : value).trim();
  if (!raw) return "";
  var digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return raw.toUpperCase();
  return digits.replace(/^0+(?=\d)/, "");
}

/* ─── Write ────────────────────────────────────────────────────────────────── */

function writePayload_(body) {
  var sheet = mustFindSheet_(SpreadsheetApp.getActiveSpreadsheet(), body.sheet || SHEET_NAME);
  var layout = resolveLayout_(sheet);
  var index = readEmployees_(sheet, layout);

  var mode = String(body.mode || "merge").toLowerCase();
  if (mode !== "merge" && mode !== "replace") {
    throw new Error("mode must be 'merge' or 'replace', got '" + mode + "'.");
  }

  var dryRun = body.dryRun !== false && body.dryRun !== "false" ? !!body.dryRun : false;
  var allowNameMismatch = !!body.allowNameMismatch;
  var incoming = Array.isArray(body.employees) ? body.employees
               : Array.isArray(body.data) ? body.data
               : null;
  if (!incoming) throw new Error("Payload needs an `employees` array.");

  // Resolve rows first so only the span that actually changes is read back.
  var targets = [];
  var unmatched = [];

  for (var i = 0; i < incoming.length; i++) {
    var item = incoming[i] || {};
    var info = item.employee && typeof item.employee === "object" ? item.employee : item;
    var empId = empKey_(info.empId || info.employee_id || info.emp_id);
    var name = text_(info.name || info.employee_name);

    if (!empId) {
      unmatched.push({ empId: "", name: name, reason: "no EMP NO in payload" });
      continue;
    }

    var match = index.byId[empId];
    if (!match) {
      unmatched.push({ empId: empId, name: name, reason: "EMP NO not on the sheet" });
      continue;
    }

    // A name that disagrees usually means the payload was keyed off a stale
    // roster; writing 12 dates onto the wrong person is not worth the guess.
    if (name && key_(name) !== key_(match.name) && !allowNameMismatch) {
      unmatched.push({
        empId: empId,
        name: name,
        reason: "name mismatch — sheet row " + match.row + " is '" + match.name +
                "'. Re-send with allowNameMismatch:true to write anyway."
      });
      continue;
    }

    targets.push({ item: item, entry: match, empId: empId, payloadName: name });
  }

  if (!targets.length) {
    return {
      ok: true,
      dryRun: dryRun,
      mode: mode,
      sheet: sheet.getName(),
      employees: { received: incoming.length, matched: 0, changed: 0, unmatched: unmatched.length },
      cellsChanged: 0,
      results: [],
      unmatched: unmatched
    };
  }

  var minRow = targets[0].entry.row, maxRow = targets[0].entry.row;
  targets.forEach(function (t) {
    if (t.entry.row < minRow) minRow = t.entry.row;
    if (t.entry.row > maxRow) maxRow = t.entry.row;
  });

  var firstCol = layout.firstWritableCol;
  var width = layout.lastWritableCol - firstCol + 1;
  var region = sheet.getRange(minRow, firstCol + 1, maxRow - minRow + 1, width);
  var values = region.getValues();
  var formulas = region.getFormulas();
  var formats = region.getNumberFormats();

  var results = [];
  var changed = {};
  var totalChanges = 0;
  var reported = 0;

  for (var t = 0; t < targets.length; t++) {
    var rowIdx = targets[t].entry.row - minRow;
    var before = values[rowIdx].slice();

    var ctx = {
      layout: layout,
      values: values,
      formulas: formulas,
      formats: formats,
      firstCol: firstCol,
      rowIdx: rowIdx,
      row: targets[t].entry.row,
      sections: {},
      warnings: []
    };

    applyEmployee_(ctx, targets[t].item, mode);

    // Diffed against the row as it arrived, not counted per set_ call: replace
    // clears a section and writes it straight back, and counting both halves
    // reports thousands of changes for a sync that altered nothing.
    var diff = rowDiff_(ctx, before);
    if (diff.length) changed[rowIdx] = true;
    totalChanges += diff.length;

    var result = {
      empId: targets[t].empId,
      name: targets[t].entry.name,
      row: ctx.row,
      cellsChanged: diff.length,
      warnings: ctx.warnings
    };
    if (reported < MAX_REPORTED_CHANGES) {
      result.changes = diff.slice(0, MAX_REPORTED_CHANGES - reported);
      reported += result.changes.length;
    }
    results.push(result);
  }

  var rowsWritten = 0;
  if (!dryRun && totalChanges) {
    rowsWritten = flush_(sheet, minRow, firstCol, width, values, formulas, formats, changed);
    SpreadsheetApp.flush();
  }

  return {
    ok: true,
    dryRun: dryRun,
    mode: mode,
    sheet: sheet.getName(),
    employees: {
      received: incoming.length,
      matched: targets.length,
      changed: Object.keys(changed).length,
      unmatched: unmatched.length
    },
    cellsChanged: totalChanges,
    rowsWritten: rowsWritten,
    changesTruncated: totalChanges > reported,
    results: results,
    unmatched: unmatched
  };
}

/**
 * Writes changed rows back in contiguous blocks.
 *
 * Cells that hold formulas are put back as their formula text, so a block write
 * can never flatten one into its computed value — the writable region should
 * contain none, but the totals sit one column past its edge and that is too
 * close to rely on arithmetic alone.
 */
function flush_(sheet, minRow, firstCol, width, values, formulas, formats, changed) {
  var rows = Object.keys(changed).map(Number).sort(function (a, b) { return a - b; });
  var written = 0;
  var i = 0;

  while (i < rows.length) {
    var start = rows[i];
    var end = start;
    while (i + 1 < rows.length && rows[i + 1] === end + 1) { end = rows[++i]; }
    i++;

    var block = [];
    var blockFormats = [];
    for (var r = start; r <= end; r++) {
      var out = [];
      for (var c = 0; c < width; c++) {
        out.push(formulas[r][c] !== "" ? formulas[r][c] : values[r][c]);
      }
      block.push(out);
      blockFormats.push(formats[r]);
    }

    var range = sheet.getRange(minRow + start, firstCol + 1, block.length, width);
    range.setNumberFormats(blockFormats);   // before the values: a "@" cell would stringify a Date
    range.setValues(block);
    written += block.length;
  }

  return written;
}

/* ─── Per-employee section writers ─────────────────────────────────────────── */

function applyEmployee_(ctx, item, mode) {
  var cl = firstArray_(item, ["casualLeave", "cl", "casual_leave"]);
  if (cl) writeDateList_(ctx, ctx.layout.cl, cl, "casualLeave", mode);

  var halfCl = firstArray_(item, ["halfCasualLeave", "halfCl", "half_casual_leave", "halfDayCasualLeave"]);
  if (halfCl) writeDateList_(ctx, ctx.layout.halfCl, halfCl, "halfCasualLeave", mode);

  var rh = firstArray_(item, ["restrictedHolidays", "rh", "restricted_holidays"]);
  if (rh) writeRestrictedHolidays_(ctx, rh, mode);

  var nh = firstArray_(item, ["nationalHolidays", "nh", "national_holidays"]);
  if (nh) writeNationalHolidays_(ctx, nh, mode);

  var ch = firstArray_(item, ["closedHolidays", "ch", "closed_holidays"]);
  if (ch) writeDatedSlots_(ctx, ctx.layout.ch, ch, "closedHolidays", mode);

  var lastYear = firstArray_(item, ["lastYearCompOff", "lastYearCh", "last_year_comp_off"]);
  if (lastYear) writeDatedSlots_(ctx, ctx.layout.lastYear, lastYear, "lastYearCompOff", mode);

  var ope = firstArray_(item, ["opeDuty", "ope", "ope_duty"]);
  if (ope) writeOpeSlots_(ctx, ctx.layout.ope, ope, "opeDuty", mode);

  var opePrev = firstArray_(item, ["opePreviousStation", "opePrevious", "ope_previous_station"]);
  if (opePrev) writeOpeSlots_(ctx, ctx.layout.opePrevious, opePrev, "opePreviousStation", mode);
}

/**
 * C/L1..C/L12 and the four 1/2 CL columns: a left-packed list, filled in the
 * order the payload gives.
 *
 * Values are not required to be dates. Thirty rows carry "NA" in the CL columns
 * and a few hold half-written entries like "6 Apr"; a writer that rejected
 * those could not reproduce the sheet it had just read.
 */
function writeDateList_(ctx, cols, incoming, section, mode) {
  var values = [];
  for (var i = 0; i < incoming.length; i++) {
    var v = cellValue_(dateField_(incoming[i], ["date", "leaveDate", "leave_date"]));
    if (v === null || v === "") {
      ctx.warnings.push(section + ": skipped blank entry " + JSON.stringify(incoming[i]));
      continue;
    }
    values.push(v);
  }

  if (mode === "replace") {
    cols.forEach(function (col) { setCell_(ctx, col, "", section); });
    for (var w = 0; w < values.length; w++) {
      if (w >= cols.length) {
        ctx.warnings.push(section + ": " + (values.length - cols.length) + " entries beyond the " +
                          cols.length + " columns available were dropped.");
        break;
      }
      setCell_(ctx, cols[w], values[w], section);
    }
    return;
  }

  var used = {};
  for (var j = 0; j < values.length; j++) {
    var at = findColWithValue_(ctx, cols, values[j], used);
    if (at >= 0) { used[at] = true; continue; }      // already recorded

    var free = firstFreeCol_(ctx, cols);
    if (free < 0) {
      ctx.warnings.push(section + ": no free column left for " + display_(values[j]) +
                        " (" + cols.length + " in use).");
      continue;
    }
    setCell_(ctx, free, values[j], section);
    used[free] = true;
  }
}

/** R/H1 and R/H2: the holiday date, plus the date the day off was actually taken. */
function writeRestrictedHolidays_(ctx, incoming, mode) {
  var slots = ctx.layout.rh;
  var section = "restrictedHolidays";

  if (mode === "replace") {
    slots.forEach(function (s) {
      setCell_(ctx, s.dateCol, "", section);
      setCell_(ctx, s.appliedCol, "", section);
    });
  }

  var used = {};

  for (var i = 0; i < incoming.length; i++) {
    var entry = incoming[i] || {};
    var rhDate = asDate_(dateField_(entry, ["date", "rhDate", "rh_date", "actualRhDate", "actual_rh_date"]));
    var applied = cellValue_(pick_(entry, ["leaveApplied", "leave_applied", "compOff", "leaveUsedOn", "leave_used_on"]));

    if (!rhDate) {
      ctx.warnings.push(section + ": skipped entry with no RH date " + JSON.stringify(entry));
      continue;
    }

    var slot = null;
    for (var s = 0; s < slots.length && !slot; s++) {
      if (!used[s] && sameDate_(readCell_(ctx, slots[s].dateCol), rhDate)) { slot = slots[s]; used[s] = true; }
    }
    if (!slot) {
      for (var f = 0; f < slots.length && !slot; f++) {
        if (!used[f] && freeCell_(ctx, slots[f].dateCol)) { slot = slots[f]; used[f] = true; }
      }
    }
    if (!slot) {
      ctx.warnings.push(section + ": both R/H columns are taken, " + iso_(rhDate) + " not written.");
      continue;
    }

    setCell_(ctx, slot.dateCol, rhDate, section);
    if (applied !== null && slot.appliedCol >= 0) setCell_(ctx, slot.appliedCol, applied, section);
  }
}

/** The three fixed National Holiday columns, addressed by their header date. */
function writeNationalHolidays_(ctx, incoming, mode) {
  var section = "nationalHolidays";
  var touched = {};

  for (var i = 0; i < incoming.length; i++) {
    var entry = incoming[i];
    var d = asDate_(dateField_(entry, ["date", "nhDate", "nh_date", "leaveDate"]));
    if (!d) {
      ctx.warnings.push(section + ": skipped unparseable entry " + JSON.stringify(entry));
      continue;
    }

    var slot = null;
    for (var s = 0; s < ctx.layout.nh.length && !slot; s++) {
      if (ctx.layout.nh[s].date === iso_(d)) slot = ctx.layout.nh[s];
    }
    if (!slot) {
      ctx.warnings.push(section + ": no column for " + iso_(d) + " on this sheet.");
      continue;
    }

    var mark = entry && typeof entry === "object"
      ? cellValue_(pick_(entry, ["mark", "value", "leaveApplied"]))
      : null;
    setCell_(ctx, slot.col, mark === null ? NH_MARK : mark, section);
    touched[slot.col] = true;
  }

  if (mode === "replace") {
    ctx.layout.nh.forEach(function (slot) {
      if (!touched[slot.col]) setCell_(ctx, slot.col, "", section);
    });
  }
}

/**
 * Closed-holiday and last-year comp-off pairs, addressed by the holiday date in
 * the column header: duty performed on the left, the date the comp-off was
 * taken on the right.
 *
 * `replace` clears only the slots this payload does not mention. Clearing the
 * rest would wipe the "NA"/"CH" markers the sheet carries for holidays the app
 * has no record of, which is most of them.
 */
function writeDatedSlots_(ctx, slots, incoming, section, mode) {
  var touched = {};

  for (var i = 0; i < incoming.length; i++) {
    var entry = incoming[i] || {};
    var d = asDate_(dateField_(entry, ["date", "chDate", "ch_date", "dutyDate", "duty_date", "leaveDate"]));
    var duty = cellValue_(pick_(entry, ["dutyPerformed", "duty_performed", "dateOrDutyPerformed", "dutyCode", "duty_code", "shift"]));
    var applied = cellValue_(pick_(entry, ["leaveApplied", "leave_applied", "compOff", "leaveUsedOn", "leave_used_on"]));

    var slot = null;
    var wanted = pick_(entry, ["slotIndex", "slot_index"]);
    if (wanted !== null && slots[Number(wanted)]) slot = slots[Number(wanted)];

    if (!slot && d) {
      for (var s = 0; s < slots.length && !slot; s++) {
        if (slots[s].date === iso_(d)) slot = slots[s];
      }
    }

    // Undated spare slots exist in the last-year block for carry-overs that do
    // not line up with one of its three named holidays.
    if (!slot && d) {
      for (var f = 0; f < slots.length && !slot; f++) {
        if (!slots[f].date && freeCell_(ctx, slots[f].dutyCol) &&
            freeCell_(ctx, slots[f].appliedCol)) {
          slot = slots[f];
          if (duty === null) duty = d;   // spare slots carry the duty date itself
        }
      }
    }

    if (!slot) {
      ctx.warnings.push(section + ": no column for " + (d ? iso_(d) : JSON.stringify(entry)) + " on this sheet.");
      continue;
    }

    if (duty !== null) setCell_(ctx, slot.dutyCol, duty, section);
    if (applied !== null) setCell_(ctx, slot.appliedCol, applied, section);
    touched[slot.index] = true;
  }

  if (mode === "replace") {
    slots.forEach(function (slot) {
      if (touched[slot.index]) return;
      setCell_(ctx, slot.dutyCol, "", section);
      setCell_(ctx, slot.appliedCol, "", section);
    });
  }
}

/**
 * OPE pairs. These have no dates in their headers — the duty date goes in the
 * left column — so generic "OPE" slots are filled in order and the reserved
 * ones ("ELECTION", "ELECTION2") only when an item names them via `slot`.
 *
 * The duty value is not required to parse as a date: the block is full of
 * legacy entries typed as "29 Apr", and rewriting those into real dates is a
 * data cleanup, not a sync, so whatever the payload sends goes in verbatim.
 */
function writeOpeSlots_(ctx, slots, incoming, section, mode) {
  var named = {};
  var generic = [];
  slots.forEach(function (s) {
    if (s.generic) generic.push(s);
    else named[s.slotKey] = s;
  });

  var items = [];
  for (var i = 0; i < incoming.length; i++) {
    var entry = incoming[i] || {};
    var duty = cellValue_(dateField_(entry, ["opeDutyDate", "ope_duty_date", "date", "dutyDate", "duty_date"]));
    if (duty === null || duty === "") {
      ctx.warnings.push(section + ": skipped entry with no OPE duty date " + JSON.stringify(entry));
      continue;
    }

    // "OPE" names a generic column, which is the same as naming none — those
    // are chosen by order. Anything else has to resolve to a reserved column,
    // or the item is asking for something this sheet does not have.
    var requested = key_(pick_(entry, ["slot", "slotLabel", "label"]) || "");
    if (requested && requested !== GENERIC_OPE_LABEL && !named[requested]) {
      ctx.warnings.push(section + ": no column labelled '" + requested + "' on this sheet.");
      continue;
    }

    items.push({
      duty: duty,
      applied: cellValue_(pick_(entry, ["leaveApplied", "leave_applied", "compOff", "leaveUsedOn", "leave_used_on"])),
      slotKey: named[requested] ? requested : ""
    });
  }

  if (mode === "replace") {
    generic.forEach(function (s) {
      setCell_(ctx, s.dutyCol, "", section);
      setCell_(ctx, s.appliedCol, "", section);
    });
    items.forEach(function (it) {
      if (it.slotKey && named[it.slotKey]) {
        setCell_(ctx, named[it.slotKey].dutyCol, "", section);
        setCell_(ctx, named[it.slotKey].appliedCol, "", section);
      }
    });
  }

  var used = {};

  for (var j = 0; j < items.length; j++) {
    var it = items[j];
    var slot = it.slotKey ? named[it.slotKey] : null;

    if (!slot && mode === "merge") {
      slot = findSlotWithValue_(ctx, generic, it.duty, used);   // already recorded
    }

    if (!slot) {
      for (var g = 0; g < generic.length && !slot; g++) {
        if (!used[generic[g].index] && freeCell_(ctx, generic[g].dutyCol)) slot = generic[g];
      }
    }

    if (!slot) {
      ctx.warnings.push(section + ": no free OPE column left for " + display_(it.duty) + ".");
      continue;
    }

    used[slot.index] = true;
    setCell_(ctx, slot.dutyCol, it.duty, section);
    if (it.applied !== null) setCell_(ctx, slot.appliedCol, it.applied, section);
  }
}

/* ─── Cell access ──────────────────────────────────────────────────────────── */

/** The row's net before/after — one entry per cell that really moved. */
function rowDiff_(ctx, before) {
  var after = ctx.values[ctx.rowIdx];
  var out = [];

  for (var i = 0; i < after.length; i++) {
    if (sameCell_(before[i], after[i])) continue;
    out.push({
      cell: a1_(ctx.firstCol + i) + ctx.row,
      section: ctx.sections[ctx.firstCol + i] || "",
      from: display_(before[i]),
      to: display_(after[i])
    });
  }

  return out;
}

function readCell_(ctx, col) {
  if (col == null || col < 0) return "";
  return ctx.values[ctx.rowIdx][col - ctx.firstCol];
}

function setCell_(ctx, col, value, section) {
  if (col == null || col < 0) return;

  if (!ctx.layout.writable[col]) {
    ctx.warnings.push(section + ": refused to write outside the writable region (" + a1_(col) + ").");
    return;
  }

  var idx = col - ctx.firstCol;
  if (ctx.formulas[ctx.rowIdx][idx] !== "") {
    ctx.warnings.push(section + ": " + a1_(col) + ctx.row + " holds a formula — left alone.");
    return;
  }

  if (sameCell_(ctx.values[ctx.rowIdx][idx], value)) return;

  ctx.values[ctx.rowIdx][idx] = value;
  ctx.sections[col] = section;

  if (value instanceof Date && needsDateFormat_(ctx.formats[ctx.rowIdx][idx])) {
    ctx.formats[ctx.rowIdx][idx] = DATE_FORMAT;
  }
}

function firstFreeCol_(ctx, cols) {
  for (var i = 0; i < cols.length; i++) {
    if (freeCell_(ctx, cols[i])) return cols[i];
  }
  return -1;
}

/**
 * Empty and actually writable.
 *
 * A formula cell reads back as blank through getValues(), so without this a
 * value would be handed to the column the guard then refuses, and dropped —
 * rather than routed to the next free column.
 */
function freeCell_(ctx, col) {
  if (col == null || col < 0 || !ctx.layout.writable[col]) return false;
  if (ctx.formulas[ctx.rowIdx][col - ctx.firstCol] !== "") return false;
  return isBlank_(readCell_(ctx, col));
}

/** `used` keeps a repeated value from matching the same column twice. */
function findColWithValue_(ctx, cols, value, used) {
  for (var i = 0; i < cols.length; i++) {
    if (used && used[cols[i]]) continue;
    if (sameCell_(readCell_(ctx, cols[i]), value)) return cols[i];
  }
  return -1;
}

function findSlotWithValue_(ctx, slots, value, used) {
  for (var i = 0; i < slots.length; i++) {
    if (used && used[slots[i].index]) continue;
    if (sameCell_(readCell_(ctx, slots[i].dutyCol), value)) return slots[i];
  }
  return null;
}

/** A cell already formatted as a date keeps its own format. */
function needsDateFormat_(format) {
  var f = String(format || "").trim().toLowerCase();
  if (!f || f === "general" || f === "@" || f === "0" || f === "text") return true;
  return f.indexOf("d") === -1 && f.indexOf("m") === -1 && f.indexOf("y") === -1;
}

/* ─── Value coercion ───────────────────────────────────────────────────────── */

function text_(value) {
  if (value == null) return "";
  if (value instanceof Date) return iso_(value) || "";
  return String(value).trim();
}

/** Normalised comparison key: lowercase, alphanumerics only. */
function key_(value) {
  return text_(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isBlank_(value) {
  return value == null || (!(value instanceof Date) && String(value).trim() === "");
}

var MONTHS_ = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};

/**
 * Strictly-shaped dates only — ISO, "2-Mar-2026", "02/03/2026".
 *
 * Deliberately no `new Date(string)` fallback: the duty columns are full of
 * short codes ("M", "A", "N", "NO", "CO", "T", "NA") and a permissive parser
 * turns several of them into dates.
 */
function asDate_(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : dateOnly_(value);

  var raw = String(value).trim();
  if (!raw) return null;

  var iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (iso) return makeDate_(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  var mmm = raw.match(/^(\d{1,2})\s*[-\/ ]\s*([A-Za-z]{3,})\s*[-\/ ]\s*(\d{2,4})$/);
  if (mmm) {
    var month = MONTHS_[mmm[2].slice(0, 3).toLowerCase()];
    if (!month) return null;
    return makeDate_(fullYear_(Number(mmm[3])), month, Number(mmm[1]));
  }

  var dmy = raw.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (dmy) return makeDate_(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));

  return null;
}

/** Day and month only — "29 Apr" and "27 Jan" are all over the legacy columns. */
function partialDate_(value) {
  if (value == null || value instanceof Date) return null;
  var m = String(value).trim().match(/^(\d{1,2})\s*[-\/ ]?\s*([A-Za-z]{3,})\.?$/);
  if (!m) return null;
  var month = MONTHS_[m[2].slice(0, 3).toLowerCase()];
  return month ? { day: Number(m[1]), month: month } : null;
}

function makeDate_(year, month, day) {
  var d = new Date(year, month - 1, day);
  return isNaN(d.getTime()) ? null : d;
}

function dateOnly_(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function fullYear_(year) {
  return year >= 100 ? year : 2000 + year;
}

function iso_(value) {
  var d = value instanceof Date ? value : asDate_(value);
  if (!d) return null;
  return d.getFullYear() + "-" + pad2_(d.getMonth() + 1) + "-" + pad2_(d.getDate());
}

function pad2_(n) {
  return ("0" + n).slice(-2);
}

/** Dates from a header cell, whether it is text or a formatted Date. */
function headerDate_(value, displayText) {
  return iso_(value) || iso_(extractDateText_(displayText));
}

function extractDateText_(text) {
  var m = String(text == null ? "" : text)
    .match(/(\d{4}-\d{1,2}-\d{1,2})|(\d{1,2}\s*[-\/ ]\s*[A-Za-z]{3,}\s*[-\/ ]\s*\d{2,4})|(\d{1,2}[-\/]\d{1,2}[-\/]\d{4})/);
  return m ? m[0] : "";
}

/** A payload value becomes a Date when it looks like one, otherwise stays text. */
function cellValue_(value) {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return dateOnly_(value);
  var raw = String(value).trim();
  if (!raw) return "";
  return asDate_(raw) || raw;
}

function dateField_(entry, names) {
  if (entry == null) return null;
  if (entry instanceof Date) return entry;
  if (typeof entry !== "object") return entry;
  return pick_(entry, names);
}

function pick_(entry, names) {
  if (!entry || typeof entry !== "object") return null;
  for (var i = 0; i < names.length; i++) {
    if (entry[names[i]] !== undefined && entry[names[i]] !== null) return entry[names[i]];
  }
  return null;
}

function firstArray_(item, names) {
  for (var i = 0; i < names.length; i++) {
    if (Array.isArray(item[names[i]])) return item[names[i]];
  }
  return null;
}

/**
 * True when a cell already holds this value.
 *
 * Dates compare by calendar day, and a partial legacy entry ("29 Apr") counts
 * as a match for the same day and month — otherwise the first sync would
 * rewrite several hundred cells that are not actually wrong.
 */
function sameCell_(a, b) {
  if (isBlank_(a) && isBlank_(b)) return true;
  if (isBlank_(a) || isBlank_(b)) return false;
  if (b instanceof Date) return sameDate_(a, b);
  if (a instanceof Date) return sameDate_(b, a);
  return String(a).trim() === String(b).trim();
}

function sameDate_(cell, date) {
  if (!date) return false;
  var target = date instanceof Date ? date : asDate_(date);
  if (!target) return false;

  var parsed = asDate_(cell);
  if (parsed) return iso_(parsed) === iso_(target);

  var partial = partialDate_(cell);
  return !!partial && partial.day === target.getDate() && partial.month === target.getMonth() + 1;
}

function display_(value) {
  if (isBlank_(value)) return "";
  return value instanceof Date ? iso_(value) : String(value);
}

/* ─── Export (round-trip helper) ───────────────────────────────────────────── */

/** One employee's row read back in the same shape doPost accepts. */
function exportEmployee_(sheet, layout, empId) {
  var entry = readEmployees_(sheet, layout).byId[empKey_(empId)];
  if (!entry) throw new Error("EMP NO " + empId + " is not on '" + sheet.getName() + "'.");

  var firstCol = layout.firstWritableCol;
  var width = layout.lastWritableCol - firstCol + 1;
  var row = sheet.getRange(entry.row, firstCol + 1, 1, width).getValues()[0];
  var at = function (col) { return col == null || col < 0 ? "" : row[col - firstCol]; };
  var filled = function (slots) {
    return slots.filter(function (s) {
      return !isBlank_(at(s.dutyCol)) || !isBlank_(at(s.appliedCol));
    });
  };
  var datedOut = function (slots) {
    return filled(slots).map(function (s) {
      return {
        slotIndex: s.index,
        date: s.date || display_(at(s.dutyCol)),
        dutyPerformed: display_(at(s.dutyCol)),
        leaveApplied: display_(at(s.appliedCol))
      };
    });
  };
  var opeOut = function (slots) {
    return filled(slots).map(function (s) {
      var out = {
        opeDutyDate: display_(at(s.dutyCol)),
        leaveApplied: display_(at(s.appliedCol))
      };
      if (!s.generic) out.slot = s.label;   // reserved columns must be named
      return out;
    });
  };

  return {
    employee: { empId: entry.empId, name: entry.name, slNo: entry.slNo, row: entry.row },
    casualLeave: layout.cl.map(at).filter(function (v) { return !isBlank_(v); }).map(display_),
    halfCasualLeave: layout.halfCl.map(at).filter(function (v) { return !isBlank_(v); }).map(display_),
    restrictedHolidays: layout.rh.filter(function (r) { return !isBlank_(at(r.dateCol)); })
      .map(function (r) {
        return { date: display_(at(r.dateCol)), leaveApplied: display_(at(r.appliedCol)) };
      }),
    nationalHolidays: layout.nh.filter(function (h) { return !isBlank_(at(h.col)); })
      .map(function (h) { return { date: h.date, mark: display_(at(h.col)) }; }),
    closedHolidays: datedOut(layout.ch),
    lastYearCompOff: datedOut(layout.lastYear),
    opeDuty: opeOut(layout.ope),
    opePreviousStation: opeOut(layout.opePrevious)
  };
}

/* ─── Plumbing ─────────────────────────────────────────────────────────────── */

function mustFindSheet_(book, wanted) {
  var target = key_(wanted);
  var sheets = book.getSheets();

  for (var i = 0; i < sheets.length; i++) {
    if (key_(sheets[i].getName()) === target) return sheets[i];
  }

  var names = sheets.map(function (s) { return s.getName(); }).join(", ");
  throw new Error("Sheet '" + wanted + "' not found. Tabs present: " + names);
}

function findHeader_(header, wanted) {
  var target = key_(wanted);
  for (var c = 0; c < header.length; c++) {
    if (key_(header[c]) === target) return c;
  }
  return -1;
}

function mustFindHeader_(header, wanted) {
  var col = findHeader_(header, wanted);
  if (col < 0) throw new Error("Header '" + wanted + "' not found on the header row.");
  return col;
}

/** 0-based column index → "A", "AC", "DN". */
function a1_(index) {
  if (index == null || index < 0) return "";
  var s = "";
  var i = index + 1;
  while (i > 0) {
    var r = (i - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    i = (i - 1 - r) / 26;
  }
  return s;
}

function errorText_(err) {
  return String(err && err.message ? err.message : err);
}

function jsonOut_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ─── Editor helpers ───────────────────────────────────────────────────────── */

/** Logs the resolved column map. Run this first, against a copy. */
function testLayout() {
  var sheet = mustFindSheet_(SpreadsheetApp.getActiveSpreadsheet(), SHEET_NAME);
  Logger.log(JSON.stringify(describeLayout_(sheet, resolveLayout_(sheet)), null, 2));
}

/** Round-trips row 4 through the writer: a correct mapping changes nothing. */
function testDryRun() {
  var sheet = mustFindSheet_(SpreadsheetApp.getActiveSpreadsheet(), SHEET_NAME);
  var layout = resolveLayout_(sheet);
  var first = readEmployees_(sheet, layout).list[0];
  var payload = exportEmployee_(sheet, layout, first.empId);

  Logger.log(JSON.stringify(writePayload_({
    dryRun: true,
    mode: "merge",
    employees: [payload]
  }), null, 2));
}
