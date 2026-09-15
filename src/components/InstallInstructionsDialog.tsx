import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Download, MoreVertical, Share } from "lucide-react";

interface InstallInstructionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Platform = "ios" | "android" | "desktop";

function detectPlatform(): Platform {
  if (typeof window === "undefined") return "desktop";

  const ua = window.navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  return "desktop";
}

const STEPS: Record<Platform, { browser: string; icon: typeof Share; steps: string[] }> = {
  ios: {
    browser: "Safari",
    icon: Share,
    steps: [
      "Tap the Share button at the bottom of Safari.",
      "Scroll down and tap \"Add to Home Screen\".",
      "Tap \"Add\" in the top-right corner.",
    ],
  },
  android: {
    browser: "Chrome",
    icon: MoreVertical,
    steps: [
      "Tap the menu (three dots) in the top-right of Chrome.",
      "Tap \"Add to Home screen\" or \"Install app\".",
      "Confirm by tapping \"Install\".",
    ],
  },
  desktop: {
    browser: "your browser",
    icon: Download,
    steps: [
      "Look for the install icon at the right of the address bar.",
      "If it isn't there, open the browser menu and choose \"Install Atcora\".",
      "Confirm by clicking \"Install\".",
    ],
  },
};

export function InstallInstructionsDialog({ open, onOpenChange }: InstallInstructionsDialogProps) {
  const platform = detectPlatform();
  const { browser, icon: PlatformIcon, steps } = STEPS[platform];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Download className="h-4 w-4 text-primary" />
            Install Atcora
          </DialogTitle>
          <DialogDescription>
            Add Atcora to your home screen for faster access, offline support, and a full-screen
            experience.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <PlatformIcon className="h-3.5 w-3.5 shrink-0" />
          <span>Open this page in {browser}, then follow the steps below.</span>
        </div>

        <ol className="space-y-3">
          {steps.map((step, index) => (
            <li key={step} className="flex gap-3 text-sm">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {index + 1}
              </span>
              <span className="pt-0.5 text-foreground/90">{step}</span>
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}
