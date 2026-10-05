/**
 * Regression tests for docs/leave-apps-script/Code.gs — the web app that writes
 * leave data back into the ATTENDANCE-2026 / LEAVE_DATA tab.
 *
 * The script is plain Apps Script, so it is loaded into a `node:vm` context with
 * the handful of Google globals it touches stubbed out, and run against a
 * fixture tab built to the same header shape as the real one: banners on row 1,
 * labels on row 2, employees from row 4.
 *
 * What these guard is the mapping. The script resolves its columns from the
 * headers precisely so a new closed holiday can shift the tab without a code
 * change — which also means a header change can silently move where data lands,
 * and only a test like this notices.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { beforeEach, describe, expect, it } from "vitest";

const CODE = path.resolve(
  fileURLToPath(import.meta.url),
  "../../../../docs/leave-apps-script/Code.gs",
);

/** Column layout of the fixture, mirroring the real tab's structure at 1/3 scale. */
const COL = {
  cl: [5, 16] as const,          // F..Q   C/L1..C/L12
  halfCl: [17, 20] as const,     // R..U   1/2 CL x4
  rh1: 21, rh1Off: 22,           // V / W
  rh2: 23, rh2Off: 24,           // X / Y
  nh: 25,                        // Z      26-Jan-2026
  ch: 26,                        // AA..AF 3 closed-holiday pairs
  lastYear: 32,                  // AG..AJ 1 dated + 1 spare
  ope: 36,                       // AK..AR 4 pairs, ELECTION third
  opePrev: 44,                   // AS..AT 1 pair
  totals: 46,                    // AU..AV computed — must stay out of reach
};

type Cell = string | number | Date;

type SlotMap = {
  index: number;
  label: string;
  date: string | null;
  generic: boolean;
  dutyCell: string;
  compOffCell: string;
};

type LayoutMap = {
  headerRow: number;
  dataRows: { first: number; last: number; employees: number };
  identity: Record<string, string>;
  writableRange: string;
  casualLeave: string[];
  halfCasualLeave: string[];
  restrictedHolidays: { index: number; dateCell: string; compOffCell: string }[];
  nationalHolidays: { date: string; label: string; cell: string }[];
  closedHolidays: SlotMap[];
  lastYearCompOff: SlotMap[];
  opeDuty: SlotMap[];
  opePreviousStation: SlotMap[];
};

type Change = { cell: string; section: string; from: string; to: string };

type Conflict = { cell: string; section: string; sheet: string; app: string };

type WriteResult = {
  ok: boolean;
  dryRun: boolean;
  cellsChanged: number;
  conflicts: number;
  concurrentEdits: number;
  writeLogError: string | null;
  spreadsheet: string;
  requestId: string | null;
  employees: { received: number; matched: number; changed: number; unmatched: number };
  results: {
    empId: string;
    name: string;
    row: number;
    cellsChanged: number;
    changes?: Change[];
    conflicts: Conflict[];
    concurrentEdit?: boolean;
    warnings: string[];
  }[];
  unmatched: { empId: string; name: string; reason: string }[];
};

/** Opaque here — resolved by the script and only ever handed straight back. */
type SheetLayout = { readonly __layout: unique symbol };

type FakeSheet = ReturnType<typeof buildFixture>["sheet"];

/** The Apps Script globals these tests reach into. */
type ScriptGlobals = {
  ACCESS_TOKEN: string;
  resolveLayout_(sheet: FakeSheet): SheetLayout;
  describeLayout_(sheet: FakeSheet, layout: SheetLayout): LayoutMap;
  exportEmployee_(sheet: FakeSheet, layout: SheetLayout, empId: string): Record<string, unknown>;
  writePayload_(body: Record<string, unknown>): WriteResult;
  display_(value: Cell): string;
  doGet(e: { parameter: Record<string, string> }): string;
  doPost(e: { postData: { contents: string } }): string;
};

type Fixture = {
  g: ScriptGlobals;
  rows: Cell[][];
  formulas: string[][];
  formats: string[][];
  sheet: FakeSheet;
  book: { name: string; logRows: Cell[][] | null };
  /** Called on every getValues(); lets a test play a clerk typing mid-write. */
  hooks: { onRead?: (range: { row: number; col: number; rows: number; cols: number }) => void };
  date: (iso: string) => Date;
  show: (v: Cell) => string;
};

