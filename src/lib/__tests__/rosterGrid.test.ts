import { describe, expect, it } from "vitest";

import {
  buildRosterGrid,
  classifyPosition,
  countMatches,
  parsePersonCell,
} from "@/lib/rosterGrid";
import type { RosterEntry } from "@/hooks/useRosters";

const DATE = "2026-08-10";

function row(overrides: Partial<RosterEntry>): RosterEntry {
  return {
    date: DATE,
    shift: "Morning",
    team: "B",
    unit: "UBN",
    employee_name: "TEST PERSON/ SM - RSR+UBN-",
    position: "RSR",
    ...overrides,
  };
}

describe("parsePersonCell", () => {
  it("splits name, grade and rating", () => {
    expect(parsePersonCell("BIBHAS SARKAR/ JGM - RSR+UBN-")).toEqual({
      name: "BIBHAS SARKAR",
      grade: "JGM",
      rating: "RSR+UBN",
      timeWindow: undefined,
      flags: [],
    });
  });

  it("tolerates the sheet's erratic spacing", () => {
    const tight = parsePersonCell("KRISHNA KANT/ SM -RSR+UBN-");
    expect(tight.name).toBe("KRISHNA KANT");
    expect(tight.grade).toBe("SM");
    expect(tight.rating).toBe("RSR+UBN");
  });

  it("takes the SAR suffix off without eating hyphenated ratings", () => {
    expect(parsePersonCell("AMRITESH KUMAR/ MGR -ADC+ACC-PLR-SAR")).toMatchObject({
      name: "AMRITESH KUMAR",
      grade: "MGR",
      rating: "ADC+ACC-PLR",
      flags: ["SAR"],
    });
  });

  it("keeps ratings whose own text ends in a hyphenated part", () => {
    expect(parsePersonCell("ARINDAM LAHA/ AM - ACC-P+OCC-").rating).toBe("ACC-P+OCC");
    expect(parsePersonCell("NAGMANI KUMAR/ MGR -ACC-PLR+ACC-P-").rating).toBe("ACC-PLR+ACC-P");
    expect(parsePersonCell("MOUMITA SARCAR/ MGR - ADC/SMC-").rating).toBe("ADC/SMC");
  });

  it("reads a partial-shift window out of the cell", () => {
    expect(parsePersonCell("SAMAR PATRA(0830-1230)")).toMatchObject({
      name: "SAMAR PATRA",
      timeWindow: "0830-1230",
    });
  });

  it("does not mistake JE for the tail of a longer grade", () => {
    expect(parsePersonCell("RAJAT RAJ/ JE - ALPHA-").grade).toBe("JE");
    expect(parsePersonCell("VIPIN KUMAR/ JGM - RSR+UBN-").grade).toBe("JGM");
  });

  it("handles rows the edge function already stripped to a bare name", () => {
    expect(parsePersonCell("BIBHAS SARKAR")).toEqual({
      name: "BIBHAS SARKAR",
      timeWindow: undefined,
      flags: [],
    });
  });
});

describe("classifyPosition", () => {
  it("maps the day-shift positions the Apps Script emits", () => {
    expect(classifyPosition("RSR")).toEqual({ group: "rsr", half: undefined });
    expect(classifyPosition("ACC PLR")).toEqual({ group: "acc-plr", half: undefined });
    expect(classifyPosition("ACC ALPHA")).toEqual({ group: "acc-alpha", half: undefined });
    expect(classifyPosition("Duty")).toEqual({ group: "duty", half: undefined });
  });

  it("maps the night-shift positions, halves included", () => {
    expect(classifyPosition("RSR (1st Half)")).toEqual({ group: "rsr", half: "1st" });
    expect(classifyPosition("ACC-PLR (2nd Half)")).toEqual({ group: "acc-plr", half: "2nd" });
    expect(classifyPosition("ACC-ALPHA (1st Half)")).toEqual({ group: "acc-alpha", half: "1st" });
    expect(classifyPosition("2nd Half")).toEqual({ group: "duty", half: "2nd" });
  });

  it("returns null for positions that are not grid columns", () => {
    expect(classifyPosition("SUPERVISION")).toBeNull();
    expect(classifyPosition("Extra Duty")).toBeNull();
    expect(classifyPosition("")).toBeNull();
  });
});

