import { Copy, MessageCircle, Share2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getAppUrl } from "@/lib/appConfig";
import { DEMO_VIDEO, demoShareText } from "@/lib/announcements";

/**
 * The quick demo video inside an announcement, with a Share button. The
 * message says Atcora is browser-only and gives the app link; the shared link
 * is the public /demo page, whose preview shows a still from the video.
 */
export function DemoVideo({ linkClassName }: { linkClassName?: string }) {
  const shareUrl = getAppUrl(DEMO_VIDEO.pagePath);
  const shareText = demoShareText(getAppUrl("/"));
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
      await navigator.clipboard.writeText(`${shareText}\n\nWatch the demo: ${shareUrl}`);
      toast.success("Message copied");
    } catch {
      toast.error("Could not copy the message");
    }
  };

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(`${shareText}\n\nWatch the demo: ${shareUrl}`)}`;
  const linkClass = cn("inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline", linkClassName);

  return (
    <div className="mt-3 space-y-2">
      <video
        className="aspect-video w-full max-w-xl rounded-lg border bg-black"
        src={DEMO_VIDEO.src}
        poster={DEMO_VIDEO.poster}
        controls
        playsInline
        preload="none"
      />
      <div className="flex flex-wrap items-center gap-3">
        {canShare ? (
          <button type="button" onClick={handleShare} className={linkClass}>
            <Share2 className="size-3.5" />
            Share video
          </button>
        ) : (
          <>
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
              <MessageCircle className="size-3.5" />
              Share on WhatsApp
            </a>
            <button type="button" onClick={handleCopy} className={linkClass}>
              <Copy className="size-3.5" />
              Copy message
            </button>
          </>
        )}
      </div>
    </div>
  );
}
