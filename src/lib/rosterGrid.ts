import { format } from "date-fns";

import { parseRosterDate } from "@/lib/rosterDate";
import { normalizeTeamKey } from "@/lib/teamDutyRotation";
import type { ShiftCode } from "@/lib/shiftRoster";
import type { RosterEntry } from "@/hooks/useRosters";

/**
 * rosterGrid.ts — rebuilds the duty roster's 2-D shape from the flat rows.
 *
 * The published roster is a matrix: unit rows crossed with rating columns.  The
 * scraper already carries both coordinates — `unit` is the row label and
 * `position` is the column label, drawn from a closed set the Apps Script emits:
 *
 *   day shift    SUPERVISION · RSR · ACC PLR · ACC ALPHA · Duty
 *   night shift  SUPERVISION · RSR (1st Half) · RSR (2nd Half) ·
 *                ACC-PLR (1st|2nd Half) · ACC-ALPHA (1st|2nd Half) ·
 *                1st Half · 2nd Half
 *   either       Extra Duty · Duty Change
 *
 * so the grid can be rebuilt without touching the scraper.  `shiftRoster.ts`
 * throws this away by sorting every row into four alphabetical buckets; this
 * module keeps it.
 *
 * Nothing is ever dropped: a row whose position is unrecognised lands in
 * `unplaced` and the view still shows it.
 */

// ── Cell text ────────────────────────────────────────────────────────────────

/** Grades as written in the sheet, longest first so SM never eats a JGM. */
const GRADES = ["JGM", "DGM", "AGM", "MGR", "SM", "AM", "JE"] as const;
export type Grade = (typeof GRADES)[number];

export interface RosterPerson {
  key: string;
  /** The sheet's own text, kept verbatim so a parse miss still reads correctly. */
  raw: string;
  name: string;
  grade?: Grade;
  /** RSR+UBN, ADC+ACC-PLR, ALPHA, ADC/SMC, … */
  rating?: string;
  /** Partial-shift window written into the cell, e.g. "0830-1230" (UTC). */
  timeWindow?: string;
  /** Currently just SAR, from the `-SAR` suffix. */
  flags: string[];
  team: string;
  isOffTeam: boolean;
}

const GRADE_PATTERN = GRADES.join("|");
/** `NAME/ GRADE - RATING-[SAR]`, tolerant of the sheet's erratic spacing. */
const NAME_RE = new RegExp(`^\\s*(${GRADE_PATTERN})\\s*-\\s*(.*)$`, "i");
/** "(0830-1230)", and the "(0830 TO 1230)" spelling some tabs use. */
const TIME_WINDOW_RE = /\((\d{3,4})\s*(?:-|–|—|to|TO|To)\s*(\d{3,4})\)\s*$/;

/**
 * Splits a roster cell into its parts.
 *
 * Legacy rows are already stripped down to a bare name by the edge function, so
 * a string with no `/` is not an error — it just yields a name.
 */
export function parsePersonCell(raw: string): {
  name: string;
  grade?: Grade;
  rating?: string;
  timeWindow?: string;
  flags: string[];
} {
  const flags: string[] = [];
  let text = String(raw || "").trim();
  let timeWindow: string | undefined;

  const windowMatch = text.match(TIME_WINDOW_RE);
  if (windowMatch) {
    timeWindow = `${windowMatch[1]}-${windowMatch[2]}`;
    text = text.slice(0, windowMatch.index).trim();
  }

  const slash = text.indexOf("/");
  if (slash === -1) {
    return { name: text.replace(/-+$/, "").trim(), timeWindow, flags };
  }

  const name = text.slice(0, slash).trim();
  const remainder = text.slice(slash + 1).trim();

  const match = remainder.match(NAME_RE);
  if (!match) {
    return { name, timeWindow, flags };
  }

  const grade = match[1].toUpperCase() as Grade;

  // The rating itself contains hyphens (ACC-PLR, ADC+ACC-PLR), so the trailing
  // terminator is stripped first and only then is the SAR suffix taken off —
  // doing it the other way round eats part of ratings like ACC-P+OCC.
  let rating = match[2].trim().replace(/-+$/, "").trim();
  if (/-SAR$/i.test(rating)) {
    flags.push("SAR");
    rating = rating.slice(0, -4).replace(/-+$/, "").trim();
  }

  return { name, grade, rating: rating || undefined, timeWindow, flags };
}

