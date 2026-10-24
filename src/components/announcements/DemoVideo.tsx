import { useState } from "react";
import { Copy, MessageCircle, Play, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { getAppUrl } from "@/lib/appConfig";
import { DEMO_VIDEO, demoShareText } from "@/lib/announcements";

/**
 * Share buttons for the quick demo. The message says Atcora is browser-only
 * and gives the app link; the shared link is the public /demo page, whose
 * preview shows a still from the video.
 */
export function DemoShareActions({ className }: { className?: string }) {
  const shareUrl = getAppUrl(DEMO_VIDEO.pagePath);
  const shareText = demoShareText(getAppUrl("/"));
  const fullMessage = `${shareText}\n\nWatch the demo: ${shareUrl}`;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const handleShare = async () => {
    try {
      await navigator.share({ title: DEMO_VIDEO.shareTitle, text: shareText, url: shareUrl });
    } catch (err) {
      if ((err as Error).name !== "AbortError") toast.error("Could not open the share menu");
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullMessage);
      toast.success("Message copied");
    } catch {
      toast.error("Could not copy the message");
    }
  };

  const linkClass = cn("inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline", className);

  if (canShare) {
    return (
      <button type="button" onClick={handleShare} className={linkClass}>
        <Share2 className="size-3.5" />
        Share video
      </button>
    );
  }

  return (
    <>
      <a
        href={`https://wa.me/?text=${encodeURIComponent(fullMessage)}`}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClass}
      >
        <MessageCircle className="size-3.5" />
        Share on WhatsApp
      </a>
      <button type="button" onClick={handleCopy} className={linkClass}>
        <Copy className="size-3.5" />
        Copy message
      </button>
    </>
  );
}

/** The quick demo in a popup, playing as soon as it opens. */
export function DemoVideoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl gap-3 p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Atcora: quick demo</DialogTitle>
          <DialogDescription>
            Duty overview, shift roster, leave and comp-off balance, and license status in 47 seconds.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <video
            className="aspect-video w-full rounded-lg border bg-black"
            src={DEMO_VIDEO.src}
            poster={DEMO_VIDEO.poster}
            controls
            autoPlay
            playsInline
          />
        )}
        <div className="flex flex-wrap items-center gap-3">
          <DemoShareActions className="text-foreground" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The quick demo inside an announcement: a small thumbnail that opens the
 * video in a popup, so the card stays about as tall as a text-only notice and
 * never pushes the BA test alert or Duty Overview down.
 */
export function DemoVideo({ linkClassName }: { linkClassName?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3 flex items-center gap-3">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative w-32 shrink-0 overflow-hidden rounded-md border bg-black sm:w-40"
        aria-label="Play the quick demo video"
      >
        <img src={DEMO_VIDEO.poster} alt="" loading="lazy" className="aspect-video w-full object-cover opacity-90 transition-opacity group-hover:opacity-100" />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-9 items-center justify-center rounded-full bg-white/90 shadow transition-transform group-hover:scale-105">
            <Play className="ml-0.5 size-4 fill-slate-900 text-slate-900" />
          </span>
        </span>
        <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] font-medium text-white">0:47</span>
      </button>
      <div className="flex min-w-0 flex-col items-start gap-1.5">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn("inline-flex items-center gap-1 text-xs font-semibold underline-offset-2 hover:underline", linkClassName)}
        >
          <Play className="size-3.5" />
          Watch demo
        </button>
        <DemoShareActions className={linkClassName} />
      </div>
      <DemoVideoDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
