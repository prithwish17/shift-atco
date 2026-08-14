/* eslint-disable @typescript-eslint/no-explicit-any --
 * `employee_schedules` is missing from the generated Supabase types, and the
 * duty_exchanges/profiles joins here predate them too. Regenerating
 * src/integrations/supabase/types.ts is the real fix.
 */
import { useQuery } from "@tanstack/react-query";
import { addDays, format, parseISO } from "date-fns";

import { supabase } from "@/integrations/supabase/client";
import { OPE_CODES } from "@/lib/dutyConfig";
import { EMPTY_FAIRNESS, type FairnessHistory } from "@/lib/compliance/ladder";
import { getTeamDutyForDateKey } from "@/lib/teamDutyRotation";

export type EmployeeHistoryMap = Map<string, FairnessHistory>;

function key(code: string | null | undefined) {
  return String(code || "").trim().toUpperCase();
}

const DEAD_STATUSES = new Set(["rejected", "cancelled", "canceled", "declined", "withdrawn"]);

/**
 * The day after `date`.
 *
 * date-fns, not `new Date(…).toISOString()`: the latter reads "yyyy-MM-dd" as local
 * midnight and prints in UTC, so east of Greenwich the round trip lands back on the
 * same day. That made the night-break derivation below compare a date against
 * itself, so no break was ever counted and the rotation load under-reported.
 */
function nextDay(date: string): string {
  return format(addDays(parseISO(date), 1), "yyyy-MM-dd");
}

/**
 * 1 January of the year containing `targetDateISO` — the start of the window every
 * rotation counter (OPE, night-breaks, exchanges) is queried over.
 *
 * Pulled out as its own pure function so "extra duty is counted from January" is
 * something the test suite can assert directly, rather than a claim about a
 * Supabase-calling function nothing here can run against a fake network.
 */
export function yearStart(targetDateISO: string): string {
  return `${parseISO(targetDateISO).getFullYear()}-01-01`;
}

/** employee_code → rotation team key, for the night-break derivation. */
async function fetchTeams(): Promise<Map<string, string>> {
  const { data, error } = await supabase.from("profiles").select("employee_id, current_shift");
  const teams = new Map<string, string>();
  if (error || !data) return teams;

  (data as Array<{ employee_id: string | null; current_shift: string | null }>).forEach((p) => {
    const code = key(p.employee_id);
    if (code && p.current_shift) teams.set(code, p.current_shift);
  });
  return teams;
}

/**
 * Per-employee rotation load for a target date: how often each controller has already
 * been imposed on this year and this month, across duty exchanges, OPE duties and
 * night-breaks. The ladder uses this to rotate WITHIN a rung — it never promotes a
 * candidate across one.
 *
 * Night-breaks are derived from roster truth rather than the decision log. A break
 * writes a plain M/A, so it is invisible to the OPE code filter, and reading the audit
 * log would miss any break entered by hand in Duty Management. Instead we compare the
 * rostered duty against the team's rotation baseline: a day duty where the cycle
 * rosters a night, with the following night-off also worked, is a night-break.
 */
export async function fetchEmployeeHistory(targetDateISO: string): Promise<EmployeeHistoryMap> {
  const ytdStart = yearStart(targetDateISO);
  const monthPrefix = targetDateISO.slice(0, 7); // yyyy-MM

  const map: EmployeeHistoryMap = new Map();
  const get = (k: string) => {
    let v = map.get(k);
    if (!v) {
      v = { ...EMPTY_FAIRNESS };
      map.set(k, v);
    }
    return v;
  };
  const inMonth = (date: string) => String(date).startsWith(monthPrefix);

  // ── OPE duties (compound codes in employee_schedules) ────────────────────
  const { data: opeRows, error: opeErr } = await supabase
    .from("employee_schedules" as any)
    .select("employee_code, duty_code, duty_date")
    .gte("duty_date", ytdStart)
    .lte("duty_date", targetDateISO)
    .in("duty_code", OPE_CODES);

  if (!opeErr && opeRows) {
    (opeRows as unknown as Array<{ employee_code: string; duty_date: string }>).forEach((r) => {
      const k = key(r.employee_code);
      if (!k) return;
      const h = get(k);
      h.opeYear += 1;
      if (inMonth(r.duty_date)) h.opeMonth += 1;
    });
  }

  // ── Night-breaks (roster deviating from the team rotation) ───────────────
  const { data: dayRows, error: dayErr } = await supabase
    .from("employee_schedules" as any)
    .select("employee_code, duty_code, duty_date")
    .gte("duty_date", ytdStart)
    .lte("duty_date", targetDateISO)
    .in("duty_code", ["M", "A"]);

  if (!dayErr && dayRows) {
    const teams = await fetchTeams();
    const dayShiftsByEmployee = new Map<string, Set<string>>();

    (dayRows as unknown as Array<{ employee_code: string; duty_date: string }>).forEach((r) => {
      const k = key(r.employee_code);
      if (!k) return;
      const set = dayShiftsByEmployee.get(k) ?? new Set<string>();
      set.add(r.duty_date);
      dayShiftsByEmployee.set(k, set);
    });

    for (const [code, dates] of dayShiftsByEmployee) {
      const team = teams.get(code);
      if (!team) continue;

      for (const date of dates) {
        // Both halves must deviate: the night day AND the night-off day.
        if (getTeamDutyForDateKey(team, date) !== "N") continue;
        const next = nextDay(date);
        if (!dates.has(next)) continue;
        if (getTeamDutyForDateKey(team, next) !== "NO") continue;

        const h = get(code);
        h.nightBreaksYear += 1;
        if (inMonth(date)) h.nightBreaksMonth += 1;
      }
    }
  }

  // ── Duty exchanges (duty_exchanges, mapped UUID → employee_code) ─────────
  const { data: exRows, error: exErr } = await supabase
    .from("duty_exchanges")
    .select("requesting_user_id, exchange_partner_id, created_at, status")
    .gte("created_at", ytdStart);

  if (!exErr && exRows) {
    const ids = new Set<string>();
    exRows.forEach((e: any) => {
      if (e.requesting_user_id) ids.add(e.requesting_user_id);
      if (e.exchange_partner_id) ids.add(e.exchange_partner_id);
    });

    const idToCode = new Map<string, string>();
    if (ids.size > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, employee_id")
        .in("id", Array.from(ids));
      (profiles || []).forEach((p: any) => idToCode.set(p.id, key(p.employee_id)));
    }

    exRows.forEach((e: any) => {
      if (DEAD_STATUSES.has(String(e.status || "").toLowerCase())) return;
      const month = inMonth(String(e.created_at || ""));
      [e.requesting_user_id, e.exchange_partner_id].forEach((uid) => {
        const k = idToCode.get(uid);
        if (!k) return;
        const h = get(k);
        h.exchangesYear += 1;
        if (month) h.exchangesMonth += 1;
      });
    });
  }

  return map;
}

export function useEmployeeHistory(targetDateISO?: string) {
  return useQuery<EmployeeHistoryMap>({
    queryKey: ["employee-history", targetDateISO],
    queryFn: () => fetchEmployeeHistory(targetDateISO || ""),
    enabled: Boolean(targetDateISO),
    staleTime: 5 * 60_000,
  });
}

export type { FairnessHistory };