// ── Columns ──────────────────────────────────────────────────────────────────

export type ColumnGroupKey = "rsr" | "acc-plr" | "acc-alpha" | "duty" | "remark";
export type Half = "1st" | "2nd";

export interface GridColumn {
  key: string;
  group: ColumnGroupKey;
  label: string;
  half?: Half;
  /** Holds controllers working a band of sectors rather than a single one. */
  covering?: boolean;
}

const GROUP_LABELS: Record<ColumnGroupKey, string> = {
  rsr: "RSR",
  "acc-plr": "ACC PLR",
  "acc-alpha": "ACC A",
  duty: "Duty",
  remark: "Remark",
};

/** Positions that are not grid columns at all. */
const SUPERVISION_POSITION = "SUPERVISION";
const SPECIAL_POSITIONS = ["EXTRA DUTY", "DUTY CHANGE"];

/**
 * Rows the sheet keeps inside the scanned block that are not units.
 *
 * They arrive with the band's name in `unit` and a plain duty position, because
 * the scraper reads them out of the same rectangle as the matrix.  Routed out
 * here so they render as the bands they are instead of appearing as sectors
 * called "LEAVE" and "TRAINING".
 */
const CHIP_BANDS = new Set(["SAR", "LEAVE", "LEAVES"]);
const NOTE_BANDS = new Set(["TRAINING", "REMARK", "REMARKS", "TRAINING & REMARKS"]);

function normalize(value?: string | null) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

/**
 * Maps one `position` value onto a column, or null when it is not a column.
 * Hyphen and space spellings are treated alike ("ACC PLR" / "ACC-PLR").
 */
export function classifyPosition(
  position: string,
): { group: ColumnGroupKey; half?: Half } | null {
  const text = normalize(position);
  if (!text) return null;

  const halfMatch = text.match(/\((1ST|2ND)\s*HALF\)/);
  const half: Half | undefined = halfMatch ? (halfMatch[1] === "1ST" ? "1st" : "2nd") : undefined;

  const base = text.replace(/\((1ST|2ND)\s*HALF\)/, "").replace(/[-\s]+/g, " ").trim();

  if (base === "RSR") return { group: "rsr", half };
  if (base === "ACC PLR") return { group: "acc-plr", half };
  if (base === "ACC ALPHA" || base === "ACC A") return { group: "acc-alpha", half };
  if (base === "DUTY") return { group: "duty", half };
  if (base === "REMARK" || base === "REMARKS") return { group: "remark", half: undefined };
  // Night's non-ACC rows carry the half alone as their position.
  if (base === "1ST HALF") return { group: "duty", half: "1st" };
  if (base === "2ND HALF") return { group: "duty", half: "2nd" };

  return null;
}

function columnKey(group: ColumnGroupKey, half?: Half) {
  return half ? `${group}:${half}` : group;
}

function columnLabel(group: ColumnGroupKey, half?: Half) {
  const base = GROUP_LABELS[group];
  if (!half) return base;
  return `${base} · ${half === "1st" ? "1st half" : "2nd half"}`;
}

// ── Rows ─────────────────────────────────────────────────────────────────────

/**
 * Fallback row order for the unit block.
 *
 * The sheet's own order differs from roster to roster — 15 Aug runs UKW, UKE,
 * UBS, URP, UKN, UGT, UBN while 10 Aug runs UBN, UKE, UKW, URP, UKN, UBS, UGT —
 * so `rosters.row_index` is what the grid sorts by whenever the scrape carried
 * it.  This list only orders rows synced before that column existed.
 */
