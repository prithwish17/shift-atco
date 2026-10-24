import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { Loader2, Paperclip, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useR2Upload } from "@/hooks/useR2Upload";
import {
  deleteAnnouncementAttachment,
  useCreateAnnouncement,
  useInvalidateAnnouncements,
  useUpdateAnnouncement,
  type ManagedAnnouncement,
} from "@/hooks/useAnnouncements";
import {
  STORAGE_LIMIT_STATUS,
  formatBytes,
  useInvalidateStorageStatus,
  useUploadsAllowed,
} from "@/hooks/useStorageStatus";
import { StorageLimitDialog } from "@/components/storage/StorageLimitDialog";
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_EXPIRY_PRESETS,
  ANNOUNCEMENT_MAX_DAYS,
  ANNOUNCEMENT_PRIORITY_LABELS,
  ANNOUNCEMENT_TITLE_MAX,
  computeExpiry,
  validateAnnouncementDraft,
  type AnnouncementPriority,
} from "@/lib/announcements";
import { AnnouncementCard } from "./AnnouncementCard";

const ATTACHMENT_ACCEPT = "application/pdf,image/jpeg,image/jpg,image/png,image/webp";
const ATTACHMENT_MIMES = new Set(ATTACHMENT_ACCEPT.split(","));
const ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024;

type ExpiryChoice = `${(typeof ANNOUNCEMENT_EXPIRY_PRESETS)[number]}` | "custom";

interface AnnouncementFormProps {
  userId: string;
  isAdmin: boolean;
  /** The announcement being edited; omit to create a new one. */
  editing?: ManagedAnnouncement | null;
  onDone: () => void;
}

function toLocalInput(date: Date): string {
  return format(date, "yyyy-MM-dd'T'HH:mm");
}

