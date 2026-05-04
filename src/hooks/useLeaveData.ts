import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getFunctionsProxyBaseUrl } from "@/lib/appConfig";
import { normalizeLeaveRecords } from "@/utils/leaveCalculations";
import { COMP_OFF_EXPIRY_MONTHS } from "@/lib/leaveConstants";
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

function normalizeDateString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const monthMatch = trimmed.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b\s+(\d{1,2})\s+(\d{4})/i);
  if (monthMatch) {
    const monthMap: Record<string, string> = {
      JAN: "01",
      FEB: "02",
      MAR: "03",
      APR: "04",
      MAY: "05",
      JUN: "06",
      JUL: "07",
      AUG: "08",
      SEP: "09",
      OCT: "10",
      NOV: "11",
      DEC: "12",
    };

    const month = monthMap[monthMatch[1].toUpperCase()];
    if (month) {
      return `${monthMatch[3]}-${month}-${monthMatch[2].padStart(2, "0")}`;
    }
  }

  const jsDateMatch = trimmed.match(/\b([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\b/);
  if (jsDateMatch) {
    const monthMap: Record<string, string> = {
      JAN: "01",
      FEB: "02",
      MAR: "03",
      APR: "04",
      MAY: "05",
      JUN: "06",
      JUL: "07",
      AUG: "08",
      SEP: "09",
      OCT: "10",
      NOV: "11",
      DEC: "12",
    };

    const month = monthMap[jsDateMatch[1].toUpperCase()];
    if (month) {
      return `${jsDateMatch[3]}-${month}-${jsDateMatch[2].padStart(2, "0")}`;
    }
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().split("T")[0];
}

function parseJsonObject(value: unknown): Record<string, any> {
  if (value && typeof value === "object") return value as Record<string, any>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") return parsed as Record<string, any>;
    } catch {
      return {};
    }
  }
  return {};
}

function matchesYear(value: unknown, year: number): boolean {
  const normalized = normalizeDateString(value);
  if (!normalized) return false;
  return Number(normalized.slice(0, 4)) === year;
}

function addMonthsToNormalizedDate(value: unknown, months: number): string | null {
  const normalized = normalizeDateString(value);
  if (!normalized) return null;

  const [year, month, day] = normalized.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;

  date.setUTCMonth(date.getUTCMonth() + months);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().split("T")[0];
}

function resolveCompOffExpiryForFilter(row: any, meta: Record<string, any>): string | null {
  const dutyDate = normalizeDateString(
    meta.duty_date ||
    meta.ope_duty_date ||
    (["COMP_OFF_EARNED", "LAST_YEAR_CH_DUTY", "OPE"].includes(String(row.leave_category || ""))
      ? row.leave_date
      : null),
  );

  if (dutyDate) return addMonthsToNormalizedDate(dutyDate, COMP_OFF_EXPIRY_MONTHS);

  const explicitExpiry = normalizeDateString(meta.expiry_date);
  if (explicitExpiry) return explicitExpiry;

  return null;
}

function resolveLeaveUsedOn(row: any, meta: Record<string, any>, rawEvent: Record<string, any>): string {
  return (
    row.leave_used_on ||
    meta.leave_used_on ||
    meta.leave_applied ||
    row.raw_leave_used_value ||
    rawEvent.leaveUsedOn ||
    rawEvent.leaveApplied ||
    ""
  );
}

function resolveDutyPerformed(row: any, meta: Record<string, any>, sourceType: string): string {
  const rawDutyPerformed = meta.duty_performed || meta.shift || row.duty_code || "";
  const isOpeSource = String(sourceType).toUpperCase().includes("OPE");
  const isDateLikeDuty = normalizeDateString(rawDutyPerformed);

  if (typeof rawDutyPerformed === "string" && rawDutyPerformed.trim()) {
    if (isDateLikeDuty) {
      return "OPE";
    }
    return rawDutyPerformed.trim();
  }

  return isOpeSource ? "OPE" : "";
}

function shouldIncludeRowForYear(row: any, meta: Record<string, any>, year?: number): boolean {
  if (!year) return true;

  const rawEvent = parseJsonObject(row.raw_event);

  const dateCandidates = [
    row.leave_date,
    row.leave_used_on,
    row.raw_leave_used_value,
    meta.duty_date,
    meta.leave_used_on,
    meta.leave_applied,
    meta.expiry_date,
    resolveCompOffExpiryForFilter(row, meta),
    meta.ope_duty_date,
    rawEvent.leaveUsedOn,
    rawEvent.leaveApplied,
  ];

  return dateCandidates.some((value) => matchesYear(value, year));
}

function pushCompOffEntry(
  record: RawLeaveRecord,
  row: any,
  meta: Record<string, any>,
  rawEvent: Record<string, any>,
  fallbackSourceType: string,
) {
  const sourceType = meta.source_type || row.source_event_type || fallbackSourceType;
  record.lastYearCompOff!.push({
    dutyDate: meta.duty_date || meta.ope_duty_date || row.leave_date,
    leaveApplied: resolveLeaveUsedOn(row, meta, rawEvent),
    dutyPerformed: resolveDutyPerformed(row, meta, sourceType),
    sourceType,
    sourceLabel: meta.source_label || "",
    eligible: typeof meta.comp_off_eligible === "boolean" ? meta.comp_off_eligible : undefined,
    expiryDate: resolveCompOffExpiryForFilter(row, meta),
    remark: meta.remark || "",
  });
}