const UNIT_ORDER = [
  "UBN", "UKE", "UKW", "URP", "UKN", "UBS", "UGT", "UKJ",
  "UGT+UKE", "UKN+UKW", "UKE+UKW",
  "IATS", "RELIEVER", "NIGHT RELIEVER-1", "NIGHT RELIEVER-2",
  "OCCN & OCC-S", "OCCN& OCC-S", "OCC/ADS", "OCCN", "OCC-S",
];

/** Sheet order for the tower / support block. */
const POSITION_ORDER = [
  "ARR+DEP & SEQ", "TSO", "TWR", "SMC", "SMC-N & SMC-S", "CLD",
  "TWR-A/ AIMS", "TWR-A/AIMS", "AIMS", "ARO", "AIS", "MCD",
  "FMP", "WSO-A", "WSO-A+FMP", "FMP+WSO-A", "WSO-A+FMP/FIC", "CORR /APP-A",
];

function orderIndex(order: string[], row: { label: string; units: string[] }) {
  const direct = order.indexOf(normalize(row.label));
  if (direct !== -1) return direct;
  // A combined label such as "UBN+UKE" sorts with the first sector it covers,
  // so it lands next to the rows it is about to span.
  for (const unit of row.units) {
    const index = order.indexOf(unit);
    if (index !== -1) return index;
  }
  return Number.MAX_SAFE_INTEGER;
}

/**
 * One position in the grid.
 *
 * `rowSpan` > 1 is the sheet's two-sector/three-controller shape: each sector
 * has its own controller, and a third spans both in a merged cell.  `covered`
 * marks the slots that merged cell occupies — the renderer emits no `<td>` for
 * them, exactly as a real `rowSpan` requires.
 */
export interface GridCell {
  people: RosterPerson[];
  rowSpan: number;
  covered: boolean;
  /** Sectors a spanning cell works, e.g. ["UBN","UKE"]. Set only when rowSpan > 1. */
  covers?: string[];
}

export interface GridRow {
  key: string;
  label: string;
  /** Composite labels such as "UKN+UKW" split into their units. */
  units: string[];
  /** One bucket per column in the owning section; several names may share a cell. */
  cells: GridCell[];
  /** Lowest row this unit occupies in the sheet, when the scrape carried it. */
  rowIndex?: number;
}

export interface GridSection {
  key: "units" | "positions";
  title: string;
  columns: GridColumn[];
  rows: GridRow[];
}

export interface RosterGridModel {
  isoDate: string;
  shiftCode: ShiftCode;
  /** Night rosters split every column into a 1st and 2nd half. */
  isSplit: boolean;
  supervision: RosterPerson[];
  sections: GridSection[];
  special: { key: string; label: string; people: RosterPerson[] }[];
  /** SAR and LEAVE — name chips, no rating. */
  chips: { key: string; label: string; people: RosterPerson[] }[];
  /** TRAINING and REMARKS — free text, kept verbatim. */
  notes: { key: string; label: string; lines: string[] }[];
  /** Rows whose position was not recognised — shown rather than discarded. */
  unplaced: RosterPerson[];
  total: number;
}

