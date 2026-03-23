import { useState, useRef, forwardRef, useImperativeHandle } from "react";
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/utils/compressImage";
import { cn } from "@/lib/utils";
import { Camera, Loader2, CheckCircle2, AlertCircle, User } from "lucide-react";

const BUCKET = "avatars";

export interface ProfilePictureUploadHandle {
  openFilePicker: () => void;
}

interface ProfilePictureUploadProps {
  employeeId: string;
  currentUrl?: string | null;
  onUpload?: (publicUrl: string) => void;
}

type Status = "idle" | "compressing" | "uploading" | "done" | "error";

const ProfilePictureUpload = forwardRef<ProfilePictureUploadHandle, ProfilePictureUploadProps>(
  function ProfilePictureUpload({ employeeId, currentUrl, onUpload }, ref) {
  const [preview, setPreview] = useState<string | null>(currentUrl || null);
  const [status, setStatus]   = useState<Status>("idle");
  const [error, setError]     = useState<string | null>(null);
  const [savedKB, setSavedKB] = useState<{ original: string; compressed: string; saved: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    openFilePicker: () => inputRef.current?.click(),
  }));

  const isLoading = status === "compressing" || status === "uploading";

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setSavedKB(null);

    try {
      // Step 1: Compress
      setStatus("compressing");
      const compressed = await compressImage(file);

      const originalKB   = (file.size / 1024).toFixed(1);
      const compressedKB = (compressed.size / 1024).toFixed(1);
      const saved        = ((file.size - compressed.size) / 1024).toFixed(1);
      setSavedKB({ original: originalKB, compressed: compressedKB, saved });

      // Show local preview immediately
      setPreview(URL.createObjectURL(compressed));

      // Step 2: Upload to Supabase
      setStatus("uploading");
      const filePath = `${employeeId}/avatar.webp`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(filePath, compressed, {
          contentType: "image/webp",
          upsert: true,
        });

      if (uploadError) throw uploadError;

      // Step 3: Get public URL
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath);

      setStatus("done");
      onUpload?.(data.publicUrl);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Upload failed. Please try again.");
      setStatus("error");
    }

    // Reset input so the same file can be re-selected
    e.target.value = "";
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Avatar ring */}
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
          <img src={preview} alt="Profile" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted">
            <User className="h-10 w-10 text-muted-foreground" />
          </div>
        )}

        {/* Hover overlay */}
        {!isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
            <Camera className="h-5 w-5" />
            <span className="mt-1 text-[11px]">Change photo</span>
          </div>
        )}

        {/* Loading spinner overlay */}
        {isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/55">
            <Loader2 className="h-6 w-6 animate-spin text-white" />
            <span className="mt-1.5 text-[10px] text-white">
              {status === "compressing" ? "Compressing…" : "Uploading…"}
            </span>
          </div>
        )}
      </button>

      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
        disabled={isLoading}
      />

      {/* Error message */}
      {error && (
        <p className="flex items-center gap-1 text-xs text-destructive max-w-[200px] text-center">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
});

export default ProfilePictureUpload;
