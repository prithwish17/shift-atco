import type { VercelRequest } from "@vercel/node";
import formidable from "formidable";
import { promises as fs } from "node:fs";
import type { File as FormidableFile } from "formidable";

export interface ParsedUpload {
    file: {
        buffer: Buffer;
        size: number;
        mime: string;
        originalName: string | null;
    };
    fields: Record<string, string>;
}

export interface ParseOpts {
    /** Hard cap on file size in bytes. */
    maxFileSize: number;
    /** Field name expected for the file. Defaults to "file". */
    fileField?: string;
}

/**
 * Parse a `multipart/form-data` request and return the single file plus any
 * scalar fields. Designed for our upload endpoints — exactly one file per
 * request.
 */
export async function parseMultipartRequest(
    req: VercelRequest,
    opts: ParseOpts,
): Promise<ParsedUpload> {
    const form = formidable({
        multiples: false,
        maxFileSize: opts.maxFileSize,
        keepExtensions: true,
    });

    const [fieldsRaw, filesRaw] = await form.parse(req);

    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(fieldsRaw)) {
        if (Array.isArray(value)) {
            fields[key] = value[0] ?? "";
        } else if (typeof value === "string") {
            fields[key] = value;
        }
    }

    const fileField = opts.fileField ?? "file";
    const fileEntry = filesRaw[fileField];
    const formidableFile: FormidableFile | undefined = Array.isArray(fileEntry)
        ? fileEntry[0]
        : (fileEntry as FormidableFile | undefined);

    if (!formidableFile) {
        throw new Error(`Missing form field: ${fileField}`);
    }

    const buffer = await fs.readFile(formidableFile.filepath);
    // Best-effort cleanup of the temp file.
    fs.unlink(formidableFile.filepath).catch(() => undefined);

    return {
        file: {
            buffer,
            size: buffer.byteLength,
            mime: formidableFile.mimetype ?? "application/octet-stream",
            originalName: formidableFile.originalFilename ?? null,
        },
        fields,
    };
}

/**
 * Quick rejection of obviously oversized requests before we even parse the body.
 * Vercel will also enforce its own platform limit; this gives a clean error.
 */
export function checkContentLength(req: VercelRequest, maxBytes: number): boolean {
    const len = Number(req.headers["content-length"] ?? "0");
    if (Number.isFinite(len) && len > 0 && len > maxBytes) return false;
    return true;
}