describe("buildRosterGrid", () => {
  it("lays names out by unit row and position column", () => {
    const model = buildRosterGrid(
      [
        row({ unit: "UBN", position: "RSR", employee_name: "A/ SM - RSR+UBN-" }),
        row({ unit: "UBN", position: "ACC PLR", employee_name: "B/ MGR - ACC-PLR-" }),
        row({ unit: "UKE", position: "RSR", employee_name: "C/ AGM - RSR+UBN-" }),
      ],
      DATE,
      "M",
      "Morning",
      ["B"],
    );

    const units = model.sections.find((section) => section.key === "units");
    expect(units).toBeDefined();
    expect(units!.columns.map((column) => column.key)).toEqual(["rsr", "acc-plr"]);
    expect(units!.rows.map((gridRow) => gridRow.label)).toEqual(["UBN", "UKE"]);
    expect(units!.rows[0].cells[0].people[0].name).toBe("A");
    expect(units!.rows[0].cells[1].people[0].name).toBe("B");
    expect(units!.rows[1].cells[1].people).toEqual([]);
  });

  describe("row ordering", () => {
    it("uses the sheet's own row order when the scrape carried it", () => {
      // 15-Aug-2026 runs UKW, UKE, UBS, URP — not the canonical UBN-first order.
      const model = buildRosterGrid(
        [
          row({ unit: "URP", row_index: 3 }),
          row({ unit: "UKW", row_index: 0 }),
          row({ unit: "UBS", row_index: 2 }),
          row({ unit: "UKE", row_index: 1 }),
        ],
        DATE,
        "M",
        "Morning",
      );

      const units = model.sections.find((section) => section.key === "units");
      expect(units!.rows.map((gridRow) => gridRow.label)).toEqual(["UKW", "UKE", "UBS", "URP"]);
    });

    it("falls back to the canonical order for rows synced before row_index", () => {
      const model = buildRosterGrid(
        ["UGT", "UBN", "UKW", "UKE"].map((unit) => row({ unit })),
        DATE,
        "M",
        "Morning",
      );

      const units = model.sections.find((section) => section.key === "units");
      expect(units!.rows.map((gridRow) => gridRow.label)).toEqual(["UBN", "UKE", "UKW", "UGT"]);
    });

    it("takes a unit's lowest row when a merge spreads it over several", () => {
      const model = buildRosterGrid(
        [
          row({ unit: "UKE", position: "RSR", row_index: 1 }),
          row({ unit: "UKE", position: "ACC PLR", row_index: 4 }),
          row({ unit: "UBN", position: "RSR", row_index: 2 }),
        ],
        DATE,
        "M",
        "Morning",
      );

      const units = model.sections.find((section) => section.key === "units");
      expect(units!.rows.map((gridRow) => gridRow.label)).toEqual(["UKE", "UBN"]);
    });

    it("does not interleave indexed and unindexed rows", () => {
      // Mid-migration a date can hold both.  Sorting a real position against a
      // stand-in yields an order matching neither, so indexed rows lead and the
      // rest keep a stable, predictable tail.
      const model = buildRosterGrid(
        [
          row({ unit: "UBN" }),
          row({ unit: "UGT", row_index: 0 }),
          row({ unit: "UKE" }),
        ],
        DATE,
        "M",
        "Morning",
      );

      const units = model.sections.find((section) => section.key === "units");
      expect(units!.rows.map((gridRow) => gridRow.label)).toEqual(["UGT", "UBN", "UKE"]);
    });
  });

  it("stacks several people into one cell", () => {
    const model = buildRosterGrid(
      [
        row({ unit: "UBN", position: "RSR", employee_name: "A/ SM - RSR+UBN-" }),
        row({ unit: "UBN", position: "RSR", employee_name: "B/ SM - RSR+UBN-" }),
      ],
      DATE,
      "M",
      "Morning",
    );

    const units = model.sections.find((section) => section.key === "units");
    expect(units!.rows[0].cells[0].people.map((person) => person.name)).toEqual(["A", "B"]);
  });

  it("splits night columns into halves and marks the model as split", () => {
    const model = buildRosterGrid(
      [
        row({ shift: "Night", unit: "UBN", position: "RSR (1st Half)" }),
        row({ shift: "Night", unit: "UBN", position: "RSR (2nd Half)" }),
        row({ shift: "Night", unit: "UBN", position: "ACC-ALPHA (1st Half)" }),
      ],
      DATE,
      "N",
      "Night",
    );

    expect(model.isSplit).toBe(true);
    const units = model.sections.find((section) => section.key === "units");
    // 1st half first, then 2nd — the order the sheet uses either side of its divider.
    expect(units!.columns.map((column) => column.key)).toEqual([
      "rsr:1st",
      "acc-alpha:1st",
      "rsr:2nd",
    ]);
  });

  it("separates tower rows from unit rows by the columns they carry", () => {
    const model = buildRosterGrid(
      [
        row({ unit: "UBN", position: "RSR" }),
        row({ unit: "TWR", position: "Duty" }),
        row({ unit: "CLD", position: "Duty" }),
      ],
      DATE,
      "M",
      "Morning",
    );

    expect(model.sections.map((section) => section.key)).toEqual(["units", "positions"]);
    const positions = model.sections.find((section) => section.key === "positions");
    expect(positions!.rows.map((gridRow) => gridRow.label)).toEqual(["TWR", "CLD"]);
  });

  it("splits composite unit labels while keeping the label verbatim", () => {
    const model = buildRosterGrid(
      [row({ shift: "Night", unit: "UKN+UKW", position: "RSR (1st Half)" })],
      DATE,
      "N",
      "Night",
    );

    const units = model.sections.find((section) => section.key === "units");
    expect(units!.rows[0].label).toBe("UKN+UKW");
    expect(units!.rows[0].units).toEqual(["UKN", "UKW"]);
  });

  // The sheet's two-sector / three-controller shape: UBN and UKE each have their
  // own controller and a third spans both in a merged cell.
  describe("two-sector bands", () => {
    const band = (extra: Partial<RosterEntry>[] = []) =>
      buildRosterGrid(
        [
          row({ unit: "UBN", position: "RSR", employee_name: "DIPTESH GARAI/ DGM - RSR+UBN-" }),
          row({ unit: "UKE", position: "RSR", employee_name: "KUMARI SANGITA/ AGM - RSR+UBN-" }),
          row({
            unit: "UBN+UKE",
            position: "RSR",
            employee_name: "MANORANJAN CHATTERJEE/ AGM - RSR+UBN-",
          }),
          ...extra.map(row),
        ],
        DATE,
        "M",
        "Morning",
      );

    it("folds the combined row into a cell spanning both sectors", () => {
      const units = band().sections.find((section) => section.key === "units")!;

      // The combined row is gone — it became a span, not an extra row.
      expect(units.rows.map((gridRow) => gridRow.label)).toEqual(["UBN", "UKE"]);

      const [ubn, uke] = units.rows;
      expect(ubn.cells[0].people.map((person) => person.name)).toEqual(["DIPTESH GARAI"]);
      expect(uke.cells[0].people.map((person) => person.name)).toEqual(["KUMARI SANGITA"]);

      // The shared controller sits in a second column that spans both rows.
      expect(ubn.cells[1].people.map((person) => person.name)).toEqual(["MANORANJAN CHATTERJEE"]);
      expect(ubn.cells[1].rowSpan).toBe(2);
      expect(ubn.cells[1].covers).toEqual(["UBN", "UKE"]);
      expect(uke.cells[1].covered).toBe(true);
    });

    it("keeps all three controllers reachable", () => {
      expect(band().total).toBe(3);
      expect(countMatches(band(), "MANORANJAN")).toBe(1);
    });

    it("keeps a sector's own controller beside the one covering the band", () => {
      // The covering controller gets its own column, so it never displaces the
      // per-sector controller in the same rating group.
      const units = band([
        { unit: "UKE", position: "ACC PLR", employee_name: "SOMEONE ELSE/ SM - ACC-PLR-" },
        { unit: "UBN+UKE", position: "ACC PLR", employee_name: "SHARED/ MGR - ACC-PLR-" },
      ]).sections.find((section) => section.key === "units")!;

      expect(units.columns.map((column) => column.key)).toEqual([
        "rsr",
        "rsr:covering",
        "acc-plr",
        "acc-plr:covering",
      ]);

      const names = units.rows.flatMap((gridRow) =>
        gridRow.cells.flatMap((cell) => cell.people.map((person) => person.name)),
      );
      expect(names).toContain("SOMEONE ELSE");
      expect(names).toContain("SHARED");
    });

    // A combined label whose sectors do not each have their own row is a real
    // combined row — night rosters carry "UKN+UKW" that way — not a merged cell.
    it("leaves a combined row standing when there is nothing to span", () => {
      const model = buildRosterGrid(
        [row({ unit: "UBN", position: "RSR" }), row({ unit: "UBN+UKE", position: "RSR" })],
        DATE,
        "M",
        "Morning",
      );

      const units = model.sections.find((section) => section.key === "units")!;
      expect(units.rows.map((gridRow) => gridRow.label)).toEqual(["UBN", "UBN+UKE"]);
      expect(units.columns.some((column) => column.covering)).toBe(false);
      expect(model.total).toBe(2);
    });

    it("spans three sectors when the band covers three", () => {
      const model = buildRosterGrid(
        [
          row({ unit: "UKN", position: "RSR" }),
          row({ unit: "UBS", position: "RSR" }),
          row({ unit: "UGT", position: "RSR" }),
          row({ unit: "UKN+UBS+UGT", position: "RSR", employee_name: "PRITAM NATH/ AGM - RSR+UBN-" }),
        ],
        DATE,
        "M",
        "Morning",
      );

      const units = model.sections.find((section) => section.key === "units")!;
      const spanning = units.rows[0].cells.find((cell) => cell.rowSpan > 1);
      expect(spanning?.rowSpan).toBe(3);
      expect(spanning?.covers).toEqual(["UKN", "UBS", "UGT"]);
    });
  });

  it("routes supervision and special rows out of the matrix", () => {
    const model = buildRosterGrid(
      [
        row({ unit: "WSO", position: "SUPERVISION", employee_name: "W/ JGM - RSR+UBN-SAR" }),
        row({ unit: "SPECIAL", position: "Extra Duty", employee_name: "E" }),
        row({ unit: "UBN", position: "RSR" }),
      ],
      DATE,
      "M",
      "Morning",
    );

    expect(model.supervision.map((person) => person.name)).toEqual(["W"]);
    expect(model.supervision[0].flags).toEqual(["SAR"]);
    expect(model.special[0].people.map((person) => person.name)).toEqual(["E"]);
  });

  // SAR / LEAVE / TRAINING / REMARKS live inside the scanned rectangle, so they
  // arrive from the scraper looking like units on duty.
  describe("bands that are not units", () => {
    it("routes SAR and LEAVE to chip bands, not to the matrix", () => {
      const model = buildRosterGrid(
        [
          row({ unit: "UBN", position: "RSR" }),
          row({ unit: "SAR", position: "Duty", employee_name: "ANKIT SRIVASTAVA" }),
          row({ unit: "LEAVE", position: "Duty", employee_name: "RAJ KUMAR" }),
          row({ unit: "LEAVE", position: "Duty", employee_name: "DIYA BASU" }),
        ],
        DATE,
        "M",
        "Morning",
      );

      expect(model.chips.map((b) => [b.key, b.people.length])).toEqual([
        ["SAR", 1],
        ["LEAVE", 2],
      ]);
      const labels = model.sections.flatMap((s) => s.rows.map((r) => r.label));
      expect(labels).not.toContain("SAR");
      expect(labels).not.toContain("LEAVE");
    });

    it("keeps TRAINING and REMARKS as verbatim text", () => {
      const line = "RSR DB :: BIBHAS TO SULAGNA(0300-0400) RICHA(0600-0730)";
      const model = buildRosterGrid(
        [
          row({ unit: "UBN", position: "RSR" }),
          row({ unit: "TRAINING", position: "Duty", employee_name: line }),
        ],
        DATE,
        "M",
        "Morning",
      );

      expect(model.notes).toEqual([{ key: "TRAINING", label: "TRAINING", lines: [line] }]);
      expect(countMatches(model, "SULAGNA")).toBe(1);
    });

    it("puts the REMARK column last, after the rating columns", () => {
      const model = buildRosterGrid(
        [
          row({ unit: "UBN", position: "RSR" }),
          row({ unit: "UBN", position: "ACC ALPHA" }),
          row({ unit: "UBN", position: "REMARK", employee_name: "UBN-A / OCC-A" }),
        ],
        DATE,
        "M",
        "Morning",
      );

      const units = model.sections.find((section) => section.key === "units")!;
      expect(units.columns.map((column) => column.key)).toEqual(["rsr", "acc-alpha", "remark"]);
    });
  });

  it("reads a time window written with TO instead of a hyphen", () => {
    expect(parsePersonCell("ABHISHEK KUMAR (0830 TO 1230)")).toMatchObject({
      name: "ABHISHEK KUMAR",
      timeWindow: "0830-1230",
    });
    expect(parsePersonCell("DIVYA DEV (0830 to 1230)").timeWindow).toBe("0830-1230");
  });

  it("keeps rows it cannot place instead of dropping them", () => {
    const model = buildRosterGrid(
      [row({ unit: "UBN", position: "SOMETHING NEW", employee_name: "X/ SM - RSR+UBN-" })],
      DATE,
      "M",
      "Morning",
    );

    expect(model.unplaced.map((person) => person.name)).toEqual(["X"]);
    expect(model.total).toBe(1);
  });

  it("ignores rows from another date or shift", () => {
    const model = buildRosterGrid(
      [
        row({ date: "2026-08-11" }),
        row({ shift: "Night" }),
        row({}),
      ],
      DATE,
      "M",
      "Morning",
    );

    expect(model.total).toBe(1);
  });

  it("marks people who are not from the team on duty", () => {
    const model = buildRosterGrid(
      [row({ team: "A" }), row({ team: "B", unit: "UKE" })],
      DATE,
      "M",
      "Morning",
      ["B"],
    );

    const units = model.sections.find((section) => section.key === "units");
    expect(units!.rows[0].cells[0].people[0].isOffTeam).toBe(true);
    expect(units!.rows[1].cells[0].people[0].isOffTeam).toBe(false);
  });
});

describe("countMatches", () => {
  it("counts across the matrix, supervision and special buckets", () => {
    const model = buildRosterGrid(
      [
        row({ unit: "UBN", position: "RSR", employee_name: "RICHA SINGH/ MGR - ADC+ACC-P-" }),
        row({ unit: "WSO", position: "SUPERVISION", employee_name: "RICHA OTHER/ JGM - RSR-" }),
        row({ unit: "UKE", position: "RSR", employee_name: "SOMEONE ELSE/ SM - RSR+UBN-" }),
      ],
      DATE,
      "M",
      "Morning",
    );

    expect(countMatches(model, "richa")).toBe(2);
    expect(countMatches(model, "ADC+ACC-P")).toBe(1);
    expect(countMatches(model, "")).toBe(0);
  });
});