function buildFixture() {
  const g = vm.createContext({}) as Record<string, unknown>;
  // Dates must be minted inside the vm realm or `instanceof Date` fails there.
  const newDate = vm.runInContext("(y,m,d)=>new Date(y,m,d)", g);
  const date = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return newDate(y, m - 1, d);
  };

  const width = COL.totals + 2;
  const blank = <T = Cell>() => Array.from({ length: width }, () => "" as T);
  const rows: Cell[][] = [blank(), blank(), blank(), blank(), blank(), blank()];

  rows[0][COL.cl[0]] = "CL, RH & NH";
  rows[0][COL.ch] = "C-OFF FOR DUTY PERFORMED IN CLOSED HOLIDAYS";
  rows[0][COL.lastYear] = "LAST YEAR C-OFF";
  rows[0][COL.ope] = "C-OFF FOR DUTY PERFORMED AGAINST OPE";
  rows[0][COL.opePrev] = "OPE (from previous station)";

  rows[1][0] = "SL No.";
  rows[1][1] = "EMP NO";
  rows[1][2] = "NAME";
  rows[1][3] = "DESIG.";
  for (let i = 0; i < 12; i++) rows[1][COL.cl[0] + i] = `C/L${i + 1}`;
  for (let i = 0; i < 4; i++) rows[1][COL.halfCl[0] + i] = "1/2 CL";
  rows[1][COL.rh1] = "R/H1";
  rows[1][COL.rh1Off] = "C-OFF";
  rows[1][COL.rh2] = "R/H2";
  rows[1][COL.rh2Off] = "C-OFF";
  rows[1][COL.nh] = "26-Jan-2026";

  const chDates = ["23-Jan-2026", "04-Mar-2026", "21-Mar-2026"];
  const chValid = ["22-Apr-2026", "01-Jun-2026", "18-Jun-2026"];
  chDates.forEach((d, i) => {
    rows[1][COL.ch + i * 2] = `${d} CH-${i + 1}`;
    rows[1][COL.ch + i * 2 + 1] = `C-OFF valid till ${chValid[i]}`;
  });

  rows[1][COL.lastYear] = "20-Oct-2025 (CH-1)";
  rows[1][COL.lastYear + 1] = "C-OFF ";
  rows[1][COL.lastYear + 2] = "";                 // spare pair, no date
  rows[1][COL.lastYear + 3] = "C-OFF ";

  ["OPE", "OPE", "ELECTION", "OPE"].forEach((label, i) => {
    rows[1][COL.ope + i * 2] = label;
    rows[1][COL.ope + i * 2 + 1] = "C-OFF";
  });
  rows[1][COL.opePrev] = "OPE";
  rows[1][COL.opePrev + 1] = "C-OFF";

  rows[1][COL.totals] = "CL";
  rows[1][COL.totals + 1] = "RH";

  rows[3][0] = 1; rows[3][1] = "10000001"; rows[3][2] = "ALPHA ONE";
  rows[4][0] = 2; rows[4][1] = "10000002"; rows[4][2] = "BETA TWO";
  rows[5][0] = 3; rows[5][1] = "10000003"; rows[5][2] = "GAMMA THREE";

  const formulas = rows.map(() => blank<string>());
  const formats = rows.map(() => blank<string>());
  formulas[3][COL.totals] = "=COUNTA(F4:Q4)";

  const hooks: Fixture["hooks"] = {};
  const book: Fixture["book"] = { name: "ATTENDANCE-2026", logRows: null };

  const sheet = {
    getName: () => "LEAVE_DATA",
    getLastRow: () => rows.length,
    getLastColumn: () => width,
    getRange(r: number, c: number, nr = 1, nc = 1) {
      const slice = <T>(src: T[][]) =>
        Array.from({ length: nr }, (_, i) =>
          Array.from({ length: nc }, (_, j) => src[r - 1 + i]?.[c - 1 + j] ?? ("" as T)));
      return {
        getValues: () => {
          hooks.onRead?.({ row: r, col: c, rows: nr, cols: nc });
          return slice(rows);
        },
        getDisplayValues: () => slice(rows).map((row) => row.map((v) => String(v))),
        getFormulas: () => slice(formulas),
        getNumberFormats: () => slice(formats),
        setValues(v: Cell[][]) {
          for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) rows[r - 1 + i][c - 1 + j] = v[i][j];
        },
        setNumberFormats(f: string[][]) {
          for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) formats[r - 1 + i][c - 1 + j] = f[i][j];
        },
      };
    },
  };

  // The APP_WRITE_LOG tab: appended to with getRange(lastRow + 1, …).setValues.
  const logSheet = () => ({
    getLastRow: () => book.logRows!.length,
    getRange: (r: number, _c: number, nr = 1) => ({
      setValues(v: Cell[][]) {
        for (let i = 0; i < nr; i++) book.logRows![r - 1 + i] = v[i];
      },
    }),
  });

  Object.assign(g, {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getName: () => book.name,
        getSheets: () => [sheet],
        getSheetByName: (name: string) => (name === "APP_WRITE_LOG" && book.logRows ? logSheet() : null),
        insertSheet: (name: string) => {
          if (name !== "APP_WRITE_LOG") throw new Error(`unexpected insertSheet(${name})`);
          book.logRows = [];
          return logSheet();
        },
      }),
      flush() {},
    },
    ContentService: { createTextOutput: (t: string) => ({ setMimeType: () => t }), MimeType: { JSON: "json" } },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Logger: { log() {} },
    console,
  });
  vm.runInContext(fs.readFileSync(CODE, "utf8"), g, { filename: "Code.gs" });

  return {
    g: g as unknown as ScriptGlobals,
    rows,
    formulas,
    formats,
    sheet,
    book,
    hooks,
    date,
    show: (v: Cell) => (g as unknown as ScriptGlobals).display_(v),
  };
}

