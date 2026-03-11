import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizeLeaveRecords } from "@/utils/leaveCalculations";
import type { RawLeaveRecord } from "@/services/leaveApi";

export function useLeaveApiUrl() {
  return useQuery({
    queryKey: ["app-settings", "leave_webapp_url"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings" as any)
        .select("value")
        .eq("key", "leave_data_webapp_url") // Updated to match our new seed key
        .maybeSingle();
      if (error) throw error;
      return (data?.value as string) || "";
    },
  });
}

// Reconstruct the RawLeaveRecord arrays from our flat employee_leave_records table.
// When `year` is provided, only dates in that year are pushed into category arrays,
// but every employee still gets an entry (so they appear with 0 counts).
function reconstructRawRecords(flatRows: any[], year?: number): RawLeaveRecord[] {
  const map = new Map<string, RawLeaveRecord>();

  for (const row of flatRows) {
    const empId = String(row.emp_id || "").trim();
    if (!empId) continue;

    if (!map.has(empId)) {
      map.set(empId, {
        empId: empId,
        name: row.employee_name || "",
        status: row.status || "Active",
        casualLeave: [],
        restrictedHolidays: [],
        nationalHolidays: [],
        closedHolidays: [],
        lastYearCompOff: [],
        opeDuty: [],
      });
    }

    // If year filter is active, skip dates outside that year
    if (year && row.leave_date) {
      const dateYear = new Date(row.leave_date).getFullYear();
      if (dateYear !== year) continue;
    }

    const rec = map.get(empId)!;
    // metadata may come back as a string from Supabase — parse it
    let meta = row.metadata || {};
    if (typeof meta === "string") {
      try { meta = JSON.parse(meta); } catch { meta = {}; }
    }

    switch (row.leave_category) {
      case "CL":
        rec.casualLeave!.push(row.leave_date);
        break;
      case "RH":
        rec.restrictedHolidays!.push({
          date: row.leave_date,
          leaveApplied: meta.leave_applied || "",
        });
        break;
      case "NH":
        rec.nationalHolidays!.push(row.leave_date);
        break;
      case "CH":
        rec.closedHolidays!.push({
          leaveApplied: meta.leave_applied || row.leave_date,
          dateOrDutyPerformed: meta.duty_performed || "",
        });
        break;
      case "COMP_OFF":
        rec.lastYearCompOff!.push({
          leaveApplied: meta.leave_applied || row.leave_date,
          dutyPerformed: meta.duty_performed || "",
        });
        break;
      case "OPE":
        rec.opeDuty!.push({
          opeDutyDate: meta.ope_duty_date || row.leave_date,
          leaveApplied: meta.leave_applied || "",
        });
        break;
    }
  }

  return Array.from(map.values());
}

export function useLeaveData(year?: number) {
  const { data: url = "", isLoading: isUrlLoading, error: urlError } = useLeaveApiUrl();
  const qc = useQueryClient();

  // Fetch ALL leave records from DB (no server-side year filter).
  // 8500 rows is a small payload (~1-2 MB). Year filtering happens client-side.
  const leaveQuery = useQuery({
    queryKey: ["leave-data-structured", year],
    queryFn: async () => {
      const PAGE_SIZE = 1000;
      let allRows: any[] = [];
      let from = 0;
      let hasMore = true;

      while (hasMore) {
        const { data: page, error } = await supabase
          .from("employee_leave_records" as any)
          .select("*")
          .range(from, from + PAGE_SIZE - 1);

        if (error) {
          console.error("[useLeaveData] Query error:", error);
          throw error;
        }

        const rows = page || [];
        allRows = allRows.concat(rows);
        hasMore = rows.length === PAGE_SIZE;
        from += PAGE_SIZE;
      }

      console.log(`[useLeaveData] Fetched ${allRows.length} total leave records, filtering for year=${year || "all"}`);

      return reconstructRawRecords(allRows, year);
    },
    staleTime: 5 * 60 * 1000,
  });

  const refresh = useMutation({
    mutationFn: async () => {
      if (!url) throw new Error("Leave API URL is not configured");

      // Try direct Supabase edge function first
      let directError: any = null;
      try {
        const { data, error } = await supabase.functions.invoke("fetch-leave-data", { body: {} });
        if (!error) return data;
        directError = error;
      } catch (err) {
        // CORS or network error — direct call failed
        directError = err;
      }

      // Fallback to Vercel proxy in dev
      if (import.meta.env.DEV) {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw directError;

        const base =
          import.meta.env.VITE_FUNCTIONS_PROXY_BASE_URL ||
          "https://shift-atco.vercel.app";

        const res = await fetch(`${base}/api/functions/fetch-leave-data`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        });

        if (res.ok) return res.json();

        const errBody = await res.json().catch(() => ({}));
        throw new Error(
          errBody.error ||
          directError?.message ||
          `Edge function failed via proxy: HTTP ${res.status}`
        );
      }

      throw directError;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leave-data-structured"] });
      qc.invalidateQueries({ queryKey: ["leave-records"] });
      qc.invalidateQueries({ queryKey: ["leave-record-summary"] });
    },
  });

  const normalized = useMemo(() => {
    const records = Array.isArray(leaveQuery.data) ? leaveQuery.data : [];
    return normalizeLeaveRecords(records);
  }, [leaveQuery.data]);

  return {
    url,
    isUrlLoading,
    urlError,
    leaveQuery,
    refresh,
    data: normalized,
  };
}

export function useLeaveRefresh() {
  const { data: url = "" } = useLeaveApiUrl();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!url) throw new Error("Leave API URL is not configured");

      // Try direct Supabase edge function first
      let directError: any = null;
      try {
        const { data, error } = await supabase.functions.invoke("fetch-leave-data", { body: {} });
        if (!error) return data;
        directError = error;
      } catch (err) {
        // CORS or network error — direct call failed
        directError = err;
      }

      // Fallback to Vercel proxy in dev
      if (import.meta.env.DEV) {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw directError;

        const base =
          import.meta.env.VITE_FUNCTIONS_PROXY_BASE_URL ||
          "https://shift-atco.vercel.app";

        const res = await fetch(`${base}/api/functions/fetch-leave-data`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        });

        if (res.ok) return res.json();

        const errBody = await res.json().catch(() => ({}));
        throw new Error(
          errBody.error ||
          directError?.message ||
          `Edge function failed via proxy: HTTP ${res.status}`
        );
      }

      throw directError;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leave-data-structured"] });
      qc.invalidateQueries({ queryKey: ["leave-records"] });
      qc.invalidateQueries({ queryKey: ["leave-record-summary"] });
    },
  });
}