// Reconstruct the RawLeaveRecord arrays from our flat employee_leave_records table.
// When `year` is provided, comp-off rows are included if their duty date, used date,
// or expiry date falls in that year, so last-year earned rows still show correctly.
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

    // metadata may come back as a string from Supabase — parse it
    const meta = parseJsonObject(row.metadata);
    const rawEvent = parseJsonObject(row.raw_event);

    if (!shouldIncludeRowForYear(row, meta, year)) continue;

    const rec = map.get(empId)!;

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
        pushCompOffEntry(rec, row, meta, rawEvent, "COMP_OFF");
        break;
      case "COMP_OFF_EARNED":
        pushCompOffEntry(rec, row, meta, rawEvent, "COMP_OFF_EARNED");
        break;
      case "LAST_YEAR_CH_DUTY":
        pushCompOffEntry(rec, row, meta, rawEvent, "LAST_YEAR_CH_DUTY");
        break;
      case "COMP_OFF_USED":
      case "LAST_YEAR_COMP_OFF":
      case "OPE_COMP_OFF":
        rec.lastYearCompOff!.push({
          leaveApplied: resolveLeaveUsedOn(row, meta, rawEvent) || row.leave_date,
          sourceType: meta.source_type || row.source_event_type || row.leave_category || "COMP_OFF_USED",
          sourceLabel: meta.source_label || "",
          eligible: typeof meta.comp_off_eligible === "boolean" ? meta.comp_off_eligible : true,
          expiryDate: resolveCompOffExpiryForFilter(row, meta),
          remark: meta.remark || "",
        });
        break;
      case "OPE":
        pushCompOffEntry(rec, row, meta, rawEvent, "OPE");
        break;
    }
  }

  return Array.from(map.values());
}

type LeaveDataOptions = {
  /**
   * When true, fetch previous-year rows too (legacy behavior) so comp-off earned late in year N
   * and expiring/used in year N+1 can still be reconstructed.
   */
  includePreviousYear?: boolean;
  /** Optional dev-only perf logging label (gated by localStorage flag). */
  debugLabel?: string;
};

const EMPLOYEE_LEAVE_RECORD_COLUMNS =
  [
    "emp_id",
    "employee_name",
    "status",
    "leave_category",
    "leave_date",
    "leave_used_on",
    "raw_leave_used_value",
    "source_event_type",
    "duty_code",
    "metadata",
    "raw_event",
  ].join(",");

function shouldDebugLeavePerf() {
  if (!import.meta.env.DEV) return false;
  try {
    return localStorage.getItem("debug.leavePerf") === "1";
  } catch {
    return false;
  }
}

export function useLeaveData(year?: number, empId?: string | null, options: LeaveDataOptions = {}) {
  const { data: url = "", isLoading: isUrlLoading, error: urlError } = useLeaveApiUrl();
  const qc = useQueryClient();
  const includePreviousYear = options.includePreviousYear ?? true;

  // Fetch leave records from DB with server-side year filtering when possible.
  // Comp-off records may span years (earned in year N, used in year N+1),
  // so we extend the date range to include the prior year for comp-off expiry visibility.
  const leaveQuery = useQuery({
    queryKey: ["leave-data-structured", year, empId ?? "all", includePreviousYear],
    enabled: empId !== null,
    queryFn: async () => {
      const PAGE_SIZE = 1000;
      let allRows: any[] = [];
      let from = 0;
      let hasMore = true;
      const t0 = performance.now();
      let pages = 0;

      while (hasMore) {
        let query = supabase
          .from("employee_leave_records" as any)
          .select(EMPLOYEE_LEAVE_RECORD_COLUMNS)
          .range(from, from + PAGE_SIZE - 1);

        if (typeof empId === "string" && empId.trim()) {
          query = query.eq("emp_id", empId.trim());
        }

        // Server-side year filter: fetch current year AND prior year
        // (prior year needed for comp-off earned late in year N, expiring in year N+1)
        if (year) {
          const startYear = includePreviousYear ? year - 1 : year;
          query = query.gte("leave_date", `${startYear}-01-01`).lte("leave_date", `${year}-12-31`);
        }

        const { data: page, error } = await query;

        if (error) {
          console.error("[useLeaveData] Query error:", error);
          throw error;
        }

        const rows = page || [];
        allRows = allRows.concat(rows);
        hasMore = rows.length === PAGE_SIZE;
        from += PAGE_SIZE;
        pages += 1;
      }

      const reconstructed = reconstructRawRecords(allRows, year);
      if (shouldDebugLeavePerf()) {
        const ms = Math.round(performance.now() - t0);
        const label = options.debugLabel ? `:${options.debugLabel}` : "";
        // eslint-disable-next-line no-console
        console.log(`[leavePerf${label}] leaveData fetched rows=${allRows.length} pages=${pages} year=${year ?? "-"} empId=${empId ?? "all"} includePrev=${includePreviousYear} in ${ms}ms`);
      }
      return reconstructed;
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

        const base = getFunctionsProxyBaseUrl();

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

        const base = getFunctionsProxyBaseUrl();

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
