import { BellRing, Download, Share2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePWAOnboarding } from "@/contexts/PWAOnboardingContext";

export function PWAOnboardingBanner() {
  const {
    isWorking,
    shouldShowInstallBanner,
    shouldShowIOSInstallHint,
    shouldShowNotificationBanner,
    installApp,
    dismissInstall,
    enableNotifications,
    dismissNotifications,
  } = usePWAOnboarding();

  const isVisible =
    shouldShowInstallBanner || shouldShowNotificationBanner || shouldShowIOSInstallHint;

  if (!isVisible) {
    return null;
  }

  const title = shouldShowInstallBanner
    ? "Install ATCORA"
    : shouldShowNotificationBanner
      ? "Enable notifications"
      : "Install on iPhone";

  const description = shouldShowInstallBanner
    ? "Install the app for faster access, offline support, and a full-screen experience."
    : shouldShowNotificationBanner
      ? "Enable notifications for duty alerts, approvals, and updates."
      : "Open Share and choose Add to Home Screen to install ATCORA on iPhone.";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-lg rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-2xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200">
            {shouldShowInstallBanner ? <Download /> : shouldShowNotificationBanner ? <BellRing /> : <Share2 />}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">{title}</h3>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{description}</p>
              </div>

              <button
                type="button"
                onClick={shouldShowNotificationBanner ? dismissNotifications : dismissInstall}
                className="rounded-lg p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                aria-label="Dismiss onboarding prompt"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {shouldShowInstallBanner && (
                <>
                  <Button onClick={installApp} disabled={isWorking}>
                    Install app
                  </Button>
                  <Button type="button" variant="ghost" onClick={dismissInstall} disabled={isWorking}>
                    Not now
                  </Button>
                </>
              )}

              {shouldShowNotificationBanner && (
                <>
                  <Button onClick={enableNotifications} disabled={isWorking}>
                    Enable notifications
                  </Button>
                  <Button type="button" variant="ghost" onClick={dismissNotifications} disabled={isWorking}>
                    Maybe later
                  </Button>
                </>
              )}

              {shouldShowIOSInstallHint && (
                <Button type="button" variant="ghost" onClick={dismissInstall}>
                  Dismiss
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}