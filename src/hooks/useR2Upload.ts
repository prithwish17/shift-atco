import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type UploadStatus = "idle" | "uploading" | "success" | "error";

export interface UploadOpts {
    /**
     * Form fields to send alongside the file (the file uses the field name "file").
     */
    fields?: Record<string, string>;
    /**
     * Field name for the file. Defaults to "file".
     */
    fileField?: string;
    /**
     * Max retry attempts on 5xx / network errors. Defaults to 2.
     */
    maxRetries?: number;
    /** Optional progress callback. Receives 0-100. */
    onProgress?: (percent: number) => void;
}

export interface UploadResult<T = unknown> {
    ok: boolean;
    status: number;
    data?: T;
    error?: string;
}

async function getAccessToken(): Promise<string | null> {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
}

function uploadOnce(
    endpoint: string,
    method: string,
    formData: FormData,
    accessToken: string,
    onProgress?: (percent: number) => void,
    abortSignal?: AbortSignal,
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(method, endpoint);
        xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);

        xhr.upload.onprogress = (ev) => {
            if (!ev.lengthComputable || !onProgress) return;
            onProgress(Math.round((ev.loaded / ev.total) * 100));
        };

        xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));

        if (abortSignal) {
            if (abortSignal.aborted) {
                xhr.abort();
                return;
            }
            abortSignal.addEventListener("abort", () => xhr.abort(), { once: true });
        }

        xhr.send(formData);
    });
}

function buildFormData(file: Blob | File, opts: UploadOpts): FormData {
    const fd = new FormData();
    const fileField = opts.fileField ?? "file";
    const filename =
        file instanceof File ? file.name : `upload-${Date.now()}.${blobExt(file)}`;
    fd.append(fileField, file, filename);
    if (opts.fields) {
        for (const [k, v] of Object.entries(opts.fields)) {
            fd.append(k, v);
        }
    }
    return fd;
}

function blobExt(blob: Blob): string {
    const t = (blob.type || "").toLowerCase();
    if (t.includes("webp")) return "webp";
    if (t.includes("png")) return "png";
    if (t.includes("jpeg") || t.includes("jpg")) return "jpg";
    if (t.includes("pdf")) return "pdf";
    return "bin";
}

export function useR2Upload<TResponse = unknown>() {
    const [status, setStatus] = useState<UploadStatus>("idle");
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    const cancel = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
    }, []);

    const upload = useCallback(
        async (
            endpoint: string,
            file: Blob | File,
            opts: UploadOpts = {},
        ): Promise<UploadResult<TResponse>> => {
            setError(null);
            setProgress(0);
            setStatus("uploading");

            const token = await getAccessToken();
            if (!token) {
                setStatus("error");
                setError("Not authenticated");
                return { ok: false, status: 401, error: "Not authenticated" };
            }

            const fd = buildFormData(file, opts);
            const maxRetries = Math.max(0, opts.maxRetries ?? 2);
            const controller = new AbortController();
            abortRef.current = controller;

            let attempt = 0;
            let lastError = "";

            while (attempt <= maxRetries) {
                try {
                    const onProgress = (pct: number) => {
                        setProgress(pct);
                        opts.onProgress?.(pct);
                    };
                    const { status: httpStatus, body } = await uploadOnce(
                        endpoint,
                        "POST",
                        fd,
                        token,
                        onProgress,
                        controller.signal,
                    );

                    if (httpStatus >= 200 && httpStatus < 300) {
                        let data: TResponse | undefined;
                        if (body) {
                            try {
                                data = JSON.parse(body) as TResponse;
                            } catch {
                                /* non-JSON success body is fine */
                            }
                        }
                        setStatus("success");
                        setProgress(100);
                        return { ok: true, status: httpStatus, data };
                    }

                    // 4xx -> do not retry; surface to caller.
                    if (httpStatus >= 400 && httpStatus < 500) {
                        const msg = parseErrorBody(body) ?? `Upload failed (${httpStatus})`;
                        setStatus("error");
                        setError(msg);
                        return { ok: false, status: httpStatus, error: msg };
                    }

                    lastError = parseErrorBody(body) ?? `Server error (${httpStatus})`;
                } catch (err) {
                    if ((err as Error).name === "AbortError") {
                        setStatus("idle");
                        setProgress(0);
                        return { ok: false, status: 0, error: "Cancelled" };
                    }
                    lastError = (err as Error).message || "Network error";
                }

                attempt += 1;
                if (attempt <= maxRetries) {
                    const backoff = 400 * 2 ** (attempt - 1);
                    await new Promise((r) => setTimeout(r, backoff));
                }
            }

            setStatus("error");
            setError(lastError || "Upload failed");
            return { ok: false, status: 0, error: lastError || "Upload failed" };
        },
        [],
    );

    return { upload, cancel, status, progress, error };
}

function parseErrorBody(body: string): string | null {
    if (!body) return null;
    try {
        const json = JSON.parse(body) as { error?: string; message?: string };
        return json.error || json.message || null;
    } catch {
        return body.length < 200 ? body : null;
    }
}
