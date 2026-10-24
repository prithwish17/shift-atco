/**
 * Daily storage recount.
 *
 *   GET|POST /api/storage/reconcile
 *
 * Lists the whole R2 bucket, removes announcement files that no announcement
 * points at any more, and overwrites the quota counter with the real total.
 * The running counter drifts without this: replaced leave documents are never
 * deleted, and files written before the quota existed were never counted.
 *
 * Called by the Vercel cron in vercel.json (Authorization: Bearer $CRON_SECRET)
 * and by the "Recount now" button on /announcements (an admin's JWT).
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

import {
    authenticateRequest,
    handleCorsPreflight,
    setCorsHeaders,
    supabaseEnv,
    userHasRole,
} from "../apiAuth.js";
import { deleteObject, listAllObjects } from "../r2.js";
import { recordReconcile, type LargestObject } from "../storageQuota.js";

const ANNOUNCEMENT_PREFIX = "announcements/";
// Leave a just-uploaded file alone: its announcement row may not point at it yet.
const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const LARGEST_COUNT = 10;

export async function handler(req: VercelRequest, res: VercelResponse) {
    if (handleCorsPreflight(req, res, "GET, POST, OPTIONS")) return;
    setCorsHeaders(req, res);

    if (req.method !== "GET" && req.method !== "POST") {
        res.setHeader("Allow", "GET, POST, OPTIONS");
        return res.status(405).json({ error: "Method not allowed" });
    }

    if (!isCronRequest(req)) {
        const user = await authenticateRequest(req, res);
        if (!user) return;
        if (!(await userHasRole(user, "admin"))) {
            return res.status(403).json({ error: "Only admins can recount storage" });
        }
    }

    try {
        const { objects, listCalls } = await listAllObjects();

        const referenced = await loadReferencedAttachments();
        const now = Date.now();
        const orphans = objects.filter(
            (o) =>
                o.key.startsWith(ANNOUNCEMENT_PREFIX) &&
                !referenced.has(o.key) &&
                o.lastModified !== null &&
                now - o.lastModified.getTime() > ORPHAN_MIN_AGE_MS,
        );

        const removed = new Set<string>();
        for (const orphan of orphans) {
            try {
                await deleteObject(orphan.key, { releaseQuota: false });
                removed.add(orphan.key);
            } catch (err) {
                console.warn("[storage-reconcile] failed to delete orphan", orphan.key, err);
            }
        }

        const kept = objects.filter((o) => !removed.has(o.key));
        const bytes = kept.reduce((sum, o) => sum + o.size, 0);
        const largest: LargestObject[] = [...kept]
            .sort((a, b) => b.size - a.size)
            .slice(0, LARGEST_COUNT)
            .map((o) => ({
                key: o.key,
                size: o.size,
                last_modified: o.lastModified ? o.lastModified.toISOString() : null,
            }));

        await recordReconcile({ bytes, objects: kept.length, listCalls, largest });

        return res.status(200).json({
            bytes_used: bytes,
            object_count: kept.length,
            orphans_removed: removed.size,
            list_calls: listCalls,
        });
    } catch (err) {
        console.error("[storage-reconcile] failed", err);
        return res.status(502).json({ error: "Storage recount failed" });
    }
}

function isCronRequest(req: VercelRequest): boolean {
    const secret = process.env.CRON_SECRET;
    return Boolean(secret) && req.headers.authorization === `Bearer ${secret}`;
}

async function loadReferencedAttachments(): Promise<Set<string>> {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    const resp = await fetch(
        `${supabaseEnv.url}/rest/v1/announcements?select=attachment_path&attachment_path=not.is.null`,
        { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" } },
    );
    if (!resp.ok) {
        // Without the list every announcement file would look orphaned.
        throw new Error(`Could not load announcement attachments (${resp.status})`);
    }
    const rows = (await resp.json()) as Array<{ attachment_path: string | null }>;
    return new Set(rows.map((r) => r.attachment_path).filter((p): p is string => Boolean(p)));
}