function splitUnits(label: string) {
  return normalize(label)
    .split(/[+&]|\s\/\s/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Turns a covering assignment into a cell that spans its sectors' rows.
 *
 * Deliberately conservative: the span is only drawn when every covered sector
 * is present in the section and the sectors are adjacent once the rows are in
 * sheet order.  Otherwise the controller stays in a plain single-row cell —
 * a band the grid cannot lay out should look ordinary, never lose somebody.
 */
function applyBandSpans(
  rows: GridRow[],
  columns: GridColumn[],
  bandSpans: Map<string, { covers: string[]; columnKey: string }>,
) {
  bandSpans.forEach(({ covers, columnKey: cellKey }, anchorKey) => {
    const columnIndex = columns.findIndex((column) => column.key === cellKey);
    if (columnIndex === -1) return;

    const anchorRow = anchorKey.split("|")[0];
    const indices = covers.map((unit) =>
      rows.findIndex((row) => row.units.length === 1 && row.units[0] === unit),
    );
    // The anchor row must itself be one of the covered sectors, or the cell is
    // sitting somewhere the span cannot start from.
    if (indices.some((index) => index === -1)) return;
    if (rows[indices[0]].key !== anchorRow) return;

    const ordered = [...indices].sort((left, right) => left - right);
    const isAdjacent = ordered.every(
      (index, position) => position === 0 || index === ordered[position - 1] + 1,
    );
    if (!isAdjacent) return;
    if (ordered[0] !== indices[0]) return;

    const top = ordered[0];
    if (rows[top].cells[columnIndex].people.length === 0) return;

    rows[top].cells[columnIndex] = {
      ...rows[top].cells[columnIndex],
      rowSpan: ordered.length,
    };
    ordered.slice(1).forEach((index) => {
      rows[index].cells[columnIndex] = { people: [], rowSpan: 1, covered: true };
    });
  });
}

// ── Build ────────────────────────────────────────────────────────────────────

interface Placement {
  unit: string;
  column: { group: ColumnGroupKey; half?: Half };
  person: RosterPerson;
  /** Sheet row, when the scrape carried one. */
  rowIndex?: number;
}

/**
 * Builds the grid for one date and shift.
 *
 * `teams` is the team the rotation puts on this shift, used only to mark people
 * who are not from it — the same rule `shiftRoster.ts` applies.
 */
export function buildRosterGrid(
  entries: RosterEntry[],
  isoDate: string,
  shiftCode: ShiftCode,
  shiftName: string,
  teams: string[] = [],
): RosterGridModel {
  const supervision: RosterPerson[] = [];
  const unplaced: RosterPerson[] = [];
  const specialByKey = new Map<string, { key: string; label: string; people: RosterPerson[] }>();
  const chipsByKey = new Map<string, { key: string; label: string; people: RosterPerson[] }>();
  const notesByKey = new Map<string, { key: string; label: string; lines: string[] }>();
  const placements: Placement[] = [];

  let total = 0;

  entries.forEach((entry, index) => {
    const parsed = parseRosterDate(entry.date);
    if (!parsed || format(parsed, "yyyy-MM-dd") !== isoDate) return;
    if (normalize(entry.shift) !== normalize(shiftName)) return;

    const raw = String(entry.employee_name || "").trim();
    if (!raw) return;

    const team = normalizeTeamKey(entry.team);
    const details = parsePersonCell(raw);
    const person: RosterPerson = {
      key: entry.id || `${shiftCode}-${index}-${raw}`,
      raw,
      ...details,
      team,
      isOffTeam: team !== "G" && teams.length > 0 && !teams.includes(team),
    };

    total += 1;

    const position = normalize(entry.position);
    const unit = String(entry.unit || "").trim();

    if (position === SUPERVISION_POSITION) {
      supervision.push(person);
      return;
    }

    if (SPECIAL_POSITIONS.includes(position)) {
      const key = position;
      const bucket = specialByKey.get(key) || {
        key,
        label: String(entry.position || "").trim(),
        people: [],
      };
      bucket.people.push(person);
      specialByKey.set(key, bucket);
      return;
    }

    // SAR / LEAVE / TRAINING / REMARKS sit inside the scanned rectangle, so they
    // arrive looking like units on duty.  Routed by their row label, before any
    // column classification, so they never enter the matrix.
    const unitKey = normalize(unit);

    if (CHIP_BANDS.has(unitKey)) {
      const bucket = chipsByKey.get(unitKey) || { key: unitKey, label: unit, people: [] };
      bucket.people.push(person);
      chipsByKey.set(unitKey, bucket);
      return;
    }

    if (NOTE_BANDS.has(unitKey)) {
      const bucket = notesByKey.get(unitKey) || { key: unitKey, label: unit, lines: [] };
      // Free text, kept exactly as written — the training and remark lines carry
      // times and emoji separators that must not be reformatted.
      bucket.lines.push(person.raw);
      notesByKey.set(unitKey, bucket);
      return;
    }

    const column = classifyPosition(entry.position);
    if (!column || !unit) {
      unplaced.push(person);
      return;
    }

    placements.push({
      unit,
      column,
      person,
      rowIndex: Number.isInteger(entry.row_index) ? (entry.row_index as number) : undefined,
    });
  });

  const isSplit = placements.some((placement) => placement.column.half);

  // A row belongs to the unit block when it actually carries ACC-family
  // columns, rather than by matching its name against a list — the sheet's unit
  // labels vary too much for a list to stay right.
  const rowGroups = new Map<string, Set<ColumnGroupKey>>();
  placements.forEach(({ unit, column }) => {
    const key = normalize(unit);
    const groups = rowGroups.get(key) || new Set<ColumnGroupKey>();
    groups.add(column.group);
    rowGroups.set(key, groups);
  });

  const isUnitRow = (unit: string) => {
    const groups = rowGroups.get(normalize(unit));
    if (!groups) return false;
    return groups.has("rsr") || groups.has("acc-plr") || groups.has("acc-alpha");
  };

  const buildSection = (
    key: GridSection["key"],
    title: string,
    groups: ColumnGroupKey[],
    order: string[],
    rows: Placement[],
  ): GridSection | null => {
    if (rows.length === 0) return null;

    const usedHalves = new Set<Half | "none">();
    rows.forEach(({ column }) => usedHalves.add(column.half ?? "none"));

    // A label naming several sectors means one of two different things:
    //
    //   · a merged cell — one controller covering sectors that each also have
    //     their own row.  This is the two-sector/three-controller shape, and it
    //     belongs in a covering column spanning those rows.
    //   · a genuinely combined row — night rosters carry "UKN+UKW" as a row in
    //     its own right, alongside a separate "UKN" row but no "UKW" row.
    //
    // They are told apart by whether every named sector also exists on its own:
    // only then is there anything to span.
    const singleUnits = new Set(
      rows.filter(({ unit }) => splitUnits(unit).length <= 1).map(({ unit }) => normalize(unit)),
    );
    const isCovering = ({ unit }: Placement) => {
      const parts = splitUnits(unit);
      return parts.length > 1 && parts.every((part) => singleUnits.has(part));
    };

    const bands = rows.filter(isCovering);
    const singles = rows.filter((placement) => !isCovering(placement));

    const columns: GridColumn[] = [];
    const halves: (Half | undefined)[] = isSplit && !usedHalves.has("none")
      ? ["1st", "2nd"]
      : [undefined];

    // Night rosters read half-by-half: every column of the 1st half, then the
    // 2nd — which is how the sheet lays them out either side of its divider.
    // Each rating group can carry two columns, mirroring the sheet's two
    // sub-columns: one for the per-sector controllers and one for whoever
    // covers a band of sectors.
    halves.forEach((half) => {
      groups.forEach((group) => {
        const matches = (placement: Placement) =>
          placement.column.group === group && placement.column.half === half;

        if (singles.some(matches)) {
          columns.push({
            key: columnKey(group, half),
            group,
            label: columnLabel(group, half),
            half,
          });
        }
        if (bands.some(matches)) {
          columns.push({
            key: `${columnKey(group, half)}:covering`,
            group,
            label: `${columnLabel(group, half)} · covering`,
            half,
            covering: true,
          });
        }
      });
    });

    const byUnit = new Map<
      string,
      { label: string; cells: Map<string, RosterPerson[]>; rowIndex?: number }
    >();
    const addTo = (unit: string, cellKey: string, person: RosterPerson, rowIndex?: number) => {
      const unitKey = normalize(unit);
      const row = byUnit.get(unitKey) || { label: unit, cells: new Map() };
      const cell = row.cells.get(cellKey) || [];
      cell.push(person);
      row.cells.set(cellKey, cell);
      // A unit spans several sheet rows once merges are involved; the lowest is
      // where the sheet starts it, and that is what orders the grid.
      if (rowIndex !== undefined && (row.rowIndex === undefined || rowIndex < row.rowIndex)) {
        row.rowIndex = rowIndex;
      }
      byUnit.set(unitKey, row);
    };

    singles.forEach(({ unit, column, person, rowIndex }) =>
      addTo(unit, columnKey(column.group, column.half), person, rowIndex));

    // Bands are parked on the sector they start at; the span is worked out below
    // once the rows are in sheet order.
    const bandSpans = new Map<string, { covers: string[]; columnKey: string }>();
    bands.forEach(({ unit, column, person }) => {
      const covers = splitUnits(unit);
      const anchor = covers[0];
      const cellKey = `${columnKey(column.group, column.half)}:covering`;
      addTo(anchor, cellKey, person);
      bandSpans.set(`${normalize(anchor)}|${cellKey}`, { covers, columnKey: cellKey });
    });

    const unsorted: GridRow[] = [...byUnit.entries()].map(([unitKey, row]) => ({
      key: unitKey,
      label: row.label,
      units: splitUnits(row.label),
      rowIndex: row.rowIndex,
      cells: columns.map<GridCell>((column) => ({
        people: row.cells.get(column.key) || [],
        rowSpan: 1,
        covered: false,
        // Set here rather than in applyBandSpans so the sectors a controller
        // covers are still stated even when the span cannot be drawn.
        covers: bandSpans.get(`${unitKey}|${column.key}`)?.covers,
      })),
    }));

    // The sheet's own row order wins when the scrape carried it, because the
    // unit ordering genuinely differs between rosters.  Older rows have no row
    // index, so those fall back to the canonical order rather than collapsing
    // into an arbitrary one.  The two are never interleaved: mixing a real
    // position with a stand-in produces an order that matches neither.
    const hasRowIndex = unsorted.some((row) => row.rowIndex !== undefined);

    const gridRows = unsorted.sort((left, right) => {
      const delta = hasRowIndex
        ? (left.rowIndex ?? Number.MAX_SAFE_INTEGER) - (right.rowIndex ?? Number.MAX_SAFE_INTEGER)
        : orderIndex(order, left) - orderIndex(order, right);
      return delta !== 0 ? delta : left.label.localeCompare(right.label);
    });

    applyBandSpans(gridRows, columns, bandSpans);

    return { key, title, columns, rows: gridRows };
  };

  const sections = [
    buildSection(
      "units",
      "Units",
      // Remark last, as the sheet places it.
      ["rsr", "acc-plr", "acc-alpha", "remark"],
      UNIT_ORDER,
      placements.filter(({ unit }) => isUnitRow(unit)),
    ),
    buildSection(
      "positions",
      "Tower & support",
      ["duty", "remark"],
      POSITION_ORDER,
      placements.filter(({ unit }) => !isUnitRow(unit)),
    ),
  ].filter((section): section is GridSection => section !== null);

  return {
    isoDate,
    shiftCode,
    isSplit,
    supervision,
    sections,
    special: [...specialByKey.values()],
    chips: [...chipsByKey.values()],
    notes: [...notesByKey.values()],
    unplaced,
    total,
  };
}

/** Case-insensitive match across the fields a user would search on. */
export function personMatchesSearch(person: RosterPerson, search: string) {
  const normalized = search.trim().toLowerCase();
  if (!normalized) return false;

  return [person.name, person.rating, person.grade, person.team, person.raw]
    .some((value) => String(value || "").toLowerCase().includes(normalized));
}

/** How many people in the model match — drives the "n matches" hint. */
export function countMatches(model: RosterGridModel, search: string) {
  if (!search.trim()) return 0;

  let count = 0;
  const tally = (people: RosterPerson[]) => {
    people.forEach((person) => {
      if (personMatchesSearch(person, search)) count += 1;
    });
  };

  tally(model.supervision);
  tally(model.unplaced);
  model.special.forEach((bucket) => tally(bucket.people));
  model.chips.forEach((bucket) => tally(bucket.people));
  const term = search.trim().toLowerCase();
  model.notes.forEach((bucket) => {
    bucket.lines.forEach((line) => {
      if (line.toLowerCase().includes(term)) count += 1;
    });
  });
  model.sections.forEach((section) =>
    section.rows.forEach((row) => row.cells.forEach((cell) => tally(cell.people))),
  );

  return count;
}
