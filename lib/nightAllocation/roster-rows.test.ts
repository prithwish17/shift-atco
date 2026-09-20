import { describe, expect, it } from "vitest";
import { isTowerUnit, readCrewRow } from "./service.js";

/**
 * The shift roster is a Google Sheet. Its name column carries working notes as
 * well as people, its unit spellings differ between team tabs, and its half
 * column is the office's own record of who works which half. These are the
 * rules that turn that into a crew, and they are the ones most likely to break
 * quietly when the sheet changes.
 */
describe("tower units", () => {
  it("accepts every spelling seen in the sheet", () => {
    for (const unit of ["TWR", "CLD", "TSO", "SMC", "SMC-N & SMC-S", "TWR-A/ AIMS", "AIMS"]) {
      expect(isTowerUnit(unit), unit).toBe(true);
    }
  });

  it("ignores case and stray spacing", () => {
    expect(isTowerUnit("  twr  ")).toBe(true);
    expect(isTowerUnit("smc-n  &  smc-s")).toBe(true);
  });

  it("rejects the sector and support units", () => {
    for (const unit of ["UBN", "UKN+UKW", "OCCN & OCC-S", "MCD", "ARO", "AIS", "FMP", "WSO"]) {
      expect(isTowerUnit(unit), unit).toBe(false);
    }
  });
});

describe("reading a roster row", () => {
  const row = (employee_name: string, unit = "TWR", position = "1st Half") => ({
    employee_name,
    unit,
    position,
    team: "A",
  });

  it("strips the designation and rating from the name", () => {
    expect(readCrewRow(row("HITESH RATHORE/ MGR - ADC/SMC-"))).toEqual({
      name: "HITESH RATHORE",
      unit: "TWR",
      half: "1st",
    });
  });

  it("reads the half from the position column", () => {
    expect(readCrewRow(row("TANYA PRAKASH/ JE - ADC/SMC-", "TWR", "2nd Half"))?.half).toBe("2nd");
    expect(readCrewRow(row("SAMAR PATRA", "TWR", "SUPERVISION"))?.half).toBeNull();
  });

  it("rejects a working note written in the name column", () => {
    // Real rows from the sheet: the name cell doubles as a scratch pad.
    expect(readCrewRow(row("TWR (1330-1530) (1630-1730) SMC (2330-0130)"))).toBeNull();
    expect(readCrewRow(row("UBN-A (1530-1630)"))).toBeNull();
    expect(readCrewRow(row("RSR-RELIEVER (1730-0130)"))).toBeNull();
  });

  it("rejects leave, remark and training rows", () => {
    expect(readCrewRow(row("SOMEONE ELSE/ JE - ADC-", "LEAVE"))).toBeNull();
    expect(readCrewRow(row("SOMEONE ELSE/ JE - ADC-", "REMARKS"))).toBeNull();
    expect(readCrewRow(row("SOMEONE ELSE/ JE - ADC-", "TRAINING"))).toBeNull();
  });

  it("rejects an empty or too-short name", () => {
    expect(readCrewRow(row(""))).toBeNull();
    expect(readCrewRow(row("  "))).toBeNull();
    expect(readCrewRow(row("A/"))).toBeNull();
  });

  it("keeps a plain name with no designation", () => {
    expect(readCrewRow(row("RISHABH", "CLD", "2nd Half"))).toEqual({
      name: "RISHABH",
      unit: "CLD",
      half: "2nd",
    });
  });
});
