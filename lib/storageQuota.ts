/**
 * R2 storage quota — keeps uploads inside Cloudflare R2's free tier.
 *
 * putObject() in lib/r2.ts reserves room here before every write, and
 * deleteObject() gives it back. The totals live in public.r2_storage_usage and
 * the limits in public.r2_storage_limits(); see
 * supabase/migrations/20261023110000_r2_storage_quota.sql.
 *
 *   scope            level          blocked at
 *   ───────────────  ─────────────  ──────────────────────────
 *   announcement     announcement   8 GB or 800,000 uploads
 *   leave_document   all            9.5 GB or 950,000 uploads
 *   profile_picture  all            9.5 GB or 950,000 uploads
 *
 * If the quota check itself fails (Supabase unreachable), announcement uploads
 * are refused but leave documents and profile pictures go ahead: an employee
 * should not lose a medical certificate to a counter outage, and the daily
 * reconcile corrects the total afterwards.
 */
import type { VercelResponse } from "@vercel/node";

import { supabaseEnv } from "./apiAuth.js";

export type QuotaScope = "announcement" | "leave_document" | "profile_picture";

export type QuotaReason = "storage" | "uploads";

/** HTTP status for "storage limit reached". The client shows the limit popup on it. */
export const STORAGE_LIMIT_STATUS = 507;

export class StorageQuotaError extends Error {
    readonly code = "storage_limit_reached";

    constructor(
        readonly scope: QuotaScope,
        readonly reason: QuotaReason | "unavailable",
    ) {
        super(
            reason === "unavailable"
                ? "Could not check the storage limit. Please try again later."
                : scope === "announcement"
                    ? "Storage limit reached. Announcement attachments are paused until space is freed."
                    : "Storage limit reached. Uploads are paused until space is freed. Please contact the admin.",
        );
        this.name = "StorageQuotaError";
    }
}

function serviceKey(): string {
    return process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const key = serviceKey();
    if (!supabaseEnv.url || !key) {
        throw new Error("Server misconfigured: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing");
    }

    const resp = await fetch(`${supabaseEnv.url}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
    });

    if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`${name} failed (${resp.status}): ${body}`);
    }

    const text = await resp.text();
    return (text ? JSON.parse(text) : null) as T;
}

/**
 * Reserve room for one upload of `bytes`. Throws StorageQuotaError when the
 * scope's level is full. Returns true when bytes were reserved (so the caller
 * must release them if the write then fails), false when the check was skipped.
 */
export async function reserveUpload(bytes: number, scope: QuotaScope): Promise<boolean> {
    let result: { allowed: boolean; reason?: QuotaReason };
    try {
        result = await rpc("r2_reserve_upload", { p_bytes: Math.max(1, Math.ceil(bytes)), p_scope: scope });
    } catch (err) {
        if (scope === "announcement") {
            console.error("[storageQuota] reserve failed; refusing announcement upload", err);
            throw new StorageQuotaError(scope, "unavailable");
        }
        console.warn("[storageQuota] reserve failed; allowing upload", { scope, err });
        return false;
    }

    if (!result?.allowed) {
        throw new StorageQuotaError(scope, result?.reason ?? "storage");
    }
    return true;
}

/** Give back bytes after a delete or a failed write. Never throws. */
export async function releaseUpload(bytes: number): Promise<void> {
    if (!(bytes > 0)) return;
    try {
        await rpc("r2_release_upload", { p_bytes: Math.ceil(bytes) });
    } catch (err) {
        console.warn("[storageQuota] release failed", err);
    }
}

export interface LargestObject {
    key: string;
    size: number;
    last_modified: string | null;
}

/** Overwrite the running totals with what a full bucket listing found. */
export async function recordReconcile(input: {
    bytes: number;
    objects: number;
    listCalls: number;
    largest: LargestObject[];
}): Promise<void> {
    await rpc("r2_record_reconcile", {
        p_bytes: input.bytes,
        p_objects: input.objects,
        p_list_calls: input.listCalls,
        p_largest: input.largest,
    });
}

/** Send the standard "storage limit reached" response. */
export function sendStorageLimit(res: VercelResponse, err: StorageQuotaError) {
    return res.status(err.reason === "unavailable" ? 503 : STORAGE_LIMIT_STATUS).json({
        error: err.message,
        code: err.reason === "unavailable" ? "storage_check_unavailable" : err.code,
        reason: err.reason,
        scope: err.scope,
    });
}
