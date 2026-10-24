import { useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, Download, Eye, Info, Loader2, Megaphone, MessageCircle, Paperclip, Share2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fetchAnnouncementAttachmentFile, openAnnouncementAttachment } from "@/hooks/useAnnouncements";
import {
  ANNOUNCEMENT_PRIORITY_LABELS,
  expiryLabel,
  type AnnouncementAttachmentMeta,
  type AnnouncementPriority,
} from "@/lib/announcements";
import { DemoVideo } from "./DemoVideo";

const TONES: Record<
  AnnouncementPriority,
  { wrap: string; bubble: string; icon: string; title: string; body: string; badge: string; Icon: typeof Info }
> = {
  info: {
    wrap: "border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/30",
    bubble: "bg-sky-100 dark:bg-sky-900/50",
    icon: "text-sky-600 dark:text-sky-400",
    title: "text-sky-900 dark:text-sky-100",
    body: "text-sky-800 dark:text-sky-200",
    badge: "bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-300",
    Icon: Info,
  },
  important: {
    wrap: "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20",
    bubble: "bg-amber-100 dark:bg-amber-800/50",
    icon: "text-amber-600 dark:text-amber-400",
    title: "text-amber-900 dark:text-amber-100",
    body: "text-amber-800 dark:text-amber-200",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-800/60 dark:text-amber-200",
    Icon: Megaphone,
  },
  urgent: {
    wrap: "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-900/20",
    bubble: "bg-red-100 dark:bg-red-800/50",
    icon: "text-red-600 dark:text-red-400",
    title: "text-red-900 dark:text-red-100",
    body: "text-red-800 dark:text-red-200",
    badge: "bg-red-100 text-red-700 dark:bg-red-800/60 dark:text-red-200",
    Icon: AlertTriangle,
  },
};

// Whether this browser can hand a file to the system share sheet (WhatsApp,
// Telegram, Mail…). Mobile browsers mostly can; many desktop browsers cannot.
const canShareFiles = (() => {
  try {
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [new File([""], "probe.pdf", { type: "application/pdf" })] })
    );
  } catch {
    return false;
  }
})();

const isShareCancelled = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export interface AnnouncementCardProps {
  /** Missing for an unsaved preview; the attachment link is then inert. */
  id?: string;
  title: string;
  body: string;
  priority: AnnouncementPriority;
  /** Omitted for the built-in demo card, which never expires. */
  expiresAt?: string;
  hasAttachment?: boolean;
  attachmentMeta?: AnnouncementAttachmentMeta | null;
  /** Shown in place of the attachment name, e.g. for a file not yet uploaded. */
  pendingAttachmentName?: string | null;
  /** Show the quick demo video under the text. */
  demoVideo?: boolean;
  /** Shows a × that hides the announcement for this user. */
  onHide?: () => void;
  /** Marks the card as hidden and offers "Show again". */
  onShowAgain?: () => void;
  className?: string;
}

/**
 * One announcement. Text longer than three lines is clamped with a
 * Show more / Show less toggle, so a long notice never pushes the dashboard down.
 */
