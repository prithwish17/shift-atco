import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash } from "node:crypto";

import {
    authenticateRequest,
    handleCorsPreflight,
    setCorsHeaders,
    supabaseUserFetch,
} from "../../lib/apiAuth.js";
import { parseMultipartRequest, checkContentLength } from "../../lib/multipart.js";
import {
    deleteObject,
    profileKeyFromPublicUrl,
    publicUrlFor,
    putObject,
} from "../../lib/r2.js";
import { assertIsImage, optimizeProfileImage } from "../../lib/imageOptimizer.js";

// Stage 1 (browser) targets <= 600 KB. We allow 2 MB on the wire to give
// fallback paths breathing room. Vercel platform limit is 4.5 MB.
const MAX_PROFILE_BYTES = 2 * 1024 * 1024;

const ACCEPTED_MIMES = new Set([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
    "image/avif",
    "image/gif",
]);

export const config = {
    api: {
        bodyParser: false,
    },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (handleCorsPreflight(req, res, "POST, DELETE, OPTIONS")) return;
    setCorsHeaders(req, res);

    if (req.method === "POST") return handlePost(req, res);
    if (req.method === "DELETE") return handleDelete(req, res);

    res.setHeader("Allow", "POST, DELETE, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
}

async function handlePost(req: VercelRequest, res: VercelResponse) {
    const user = await authenticateRequest(req, res);
    if (!user) return;

    if (!checkContentLength(req, MAX_PROFILE_BYTES)) {
        return res.status(413).json({ error: "Image too large (max 2 MB after browser compression)" });
    }

    let parsed;
    try {
        parsed = await parseMultipartRequest(req, { maxFileSize: MAX_PROFILE_BYTES });
    } catch (err) {
        const msg = (err as Error).message || "Failed to parse upload";
        return res.status(400).json({ error: msg });
    }

    const { file, fields } = parsed;
    const employeeId = (fields.employeeId ?? fields.employee_id ?? "").trim();
    if (!employeeId) {
        return res.status(400).json({ error: "Missing form field: employeeId" });
    }

    if (!/^[A-Za-z0-9_-]{1,64}$/.test(employeeId)) {
        return res.status(400).json({ error: "Invalid employeeId format" });
    }

    const claimedMime = (file.mime ?? "").toLowerCase();
    if (!ACCEPTED_MIMES.has(claimedMime)) {
        return res.status(415).json({ error: `Unsupported image MIME: ${file.mime}` });
    }

    try {
        await assertIsImage(file.buffer);
    } catch {
        return res.status(415).json({ error: "Uploaded file is not a valid image" });
    }

    let optimized;
    try {
        optimized = await optimizeProfileImage(file.buffer, { size: 200, maxKb: 100 });
    } catch (err) {
        console.error("[profile-picture] optimize failed", err);
        return res.status(500).json({ error: "Image optimization failed" });
    }

    const contentHash = createHash("sha256").update(optimized.buffer).digest("hex").slice(0, 16);
    const key = `profiles/${employeeId}/${contentHash}.webp`;

    try {
        await putObject(key, optimized.buffer, "image/webp", {
            cacheControl: "public, max-age=31536000, immutable",
            metadata: {
                "employee-id": employeeId,
                "uploaded-by": user.id,
            },
        });
    } catch (err) {
        console.error("[profile-picture] R2 put failed", err);
        return res.status(502).json({ error: "Failed to store image" });
    }

    let publicUrl: string;
    try {
        publicUrl = publicUrlFor(key);
    } catch (err) {
        console.error("[profile-picture] missing R2 public base", err);
        return res.status(500).json({ error: "Server misconfigured: R2_PUBLIC_BASE_URL" });
    }

    // Look up the existing photo URL so we can clean up after a successful update.
    let previousPhotoUrl: string | null = null;
    try {
        const lookup = await supabaseUserFetch(
            user,
            `/rest/v1/profiles?employee_id=eq.${encodeURIComponent(employeeId)}&select=photo_url`,
            { method: "GET", headers: { Accept: "application/json" } },
        );
        if (lookup.ok) {
            const rows = (await lookup.json()) as Array<{ photo_url: string | null }>;
            previousPhotoUrl = rows[0]?.photo_url ?? null;
        }
    } catch (err) {
        console.warn("[profile-picture] photo lookup failed", err);
    }

    // PATCH using the caller's JWT so RLS enforces "self or supervisor/admin".
    const patchResp = await supabaseUserFetch(
        user,
        `/rest/v1/profiles?employee_id=eq.${encodeURIComponent(employeeId)}`,
        {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                Prefer: "return=minimal",
            },
            body: JSON.stringify({ photo_url: publicUrl }),
        },
    );

    if (!patchResp.ok) {
        const body = await patchResp.text().catch(() => "");
        console.error("[profile-picture] supabase PATCH failed", patchResp.status, body);

        // RLS rejection — surface a clean 403 to the client and roll back the R2 object.
        await deleteObject(key).catch(() => undefined);

        if (patchResp.status === 401 || patchResp.status === 403) {
            return res.status(403).json({ error: "Not allowed to update this profile" });
        }
        return res.status(502).json({ error: "Failed to update profile record" });
    }

    // Best-effort cleanup of the previous content-hashed key.
    if (previousPhotoUrl) {
        const oldKey = profileKeyFromPublicUrl(previousPhotoUrl, employeeId);
        if (oldKey && oldKey !== key) {
            deleteObject(oldKey).catch((err) => {
                console.warn("[profile-picture] failed to delete previous key", oldKey, err);
            });
        }
    }

    return res.status(200).json({
        url: publicUrl,
        key,
        sizeKb: optimized.sizeKb,
        quality: optimized.quality,
    });
}

async function handleDelete(req: VercelRequest, res: VercelResponse) {
    const user = await authenticateRequest(req, res);
    if (!user) return;

    const employeeId = String(req.query.employeeId ?? "").trim();
    if (!employeeId || !/^[A-Za-z0-9_-]{1,64}$/.test(employeeId)) {
        return res.status(400).json({ error: "Missing or invalid employeeId" });
    }

    const lookup = await supabaseUserFetch(
        user,
        `/rest/v1/profiles?employee_id=eq.${encodeURIComponent(employeeId)}&select=photo_url`,
        { method: "GET", headers: { Accept: "application/json" } },
    );

    if (!lookup.ok) {
        return res.status(403).json({ error: "Not allowed to read this profile" });
    }
    const rows = (await lookup.json()) as Array<{ photo_url: string | null }>;
    const existing = rows[0]?.photo_url ?? null;

    const patch = await supabaseUserFetch(
        user,
        `/rest/v1/profiles?employee_id=eq.${encodeURIComponent(employeeId)}`,
        {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                Prefer: "return=minimal",
            },
            body: JSON.stringify({ photo_url: null }),
        },
    );

    if (!patch.ok) {
        const status = patch.status;
        const body = await patch.text().catch(() => "");
        console.error("[profile-picture] DELETE PATCH failed", status, body);
        return res.status(status === 401 || status === 403 ? 403 : 502).json({
            error: "Failed to clear photo_url",
        });
    }

    if (existing) {
        const key = profileKeyFromPublicUrl(existing, employeeId);
        if (key) {
            await deleteObject(key).catch((err) => {
                console.warn("[profile-picture] R2 delete failed", key, err);
            });
        }
    }

    return res.status(204).end();
}
