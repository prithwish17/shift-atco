import { useState, useRef, forwardRef, useImperativeHandle } from "react";
import { compressForUpload } from "@/utils/imageCompressorBrowser";
import { useR2Upload } from "@/hooks/useR2Upload";
import { cn } from "@/lib/utils";
import { Camera, Loader2, AlertCircle, User } from "lucide-react";

export interface ProfilePictureUploadHandle {
    openFilePicker: () => void;
}

interface ProfilePictureUploadProps {
    employeeId: string;
    currentUrl?: string | null;
    onUpload?: (publicUrl: string) => void;
}

interface UploadResponse {
    url: string;
    key: string;
    sizeKb: number;
    quality: number;
}

type Status = "idle" | "compressing" | "uploading" | "done" | "error";

const ACCEPTED = "image/*,.heic,.heif,.avif";

const ProfilePictureUpload = forwardRef<ProfilePictureUploadHandle, ProfilePictureUploadProps>(
    function ProfilePictureUpload({ employeeId, currentUrl, onUpload }, ref) {
        const [preview, setPreview] = useState<string | null>(currentUrl || null);
        const [status, setStatus] = useState<Status>("idle");
        const [error, setError] = useState<string | null>(null);
        const inputRef = useRef<HTMLInputElement>(null);

        const { upload } = useR2Upload<UploadResponse>();

        useImperativeHandle(ref, () => ({
            openFilePicker: () => inputRef.current?.click(),
        }));

        const isLoading = status === "compressing" || status === "uploading";

        async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
            const file = e.target.files?.[0];
            if (!file) return;

            setError(null);

            if (!employeeId) {
                setError("Your session is still loading. Please try again in a moment.");
                setStatus("error");
                e.target.value = "";
                return;
            }

            try {
                setStatus("compressing");
                const compressed = await compressForUpload(file, { maxEdge: 1200, maxKb: 600 });

                // Optimistic local preview before the round-trip.
                setPreview(URL.createObjectURL(compressed.blob));

                setStatus("uploading");
                const result = await upload("/api/upload/profile-picture", compressed.blob, {
                    fields: { employeeId },
                });

                if (!result.ok || !result.data) {
                    throw new Error(result.error || "Upload failed");
                }

                setStatus("done");
                setPreview(result.data.url);
                onUpload?.(result.data.url);
            } catch (err) {
                console.error(err);
                setError((err as Error).message || "Upload failed. Please try again.");
                setStatus("error");
                if (currentUrl) setPreview(currentUrl);
            }

            e.target.value = "";
        }

        return (
            <div className="flex flex-col items-center gap-2">
                <button
                    type="button"
                    disabled={isLoading}
                    onClick={() => inputRef.current?.click()}
                    className={cn(
                        "relative h-28 w-28 rounded-full overflow-hidden border-[3px] border-border shadow-md",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        !isLoading && "cursor-pointer group",
                    )}
                >
                    {preview ? (
                        <img
                            src={preview}
                            alt="Profile"
                            loading="lazy"
                            decoding="async"
                            className="h-full w-full object-cover"
                        />
                    ) : (
                        <div className="flex h-full w-full items-center justify-center bg-muted">
                            <User className="h-10 w-10 text-muted-foreground" />
                        </div>
                    )}

                    {!isLoading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
                            <Camera className="h-5 w-5" />
                            <span className="mt-1 text-[11px]">Change photo</span>
                        </div>
                    )}

                    {isLoading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/55">
                            <Loader2 className="h-6 w-6 animate-spin text-white" />
                            <span className="mt-1.5 text-[10px] text-white">
                                {status === "compressing" ? "Compressing…" : "Uploading…"}
                            </span>
                        </div>
                    )}
                </button>

                <input
                    ref={inputRef}
                    type="file"
                    accept={ACCEPTED}
                    className="hidden"
                    onChange={handleFileChange}
                    disabled={isLoading}
                />

                {error && (
                    <p className="flex items-center gap-1 text-xs text-destructive max-w-[220px] text-center">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        {error}
                    </p>
                )}
            </div>
        );
    },
);

export default ProfilePictureUpload;
