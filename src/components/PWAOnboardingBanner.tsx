import { Download, Share2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePWAOnboarding } from "@/contexts/PWAOnboardingContext";
import { NotificationPrompt } from "@/components/NotificationPrompt";

export function PWAOnboardingBanner() {
  const {
    isWorking,
    shouldShowInstallBanner,
    shouldShowIOSInstallHint,
    shouldShowNotificationBanner,
    notificationPermission,
    notificationStatus,
    installApp,
    dismissInstall,
    enableNotifications,
    dismissNotifications,
  } = usePWAOnboarding();

  const showInstallUI = shouldShowInstallBanner || shouldShowIOSInstallHint;

  return (
    <>
      {/* ── Install banner (unchanged bottom card) ── */}
      {showInstallUI && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
          <div className="pointer-events-auto w-full max-w-lg rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-2xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200">
                {shouldShowInstallBanner ? <Download /> : <Share2 />}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                      {shouldShowInstallBanner ? "Install Atcora" : "Install on iPhone"}
                    </h3>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                      {shouldShowInstallBanner
                        ? "Install the app for faster access, offline support, and a full-screen experience."
                        : "Open Share and choose Add to Home Screen to install Atcora on iPhone."}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={dismissInstall}
                    className="rounded-lg p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    aria-label="Dismiss install prompt"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {shouldShowInstallBanner ? (
                    <>
                      <Button onClick={installApp} disabled={isWorking}>
                        Install app
                      </Button>
                      <Button type="button" variant="ghost" onClick={dismissInstall} disabled={isWorking}>
                        Not now
                      </Button>
                    </>
                  ) : (
                    <Button type="button" variant="ghost" onClick={dismissInstall}>
                      Dismiss
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Notification soft-ask bottom sheet ── */}
      <NotificationPrompt
        open={shouldShowNotificationBanner}
        permission={notificationPermission}
        status={notificationStatus}
        onEnable={enableNotifications}
        onDismiss={dismissNotifications}
      />
    </>
  );
}