export function AnnouncementForm({ userId, isAdmin, editing, onDone }: AnnouncementFormProps) {
  const createAnnouncement = useCreateAnnouncement();
  const updateAnnouncement = useUpdateAnnouncement();
  const invalidateAnnouncements = useInvalidateAnnouncements();
  const { upload, status: uploadStatus, progress } = useR2Upload<unknown>();
  const attachmentsAllowed = useUploadsAllowed("announcement");
  const invalidateStorageStatus = useInvalidateStorageStatus();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const alreadyStarted = Boolean(editing && new Date(editing.starts_at) <= new Date());

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<AnnouncementPriority>("info");
  const [startMode, setStartMode] = useState<"now" | "later">("now");
  const [startLocal, setStartLocal] = useState(() => toLocalInput(new Date()));
  const [expiryChoice, setExpiryChoice] = useState<ExpiryChoice>("7");
  const [customDate, setCustomDate] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [removeExisting, setRemoveExisting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [limitOpen, setLimitOpen] = useState(false);

  // Load the announcement being edited, or reset for a new one.
  useEffect(() => {
    setError(null);
    setPendingFile(null);
    setRemoveExisting(false);
    if (editing) {
      setTitle(editing.title);
      setBody(editing.body);
      setPriority(editing.priority);
      const started = new Date(editing.starts_at) <= new Date();
      setStartMode(started ? "now" : "later");
      setStartLocal(toLocalInput(new Date(editing.starts_at)));
      setExpiryChoice("custom");
      setCustomDate(format(new Date(editing.expires_at), "yyyy-MM-dd"));
    } else {
      setTitle("");
      setBody("");
      setPriority("info");
      setStartMode("now");
      setStartLocal(toLocalInput(new Date()));
      setExpiryChoice("7");
      setCustomDate("");
    }
  }, [editing]);

  const startsAt = useMemo(() => {
    if (editing && alreadyStarted) return new Date(editing.starts_at);
    if (startMode === "now") return new Date();
    return new Date(startLocal);
  }, [alreadyStarted, editing, startLocal, startMode]);

  const expiresAt = useMemo(() => {
    if (expiryChoice === "custom") return customDate ? computeExpiry(startsAt, { date: customDate }) : new Date(NaN);
    return computeExpiry(startsAt, { days: Number(expiryChoice) });
  }, [customDate, expiryChoice, startsAt]);

  const maxCustomDate = format(
    new Date(startsAt.getTime() + ANNOUNCEMENT_MAX_DAYS * 24 * 60 * 60 * 1000),
    "yyyy-MM-dd",
  );
  const minCustomDate = format(new Date(Math.max(startsAt.getTime(), Date.now())), "yyyy-MM-dd");

  const existingAttachment = editing?.attachment_path && !removeExisting ? editing : null;
  const previewAttachmentName = pendingFile?.name ?? (existingAttachment ? existingAttachment.attachment_meta?.original_name ?? "Attachment" : null);

  const handlePickFile = () => {
    if (!attachmentsAllowed) {
      setLimitOpen(true);
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFileChosen = (file: File | undefined) => {
    if (!file) return;
    if (!ATTACHMENT_MIMES.has(file.type.toLowerCase())) {
      toast.error("Only PDF, JPG, PNG or WebP files can be attached.");
      return;
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      toast.error("The file is too large. The maximum is 4 MB.");
      return;
    }
    setPendingFile(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validateAnnouncementDraft({ title, body, startsAt, expiresAt });
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSaving(true);

    const input = {
      title,
      body,
      priority,
      starts_at: startsAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    };

    try {
      let id: string;
      if (editing) {
        await updateAnnouncement.mutateAsync({ id: editing.id, ...input });
        id = editing.id;
      } else {
        id = await createAnnouncement.mutateAsync({ ...input, created_by: userId });
      }

      if (isAdmin && pendingFile) {
        const result = await upload("/api/storage/announcement-attachment", pendingFile, {
          fields: { announcement_id: id },
        });
        if (!result.ok) {
          if (result.status === STORAGE_LIMIT_STATUS) {
            setLimitOpen(true);
            invalidateStorageStatus();
          }
          toast.error(`Announcement saved, but the attachment was not uploaded: ${result.error ?? "upload failed"}`);
        }
        invalidateStorageStatus();
      } else if (isAdmin && editing?.attachment_path && removeExisting) {
        await deleteAnnouncementAttachment(id);
        invalidateStorageStatus();
      }

      invalidateAnnouncements();
      toast.success(editing ? "Announcement updated" : "Announcement posted");
      onDone();
    } catch (err) {
      setError((err as Error).message || "Could not save the announcement.");
    } finally {
      setSaving(false);
    }
  };

  const busy = saving || uploadStatus === "uploading";

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="announcement-title">Title</Label>
            <CharCount value={title} max={ANNOUNCEMENT_TITLE_MAX} />
          </div>
          <Input
            id="announcement-title"
            value={title}
            maxLength={ANNOUNCEMENT_TITLE_MAX}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Roster for November is published"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="announcement-body">Announcement</Label>
            <CharCount value={body} max={ANNOUNCEMENT_BODY_MAX} />
          </div>
          <Textarea
            id="announcement-body"
            value={body}
            maxLength={ANNOUNCEMENT_BODY_MAX}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            placeholder="Keep it short. Text longer than three lines is collapsed on the dashboard."
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Priority</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as AnnouncementPriority)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ANNOUNCEMENT_PRIORITY_LABELS) as AnnouncementPriority[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {ANNOUNCEMENT_PRIORITY_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">Urgent announcements always show first.</p>
          </div>

          <div className="space-y-1.5">
            <Label>Starts</Label>
            {editing && alreadyStarted ? (
              <p className="flex h-10 items-center text-sm text-muted-foreground">
                Started {format(new Date(editing.starts_at), "d MMM yyyy, HH:mm")}
              </p>
            ) : (
              <div className="space-y-2">
                <Select value={startMode} onValueChange={(v) => setStartMode(v as "now" | "later")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="now">Now</SelectItem>
                    <SelectItem value="later">Schedule for later</SelectItem>
                  </SelectContent>
                </Select>
                {startMode === "later" && (
                  <Input
                    type="datetime-local"
                    value={startLocal}
                    min={toLocalInput(new Date())}
                    onChange={(e) => setStartLocal(e.target.value)}
                  />
                )}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Show for</Label>
          <div className="flex flex-wrap gap-2">
            {ANNOUNCEMENT_EXPIRY_PRESETS.map((days) => (
              <Button
                key={days}
                type="button"
                size="sm"
                variant={expiryChoice === String(days) ? "default" : "outline"}
                onClick={() => setExpiryChoice(String(days) as ExpiryChoice)}
              >
                {days === 1 ? "1 day" : `${days} days`}
              </Button>
            ))}
            <Button
              type="button"
              size="sm"
              variant={expiryChoice === "custom" ? "default" : "outline"}
              onClick={() => setExpiryChoice("custom")}
            >
              Pick a date
            </Button>
          </div>
          {expiryChoice === "custom" && (
            <Input
              type="date"
              className="max-w-[220px]"
              value={customDate}
              min={minCustomDate}
              max={maxCustomDate}
              onChange={(e) => setCustomDate(e.target.value)}
            />
          )}
          <p className="text-[11px] text-muted-foreground">
            {Number.isNaN(expiresAt.getTime())
              ? `Choose a date up to ${ANNOUNCEMENT_MAX_DAYS} days after the start.`
              : `Disappears from the dashboard on ${format(expiresAt, "d MMM yyyy, HH:mm")}.`}
          </p>
        </div>

        {isAdmin && (
          <div className="space-y-1.5">
            <Label>Attachment (optional, admins only)</Label>
            {pendingFile ? (
              <FileChip name={pendingFile.name} size={pendingFile.size} onRemove={() => setPendingFile(null)} />
            ) : existingAttachment ? (
              <FileChip
                name={existingAttachment.attachment_meta?.original_name ?? "Attachment"}
                size={existingAttachment.attachment_meta?.size}
                onRemove={() => setRemoveExisting(true)}
                removeIcon="trash"
              />
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn("gap-1.5", !attachmentsAllowed && "border-amber-300 text-amber-700")}
                onClick={handlePickFile}
              >
                <Paperclip className="size-4" />
                {attachmentsAllowed ? "Attach a file" : "Attachments paused: storage nearly full"}
              </Button>
            )}
            {existingAttachment && !pendingFile && (
              <button
                type="button"
                className="block text-xs text-muted-foreground underline-offset-2 hover:underline"
                onClick={handlePickFile}
              >
                Replace file
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept={ATTACHMENT_ACCEPT}
              className="hidden"
              onChange={(e) => {
                handleFileChosen(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <p className="text-[11px] text-muted-foreground">PDF, JPG, PNG or WebP, up to 4 MB.</p>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
            {uploadStatus === "uploading"
              ? `Uploading ${progress}%`
              : editing
                ? "Save changes"
                : startMode === "later"
                  ? "Schedule announcement"
                  : "Post announcement"}
          </Button>
          {editing && (
            <Button type="button" variant="ghost" onClick={onDone} disabled={busy}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Preview on the employee dashboard</Label>
        <AnnouncementCard
          title={title.trim() || "Your title"}
          body={body.trim() || "Your announcement text appears here."}
          priority={priority}
          expiresAt={Number.isNaN(expiresAt.getTime()) ? new Date(Date.now() + 86_400_000).toISOString() : expiresAt.toISOString()}
          pendingAttachmentName={previewAttachmentName}
        />
      </div>

      <StorageLimitDialog open={limitOpen} onOpenChange={setLimitOpen} scope="announcement" />
    </form>
  );
}

function CharCount({ value, max }: { value: string; max: number }) {
  const length = value.length;
  return (
    <span
      className={cn(
        "text-[11px] tabular-nums text-muted-foreground",
        length >= max * 0.9 && "text-amber-600",
        length >= max && "font-semibold text-destructive",
      )}
    >
      {length}/{max}
    </span>
  );
}

function FileChip({
  name,
  size,
  onRemove,
  removeIcon = "x",
}: {
  name: string;
  size?: number;
  onRemove: () => void;
  removeIcon?: "x" | "trash";
}) {
  return (
    <div className="flex max-w-md items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
      <Paperclip className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        {size ? <p className="text-[11px] text-muted-foreground">{formatBytes(size)}</p> : null}
      </div>
      <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onRemove} aria-label="Remove file">
        {removeIcon === "trash" ? <Trash2 className="size-4 text-destructive" /> : <X className="size-4" />}
      </Button>
    </div>
  );
}
