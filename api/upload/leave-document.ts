import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash } from "node:crypto";

import {
    authenticateRequest,
    handleCorsPreflight,
    setCorsHeaders,
    supabaseUserFetch,
} from "../../lib/apiAuth.js";
import { parseMultipartRequest, checkContentLength } from "../../lib/multipart.js";
import { putObject } from "../../lib/r2.js";
import { optimizeDocumentImage } from "../../lib/imageOptimizer.js";

// Vercel Hobby's body limit is 4.5 MB; leave headroom.
const MAX_LEAVE_BYTES = 4 * 1024 * 1024;

const ACCEPTED_MIMES = new Map<string, string>([
    ["application/pdf", "pdf"],
    ["image/jpeg", "jpg"],
    ["image/jpg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
]);

const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF

export const config = {
    api: {
        bodyParser: false,
    },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (handleCorsPreflight(req, res, "POST, OPTIONS")) return;
    setCorsHeaders(req, res);

    if (req.method !== "POST") {
        res.setHeader("Allow", "POST, OPTIONS");
        return res.status(405).json({ error: "Method not allowed" });
    }

    const user = await authenticateRequest(req, res);
    if (!user) return;

    if (!checkContentLength(req, MAX_LEAVE_BYTES)) {
        return res.status(413).json({ error: "Document too large (max 4 MB)" });
    }

    let parsed;
    try {
        parsed = await parseMultipartRequest(req, { maxFileSize: MAX_LEAVE_BYTES });
    } catch (err) {
        const msg = (err as Error).message || "Failed to parse upload";
        return res.status(400).json({ error: msg });
    }

    const { file, fields } = parsed;
    const leaveRequestId = (fields.leave_request_id ?? fields.leaveRequestId ?? "").trim();
    if (!leaveRequestId || !/^[0-9a-fA-F-]{16,}$/.test(leaveRequestId)) {
        return res.status(400).json({ error: "Missing or invalid leave_request_id" });
    }

    const claimedMime = (file.mime ?? "").toLowerCase();
    const ext = ACCEPTED_MIMES.get(claimedMime);
    if (!ext) {
        return res.status(415).json({ error: `Unsupported document type: ${file.mime}` });
    }

    // Magic-bytes check for PDFs; for images we trust the parser's mime
    // detection (formidable already inspects file headers).
    if (claimedMime === "application/pdf") {
        if (file.buffer.length < 4 || !file.buffer.subarray(0, 4).equals(PDF_MAGIC)) {
            return res.status(415).json({ error: "File does not appear to be a valid PDF" });
        }
    }

    // Verify the caller is allowed to attach to this leave request via RLS.
    console.log("[leave-document] Step 1: Verifying leave request ownership", { leaveRequestId, userId: user.id });
    const ownerCheck = await supabaseUserFetch(
        user,
        `/rest/v1/leave_requests?id=eq.${encodeURIComponent(leaveRequestId)}&select=id,employee_id`,
        { method: "GET", headers: { Accept: "application/json" } },
    );

    if (!ownerCheck.ok) {
        const errBody = await ownerCheck.text().catch(() => "");
        console.error("[leave-document] Step 1 FAILED: ownerCheck not ok", ownerCheck.status, errBody);
        return res.status(502).json({ error: "Could not verify leave request", details: errBody });
    }

    const matched = (await ownerCheck.json()) as Array<{ id: string; employee_id: string | null }>;
    console.log("[leave-document] Step 1 OK: matched rows", matched.length, JSON.stringify(matched));
    if (matched.length === 0) {
        return res.status(403).json({ error: "Leave request not found or access denied" });
    }

    const ownerUserId = matched[0].employee_id ?? user.id;

    let uploadBuffer = file.buffer;
    let finalMime = claimedMime;
    let finalExt = ext;
    let uploadSize = file.size;

    if (claimedMime.startsWith("image/")) {
        try {
            console.log("[leave-document] Step 1.5: Optimizing image attachment");
            const optimized = await optimizeDocumentImage(file.buffer);
            uploadBuffer = optimized.buffer;
            finalMime = "image/webp";
            finalExt = "webp";
            uploadSize = optimized.buffer.byteLength;
        } catch (err) {
            console.warn("[leave-document] Image optimization failed, falling back to original", err);
        }
    }

    const contentHash = createHash("sha256").update(uploadBuffer).digest("hex").slice(0, 16);
    const key = `leave-documents/${ownerUserId}/${leaveRequestId}/${contentHash}.${finalExt}`;
    console.log("[leave-document] Step 2: Uploading to R2", { key, mime: finalMime, size: uploadSize });

    try {
        await putObject(key, uploadBuffer, finalMime, {
            cacheControl: "private, max-age=300",
            contentDisposition: file.originalName
                ? `inline; filename="${sanitiseFilename(file.originalName)}"`
                : "inline",
            metadata: {
                "uploaded-by": user.id,
                "leave-request-id": leaveRequestId,
            },
        });
        console.log("[leave-document] Step 2 OK: R2 upload succeeded");
    } catch (err) {
        console.error("[leave-document] Step 2 FAILED: R2 put failed", err);
        return res.status(502).json({ error: "Failed to store document" });
    }

    console.log("[leave-document] Step 3: PATCHing leave_requests with attachment_path");
    const patch = await supabaseUserFetch(
        user,
        `/rest/v1/leave_requests?id=eq.${encodeURIComponent(leaveRequestId)}`,
        {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                Prefer: "return=minimal",
            },
            body: JSON.stringify({
                attachment_path: key,
                attachment_meta: {
                    mime: finalMime,
                    size: uploadSize,
                    original_name: file.originalName,
                    uploaded_at: new Date().toISOString(),
                },
            }),
        },
    );

    if (!patch.ok) {
        const status = patch.status;
        const body = await patch.text().catch(() => "");
        console.error("[leave-document] Step 3 FAILED: PATCH failed", status, body);
        return res.status(status === 401 || status === 403 ? 403 : 502).json({
            error: "Failed to update leave request",
            details: body,
        });
    }

    console.log("[leave-document] Step 3 OK: PATCH succeeded. Upload complete!", { key });
    return res.status(200).json({
        key,
        size: uploadSize,
        mime: finalMime,
        original_name: file.originalName,
    });
}

function sanitiseFilename(name: string): string {
    return name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
}
