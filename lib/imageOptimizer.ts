import sharp from "sharp";

export interface OptimizedImage {
    buffer: Buffer;
    width: number;
    height: number;
    sizeKb: number;
    quality: number;
}

export interface OptimizeOpts {
    /** Output edge length (square crop). Default 200. */
    size?: number;
    /** Target max output size in KB. Default 100. */
    maxKb?: number;
    /** Quality stepdown ladder. */
    qualityLadder?: number[];
}

const DEFAULT_LADDER = [80, 70, 60, 50, 40, 30];

/**
 * Resize an arbitrary image buffer to a square cover, encode WebP, and step
 * the quality down until the result is at most `maxKb` kilobytes.
 *
 * `sharp` strips EXIF by default — important for profile pictures where the
 * input may carry GPS / camera metadata.
 */
export async function optimizeProfileImage(
    input: Buffer,
    opts: OptimizeOpts = {},
): Promise<OptimizedImage> {
    const size = opts.size ?? 200;
    const maxBytes = (opts.maxKb ?? 100) * 1024;
    const ladder = opts.qualityLadder ?? DEFAULT_LADDER;

    const metadata = await sharp(input).metadata();
    if (!metadata.width || !metadata.height) {
        throw new Error("Invalid image: could not read dimensions");
    }

    let last: { buffer: Buffer; quality: number } | null = null;

    for (const quality of ladder) {
        const buffer = await sharp(input)
            .rotate()
            .resize(size, size, { fit: "cover", position: "centre" })
            .webp({ quality, effort: 5 })
            .toBuffer();
        last = { buffer, quality };
        if (buffer.byteLength <= maxBytes) {
            return {
                buffer,
                width: size,
                height: size,
                sizeKb: Math.round(buffer.byteLength / 1024),
                quality,
            };
        }
    }

    if (!last) throw new Error("Image optimization failed");
    return {
        buffer: last.buffer,
        width: size,
        height: size,
        sizeKb: Math.round(last.buffer.byteLength / 1024),
        quality: last.quality,
    };
}

/**
 * Resize a document image to a reasonable maximum dimension, encode WebP,
 * and step the quality down until it fits within maxKb. Maintains aspect ratio.
 */
export async function optimizeDocumentImage(
    input: Buffer,
    opts: { maxDimension?: number; maxKb?: number; qualityLadder?: number[] } = {},
): Promise<OptimizedImage> {
    const maxDimension = opts.maxDimension ?? 1600;
    const maxBytes = (opts.maxKb ?? 500) * 1024;
    const ladder = opts.qualityLadder ?? [85, 75, 60, 45, 30];

    const metadata = await sharp(input).metadata();
    if (!metadata.width || !metadata.height) {
        throw new Error("Invalid image: could not read dimensions");
    }

    let last: { buffer: Buffer; quality: number } | null = null;

    for (const quality of ladder) {
        const buffer = await sharp(input)
            .rotate() // auto-orient based on EXIF
            .resize({ width: maxDimension, height: maxDimension, fit: "inside", withoutEnlargement: true })
            .webp({ quality, effort: 5 })
            .toBuffer();
        last = { buffer, quality };
        if (buffer.byteLength <= maxBytes) {
            const info = await sharp(buffer).metadata();
            return {
                buffer,
                width: info.width || 0,
                height: info.height || 0,
                sizeKb: Math.round(buffer.byteLength / 1024),
                quality,
            };
        }
    }

    if (!last) throw new Error("Document image optimization failed");
    const info = await sharp(last.buffer).metadata();
    return {
        buffer: last.buffer,
        width: info.width || 0,
        height: info.height || 0,
        sizeKb: Math.round(last.buffer.byteLength / 1024),
        quality: last.quality,
    };
}

/**
 * Validate that the buffer is a real image by attempting to read its metadata.
 * Returns the detected MIME type or throws.
 */
export async function assertIsImage(input: Buffer): Promise<string> {
    const meta = await sharp(input).metadata();
    if (!meta.format) throw new Error("Unsupported or unrecognized image format");
    return `image/${meta.format}`;
}
