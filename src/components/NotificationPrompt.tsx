import { BellRing, ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { PushStatus } from "@/hooks/usePushNotifications";

interface NotificationPromptProps {
  /** Whether the sheet is open */
  open: boolean;
  /** Current permission state */
  permission: NotificationPermission | "unsupported";
  /** Whether a subscribe/unsubscribe operation is in progress */
  status: PushStatus;
  /** Called when user clicks "Enable Notifications" */
  onEnable: () => void;
  /** Called when user clicks "Not Now" or closes the sheet */
  onDismiss: () => void;
}

/**
 * A bottom-sheet soft-ask prompt that appears before the browser's native
 * permission dialog.  Shows a "blocked" hint when permission === "denied".
 */
export function NotificationPrompt({
  open,
  permission,
  status,
  onEnable,
  onDismiss,
}: NotificationPromptProps) {
  const isBlocked = permission === "denied";
  const isBusy = status === "subscribing";

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onDismiss()}>
      <SheetContent side="bottom" className="rounded-t-2xl px-6 pb-8 pt-4">
        {/* Drag handle */}
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-600" />

        {isBlocked ? (
          /* ── Blocked state ── */
          <div className="flex flex-col items-center text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400">
              <ShieldAlert className="h-7 w-7" />
            </div>

            <SheetHeader className="mt-4">
              <SheetTitle className="text-lg">Notifications Blocked</SheetTitle>
              <SheetDescription className="mt-1 text-sm leading-relaxed">
                Notifications are blocked for this site. You can enable them
                anytime in your browser&apos;s site settings.
              </SheetDescription>
            </SheetHeader>

            <Button
              variant="outline"
              className="mt-6 w-full max-w-xs"
              onClick={onDismiss}
            >
              Got it
            </Button>
          </div>
        ) : (
          /* ── Default / soft-ask state ── */
          <div className="flex flex-col items-center text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200">
              <BellRing className="h-7 w-7" />
            </div>

            <SheetHeader className="mt-4">
              <SheetTitle className="text-lg">Enable Notifications</SheetTitle>
              <SheetDescription className="mt-1 text-sm leading-relaxed">
                Get real-time updates for duty changes, approvals, and critical
                alerts.
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 flex w-full max-w-xs flex-col gap-2">
              <Button onClick={onEnable} disabled={isBusy} className="w-full">
                {isBusy ? "Enabling…" : "Enable Notifications"}
              </Button>
              <Button
                variant="ghost"
                onClick={onDismiss}
                disabled={isBusy}
                className="w-full"
              >
                Not Now
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
