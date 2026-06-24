import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { OPE_CODES } from "@/lib/dutyConfig";
import type { EmployeeHistory } from "@/lib/compliance/engine";

export type EmployeeHistoryMap = Map<string, EmployeeHistory>;

function key(code: string | null | undefined) {
  return String(code || "").trim().toUpperCase();
}

function blank(): EmployeeHistory {
  return { opeMonth: 0, opeYear: 0, exMonth: 0, exYear: 0 };
}

const DEAD_STATUSES = new Set(["rejected", "cancelled", "canceled", "declined", "withdrawn"]);

/**
 * Per-employee fairness history for a target date:
 *  - OPE duties done year-to-date and within the target month
 *  - duty exchanges done year-to-date and within the target month
 * Keyed by uppercased employee_code (matches the compliance timelines).
 */
export async function fetchEmployeeHistory(targetDateISO: string): Promise<EmployeeHistoryMap> {
  const target = new Date(`${targetDateISO}T00:00:00`);
  const year = target.getFullYear();
  const ytdStart = `${year}-01-01`;
  const monthPrefix = targetDateISO.slice(0, 7); // yyyy-MM
  const map: EmployeeHistoryMap = new Map();
  const get = (k: string) => {
    let v = map.get(k);
    if (!v) { v = blank(); map.set(k, v); }
    return v;
  };

  // ── OPE duties (employee_schedules, OPE compound codes) ──────────────────
  const { data: opeRows, error: opeErr } = await supabase
    .from("employee_schedules" as any)
    .select("employee_code, duty_code, duty_date")
    .gte("duty_date", ytdStart)
    .lte("duty_date", targetDateISO)
    .in("duty_code", OPE_CODES);
  if (!opeErr && opeRows) {
    (opeRows as Array<{ employee_code: string; duty_date: string }>).forEach((r) => {
      const k = key(r.employee_code);
      if (!k) return;
      const h = get(k);
      h.opeYear += 1;
      if (String(r.duty_date).startsWith(monthPrefix)) h.opeMonth += 1;
    });
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
      const inMonth = String(e.created_at || "").startsWith(monthPrefix);
      [e.requesting_user_id, e.exchange_partner_id].forEach((uid) => {
        const k = idToCode.get(uid);
        if (!k) return;
        const h = get(k);
        h.exYear += 1;
        if (inMonth) h.exMonth += 1;
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
