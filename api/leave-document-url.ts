import type { VercelRequest, VercelResponse } from "@vercel/node";

import {
    authenticateRequest,
    handleCorsPreflight,
    setCorsHeaders,
    supabaseUserFetch,
} from "../lib/apiAuth.js";
import { getPresignedGetUrl } from "../lib/r2.js";

const URL_TTL_SECONDS = 300;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (handleCorsPreflight(req, res, "GET, OPTIONS")) return;
    setCorsHeaders(req, res);

    if (req.method !== "GET") {
        res.setHeader("Allow", "GET, OPTIONS");
        return res.status(405).json({ error: "Method not allowed" });
    }

    const user = await authenticateRequest(req, res);
    if (!user) return;

    const leaveRequestId = String(req.query.leave_request_id ?? "").trim();
    if (!leaveRequestId || !/^[0-9a-fA-F-]{16,}$/.test(leaveRequestId)) {
        return res.status(400).json({ error: "Missing or invalid leave_request_id" });
    }

    // RLS-enforced read: returns nothing if the user isn't allowed to see this row.
    const lookup = await supabaseUserFetch(
        user,
        `/rest/v1/leave_requests?id=eq.${encodeURIComponent(leaveRequestId)}&select=attachment_path`,
        { method: "GET", headers: { Accept: "application/json" } },
    );

    if (!lookup.ok) {
        return res.status(502).json({ error: "Failed to look up leave request" });
    }

    const rows = (await lookup.json()) as Array<{ attachment_path: string | null }>;
    if (rows.length === 0) {
        return res.status(403).json({ error: "Leave request not found or access denied" });
    }

    const key = rows[0]?.attachment_path;
    if (!key) {
        return res.status(404).json({ error: "No attachment on this leave request" });
    }

    if (!key.startsWith(`leave-documents/`)) {
        // Defensive: never sign anything outside the documents prefix.
        return res.status(409).json({ error: "Invalid attachment key" });
    }

    let url: string;
    try {
        url = await getPresignedGetUrl(key, URL_TTL_SECONDS);
    } catch (err) {
        console.error("[leave-document-url] presign failed", err);
        return res.status(502).json({ error: "Failed to sign document URL" });
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
        url,
        expires_in: URL_TTL_SECONDS,
        expires_at: new Date(Date.now() + URL_TTL_SECONDS * 1000).toISOString(),
    });
}
