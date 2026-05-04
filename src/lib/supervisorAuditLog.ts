/**
 * Supervisor Audit Logger
 *
 * Fire-and-forget utility that sends supervisor edit events to a
 * Google Sheet webapp.  The webapp URL is read from `app_settings`
 * (key: `supervisor_audit_log_webapp_url`) and cached for 5 minutes.
 *
 * Usage:
 *   import { logSupervisorEdit } from "@/lib/supervisorAuditLog";
 *
 *   // After a successful DB mutation:
 *   logSupervisorEdit({
 *     action: "update",
 *     table: "employee_schedules",
 *     description: "Changed duty M→A for EMP001 on 2026-04-10",
 *     recordId: "abc-123",
 *     before: { duty_code: "M" },
 *     after:  { duty_code: "A" },
 *   });
 *
 * Design principles:
 *   • Never throws — every call is wrapped in try/catch.
 *   • Never blocks — uses void promises so callers don't need await.
 *   • Silently skips if the webapp URL is not configured.
 */

import { supabase } from "@/integrations/supabase/client";

/* ─── Types ─────────────────────────────────────────────────── */

export interface AuditLogEntry {
  /** The kind of database operation */
  action: "insert" | "update" | "delete" | "upsert";
  /** The Supabase table that was modified */
  table: string;
  /** Human-readable summary of the change */
  description: string;
  /** Optional primary key / composite key of the affected row */
  recordId?: string;
  /** Values before the change (when available) */
  before?: Record<string, unknown>;
  /** Values after the change */
  after?: Record<string, unknown>;
}

/* ─── Cached state ─────────────────────────────────────────── */

let _cachedUrl: string | null = null;
let _urlFetchedAt = 0;
const URL_CACHE_MS = 5 * 60 * 1000; // 5 minutes

let _cachedUserName: string | null = null;
let _cachedUserRole: string | null = null;
let _userFetchedAt = 0;
const USER_CACHE_MS = 5 * 60 * 1000;

/* ─── Internal helpers ─────────────────────────────────────── */

async function getWebappUrl(): Promise<string> {
  const now = Date.now();
  if (_cachedUrl !== null && now - _urlFetchedAt < URL_CACHE_MS) {
    return _cachedUrl;
  }

  try {
    const { data } = await supabase
      .from("app_settings" as any)
      .select("value")
      .eq("key", "supervisor_audit_log_webapp_url")
      .maybeSingle();

    _cachedUrl = (data as any)?.value || "";
    _urlFetchedAt = now;
    return _cachedUrl;
  } catch {
    return _cachedUrl || "";
  }
}

async function getCurrentUser(): Promise<{ name: string; role: string }> {
  const now = Date.now();
  if (_cachedUserName && now - _userFetchedAt < USER_CACHE_MS) {
    return { name: _cachedUserName, role: _cachedUserRole || "unknown" };
  }

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { name: "Unknown", role: "unknown" };

    // Try to get full_name from profiles
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle();

    const fullName =
      (profile as any)?.full_name ||
      user.user_metadata?.full_name ||
      user.email ||
      "Unknown";

    // Get role
    const { data: roleData } = await supabase.rpc("get_user_role", {
      _user_id: user.id,
    });

    _cachedUserName = fullName;
    _cachedUserRole = (roleData as string) || "unknown";
    _userFetchedAt = now;

    return { name: _cachedUserName, role: _cachedUserRole };
  } catch {
    return {
      name: _cachedUserName || "Unknown",
      role: _cachedUserRole || "unknown",
    };
  }
}

/* ─── Public API ───────────────────────────────────────────── */

/**
 * Send a supervisor edit event to the Google Sheet webapp.
 *
 * This function is **fire-and-forget** — it returns immediately
 * and never throws.  Call it right after a successful DB mutation.
 */
export function logSupervisorEdit(entry: AuditLogEntry): void {
  // Intentionally not awaited — fire-and-forget
  void _sendAuditLog(entry);
}

async function _sendAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    const url = await getWebappUrl();
    if (!url) return; // Not configured — silently skip

    const user = await getCurrentUser();

    const payload = {
      type: "audit_log",
      timestamp: new Date().toISOString(),
      userName: user.name,
      userRole: user.role,
      action: entry.action,
      table: entry.table,
      description: entry.description,
      recordId: entry.recordId || null,
      before: entry.before || null,
      after: entry.after || null,
    };

    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload),
      mode: "no-cors",
    });
  } catch {
    // Silently swallow — audit logging must never disrupt the app
    if (import.meta.env.DEV) {
      console.warn("[AuditLog] Failed to send audit log:", entry.description);
    }
  }
}
