/* eslint-disable @typescript-eslint/no-explicit-any --
 * `employee_schedules` is missing from the generated Supabase types
 * (src/integrations/supabase/types.ts is out of date and omits several live
 * tables). The casts are confined to this module so every caller sees a typed
 * API; regenerating the types is the real fix and would let these all go.
 */

/**
 * schedule.repository.ts
 * ---------------------------------------------------------------------------
 * The single write path for employee_schedules duty cells.
 *
 * Previously this lived inline inside DutyManagement.tsx, so the Availability
 * Finder had no way to apply a suggestion without duplicating it. Both pages now
 * go through here.
 */
import { supabase } from "@/integrations/supabase/client";
import { DUTY_DESCRIPTIONS } from "@/hooks/useEmployeeSchedules";
import type { DutyMutation } from "@/lib/compliance/planValidator";

export interface DutyCellWrite {
  employeeCode: string;
  employeeName: string;
  dutyDate: string;
  dutyCode: string;
}

/** Write one duty cell. An empty duty code deletes the row. */
export async function upsertDuty({ employeeCode, employeeName, dutyDate, dutyCode }: DutyCellWrite) {
  if (!dutyCode) {
    const { error } = await supabase
      .from("employee_schedules" as any)
      .delete()
      .eq("employee_code", employeeCode)
      .eq("duty_date", dutyDate);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from("employee_schedules" as any)
    .upsert(
      {
        employee_code: employeeCode,
        employee_name: employeeName,
        duty_date: dutyDate,
        duty_code: dutyCode,
        duty_description: DUTY_DESCRIPTIONS[dutyCode] || dutyCode,
      } as any,
      { onConflict: "employee_code,duty_date" },
    );
  if (error) throw error;
}

export class StaleDutyPlanError extends Error {
  constructor(readonly conflicts: string[]) {
    super(
      `The roster changed while this suggestion was on screen: ${conflicts.join("; ")}. ` +
        `Re-run the search so the plan is checked against the current roster.`,
    );
    this.name = "StaleDutyPlanError";
  }
}

/**
 * Compare-and-set guard. Two supervisors covering the same gap both see a safe
 * plan and both apply it; the upsert's conflict target protects the CELL but not
 * the DECISION. Re-read the cells this plan depends on and abort if any has moved
 * since the suggestion was generated.
 */
async function assertPlanIsCurrent(mutations: DutyMutation[]) {
  const dates = [...new Set(mutations.map((m) => m.date))].sort();
  const codes = [...new Set(mutations.map((m) => m.employeeId))];

  const { data, error } = await supabase
    .from("employee_schedules" as any)
    .select("employee_code, duty_date, duty_code")
    .in("employee_code", codes)
    .gte("duty_date", dates[0])
    .lte("duty_date", dates[dates.length - 1]);
  if (error) throw error;

  const live = new Map<string, string | null>();
  (data as unknown as Array<{ employee_code: string; duty_date: string; duty_code: string | null }>)
    .forEach((r) => live.set(`${r.employee_code.trim().toUpperCase()}::${r.duty_date}`, r.duty_code));

  const conflicts = mutations
    .filter((m) => {
      const current = live.get(`${m.employeeId.trim().toUpperCase()}::${m.date}`) ?? null;
      return (current ?? "") !== (m.from ?? "");
    })
    .map((m) => {
      const current = live.get(`${m.employeeId.trim().toUpperCase()}::${m.date}`) ?? "(none)";
      return `${m.date} is now ${current}, expected ${m.from ?? "(none)"}`;
    });

  if (conflicts.length > 0) throw new StaleDutyPlanError(conflicts);
}

export interface ApplyDutyPlanArgs {
  mutations: DutyMutation[];
  employeeName: string;
  /** Skip the staleness check — only for the undo path, which restores known state. */
  force?: boolean;
}

/**
 * Apply every cell of a plan. A night-break writes two days and both must land, so
 * a mid-way failure rolls the earlier writes back to their recorded `from` values.
 *
 * Supabase has no client-side transaction, so this is a best-effort compensating
 * rollback rather than an atomic commit — enough to avoid leaving a controller with
 * half a night-break, which would be worse than either outcome.
 */
export async function applyDutyPlan({ mutations, employeeName, force }: ApplyDutyPlanArgs) {
  if (mutations.length === 0) return;
  if (!force) await assertPlanIsCurrent(mutations);

  const written: DutyMutation[] = [];
  try {
    for (const m of mutations) {
      await upsertDuty({
        employeeCode: m.employeeId,
        employeeName,
        dutyDate: m.date,
        dutyCode: m.to,
      });
      written.push(m);
    }
  } catch (error) {
    for (const m of written.reverse()) {
      await upsertDuty({
        employeeCode: m.employeeId,
        employeeName,
        dutyDate: m.date,
        dutyCode: m.from ?? "",
      }).catch(() => undefined);
    }
    throw error;
  }
}

/** Restore a plan's cells to the duty codes they held before it was applied. */
export async function revertDutyPlan(mutations: DutyMutation[], employeeName: string) {
  await applyDutyPlan({
    mutations: mutations.map((m) => ({ ...m, from: m.to, to: m.from ?? "" })),
    employeeName,
    force: true,
  });
}