export function AnnouncementCard({
  id,
  title,
  body,
  priority,
  expiresAt,
  hasAttachment,
  attachmentMeta,
  pendingAttachmentName,
  demoVideo,
  onHide,
  onShowAgain,
  className,
}: AnnouncementCardProps) {
  const tone = TONES[priority];
  const bodyRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const [opening, setOpening] = useState(false);
  const [sharing, setSharing] = useState(false);
  // Fetched when the share menu opens, so the file is usually in hand by the
  // time an item is tapped: navigator.share() must run close to the tap.
  const fileRef = useRef<{ promise: Promise<File>; file?: File } | null>(null);

  // Measure while clamped: the toggle only appears when text is actually cut off.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || expanded) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [body, expanded]);

  const attachmentName =
    pendingAttachmentName ?? attachmentMeta?.original_name ?? (hasAttachment ? "Attachment" : null);

  const handleOpenAttachment = async () => {
    if (!id || opening) return;
    setOpening(true);
    try {
      await openAnnouncementAttachment(id);
    } catch (err) {
      toast.error((err as Error).message || "Could not open the attachment");
    } finally {
      setOpening(false);
    }
  };

  const canShare = Boolean(id && attachmentName && !pendingAttachmentName);

  const loadFile = () => {
    if (!id) return Promise.reject(new Error("Save the announcement first"));
    if (!fileRef.current) {
      const entry: { promise: Promise<File>; file?: File } = {
        promise: fetchAnnouncementAttachmentFile(id, attachmentMeta),
      };
      entry.promise.then(
        (file) => (entry.file = file),
        () => (fileRef.current = null),
      );
      fileRef.current = entry;
    }
    return fileRef.current.promise;
  };

  const shareText = `${title}\n\n${body}`;

  const withFile = async (action: (file: File) => Promise<void> | void) => {
    if (sharing) return;
    setSharing(true);
    try {
      const file = fileRef.current?.file ?? (await loadFile());
      await action(file);
    } catch (err) {
      if (isShareCancelled(err)) return;
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        // The download outlasted the tap; the file is cached now.
        toast.info("Attachment ready. Tap Share again.");
        return;
      }
      toast.error((err as Error).message || "Could not share the attachment");
    } finally {
      setSharing(false);
    }
  };

  const handleShare = () =>
    withFile(async (file) => {
      await navigator.share({ title, text: shareText, files: [file] });
    });

  // No file sharing in this browser: open WhatsApp with the text and hand
  // over the file to attach there.
  const handleWhatsApp = () =>
    withFile((file) => {
      window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, "_blank", "noopener,noreferrer");
      downloadFile(file);
      toast.success("Attachment downloaded", {
        description: "WhatsApp opened with the announcement text. Attach the downloaded file there.",
      });
    });

  const handleDownload = () => withFile(downloadFile);

  return (
    <div className={cn("relative rounded-xl border p-4 md:p-5", tone.wrap, onShowAgain && "opacity-70", className)}>
      {onHide && (
        <button
          type="button"
          onClick={onHide}
          className="absolute right-2.5 top-2.5 flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
          aria-label={`Hide announcement: ${title}`}
          title="Hide after reading"
        >
          <X className="size-4" />
        </button>
      )}
      <div className={cn("flex items-start gap-3", onHide && "pr-7")}>
        <div className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full", tone.bubble)}>
          <tone.Icon className={cn("size-4", tone.icon)} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className={cn("min-w-0 text-sm font-semibold [overflow-wrap:anywhere]", tone.title)}>{title || "Untitled"}</p>
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", tone.badge)}>
              {ANNOUNCEMENT_PRIORITY_LABELS[priority]}
            </span>
            {expiresAt && <span className="text-[11px] text-muted-foreground">{expiryLabel(expiresAt)}</span>}
          </div>

          <p
            ref={bodyRef}
            className={cn(
              "mt-1 whitespace-pre-line break-words text-sm leading-snug",
              tone.body,
              !expanded && "line-clamp-3",
            )}
          >
            {body}
          </p>

          {demoVideo && <DemoVideo linkClassName={tone.title} />}

          <div className="mt-2 flex flex-wrap items-center gap-3">
            {(overflows || expanded) && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className={cn("text-xs font-semibold underline-offset-2 hover:underline", tone.title)}
                aria-expanded={expanded}
              >
                {expanded ? "Show less" : "Show more"}
              </button>
            )}

            {onShowAgain && (
              <button
                type="button"
                onClick={onShowAgain}
                className={cn("inline-flex items-center gap-1 text-xs font-semibold underline-offset-2 hover:underline", tone.title)}
              >
                <Eye className="size-3.5" />
                Hidden · Show again
              </button>
            )}

            {attachmentName && (
              <button
                type="button"
                onClick={handleOpenAttachment}
                disabled={!id || opening}
                className={cn(
                  "inline-flex max-w-full items-center gap-1 text-xs font-medium underline-offset-2 enabled:hover:underline disabled:opacity-70",
                  tone.title,
                )}
              >
                {opening ? <Loader2 className="size-3.5 animate-spin" /> : <Paperclip className="size-3.5 shrink-0" />}
                <span className="truncate">{attachmentName}</span>
              </button>
            )}

            {canShare && (
              <DropdownMenu onOpenChange={(open) => open && void loadFile().catch(() => undefined)}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={sharing}
                    className={cn(
                      "inline-flex items-center gap-1 text-xs font-medium underline-offset-2 enabled:hover:underline disabled:opacity-70",
                      tone.title,
                    )}
                    aria-label={`Share ${attachmentName}`}
                  >
                    {sharing ? <Loader2 className="size-3.5 animate-spin" /> : <Share2 className="size-3.5" />}
                    Share
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {canShareFiles ? (
                    <DropdownMenuItem onSelect={handleShare}>
                      <Share2 className="mr-2 size-4" />
                      Share to WhatsApp & more
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onSelect={handleWhatsApp}>
                      <MessageCircle className="mr-2 size-4" />
                      Send on WhatsApp
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={handleDownload}>
                    <Download className="mr-2 size-4" />
                    Download
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
