/**
 * The register → sheet mapping, which is the inverse of
 * supabase/functions/fetch-leave-data.
 *
 * The case worth guarding hardest: for comp-off categories `leave_date` is the
 * DUTY date and the day off is `leave_used_on`, the opposite way round from a
 * plain leave row. Getting that backwards writes the comp-off date into the
 * holiday column and looks plausible.
 */
import { describe, expect, it } from "vitest";

import { buildSheetPayload, normaliseEmpId, type LeaveRecordRow } from "../../../lib/leaveSheetPayload";

const base = { emp_id: "10014941", employee_name: "SUMAN CHANDRA HALDER" };
const build = (rows: Partial<LeaveRecordRow>[], year = 2026) =>
    buildSheetPayload(rows.map((r) => ({ ...base, ...r }) as LeaveRecordRow), { year });

describe("buildSheetPayload", () => {
    it("routes each category to its own section", () => {
        const { employees } = build([
            { leave_category: "CL", leave_date: "2026-03-02" },
            { leave_category: "NH", leave_date: "2026-01-26" },
            { leave_category: "RH", leave_date: "2026-03-03", leave_used_on: "2026-03-03" },
            { leave_category: "COMP_OFF_EARNED", leave_date: "2026-05-28", duty_code: "N", leave_used_on: "2026-08-20" },
            { leave_category: "LAST_YEAR_CH_DUTY", leave_date: "2025-10-20", duty_code: "A", leave_used_on: "2026-01-19" },
            { leave_category: "OPE", leave_date: "2025-12-03", leave_used_on: "2026-02-26" },
        ]);

        expect(employees).toHaveLength(1);
        const e = employees[0];
        expect(e.employee).toEqual({ empId: "10014941", name: "SUMAN CHANDRA HALDER" });
        expect(e.casualLeave).toEqual(["2026-03-02"]);
        expect(e.nationalHolidays).toEqual(["2026-01-26"]);
        expect(e.restrictedHolidays).toEqual([{ date: "2026-03-03", leaveApplied: "2026-03-03" }]);
        expect(e.closedHolidays).toEqual([
            { date: "2026-05-28", dutyPerformed: "N", leaveApplied: "2026-08-20" },
        ]);
        expect(e.lastYearCompOff).toEqual([
            { date: "2025-10-20", dutyPerformed: "A", leaveApplied: "2026-01-19" },
        ]);
        expect(e.opeDuty).toEqual([{ opeDutyDate: "2025-12-03", leaveApplied: "2026-02-26" }]);
    });

    it("keeps the duty date and the day off the right way round", () => {
        const { employees } = build([
            { leave_category: "COMP_OFF_EARNED", leave_date: "2026-01-23", duty_code: "M", leave_used_on: "2026-04-10" },
        ]);

        // The holiday worked, not the day taken off.
        expect(employees[0].closedHolidays[0].date).toBe("2026-01-23");
        expect(employees[0].closedHolidays[0].leaveApplied).toBe("2026-04-10");
    });

    it("year-filters leave but not comp-off", () => {
        // A comp-off earned last October is still claimable this year, and the
        // sheet keys it by the holiday date in its column header.
        const { employees } = build([
            { leave_category: "CL", leave_date: "2025-03-02" },
            { leave_category: "RH", leave_date: "2025-03-03" },
            { leave_category: "NH", leave_date: "2025-01-26" },
            { leave_category: "LAST_YEAR_CH_DUTY", leave_date: "2025-10-20", duty_code: "A" },
        ], 2026);

        expect(employees[0].casualLeave).toEqual([]);
        expect(employees[0].restrictedHolidays).toEqual([]);
        expect(employees[0].nationalHolidays).toEqual([]);
        expect(employees[0].lastYearCompOff).toHaveLength(1);
    });

    it("reports categories with no column instead of dropping them", () => {
        // `CH` rows record only the day the comp-off was taken, never the holiday
        // it was earned against, so there is nowhere to put them.
        const { employees, skipped } = build([
            { leave_category: "CH", leave_date: "2026-04-10" },
            { leave_category: "CH", leave_date: "2026-04-11" },
            { leave_category: "OPE_COMP_OFF", leave_date: "2026-05-01" },
        ]);

        expect(skipped).toEqual([
            { category: "CH", count: 2 },
            { category: "OPE_COMP_OFF", count: 1 },
        ]);
        expect(employees[0].closedHolidays).toEqual([]);
    });

    it("falls back to metadata when the columns are empty", () => {
        const { employees } = build([
            {
                leave_category: "OPE",
                leave_date: "2026-01-01",
                metadata: { ope_duty_date: "2025-12-03" },
            },
            {
                leave_category: "COMP_OFF_EARNED",
                leave_date: "2026-03-21",
                duty_code: "",
                metadata: { duty_performed: "NO+N" },
            },
            {
                leave_category: "RH",
                leave_date: "2026-02-19",
                metadata: JSON.stringify({ leave_applied: "2026-02-25" }),
            },
        ]);

        expect(employees[0].opeDuty[0].opeDutyDate).toBe("2025-12-03");
        expect(employees[0].closedHolidays[0].dutyPerformed).toBe("NO+N");
        expect(employees[0].restrictedHolidays[0].leaveApplied).toBe("2026-02-25");
    });

    it("groups by employee and keeps them separate", () => {
        const { employees } = build([
            { emp_id: "10014941", employee_name: "ALPHA", leave_category: "CL", leave_date: "2026-03-02" },
            { emp_id: "10020402", employee_name: "BETA", leave_category: "CL", leave_date: "2026-03-23" },
            { emp_id: "10014941", employee_name: "ALPHA", leave_category: "CL", leave_date: "2026-03-04" },
        ]);

        expect(employees.map((e) => e.employee.empId)).toEqual(["10014941", "10020402"]);
        expect(employees[0].casualLeave).toEqual(["2026-03-02", "2026-03-04"]);
        expect(employees[1].casualLeave).toEqual(["2026-03-23"]);
    });

    it("skips rows with no emp_id rather than inventing an employee", () => {
        const { employees } = build([{ emp_id: "", leave_category: "CL", leave_date: "2026-03-02" }]);
        expect(employees).toEqual([]);
    });
});

describe("normaliseEmpId", () => {
    it("matches the key the sheet uses", () => {
        expect(normaliseEmpId("010014941")).toBe("10014941");
        expect(normaliseEmpId(10014941)).toBe("10014941");
        expect(normaliseEmpId(" 10014941 ")).toBe("10014941");
    });
});
