import { useState, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Check, Share2, Smartphone, Mail } from "lucide-react";

interface ShareAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SHARE_TEXT = `Hi,

Your Atcora account is ready.

Atcora helps you check shifts, track work schedules, stay updated with ratings and licenses, and manage BA tests—all in one place.

🔹 Login: Your registered Gmail ID
🔹 Password: ShiftPlan@{empid}
🔹 Open app: https://atcora.in

📲 Install App (Recommended):

For Android (Chrome):
• Open the link in Chrome
• Tap menu (⋮) → Add to Home Screen

For iPhone (Safari):
• Open the link in Safari
• Tap Share (⬆) → Add to Home Screen

⚠️ Important: All accounts start with the same password format. Please change your password after first login for privacy.
Go to: Settings → Change Password

Need help? Contact support.`;

const GMAIL_SUBJECT = "Your ATCORA Account is Ready";

const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

export function ShareAppDialog({ open, onOpenChange }: ShareAppDialogProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset copied state and clear timer when dialog closes
  useEffect(() => {
    if (!open) {
      setCopied(false);
      if (timerRef.current) clearTimeout(timerRef.current);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [open]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(SHARE_TEXT);
      setCopied(true);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select text from a temporary textarea
      const ta = document.createElement("textarea");
      ta.value = SHARE_TEXT;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleWhatsApp = () => {
    const encoded = encodeURIComponent(SHARE_TEXT);
    window.open(`https://wa.me/?text=${encoded}`, "_blank", "noopener,noreferrer");
  };

  const handleGmail = () => {
    const subject = encodeURIComponent(GMAIL_SUBJECT);
    const body = encodeURIComponent(SHARE_TEXT);
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&su=${subject}&body=${body}`, "_blank", "noopener,noreferrer");
  };

  const handleNativeShare = async () => {
    try {
      await navigator.share({ title: "Your ATCORA Account is Ready", text: SHARE_TEXT });
    } catch {
      // user cancelled or not supported — fallback silently
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Share2 className="h-4 w-4 text-primary" />
            Share ATCORA
          </DialogTitle>
          <DialogDescription className="sr-only">
            Share the ATCORA app with colleagues via WhatsApp, Gmail, or other apps.
          </DialogDescription>
        </DialogHeader>

        {/* App meta banner */}
        <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
          <img
            src="/logo.png"
            alt="ATCORA"
            className="h-10 w-10 rounded-lg object-cover shrink-0"
          />
          <div>
            <p className="font-semibold text-sm leading-tight">ATCORA</p>
            <p className="text-xs text-muted-foreground leading-snug mt-0.5">
              Shift &amp; duty management for ATCOs
            </p>
            <a
              href="https://atcora.in"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline"
            >
              https://atcora.in
            </a>
          </div>
        </div>

        {/* Share message preview */}
        <div className="rounded-lg border bg-muted/20 p-3 whitespace-pre-wrap font-mono leading-relaxed text-foreground/90 text-xs max-h-48 overflow-y-auto">
          {SHARE_TEXT}
        </div>

        {/* Install hint */}
        <div className="flex items-start gap-2 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 px-3 py-2.5 text-xs text-blue-700 dark:text-blue-300">
          <Smartphone className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Share this message with new employees so they can install the app
            and log in on their first day.
          </span>
        </div>

        {/* Share actions */}
        <div className="space-y-2 pt-1">
          {/* Native share — opens OS share sheet (all installed apps) */}
          {canNativeShare && (
            <Button type="button" className="w-full" onClick={handleNativeShare}>
              <Share2 className="h-4 w-4 mr-2" />
              Share via...
            </Button>
          )}

          {/* WhatsApp + Gmail */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              onClick={handleWhatsApp}
              className="bg-[#25D366] hover:bg-[#1ebe59] text-white"
            >
              <svg className="h-4 w-4 mr-2 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              WhatsApp
            </Button>
            <Button
              type="button"
              onClick={handleGmail}
              variant="outline"
              className="border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/20"
            >
              <Mail className="h-4 w-4 mr-2 shrink-0" />
              Gmail
            </Button>
          </div>

          {/* Copy */}
          <Button type="button" variant="outline" className="w-full" onClick={handleCopy}>
            {copied ? (
              <>
                <Check className="h-4 w-4 mr-2 text-green-600" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="h-4 w-4 mr-2" />
                Copy Message
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
