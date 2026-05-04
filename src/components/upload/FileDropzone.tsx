import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Upload, FileText, ImageIcon } from "lucide-react";

export interface FileDropzoneProps {
    accept: string;
    onFile: (file: File) => void;
    disabled?: boolean;
    className?: string;
    description?: string;
    /** Soft hint shown to the user; not enforced. */
    maxMb?: number;
    /** Visual variant. `image` shows a thumb preview when available. */
    variant?: "image" | "document";
}

export function FileDropzone({
    accept,
    onFile,
    disabled,
    className,
    description,
    maxMb,
    variant = "document",
}: FileDropzoneProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [isDragging, setIsDragging] = useState(false);

    const trigger = useCallback(() => {
        if (disabled) return;
        inputRef.current?.click();
    }, [disabled]);

    const handleFiles = useCallback(
        (files: FileList | null) => {
            const file = files?.[0];
            if (file) onFile(file);
        },
        [onFile],
    );

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={trigger}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    trigger();
                }
            }}
            onDragOver={(e) => {
                e.preventDefault();
                if (!disabled) setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                if (disabled) return;
                handleFiles(e.dataTransfer.files);
            }}
            className={cn(
                "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border/70 bg-muted/30 p-6 text-center transition",
                "hover:border-primary/60 hover:bg-muted/60 cursor-pointer",
                isDragging && "border-primary bg-primary/5",
                disabled && "cursor-not-allowed opacity-60",
                className,
            )}
        >
            {variant === "image" ? (
                <ImageIcon className="h-6 w-6 text-muted-foreground" />
            ) : (
                <FileText className="h-6 w-6 text-muted-foreground" />
            )}
            <div className="flex items-center gap-1.5 text-sm font-medium">
                <Upload className="h-3.5 w-3.5" />
                <span>Click to upload or drag and drop</span>
            </div>
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
            {typeof maxMb === "number" && (
                <p className="text-[11px] text-muted-foreground/70">Max {maxMb} MB</p>
            )}
            <input
                ref={inputRef}
                type="file"
                accept={accept}
                className="hidden"
                disabled={disabled}
                onChange={(e) => {
                    handleFiles(e.target.files);
                    e.target.value = "";
                }}
            />
        </div>
    );
}

export default FileDropzone;
