#!/usr/bin/env node
/**
 * Pushes leave data into the LEAVE_DATA tab through the Apps Script web app in
 * docs/leave-apps-script/Code.gs.
 *
 * Two sources, because the two jobs are different:
 *
 *   --from csv        Rebuild the tab from a CSV export of it. This is the test
 *                     and seeding path: push the export back at a copy and the
 *                     script should report zero changes, which is what proves
 *                     the column mapping before any real data moves.
 *
 *   --from supabase   The production path: read employee_leave_records and turn
 *                     it back into sheet shape. This is the exact inverse of
 *                     supabase/functions/fetch-leave-data — keep the two in step.
 *
 * Dry run unless --commit is passed. Always dry-run first and read the diff.
 *
 *   node scripts/leave-sheet-push.mjs --url <exec-url> --token <secret> \
 *     --from csv --csv "ATTENDANCE-2026 - LEAVE_DATA.csv" --emp 10014941
 *
 *   node scripts/leave-sheet-push.mjs --url <exec-url> --token <secret> \
 *     --from supabase --year 2026 --commit
 */
import fs from "node:fs";

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const args = parseArgs(process.argv.slice(2));

if (args.help || (!args.url && !args.out)) {
  console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace(/^.*?\n/, ""));
  process.exit(args.help ? 0 : 1);
}

const source = args.from || "csv";
const employees = source === "csv"
  ? fromCsv(args.csv || "ATTENDANCE-2026 - LEAVE_DATA.csv")
  : await fromSupabase(args);

const only = args.emp ? new Set(String(args.emp).split(",").map((s) => s.trim())) : null;
const payload = {
  token: args.token,
  mode: args.mode || "merge",
  dryRun: !args.commit,
  sheet: args.sheet,
  allowNameMismatch: !!args.allowNameMismatch,
  employees: only ? employees.filter((e) => only.has(e.employee.empId)) : employees,
};

if (args.out) {
  fs.writeFileSync(args.out, JSON.stringify(payload, null, 2));
  console.log(`wrote ${payload.employees.length} employees to ${args.out}`);
}

if (!args.url) process.exit(0);

console.log(`${payload.dryRun ? "DRY RUN" : "WRITING"} — ${payload.employees.length} employees, mode=${payload.mode}`);

