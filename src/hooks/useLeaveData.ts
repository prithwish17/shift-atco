import { useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchLeaveData, persistLeaveData } from "@/services/leaveApi";
import { normalizeLeaveRecords } from "@/utils/leaveCalculations";

const LEAVE_CACHE_KEY = "leave_data_cache_v1";
const LEAVE_CACHE_TTL_MS = 5 * 60 * 1000;

function readLeaveCache(): { ts: number; data: any[] } | null {
  try {
    const raw = localStorage.getItem(LEAVE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.data) || typeof parsed.ts !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLeaveCache(data: any[]) {
  try {
    localStorage.setItem(LEAVE_CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // ignore cache write failures
  }
}

export function useLeaveApiUrl() {
  return useQuery({
    queryKey: ["app-settings", "leave_webapp_url"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings" as any)
        .select("value")
        .eq("key", "leave_webapp_url")
        .maybeSingle();
      if (error) throw error;
      return (data?.value as string) || "";
    },
  });
}

export function useLeaveData() {
  const { data: url = "", isLoading: isUrlLoading, error: urlError } = useLeaveApiUrl();
  const qc = useQueryClient();

  const leaveQuery = useQuery({
    queryKey: ["leave-data"],
    queryFn: async () => {
      const cached = readLeaveCache();
      if (cached && Date.now() - cached.ts < LEAVE_CACHE_TTL_MS) {
        return cached.data;
      }

      const { data, error } = await supabase
        .from("leave_balances_cache" as any)
        .select("payload");
      if (error) throw error;
      const records = (data || []).map((row: any) => row.payload).filter(Boolean);

      if (records.length === 0 && url) {
        const api = await fetchLeaveData(url);
        await persistLeaveData(api.data);
        writeLeaveCache(api.data);
        return api.data;
      }
      writeLeaveCache(records);
      return records;
    },
    staleTime: 5 * 60 * 1000,
  });

  const refresh = useMutation({
    mutationFn: async () => {
      if (!url) throw new Error("Leave API URL is not configured");
      const api = await fetchLeaveData(url);
      await persistLeaveData(api.data);
      writeLeaveCache(api.data);
      return api;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leave-data"] });
    },
  });

  const normalized = useMemo(() => {
    const records = Array.isArray(leaveQuery.data) ? leaveQuery.data : [];
    return normalizeLeaveRecords(records);
  }, [leaveQuery.data]);

  useEffect(() => {
    if (!leaveQuery.isLoading && !leaveQuery.error && (!leaveQuery.data || (Array.isArray(leaveQuery.data) && leaveQuery.data.length === 0)) && url) {
      refresh.mutate();
    }
  }, [leaveQuery.isLoading, leaveQuery.error, leaveQuery.data, url, refresh]);

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
      const api = await fetchLeaveData(url);
      await persistLeaveData(api.data);
      writeLeaveCache(api.data);
      return api;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leave-data"] });
    },
  });
}
