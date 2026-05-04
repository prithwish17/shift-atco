import { useCallback, useEffect, useState } from "react";
import { Loader2, FileText, AlertCircle, CheckCircle2, Eye, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useR2Upload } from "@/hooks/useR2Upload";
import { supabase } from "@/integrations/supabase/client";
import { FileDropzone } from "./FileDropzone";

const ACCEPTED = "application/pdf,image/jpeg,image/jpg,image/png,image/webp";
const ACCEPTED_MIMES = new Set([
    "application/pdf",
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
]);
const MAX_BYTES = 4 * 1024 * 1024;

interface UploadResponse {
    key: string;
    size: number;
    mime: string;
    original_name: string | null;
}

export interface LeaveDocumentUploadProps {
    leaveRequestId: string;
    /** Initial saved attachment metadata (if any). */
    initialAttachment?: {
        path: string | null;
        meta?: { mime?: string; size?: number; original_name?: string | null } | null;
    };
    onChange?: (attachment: UploadResponse | null) => void;
    className?: string;
    disabled?: boolean;
}

export function LeaveDocumentUpload({
    leaveRequestId,
    initialAttachment,
    onChange,
    className,
    disabled,
}: LeaveDocumentUploadProps) {
    const { upload, cancel, status, progress, error } = useR2Upload<UploadResponse>();

    const [current, setCurrent] = useState<{
        key: string;
        mime: string;
        size: number;
        original_name: string | null;
    } | null>(() => {
        if (!initialAttachment?.path) return null;
        return {
            key: initialAttachment.path,
            mime: initialAttachment.meta?.mime ?? "application/octet-stream",
            size: initialAttachment.meta?.size ?? 0,
            original_name: initialAttachment.meta?.original_name ?? null,
        };
    });

    const [previewLoading, setPreviewLoading] = useState(false);
    const [localError, setLocalError] = useState<string | null>(null);

    useEffect(() => () => cancel(), [cancel]);

    const handleFile = useCallback(
        async (file: File) => {
            setLocalError(null);

            if (!ACCEPTED_MIMES.has(file.type.toLowerCase())) {
                setLocalError("Only PDF, JPG, PNG or WebP files are accepted");
                return;
            }
            if (file.size > MAX_BYTES) {
                setLocalError(`File too large (max ${Math.round(MAX_BYTES / 1024 / 1024)} MB)`);
                return;
            }

            const result = await upload("/api/upload/leave-document", file, {
                fields: { leave_request_id: leaveRequestId },
            });

            if (result.ok && result.data) {
                const data = result.data;
                setCurrent({
                    key: data.key,
                    mime: data.mime,
                    size: data.size,
                    original_name: data.original_name,
                });
                onChange?.(data);
            }
        },
        [leaveRequestId, onChange, upload],
    );

    const handleView = useCallback(async () => {
        if (!current) return;
        setPreviewLoading(true);
        try {
            const { data } = await supabase.auth.getSession();
            const token = data.session?.access_token;
            if (!token) throw new Error("Not authenticated");

            const resp = await fetch(
                `/api/leave-document-url?leave_request_id=${encodeURIComponent(leaveRequestId)}`,
                { headers: { Authorization: `Bearer ${token}` } },
            );
            if (!resp.ok) {
                const body = await resp.text();
                throw new Error(body || `Failed (${resp.status})`);
            }
            const json = (await resp.json()) as { url: string };
            window.open(json.url, "_blank", "noopener,noreferrer");
        } catch (err) {
            setLocalError((err as Error).message || "Failed to open document");
        } finally {
            setPreviewLoading(false);
        }
    }, [current, leaveRequestId]);

    const handleClear = useCallback(() => {
        // Frontend-only clear; if you also want to delete the row's attachment_path,
        // wire a DELETE endpoint here.
        setCurrent(null);
        onChange?.(null);
    }, [onChange]);

    const isUploading = status === "uploading";
    const displayName = current?.original_name || current?.key.split("/").pop() || "Attachment";
    const sizeKb = current ? Math.round((current.size || 0) / 1024) : 0;

    return (
        <div className={cn("space-y-2", className)}>
            {!current && !isUploading && (
                <FileDropzone
                    accept={ACCEPTED}
                    onFile={handleFile}
                    disabled={disabled}
                    description="PDF, JPG, PNG or WebP"
                    maxMb={4}
                    variant="document"
                />
            )}

            {isUploading && (
                <div className="rounded-xl border border-border bg-muted/30 p-4">
                    <div className="flex items-center gap-2 text-sm">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Uploading… {progress}%</span>
                    </div>
                    <Progress value={progress} className="mt-2 h-1.5" />
                </div>
            )}

            {current && !isUploading && (
                <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-3">
                    <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{displayName}</p>
                        <p className="text-[11px] text-muted-foreground">
                            {current.mime} • {sizeKb > 0 ? `${sizeKb} KB` : "—"}
                        </p>
                    </div>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleView}
                        disabled={previewLoading}
                        className="gap-1.5"
                    >
                        {previewLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                        View
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={handleClear}
                        className="text-destructive"
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                </div>
            )}

            {(error || localError) && (
                <div className="flex items-center gap-1.5 text-xs text-destructive">
                    <AlertCircle className="h-3.5 w-3.5" />
                    <span>{localError ?? error}</span>
                </div>
            )}

            {status === "success" && !error && !localError && current && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Document uploaded
                </div>
            )}
        </div>
    );
}

export default LeaveDocumentUpload;
