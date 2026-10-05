/**
 * The CL balance an employee sees is derived from the register rows, so this
 * has to agree with recompute_leave_balance() in
 * supabase/migrations/20261005110000_leave_register_on_approval.sql:
 * a full-day CL counts 1, a half-day (CL_1ST / CL_2ND) counts ½, capped at 12.
 */
import { describe, expect, it } from "vitest";

import { calculateCasualLeaveCount, normalizeLeaveRecord } from "../leaveCalculations";

describe("casual leave count", () => {
    it("counts a half-day CL as half a day", () => {
        const record = {
            empId: "10000001",
            casualLeave: ["2026-02-10", "2026-03-05"],
            halfCasualLeave: ["2026-04-08"],
        };

        expect(calculateCasualLeaveCount(record)).toBe(2.5);
        expect(normalizeLeaveRecord(record).casualRemaining).toBe(9.5);
    });

    it("counts half days when there are no full days", () => {
        expect(calculateCasualLeaveCount({ halfCasualLeave: ["2026-04-08", "2026-05-11"] })).toBe(1);
    });

    it("still caps at the annual allowance", () => {
        const casualLeave = Array.from({ length: 12 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`);
        expect(calculateCasualLeaveCount({ casualLeave, halfCasualLeave: ["2026-02-01"] })).toBe(12);
    });

    it("carries the half days through normalisation", () => {
        const normalized = normalizeLeaveRecord({ empId: "1", halfCasualLeave: ["2026-04-08"] });
        expect(normalized.halfCasualLeave).toEqual(["2026-04-08"]);
    });
});
