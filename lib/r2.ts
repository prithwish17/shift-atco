import {
    S3Client,
    PutObjectCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { releaseUpload, reserveUpload, type QuotaScope } from "./storageQuota.js";

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    console.warn(
        "[r2] One or more R2 credentials are missing. Uploads will fail until R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are set in the environment.",
    );
}

export const R2_BUCKET = process.env.R2_BUCKET_NAME ?? "atcora-storage";

/**
 * Public base URL for objects served over the R2 public domain.
 * Examples:
 *   https://cdn.atcora.in
 *   https://pub-<hash>.r2.dev
 * Only `profiles/*` should be served from this domain. Private documents stay
 * behind short-lived presigned URLs.
 */
export const R2_PUBLIC_BASE = (process.env.R2_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");

export const r2 = new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID ?? "",
        secretAccessKey: R2_SECRET_ACCESS_KEY ?? "",
    },
    forcePathStyle: false,
});

export interface PutObjectOpts {
    /**
     * Which storage-limit level this upload counts against. Every write is
     * checked against the free-tier quota first; see lib/storageQuota.ts.
     */
    quotaScope: QuotaScope;
    cacheControl?: string;
    contentDisposition?: string;
    metadata?: Record<string, string>;
}

const DEFAULT_CACHE_PUBLIC = "public, max-age=31536000, immutable";

/**
 * Write an object. Throws StorageQuotaError (lib/storageQuota.ts) before
 * touching the bucket when the upload would cross the free-tier limit.
 */
export async function putObject(
    key: string,
    body: Buffer,
    contentType: string,
    opts: PutObjectOpts,
): Promise<void> {
    const reserved = await reserveUpload(body.byteLength, opts.quotaScope);

    try {
        await r2.send(
            new PutObjectCommand({
                Bucket: R2_BUCKET,
                Key: key,
                Body: body,
                ContentType: contentType,
                CacheControl: opts.cacheControl ?? DEFAULT_CACHE_PUBLIC,
                ContentDisposition: opts.contentDisposition,
                Metadata: opts.metadata,
            }),
        );
    } catch (err) {
        if (reserved) await releaseUpload(body.byteLength);
        throw err;
    }
}

/**
 * Delete an object and give its bytes back to the storage quota. Pass
 * `{ releaseQuota: false }` when the caller recounts the bucket itself.
 */
export async function deleteObject(
    key: string,
    opts: { releaseQuota?: boolean } = {},
): Promise<void> {
    const releaseQuota = opts.releaseQuota ?? true;
    const size = releaseQuota ? await objectSize(key) : null;

    await r2.send(
        new DeleteObjectCommand({
            Bucket: R2_BUCKET,
            Key: key,
        }),
    );

    if (size) await releaseUpload(size);
}

async function objectSize(key: string): Promise<number | null> {
    try {
        const head = await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
        return head.ContentLength ?? null;
    } catch {
        return null;
    }
}

export interface ListedObject {
    key: string;
    size: number;
    lastModified: Date | null;
}

/**
 * List every object in the bucket. Each page of up to 1,000 keys is one
 * Class A operation; `listCalls` reports how many were made.
 */
export async function listAllObjects(prefix?: string): Promise<{ objects: ListedObject[]; listCalls: number }> {
    const objects: ListedObject[] = [];
    let listCalls = 0;
    let token: string | undefined;

    do {
        const page = await r2.send(
            new ListObjectsV2Command({
                Bucket: R2_BUCKET,
                Prefix: prefix,
                ContinuationToken: token,
                MaxKeys: 1000,
            }),
        );
        listCalls += 1;

        for (const item of page.Contents ?? []) {
            if (!item.Key) continue;
            objects.push({
                key: item.Key,
                size: item.Size ?? 0,
                lastModified: item.LastModified ?? null,
            });
        }

        token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);

    return { objects, listCalls };
}

export async function objectExists(key: string): Promise<boolean> {
    try {
        await r2.send(
            new HeadObjectCommand({
                Bucket: R2_BUCKET,
                Key: key,
            }),
        );
        return true;
    } catch (err: unknown) {
        const e = err as { $metadata?: { httpStatusCode?: number }; name?: string };
        if (e?.$metadata?.httpStatusCode === 404 || e?.name === "NotFound") return false;
        throw err;
    }
}

/**
 * Generate a short-lived presigned GET URL for a private object.
 * Use for `leave-documents/*`, certificates, HR documents.
 */
export async function getPresignedGetUrl(key: string, ttlSeconds = 300): Promise<string> {
    return getSignedUrl(
        r2,
        new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }),
        { expiresIn: ttlSeconds },
    );
}

/**
 * Build the public URL for a public object (e.g. profile picture).
 * Returns the key prefixed with the public base; do NOT use this for private docs.
 */
export function publicUrlFor(key: string): string {
    if (!R2_PUBLIC_BASE) {
        throw new Error("R2_PUBLIC_BASE_URL is not configured");
    }
    return `${R2_PUBLIC_BASE}/${key}`;
}

/**
 * Best-effort key extraction from a stored avatar URL.
 * Returns null if the URL doesn't belong to our public R2 base or doesn't
 * start with the expected `profiles/` prefix — protects against deleting
 * arbitrary objects if the URL was tampered with.
 */
export function profileKeyFromPublicUrl(url: string | null | undefined, employeeId: string): string | null {
    if (!url || !R2_PUBLIC_BASE) return null;
    if (!url.startsWith(`${R2_PUBLIC_BASE}/`)) return null;
    const key = url.slice(R2_PUBLIC_BASE.length + 1).split("?")[0];
    const expectedPrefix = `profiles/${employeeId}/`;
    if (!key.startsWith(expectedPrefix)) return null;
    return key;
}
