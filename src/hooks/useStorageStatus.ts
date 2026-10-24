import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// get_r2_storage_status is not in the generated types yet, so it goes through
// an untyped view of the client. See supabase/migrations/20261023110000_r2_storage_quota.sql.
const db = supabase as unknown as SupabaseClient;

/** Which storage-limit level an upload counts against. Mirrors lib/storageQuota.ts. */
export type StorageScope = "announcement" | "all";

/** HTTP status the storage API sends when the limit is reached. */
export const STORAGE_LIMIT_STATUS = 507;

export interface StorageLimits {
  free_bytes: number;
  free_uploads: number;
  announcement_bytes: number;
  announcement_uploads: number;
  all_bytes: number;
  all_uploads: number;
}

export interface StorageStatus {
  bytes_used: number;
  uploads_this_month: number;
  limits: StorageLimits;
  announcement_uploads_allowed: boolean;
  all_uploads_allowed: boolean;
  // Admins only:
  object_count?: number;
  largest_objects?: Array<{ key: string; size: number; last_modified: string | null }>;
  reconciled_at?: string | null;
  updated_at?: string | null;
}

const STORAGE_STATUS_KEY = ["r2-storage-status"];

export function useStorageStatus() {
  return useQuery({
    queryKey: STORAGE_STATUS_KEY,
    queryFn: async () => {
      const { data, error } = await db.rpc("get_r2_storage_status");
      if (error) throw error;
      return data as unknown as StorageStatus;
    },
    staleTime: 60_000,
  });
}

/**
 * Whether uploads in `scope` are open. Unknown (still loading, or the check
 * failed) counts as open: the server enforces the limit either way, and the
 * popup still appears if it refuses.
 */
export function useUploadsAllowed(scope: StorageScope): boolean {
  const { data } = useStorageStatus();
  if (!data) return true;
  return scope === "announcement" ? data.announcement_uploads_allowed : data.all_uploads_allowed;
}

/** Refresh the status after the server refused an upload. */
export function useInvalidateStorageStatus() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: STORAGE_STATUS_KEY });
}

export function useRecountStorage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const resp = await fetch("/api/storage/reconcile", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(body.error || `Recount failed (${resp.status})`);
      return body as { bytes_used: number; object_count: number; orphans_removed: number };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: STORAGE_STATUS_KEY }),
  });
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return `${bytes} B`;
}
