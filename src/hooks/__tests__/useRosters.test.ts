import { describe, expect, it } from "vitest";
import { rosterRowBelongsTo } from "@/hooks/useRosters";

/**
 * `rosters.employee_name` holds the sheet cell verbatim, so the same person is
 * spelled several ways.  These are real shapes taken from the table.
 */
describe("rosterRowBelongsTo", () => {
  it("matches the designation-and-ratings form the sheet writes for most cells", () => {
    expect(rosterRowBelongsTo("BHUPENDRA KUMAR GUPTA/ SM - RSR+UBN-", "BHUPENDRA KUMAR GUPTA")).toBe(true);
    expect(rosterRowBelongsTo("SANGEETA DHAR/ AGM - RSR+UBN-", "SANGEETA DHAR")).toBe(true);
    expect(rosterRowBelongsTo("SHREEKRUSHNA MISHRA/ JE - ADC/SMC-", "SHREEKRUSHNA MISHRA")).toBe(true);
  });

  it("matches a bare name", () => {
    expect(rosterRowBelongsTo("BRAJ MOHAN", "BRAJ MOHAN")).toBe(true);
    expect(rosterRowBelongsTo("braj mohan", "BRAJ MOHAN")).toBe(true);
  });

  it("matches duty-change rows, which spell the assignment out after a colon", () => {
    expect(rosterRowBelongsTo("RANJIT KUMAR: UBN-PLR (1330-1530)  OCC-RELIVER (1830-2030)", "RANJIT KUMAR")).toBe(true);
    expect(rosterRowBelongsTo("VIPIN KUMAR:  UKN-RSR (1530-1730)  UBN", "VIPIN KUMAR")).toBe(true);
  });

  it("does not let a shorter name claim a longer one's duties", () => {
    expect(rosterRowBelongsTo("RANJIT KUMAR DAS/ AGM - ASR+RSR-", "RANJIT KUMAR")).toBe(false);
    expect(rosterRowBelongsTo("RANJIT KUMAR DAS", "RANJIT KUMAR")).toBe(false);
    expect(rosterRowBelongsTo("RANJIT KUMAR/ DGM - RSR+UBN-", "RANJIT KUMAR DAS")).toBe(false);
  });

  it("ignores the header and legend rows the scraper emits alongside duties", () => {
    expect(rosterRowBelongsTo("1st HALF: 1330-1530 1730-2130", "RANJIT KUMAR")).toBe(false);
    expect(rosterRowBelongsTo("", "RANJIT KUMAR")).toBe(false);
    expect(rosterRowBelongsTo(null, "RANJIT KUMAR")).toBe(false);
  });
});