describe("leave sheet write-back", () => {
  let f: Fixture;
  let write: (body: Record<string, unknown>) => WriteResult;
  let at: (row: number, col: number) => string;

  beforeEach(() => {
    f = buildFixture();
    write = (body) => f.g.writePayload_({ mode: "merge", ...body });
    at = (row, col) => f.show(f.rows[row - 1][col]);
  });

  describe("layout resolution", () => {
    it("derives every block from the header rows", () => {
      const map = f.g.describeLayout_(f.sheet, f.g.resolveLayout_(f.sheet));

      expect(map.headerRow).toBe(2);
      expect(map.dataRows.first).toBe(3);   // row 3 is the second label row, skipped for having no EMP NO
      expect(map.dataRows.employees).toBe(3);
      expect(map.identity).toMatchObject({ empNo: "B", name: "C" });
      expect(map.casualLeave).toEqual(["F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q"]);
      expect(map.halfCasualLeave).toEqual(["R", "S", "T", "U"]);
      expect(map.restrictedHolidays).toEqual([
        { index: 1, dateCell: "V", compOffCell: "W" },
        { index: 2, dateCell: "X", compOffCell: "Y" },
      ]);
      expect(map.nationalHolidays).toEqual([{ date: "2026-01-26", label: "26-Jan-2026", cell: "Z" }]);
      expect(map.closedHolidays.map((s) => `${s.date}@${s.dutyCell}/${s.compOffCell}`))
        .toEqual(["2026-01-23@AA/AB", "2026-03-04@AC/AD", "2026-03-21@AE/AF"]);
      expect(map.lastYearCompOff.map((s) => s.date)).toEqual(["2025-10-20", null]);
      expect(map.opeDuty.map((s) => `${s.label}@${s.dutyCell}`))
        .toEqual(["OPE@AK", "OPE@AM", "ELECTION@AO", "OPE@AQ"]);
      expect(map.opeDuty.map((s) => s.generic)).toEqual([true, true, false, true]);
      expect(map.opePreviousStation).toHaveLength(1);
    });

    it("stops the writable region before the computed totals", () => {
      // The last banner fills right across the totals; only the "C-OFF" partner
      // header caps the block, so this is the assertion that matters most.
      expect(f.g.describeLayout_(f.sheet, f.g.resolveLayout_(f.sheet)).writableRange).toBe("F:AT");
    });
  });

  describe("merge", () => {
    it("appends new dates and recognises ones already recorded", () => {
      f.rows[3][COL.cl[0]] = f.date("2026-02-10");

      const res = write({ employees: [{
        employee: { empId: "10000001", name: "ALPHA ONE" },
        casualLeave: ["2026-02-10", "2026-03-05"],
      }] });

      expect(res.cellsChanged).toBe(1);
      expect(at(4, COL.cl[0])).toBe("2026-02-10");
      expect(at(4, COL.cl[0] + 1)).toBe("2026-03-05");
    });

    it("treats a partial legacy entry as the same day", () => {
      // Several hundred cells read "29 Apr" rather than a real date; rewriting
      // them all on the first sync would bury the changes that matter.
      f.rows[3][COL.ope] = "29 Apr";

      const res = write({ employees: [{
        employee: { empId: "10000001" },
        opeDuty: [{ opeDutyDate: "2026-04-29", leaveApplied: "2026-06-21" }],
      }] });

      expect(res.results[0].changes?.map((c) => c.cell)).toEqual(["AL4"]);
      expect(at(4, COL.ope)).toBe("29 Apr");
    });

    it("gives each R/H column its own slot when both carry the same date", () => {
      write({ employees: [{
        employee: { empId: "10000001" },
        restrictedHolidays: [
          { date: "2026-01-01", leaveApplied: "2026-03-26" },
          { date: "2026-01-01", leaveApplied: "2026-03-27" },
        ],
      }] });

      expect([at(4, COL.rh1), at(4, COL.rh1Off)]).toEqual(["2026-01-01", "2026-03-26"]);
      expect([at(4, COL.rh2), at(4, COL.rh2Off)]).toEqual(["2026-01-01", "2026-03-27"]);
    });

    it("places a closed holiday by the date in its column header", () => {
      write({ employees: [{
        employee: { empId: "10000002" },
        closedHolidays: [{ date: "2026-03-21", dutyPerformed: "NO", leaveApplied: "2026-05-02" }],
      }] });

      expect(at(5, COL.ch + 4)).toBe("NO");
      expect(at(5, COL.ch + 5)).toBe("2026-05-02");
      expect(at(5, COL.ch)).toBe("");
    });

    it("fills generic OPE columns in order and reserved ones only by name", () => {
      write({ employees: [{
        employee: { empId: "10000001" },
        opeDuty: [
          { opeDutyDate: "2025-12-03", leaveApplied: "2026-02-26" },
          { opeDutyDate: "2026-04-29", leaveApplied: "2026-06-21", slot: "ELECTION" },
          { opeDutyDate: "2025-12-09" },
        ],
      }] });

      expect(at(4, COL.ope)).toBe("2025-12-03");
      expect(at(4, COL.ope + 2)).toBe("2025-12-09");   // skipped the reserved column
      expect(at(4, COL.ope + 4)).toBe("2026-04-29");
      expect(at(4, COL.ope + 5)).toBe("2026-06-21");
    });

    it("reports an OPE slot label the sheet does not have", () => {
      const res = write({ employees: [{
        employee: { empId: "10000001" },
        opeDuty: [{ opeDutyDate: "2026-04-29", slot: "ELECTION2" }],
      }] });

      expect(res.cellsChanged).toBe(0);
      expect(res.results[0].warnings.join(" ")).toMatch(/no column labelled 'election2'/);
    });

    it("warns instead of writing when no column matches the date", () => {
      const res = write({ employees: [{
        employee: { empId: "10000001" },
        closedHolidays: [{ date: "2030-01-01", dutyPerformed: "N" }],
        nationalHolidays: ["2030-01-01"],
      }] });

      expect(res.cellsChanged).toBe(0);
      expect(res.results[0].warnings).toHaveLength(2);
    });

    it("reports overflow rather than spilling into the next column", () => {
      const res = write({ employees: [{
        employee: { empId: "10000001" },
        casualLeave: Array.from({ length: 13 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`),
      }] });

      expect(res.results[0].warnings.join(" ")).toMatch(/no free column left/);
      expect(at(4, COL.halfCl[0])).toBe("");
    });
  });

  describe("replace", () => {
    beforeEach(() => {
      f.rows[3][COL.cl[0]] = f.date("2026-02-10");
      f.rows[3][COL.cl[0] + 1] = f.date("2026-02-11");
      f.rows[3][COL.ch] = "CH";
      f.rows[3][COL.ch + 2] = "NA";
    });

    it("rewrites the sections it is given", () => {
      write({ mode: "replace", employees: [{
        employee: { empId: "10000001" }, casualLeave: ["2026-06-01"],
      }] });

      expect(at(4, COL.cl[0])).toBe("2026-06-01");
      expect(at(4, COL.cl[0] + 1)).toBe("");
    });

    it("leaves sections the payload omits completely alone", () => {
      write({ mode: "replace", employees: [{
        employee: { empId: "10000001" }, casualLeave: ["2026-06-01"],
      }] });

      expect(at(4, COL.ch)).toBe("CH");
      expect(at(4, COL.ch + 2)).toBe("NA");
    });

    it("clears the slots of a section it is given", () => {
      write({ mode: "replace", employees: [{
        employee: { empId: "10000001" },
        closedHolidays: [{ date: "2026-03-04", dutyPerformed: "M" }],
      }] });

      expect(at(4, COL.ch + 2)).toBe("M");
      expect(at(4, COL.ch)).toBe("");
    });

    it("reports the net diff, not each intermediate write", () => {
      const res = write({ mode: "replace", employees: [{
        employee: { empId: "10000001" }, casualLeave: ["2026-02-10", "2026-02-11"],
      }] });

      expect(res.cellsChanged).toBe(0);
    });
  });

  describe("guards", () => {
    it("never overwrites a formula, and routes list writes around one", () => {
      formulaAt(f, 3, COL.cl[0] + 1);

      const res = write({ employees: [{
        employee: { empId: "10000001" }, casualLeave: ["2026-02-10", "2026-02-11"],
      }] });

      expect(f.formulas[3][COL.cl[0] + 1]).toBe("=1");
      expect(at(4, COL.cl[0])).toBe("2026-02-10");
      expect(at(4, COL.cl[0] + 2)).toBe("2026-02-11");
      expect(res.cellsChanged).toBe(2);
    });

    it("reports a formula in a cell it was asked for by name", () => {
      formulaAt(f, 3, COL.ch + 1);

      const res = write({ employees: [{
        employee: { empId: "10000001" },
        closedHolidays: [{ date: "2026-01-23", dutyPerformed: "N", leaveApplied: "2026-03-01" }],
      }] });

      expect(res.results[0].warnings.join(" ")).toMatch(/AB4 holds a formula/);
      expect(at(4, COL.ch)).toBe("N");
      expect(f.formulas[3][COL.ch + 1]).toBe("=1");
    });

    it("puts formulas back as formulas after a block write", () => {
      // A row is written back as a whole block, so a formula anywhere inside the
      // region would be flattened to its computed value without this.
      formulaAt(f, 3, COL.halfCl[1]);

      write({ employees: [{ employee: { empId: "10000001" }, casualLeave: ["2026-02-10"] }] });

      expect(f.rows[3][COL.halfCl[1]]).toBe("=1");
      expect(at(4, COL.cl[0])).toBe("2026-02-10");
    });

    it("leaves the computed totals outside the block it writes", () => {
      write({ employees: [{ employee: { empId: "10000001" }, casualLeave: ["2026-02-10"] }] });

      expect(f.rows[3][COL.totals]).toBe("");
      expect(f.formulas[3][COL.totals]).toBe("=COUNTA(F4:Q4)");
    });

    it("skips a row whose name disagrees unless told otherwise", () => {
      const mismatch = { employee: { empId: "10000001", name: "SOMEONE ELSE" }, casualLeave: ["2026-02-10"] };

      expect(write({ dryRun: true, employees: [mismatch] }).employees.matched).toBe(0);
      expect(write({ dryRun: true, allowNameMismatch: true, employees: [mismatch] }).employees.matched).toBe(1);
    });

    it("reports an unknown EMP NO instead of creating a row", () => {
      const res = write({ employees: [{ employee: { empId: "99999999" }, casualLeave: ["2026-02-10"] }] });

      expect(res.unmatched[0].reason).toMatch(/not on the sheet/);
      expect(f.rows).toHaveLength(6);
    });

    it("writes nothing at all on a dry run", () => {
      const before = JSON.stringify(f.rows.map((r) => r.map(f.show)));
      write({ dryRun: true, mode: "replace", employees: [{
        employee: { empId: "10000001" }, casualLeave: ["2026-12-25"],
      }] });

      expect(JSON.stringify(f.rows.map((r) => r.map(f.show)))).toBe(before);
    });

    it("refuses to POST while ACCESS_TOKEN is unset", () => {
      const res = JSON.parse(f.g.doPost({ postData: { contents: JSON.stringify({ employees: [] }) } }));
      expect(res.error).toMatch(/ACCESS_TOKEN is not set/);
    });

    it("checks the token once one is configured", () => {
      f.g.ACCESS_TOKEN = "s3cret";
      const post = (token: string) =>
        JSON.parse(f.g.doPost({ postData: { contents: JSON.stringify({ token, employees: [] }) } }));

      expect(post("wrong").error).toBe("Unauthorized");
      expect(post("s3cret").ok).toBe(true);
      expect(JSON.parse(f.g.doGet({ parameter: { action: "layout" } })).error).toBe("Unauthorized");
    });
  });

  describe("merge is additive", () => {
    it("never blanks a cell the app has no value for", () => {
      // The clerk recorded the comp-off date; the app has not seen it yet.
      f.rows[3][COL.ch] = "N";
      f.rows[3][COL.ch + 1] = f.date("2026-04-01");

      const res = write({ employees: [{
        employee: { empId: "10000001" },
        closedHolidays: [{ date: "2026-01-23", dutyPerformed: "N", leaveApplied: "" }],
        opeDuty: [{ opeDutyDate: "2025-12-03", leaveApplied: "" }],
      }] });

      expect(at(4, COL.ch + 1)).toBe("2026-04-01");
      expect(res.results[0].conflicts).toEqual([]);
      expect(res.results[0].changes?.map((c) => c.cell)).toEqual(["AK4"]);
    });

    it("reports a different value as a conflict and keeps the sheet's", () => {
      f.rows[3][COL.ch] = "L";
      f.rows[3][COL.ch + 1] = f.date("2026-04-01");

      const res = write({ employees: [{
        employee: { empId: "10000001" },
        closedHolidays: [{ date: "2026-01-23", dutyPerformed: "N", leaveApplied: "2026-04-09" }],
      }] });

      expect(at(4, COL.ch)).toBe("L");
      expect(at(4, COL.ch + 1)).toBe("2026-04-01");
      expect(res.cellsChanged).toBe(0);
      expect(res.conflicts).toBe(2);
      expect(res.results[0].conflicts).toEqual([
        { cell: "AA4", section: "closedHolidays", sheet: "L", app: "N" },
        { cell: "AB4", section: "closedHolidays", sheet: "2026-04-01", app: "2026-04-09" },
      ]);
    });

    it("fills the NA a holiday carries until it happens", () => {
      f.rows[3][COL.ch + 2] = "NA";

      write({ employees: [{
        employee: { empId: "10000001" },
        closedHolidays: [{ date: "2026-03-04", dutyPerformed: "M" }],
      }] });

      expect(at(4, COL.ch + 2)).toBe("M");
    });

    it("finds a spare last-year pair by the date in its duty cell instead of reporting no column", () => {
      // The spare pair has no header date; its duty cell holds the date.
      f.rows[3][COL.lastYear + 2] = f.date("2025-11-15");

      const res = write({ employees: [{
        employee: { empId: "10000001" },
        lastYearCompOff: [{ date: "2025-11-15", dutyPerformed: "A", leaveApplied: "2026-01-10" }],
      }] });

      expect(res.results[0].warnings).toEqual([]);
      expect(at(4, COL.lastYear + 2)).toBe("2025-11-15");
      expect(at(4, COL.lastYear + 3)).toBe("2026-01-10");
    });

    it("still lets replace clear a section it is given", () => {
      f.rows[3][COL.cl[0]] = f.date("2026-02-10");
      write({ mode: "replace", employees: [{ employee: { empId: "10000001" }, casualLeave: [] }] });
      expect(at(4, COL.cl[0])).toBe("");
    });
  });

  describe("a commit", () => {
    it("skips a row someone edited while it was being prepared, and writes the rest", () => {
      // The writer reads the writable block once to plan and once more just
      // before writing. A clerk types into row 4 in between.
      let blockReads = 0;
      f.hooks.onRead = ({ cols }) => {
        if (cols !== 41) return;                 // the F:AT writable block
        blockReads += 1;
        if (blockReads === 2) f.rows[3][COL.nh] = "NH";
      };

      const res = write({ dryRun: false, employees: [
        { employee: { empId: "10000001" }, casualLeave: ["2026-02-10"] },
        { employee: { empId: "10000002" }, casualLeave: ["2026-02-11"] },
      ] });

      expect(res.concurrentEdits).toBe(1);
      expect(res.results[0].concurrentEdit).toBe(true);
      expect(at(4, COL.cl[0])).toBe("");        // not written over the clerk
      expect(at(4, COL.nh)).toBe("NH");         // the clerk's edit stands
      expect(at(5, COL.cl[0])).toBe("2026-02-11");
      expect(res.cellsChanged).toBe(1);
    });

    it("logs every written cell to APP_WRITE_LOG", () => {
      write({ dryRun: false, requestId: "req-1", actor: "sup@test", employees: [
        { employee: { empId: "10000001" }, casualLeave: ["2026-02-10", "2026-02-11"] },
      ] });

      const [header, ...entries] = f.book.logRows!;
      expect(header).toEqual(["Written at", "Request", "By", "Tab", "Cell", "Section", "Before", "After"]);
      expect(entries.map((r) => r.slice(1))).toEqual([
        ["req-1", "sup@test", "LEAVE_DATA", "F4", "casualLeave", "", "2026-02-10"],
        ["req-1", "sup@test", "LEAVE_DATA", "G4", "casualLeave", "", "2026-02-11"],
      ]);
    });

    it("logs nothing for a dry run", () => {
      write({ dryRun: true, employees: [{ employee: { empId: "10000001" }, casualLeave: ["2026-02-10"] }] });
      expect(f.book.logRows).toBeNull();
    });

    it("refuses a workbook named for another year before touching it", () => {
      const post = (expectedYear: number) => JSON.parse(f.g.doPost({ postData: { contents: JSON.stringify({
        token: "s3cret", dryRun: false, expectedYear,
        employees: [{ employee: { empId: "10000001" }, casualLeave: ["2026-02-10"] }],
      }) } }));
      f.g.ACCESS_TOKEN = "s3cret";

      expect(post(2027).error).toMatch(/not the 2027 workbook/);
      expect(at(4, COL.cl[0])).toBe("");
      expect(post(2026).ok).toBe(true);
      expect(at(4, COL.cl[0])).toBe("2026-02-10");
    });
  });

  it("round-trips: exporting a row and writing it back changes nothing", () => {
    f.rows[3][COL.cl[0]] = f.date("2026-02-10");
    f.rows[3][COL.halfCl[0]] = f.date("2026-02-12");
    f.rows[3][COL.rh1] = f.date("2026-01-01");
    f.rows[3][COL.rh1Off] = f.date("2026-03-26");
    f.rows[3][COL.nh] = "NH";
    f.rows[3][COL.ch] = "N";
    f.rows[3][COL.ch + 1] = f.date("2026-04-01");
    f.rows[3][COL.ch + 2] = "NA";
    f.rows[3][COL.lastYear] = "A";
    f.rows[3][COL.lastYear + 1] = "19 Jan";
    f.rows[3][COL.ope] = f.date("2025-12-03");
    f.rows[3][COL.ope + 4] = "29 Apr";
    f.rows[3][COL.opePrev] = f.date("2026-07-15");

    const layout = f.g.resolveLayout_(f.sheet);
    const payload = f.g.exportEmployee_(f.sheet, layout, "10000001");
    const res = write({ dryRun: true, employees: [payload] });

    expect(res.cellsChanged).toBe(0);
    expect(res.results[0].warnings).toEqual([]);
  });
});

function formulaAt(f: Fixture, rowIdx: number, col: number) {
  f.formulas[rowIdx][col] = "=1";
}
