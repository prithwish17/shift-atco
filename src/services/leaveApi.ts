export type RawLeaveRecord = {
  empId?: string | number | null;
  name?: string | null;
  status?: string | null;
  casualLeave?: unknown[] | null;
  restrictedHolidays?: unknown[] | null;
  nationalHolidays?: unknown[] | null;
  closedHolidays?: unknown[] | null;
  lastYearCompOff?: unknown[] | null;
  opeDuty?: unknown[] | null;
  [key: string]: unknown;
};

export type LeaveApiResponse = {
  status?: string;
  count?: number;
  data: RawLeaveRecord[];
};

import { supabase } from "@/integrations/supabase/client";

export async function fetchLeaveData(url: string): Promise<LeaveApiResponse> {
  if (!url || !url.trim()) {
    throw new Error("Leave API URL is not configured");
  }

  let response: Response;
  try {
    response = await fetch(url, { method: "GET" });
  } catch (error: any) {
    throw new Error(error?.message || "Failed to reach leave API");
  }

  if (!response.ok) {
    let payload: any = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const detail = payload?.error || payload?.message;
    throw new Error(detail || `Leave API error (${response.status})`);
  }

  let json: any;
  try {
    json = await response.json();
  } catch {
    throw new Error("Leave API returned invalid JSON");
  }

  const data = Array.isArray(json?.data) ? (json.data as RawLeaveRecord[]) : [];
  const count = typeof json?.count === "number" ? json.count : data.length;

  return {
    status: typeof json?.status === "string" ? json.status : undefined,
    count,
    data,
  };
}

export async function persistLeaveData(records: RawLeaveRecord[]): Promise<void> {
  if (!records.length) return;
  const payload = records.map((record) => ({
    emp_id: record.empId != null ? String(record.empId).trim() : "",
    name: typeof record.name === "string" ? record.name.trim() : null,
    status: typeof record.status === "string" ? record.status : null,
    payload: record,
    updated_at: new Date().toISOString(),
  })).filter((row) => row.emp_id);

  if (payload.length === 0) return;

  const { error } = await supabase
    .from("leave_balances_cache" as any)
    .upsert(payload as any, { onConflict: "emp_id" });

  if (error) throw error;
}
