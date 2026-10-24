/**
 * Announcement attachments — admins only.
 *
 *   POST   /api/storage/announcement-attachment   multipart: file + announcement_id
 *   DELETE /api/storage/announcement-attachment?announcement_id=…
 *   GET    /api/storage/announcement-attachment-url?announcement_id=…
 *
 * Files are private, under announcements/<id>/, and viewed through a
 * five-minute signed URL. Uploads count against the "announcement" storage
 * level, which closes at 8 GB so leave documents keep the last stretch of the
 * free tier. See docs/announcements-and-storage-quota.md.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash } from "node:crypto";

import {
    authenticateRequest,
    handleCorsPreflight,
    setCorsHeaders,
    supabaseUserFetch,
    userHasRole,
    type AuthenticatedUser,
} from "../apiAuth.js";
import { optimizeDocumentImage } from "../imageOptimizer.js";
import { checkContentLength, parseMultipartRequest } from "../multipart.js";
import { deleteObject, getPresignedGetUrl, putObject } from "../r2.js";
import { StorageQuotaError, sendStorageLimit } from "../storageQuota.js";

// Vercel Hobby's body limit is 4.5 MB; leave headroom.
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const URL_TTL_SECONDS = 300;

const ACCEPTED_MIMES = new Map<string, string>([
    ["application/pdf", "pdf"],
    ["image/jpeg", "jpg"],
    ["image/jpg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
]);

const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF
const UUID_RE = /^[0-9a-fA-F-]{16,}$/;

interface AttachmentRow {
    id: string;
    attachment_path: string | null;
}

export async function handler(req: VercelRequest, res: VercelResponse) {
    if (handleCorsPreflight(req, res, "POST, DELETE, OPTIONS")) return;
    setCorsHeaders(req, res);

    if (req.method !== "POST" && req.method !== "DELETE") {
        res.setHeader("Allow", "POST, DELETE, OPTIONS");
        return res.status(405).json({ error: "Method not allowed" });
    }

    const user = await authenticateRequest(req, res);
    if (!user) return;

    if (!(await userHasRole(user, "admin"))) {
        return res.status(403).json({ error: "Only admins can manage announcement attachments" });
    }

    if (req.method === "DELETE") return handleDelete(req, res, user);
    return handlePost(req, res, user);
}

async function handlePost(req: VercelRequest, res: VercelResponse, user: AuthenticatedUser) {
    if (!checkContentLength(req, MAX_ATTACHMENT_BYTES)) {
        return res.status(413).json({ error: "Attachment too large (max 4 MB)" });
    }

    let parsed;
    try {
        parsed = await parseMultipartRequest(req, { maxFileSize: MAX_ATTACHMENT_BYTES });
    } catch (err) {
        return res.status(400).json({ error: (err as Error).message || "Failed to parse upload" });
    }

    const { file, fields } = parsed;
    const announcementId = (fields.announcement_id ?? "").trim();
    if (!UUID_RE.test(announcementId)) {
        return res.status(400).json({ error: "Missing or invalid announcement_id" });
    }

    const claimedMime = (file.mime ?? "").toLowerCase();
    let ext = ACCEPTED_MIMES.get(claimedMime);
    if (!ext) {
        return res.status(415).json({ error: `Unsupported file type: ${file.mime}` });
    }
    if (claimedMime === "application/pdf") {
        if (file.buffer.length < 4 || !file.buffer.subarray(0, 4).equals(PDF_MAGIC)) {
            return res.status(415).json({ error: "File does not appear to be a valid PDF" });
        }
    }

    const existing = await loadAttachmentRow(user, announcementId);
    if (existing === "error") return res.status(502).json({ error: "Could not look up the announcement" });
    if (!existing) return res.status(404).json({ error: "Announcement not found" });

    let buffer = file.buffer;
    let mime = claimedMime;
    if (claimedMime.startsWith("image/")) {
        try {
            const optimized = await optimizeDocumentImage(file.buffer);
            buffer = optimized.buffer;
            mime = "image/webp";
            ext = "webp";
        } catch (err) {
            console.warn("[announcement-attachment] image optimization failed, keeping original", err);
        }
    }

    const contentHash = createHash("sha256").update(buffer).digest("hex").slice(0, 16);
    const key = `announcements/${announcementId}/${contentHash}.${ext}`;
    const originalName = file.originalName ? sanitiseFilename(file.originalName) : null;

    try {
        await putObject(key, buffer, mime, {
            quotaScope: "announcement",
            cacheControl: "private, max-age=300",
            contentDisposition: originalName ? `inline; filename="${originalName}"` : "inline",
            metadata: {
                "uploaded-by": user.id,
                "announcement-id": announcementId,
            },
        });
    } catch (err) {
        if (err instanceof StorageQuotaError) return sendStorageLimit(res, err);
        console.error("[announcement-attachment] R2 put failed", err);
        return res.status(502).json({ error: "Failed to store attachment" });
    }

    const meta = {
        mime,
        size: buffer.byteLength,
        original_name: originalName,
        uploaded_at: new Date().toISOString(),
    };

    const patch = await patchAttachment(user, announcementId, { attachment_path: key, attachment_meta: meta });
    if (!patch.ok) {
        const body = await patch.text().catch(() => "");
        console.error("[announcement-attachment] PATCH failed", patch.status, body);
        if (existing.attachment_path !== key) await deleteObject(key).catch(() => undefined);
        return res.status(patch.status === 401 || patch.status === 403 ? 403 : 502).json({
            error: "Failed to save the attachment on the announcement",
        });
    }

    if (existing.attachment_path && existing.attachment_path !== key) {
        await deleteObject(existing.attachment_path).catch((err) => {
            console.warn("[announcement-attachment] failed to delete previous file", existing.attachment_path, err);
        });
    }

    return res.status(200).json({ key, ...meta });
}

async function handleDelete(req: VercelRequest, res: VercelResponse, user: AuthenticatedUser) {
    const announcementId = String(req.query.announcement_id ?? "").trim();
    if (!UUID_RE.test(announcementId)) {
        return res.status(400).json({ error: "Missing or invalid announcement_id" });
    }

    const existing = await loadAttachmentRow(user, announcementId);
    if (existing === "error") return res.status(502).json({ error: "Could not look up the announcement" });
    if (!existing) return res.status(404).json({ error: "Announcement not found" });
    if (!existing.attachment_path) return res.status(204).end();

    const patch = await patchAttachment(user, announcementId, { attachment_path: null, attachment_meta: null });
    if (!patch.ok) {
        return res.status(patch.status === 401 || patch.status === 403 ? 403 : 502).json({
            error: "Failed to remove the attachment",
        });
    }

    await deleteObject(existing.attachment_path).catch((err) => {
        console.warn("[announcement-attachment] R2 delete failed; reconcile will remove it", err);
    });

    return res.status(204).end();
}

/** GET /api/storage/announcement-attachment-url — anyone who can see the announcement. */
export async function urlHandler(req: VercelRequest, res: VercelResponse) {
    if (handleCorsPreflight(req, res, "GET, OPTIONS")) return;
    setCorsHeaders(req, res);

    if (req.method !== "GET") {
        res.setHeader("Allow", "GET, OPTIONS");
        return res.status(405).json({ error: "Method not allowed" });
    }

    const user = await authenticateRequest(req, res);
    if (!user) return;

    const announcementId = String(req.query.announcement_id ?? "").trim();
    if (!UUID_RE.test(announcementId)) {
        return res.status(400).json({ error: "Missing or invalid announcement_id" });
    }

    // RLS: employees only see live announcements; supervisors and admins see all.
    const row = await loadAttachmentRow(user, announcementId);
    if (row === "error") return res.status(502).json({ error: "Could not look up the announcement" });
    if (!row?.attachment_path) return res.status(404).json({ error: "No attachment" });

    try {
        const url = await getPresignedGetUrl(row.attachment_path, URL_TTL_SECONDS);
        return res.status(200).json({ url, expires_in: URL_TTL_SECONDS });
    } catch (err) {
        console.error("[announcement-attachment-url] presign failed", err);
        return res.status(502).json({ error: "Failed to create the download link" });
    }
}

async function loadAttachmentRow(
    user: AuthenticatedUser,
    announcementId: string,
): Promise<AttachmentRow | null | "error"> {
    const resp = await supabaseUserFetch(
        user,
        `/rest/v1/announcements?id=eq.${encodeURIComponent(announcementId)}&select=id,attachment_path`,
        { method: "GET", headers: { Accept: "application/json" } },
    );
    if (!resp.ok) return "error";
    const rows = (await resp.json()) as AttachmentRow[];
    return rows[0] ?? null;
}

function patchAttachment(
    user: AuthenticatedUser,
    announcementId: string,
    body: { attachment_path: string | null; attachment_meta: Record<string, unknown> | null },
) {
    return supabaseUserFetch(user, `/rest/v1/announcements?id=eq.${encodeURIComponent(announcementId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(body),
    });
}

function sanitiseFilename(name: string): string {
    return name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
}
