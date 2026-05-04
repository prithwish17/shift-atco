/**
 * One-shot migration: copy every existing Supabase Storage `avatars/*` object
 * into Cloudflare R2 under `profiles/<employee_id>/<hash>.webp`, run them
 * through `sharp` for normalisation, and update `profiles.photo_url` to point
 * at the new R2 URL.
 *
 * Run:
 *   npx tsx scripts/migrate-avatars-to-r2.ts          # dry-run, copies + updates DB; keeps Supabase originals
 *   npx tsx scripts/migrate-avatars-to-r2.ts --cleanup  # additionally deletes the Supabase originals after copy
 *
 * Env required (in `.env` or shell):
 *   SUPABASE_URL                     # https://<proj>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY        # service role key (bypass RLS)
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 *   R2_BUCKET_NAME, R2_PUBLIC_BASE_URL
 *
 * Notes:
 *  - Idempotent: a re-run will not duplicate objects (content-hashed keys).
 *  - Safe by default — Supabase originals stay until you pass --cleanup.
 *  - Prints a per-row table at the end.
 */

import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { putObject, R2_PUBLIC_BASE } from "../lib/r2";
import { optimizeProfileImage } from "../lib/imageOptimizer";

interface ProfileRow {
    id: string;
    employee_id: string | null;
    photo_url: string | null;
}

interface ResultRow {
    employee_id: string;
    bucket_path: string;
    new_key?: string;
    new_url?: string;
    size_kb?: number;
    status: "migrated" | "skipped" | "error";
    detail?: string;
}

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const AVATARS_BUCKET = "avatars";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
}

if (!R2_PUBLIC_BASE) {
    console.error("Missing R2_PUBLIC_BASE_URL");
    process.exit(1);
}

const cleanup = process.argv.includes("--cleanup");

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
});

function bucketPathFromUrl(url: string): string | null {
    // Public Supabase storage URLs:
    //   https://<proj>.supabase.co/storage/v1/object/public/avatars/<employeeId>/avatar.webp
    //   https://<proj>.supabase.co/storage/v1/object/sign/avatars/...?token=...
    const m = url.match(/\/storage\/v1\/object\/(?:public|sign)\/avatars\/([^?#]+)/);
    return m ? m[1] : null;
}

async function downloadObject(bucketPath: string): Promise<Buffer | null> {
    const { data, error } = await admin.storage.from(AVATARS_BUCKET).download(bucketPath);
    if (error || !data) return null;
    const arr = await data.arrayBuffer();
    return Buffer.from(arr);
}

async function migrateOne(profile: ProfileRow): Promise<ResultRow> {
    const employeeId = profile.employee_id ?? "";
    if (!employeeId || !profile.photo_url) {
        return {
            employee_id: employeeId,
            bucket_path: profile.photo_url ?? "",
            status: "skipped",
            detail: "no employee_id or photo_url",
        };
    }

    // Already on R2 — nothing to do.
    if (profile.photo_url.startsWith(R2_PUBLIC_BASE)) {
        return {
            employee_id: employeeId,
            bucket_path: profile.photo_url,
            status: "skipped",
            detail: "already on R2",
        };
    }

    const bucketPath = bucketPathFromUrl(profile.photo_url);
    if (!bucketPath) {
        return {
            employee_id: employeeId,
            bucket_path: profile.photo_url,
            status: "skipped",
            detail: "URL not a Supabase avatars path",
        };
    }

    const buf = await downloadObject(bucketPath);
    if (!buf) {
        return {
            employee_id: employeeId,
            bucket_path: bucketPath,
            status: "error",
            detail: "download failed (object missing?)",
        };
    }

    let optimized;
    try {
        optimized = await optimizeProfileImage(buf, { size: 200, maxKb: 100 });
    } catch (err) {
        return {
            employee_id: employeeId,
            bucket_path: bucketPath,
            status: "error",
            detail: `optimize failed: ${(err as Error).message}`,
        };
    }

    const hash = createHash("sha256").update(optimized.buffer).digest("hex").slice(0, 16);
    const newKey = `profiles/${employeeId}/${hash}.webp`;
    const newUrl = `${R2_PUBLIC_BASE}/${newKey}`;

    try {
        await putObject(newKey, optimized.buffer, "image/webp", {
            cacheControl: "public, max-age=31536000, immutable",
            metadata: { "employee-id": employeeId, "migrated-from": "supabase-avatars" },
        });
    } catch (err) {
        return {
            employee_id: employeeId,
            bucket_path: bucketPath,
            status: "error",
            detail: `R2 put failed: ${(err as Error).message}`,
        };
    }

    const { error: updateError } = await admin
        .from("profiles")
        .update({ photo_url: newUrl })
        .eq("id", profile.id);

    if (updateError) {
        return {
            employee_id: employeeId,
            bucket_path: bucketPath,
            new_key: newKey,
            new_url: newUrl,
            size_kb: optimized.sizeKb,
            status: "error",
            detail: `DB update failed: ${updateError.message}`,
        };
    }

    if (cleanup) {
        const { error: rmError } = await admin.storage.from(AVATARS_BUCKET).remove([bucketPath]);
        if (rmError) {
            console.warn(`[cleanup] failed to remove ${bucketPath}: ${rmError.message}`);
        }
    }

    return {
        employee_id: employeeId,
        bucket_path: bucketPath,
        new_key: newKey,
        new_url: newUrl,
        size_kb: optimized.sizeKb,
        status: "migrated",
    };
}

async function main() {
    console.log(`[migrate] cleanup=${cleanup}`);

    const { data: profiles, error } = await admin
        .from("profiles")
        .select("id, employee_id, photo_url")
        .not("photo_url", "is", null);

    if (error) {
        console.error("Failed to fetch profiles:", error.message);
        process.exit(1);
    }

    console.log(`[migrate] ${profiles?.length ?? 0} profiles with an photo_url`);

    const results: ResultRow[] = [];
    for (const profile of profiles ?? []) {
        const row = await migrateOne(profile as ProfileRow);
        results.push(row);
        console.log(
            `  ${row.status.padEnd(8)} ${row.employee_id.padEnd(12)} ${row.detail ?? row.new_key ?? ""}`,
        );
    }

    const counts = results.reduce<Record<string, number>>((acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        return acc;
    }, {});

    console.log("\n[migrate] summary:", counts);
    if (counts.error) {
        console.warn("[migrate] some rows failed; review the log above before re-running with --cleanup.");
        process.exit(2);
    }
}

main().catch((err) => {
    console.error("[migrate] fatal:", err);
    process.exit(1);
});