const res = await fetch(args.url, {
  method: "POST",
  redirect: "follow",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
const text = await res.text();

let out;
try {
  out = JSON.parse(text);
} catch {
  console.error(`Apps Script returned ${res.status} and not JSON:\n${text.slice(0, 800)}`);
  process.exit(1);
}

if (out.error) {
  console.error("error:", out.error);
  process.exit(1);
}

console.log(`matched ${out.employees.matched}/${out.employees.received}` +
            `, ${out.employees.changed} rows, ${out.cellsChanged} cells` +
            (out.dryRun ? " (nothing written)" : ` written to ${out.rowsWritten} rows`));

for (const r of out.results.filter((r) => r.cellsChanged || r.warnings.length)) {
  console.log(`\n  ${r.empId} ${r.name} (row ${r.row})`);
  for (const c of r.changes || []) console.log(`    ${c.cell.padEnd(7)} ${c.section.padEnd(20)} ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
  for (const w of r.warnings) console.log(`    ! ${w}`);
}
for (const u of out.unmatched) console.log(`  ! ${u.empId} ${u.name}: ${u.reason}`);

/* ─── CSV → payload ────────────────────────────────────────────────────────── */

/**
 * Reads a CSV export of the tab using the same header rules the Apps Script
 * uses, so the two agree about which column is what.
 */
function fromCsv(path) {
  const rows = parseCsv(fs.readFileSync(path, "utf8"));
  const width = Math.max(...rows.map((r) => r.length));
  const cell = (r, c) => (rows[r]?.[c] ?? "").trim();

  const headerRow = rows.findIndex((r) => r.some((v) => key(v) === "empno"));
  if (headerRow < 0) throw new Error(`No 'EMP NO' header row in ${path}`);

  const header = Array.from({ length: width }, (_, c) => cell(headerRow, c));
  const banner = [];
  let carried = "";
  for (let c = 0; c < width; c++) {
    const v = cell(headerRow - 1, c);
    if (v) carried = v;
    banner.push(carried);
  }

  const find = (want) => header.findIndex((h) => key(h) === key(want));
  const empNoCol = find("empno");
  const nameCol = find("name");

  const cl = header.map((h, c) => [key(h).match(/^cl(\d+)$/), c])
    .filter(([m]) => m).sort((a, b) => Number(a[0][1]) - Number(b[0][1])).map(([, c]) => c);
  const halfCl = header.map((h, c) => (key(h) === "12cl" ? c : -1)).filter((c) => c >= 0);
  const rh = [find("rh1"), find("rh2")].filter((c) => c >= 0).map((c) => ({ dateCol: c, appliedCol: c + 1 }));

  const range = (needle) => {
    const start = banner.findIndex((b) => key(b).includes(key(needle)));
    if (start < 0) return null;
    let end = start;
    while (end + 1 < width && key(banner[end + 1]) === key(banner[start])) end++;
    return { start, end };
  };
  const pairs = (needle, dated) => {
    const r = range(needle);
    const out = [];
    if (!r) return out;
    for (let c = r.start; c + 1 <= r.end; c += 2) {
      if (!key(header[c + 1]).startsWith("coff")) break;
      out.push({ index: out.length, dutyCol: c, appliedCol: c + 1, label: header[c],
                 date: dated ? isoOf(header[c]) : null, generic: key(header[c]) === "ope" });
    }
    return out;
  };

  const first = range("CL, RH & NH");
  const nh = [];
  for (let c = first.start; c <= first.end; c++) {
    if (cl.includes(c) || halfCl.includes(c) || rh.some((r) => r.dateCol === c || r.appliedCol === c)) continue;
    const d = isoOf(header[c]);
    if (d) nh.push({ date: d, col: c });
  }

  const ch = pairs("closed holidays", true);
  const lastYear = pairs("last year", true);
  const ope = pairs("against ope", false);
  const opePrev = pairs("previous station", false);

  const out = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const empId = cell(r, empNoCol).replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
    if (!empId) continue;

    const at = (c) => cell(r, c);
    const filled = (slots) => slots.filter((s) => at(s.dutyCol) || at(s.appliedCol));

    out.push({
      employee: { empId, name: cell(r, nameCol) },
      casualLeave: cl.map(at).filter(Boolean),
      halfCasualLeave: halfCl.map(at).filter(Boolean),
      restrictedHolidays: rh.filter((s) => at(s.dateCol))
        .map((s) => ({ date: at(s.dateCol), leaveApplied: at(s.appliedCol) })),
      nationalHolidays: nh.filter((s) => at(s.col)).map((s) => ({ date: s.date, mark: at(s.col) })),
      closedHolidays: filled(ch).map((s) => ({ slotIndex: s.index, date: s.date,
        dutyPerformed: at(s.dutyCol), leaveApplied: at(s.appliedCol) })),
      lastYearCompOff: filled(lastYear).map((s) => ({ slotIndex: s.index, date: s.date || at(s.dutyCol),
        dutyPerformed: at(s.dutyCol), leaveApplied: at(s.appliedCol) })),
      opeDuty: filled(ope).map((s) => ({ opeDutyDate: at(s.dutyCol), leaveApplied: at(s.appliedCol),
        ...(s.generic ? {} : { slot: s.label }) })),
      opePreviousStation: filled(opePrev).map((s) => ({ opeDutyDate: at(s.dutyCol), leaveApplied: at(s.appliedCol) })),
    });
  }

  return out;
}

/* ─── Supabase → payload ───────────────────────────────────────────────────── */

/**
 * The inverse of supabase/functions/fetch-leave-data.
 *
 * Comp-off rows key off the DUTY date (leave_date) with the day off in
 * leave_used_on — the opposite way round from plain leave rows, which is the
 * single easiest thing to get backwards here.
 *
 * Known gap: employee_leave_records does not mark a CL row as a half day, so
 * the four "1/2 CL" columns cannot be rebuilt from it. They come from
 * leave_requests.leave_type (CL_1ST / CL_2ND) and are left alone by this path.
 */
async function fromSupabase(args) {
  const url = args.supabaseUrl || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const kkey = args.supabaseKey || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !kkey) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or pass --supabaseUrl/--supabaseKey).");

  const year = Number(args.year) || new Date().getFullYear();
  const rows = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const q = new URL(`${url.replace(/\/$/, "")}/rest/v1/employee_leave_records`);
    q.searchParams.set("select", "emp_id,employee_name,leave_category,source_event_type,event_kind,leave_date,leave_used_on,duty_code,metadata");
    q.searchParams.set("order", "emp_id,leave_date");
    const res = await fetch(q, {
      headers: { apikey: kkey, Authorization: `Bearer ${kkey}`, Range: `${offset}-${offset + pageSize - 1}` },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  const byEmp = new Map();
  const bucket = (r) => {
    if (!byEmp.has(r.emp_id)) {
      byEmp.set(r.emp_id, {
        employee: { empId: String(r.emp_id).replace(/^0+(?=\d)/, ""), name: r.employee_name || "" },
        casualLeave: [], restrictedHolidays: [], nationalHolidays: [],
        closedHolidays: [], lastYearCompOff: [], opeDuty: [],
      });
    }
    return byEmp.get(r.emp_id);
  };

  for (const r of rows) {
    const inYear = (d) => d && Number(String(d).slice(0, 4)) === year;
    const e = bucket(r);
    const meta = r.metadata || {};

    switch (r.leave_category) {
      case "CL":
        if (inYear(r.leave_date)) e.casualLeave.push(r.leave_date);
        break;
      case "RH":
        if (inYear(r.leave_date)) e.restrictedHolidays.push({ date: r.leave_date, leaveApplied: r.leave_used_on || meta.leave_applied || "" });
        break;
      case "NH":
        if (inYear(r.leave_date)) e.nationalHolidays.push(r.leave_date);
        break;
      case "COMP_OFF_EARNED":
      case "COMP_OFF":
        // leave_date is the closed-holiday duty date; the day off is leave_used_on.
        e.closedHolidays.push({ date: r.leave_date, dutyPerformed: r.duty_code || meta.duty_performed || "", leaveApplied: r.leave_used_on || "" });
        break;
      case "LAST_YEAR_CH_DUTY":
        e.lastYearCompOff.push({ date: r.leave_date, dutyPerformed: r.duty_code || meta.duty_performed || "", leaveApplied: r.leave_used_on || "" });
        break;
      case "OPE":
        e.opeDuty.push({ opeDutyDate: meta.ope_duty_date || r.leave_date, leaveApplied: r.leave_used_on || "" });
        break;
      default:
        break;   // CH / *_COMP_OFF rows carry no slot date; they cannot be placed
    }
  }

  return [...byEmp.values()];
}

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

function key(v) {
  return String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** First full date inside a header label, ISO. "23-Jan-2026 CH-1" → 2026-01-23. */
function isoOf(text) {
  const m = String(text ?? "").match(/(\d{1,2})[-/ ]([A-Za-z]{3,})[-/ ](\d{4})/);
  if (!m) {
    const iso = String(text ?? "").match(/(\d{4})-(\d{2})-(\d{2})/);
    return iso ? iso[0] : null;
  }
  const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
  return mo ? `${m[3]}-${String(mo).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}` : null;
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }

  return rows;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const name = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[name] = true;
    else { out[name] = next; i++; }
  }
  return out;
}
