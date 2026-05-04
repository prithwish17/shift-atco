/**
 * Two-stage image compression — browser stage.
 *
 * Reduces *any* image (HEIC, RAW JPEG, multi-MP PNG) to a sub-MB WebP blob
 * before it leaves the device. The server then runs the authoritative pass
 * with `sharp` to produce the final 200x200 webp stored in R2.
 *
 * Goals:
 *  - never exceed Vercel's 4.5 MB request body limit
 *  - keep memory low on mobile (createImageBitmap, OffscreenCanvas when available)
 *  - graceful fallback for old browsers and non-WebP encoders
 */

const HEIC_MIMES = new Set(["image/heic", "image/heif"]);
const HEIC_EXTS = /\.(heic|heif)$/i;

const DEFAULT_MAX_EDGE = 1200;
const DEFAULT_MAX_KB = 600;
const QUALITY_LADDER = [0.7, 0.6, 0.5, 0.4, 0.3];

export interface BrowserCompressOpts {
    /** Output longest-edge in pixels. Default 1200. */
    maxEdge?: number;
    /** Output target size in KB. Default 600. */
    maxKb?: number;
}

export interface BrowserCompressResult {
    blob: Blob;
    sizeKb: number;
    width: number;
    height: number;
    sourceSizeKb: number;
}

function isHeic(file: File): boolean {
    return HEIC_MIMES.has(file.type.toLowerCase()) || HEIC_EXTS.test(file.name);
}

async function decodeBlob(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
    if (typeof createImageBitmap === "function") {
        try {
            return await createImageBitmap(blob);
        } catch {
            // fall through to <img> fallback
        }
    }

    const url = URL.createObjectURL(blob);
    try {
        return await new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error("Failed to decode image"));
            img.src = url;
        });
    } finally {
        // Browsers keep the URL alive while the image is loaded; revoke once
        // we've drawn it (after this function returns is fine since the bitmap
        // is now in canvas memory).
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }
}

function computeTargetSize(
    width: number,
    height: number,
    maxEdge: number,
): { width: number; height: number } {
    if (width <= maxEdge && height <= maxEdge) {
        return { width, height };
    }
    const scale = maxEdge / Math.max(width, height);
    return {
        width: Math.round(width * scale),
        height: Math.round(height * scale),
    };
}

async function drawAndEncode(
    source: ImageBitmap | HTMLImageElement,
    width: number,
    height: number,
    quality: number,
    mime: string,
): Promise<Blob | null> {
    if (typeof OffscreenCanvas !== "undefined") {
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);
        try {
            return await canvas.convertToBlob({ type: mime, quality });
        } catch {
            return null;
        }
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);
    return new Promise<Blob | null>((resolve) => {
        canvas.toBlob((blob) => resolve(blob), mime, quality);
    });
}

async function tryEncode(
    source: ImageBitmap | HTMLImageElement,
    width: number,
    height: number,
    maxBytes: number,
): Promise<{ blob: Blob; quality: number; mime: string } | null> {
    // Prefer WebP, fall back to JPEG if encoder unavailable.
    for (const mime of ["image/webp", "image/jpeg"]) {
        for (const q of QUALITY_LADDER) {
            const out = await drawAndEncode(source, width, height, q, mime);
            if (!out) continue;
            if (out.size <= maxBytes) return { blob: out, quality: q, mime };
        }
    }
    // Last-ditch: encode at the lowest quality WebP/JPEG we managed and accept
    // whatever size came out — server will still run sharp on it.
    const fallback = await drawAndEncode(source, width, height, 0.3, "image/jpeg");
    if (fallback) return { blob: fallback, quality: 0.3, mime: "image/jpeg" };
    return null;
}

export async function compressForUpload(
    file: File,
    opts: BrowserCompressOpts = {},
): Promise<BrowserCompressResult> {
    const maxEdge = opts.maxEdge ?? DEFAULT_MAX_EDGE;
    const maxBytes = (opts.maxKb ?? DEFAULT_MAX_KB) * 1024;
    const sourceSizeKb = Math.round(file.size / 1024);

    let blob: Blob = file;

    // HEIC/HEIF must be converted to a canvas-decodable format first.
    if (isHeic(file)) {
        const heic2any = (await import("heic2any")).default;
        const converted = (await heic2any({
            blob: file,
            toType: "image/jpeg",
            quality: 0.9,
        })) as Blob | Blob[];
        blob = Array.isArray(converted) ? converted[0] : converted;
    }

    const decoded = await decodeBlob(blob);
    const srcWidth =
        "width" in decoded
            ? (decoded as ImageBitmap).width || (decoded as HTMLImageElement).naturalWidth
            : 0;
    const srcHeight =
        "height" in decoded
            ? (decoded as ImageBitmap).height || (decoded as HTMLImageElement).naturalHeight
            : 0;

    if (!srcWidth || !srcHeight) {
        throw new Error("Could not read image dimensions");
    }

    const target = computeTargetSize(srcWidth, srcHeight, maxEdge);
    const encoded = await tryEncode(decoded, target.width, target.height, maxBytes);

    if (!encoded) {
        throw new Error("Image compression failed in this browser");
    }

    return {
        blob: encoded.blob,
        sizeKb: Math.round(encoded.blob.size / 1024),
        width: target.width,
        height: target.height,
        sourceSizeKb,
    };
}
