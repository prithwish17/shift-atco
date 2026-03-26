import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { safeStorage } from "@/lib/safeStorage";
import {
  getNotificationPermissionState,
  isNotificationPermissionSupported,
  isPushSupported,
  subscribeToPush,
} from "@/utils/pushSubscription";

const INSTALL_DISMISSED_KEY = "installDismissed";
const NOTIFICATION_DISMISSED_KEY = "notificationDismissed";
const NOTIFICATION_ENABLED_KEY = "notificationEnabled";
const INSTALL_DELAY_MS = 6000;
const NOTIFICATION_DELAY_MS = 9000;
const AUTH_ROUTES = new Set(["/", "/login", "/register", "/forgot-password", "/setup-admin"]);

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface PWAOnboardingContextValue {
  isInstalled: boolean;
  canInstall: boolean;
  shouldShowInstallBanner: boolean;
  shouldShowNotificationBanner: boolean;
  shouldShowIOSInstallHint: boolean;
  notificationPermission: NotificationPermission | "unsupported";
  isWorking: boolean;
  installApp: () => Promise<void>;
  dismissInstall: () => void;
  enableNotifications: () => Promise<void>;
  dismissNotifications: () => void;
}

const PWAOnboardingContext = createContext<PWAOnboardingContextValue | undefined>(undefined);

function readStoredFlag(key: string): boolean {
  return safeStorage.getItem(key) === "true";
}

function writeStoredFlag(key: string, value: boolean) {
  safeStorage.setItem(key, String(value));
}

function detectInstalledState() {
  if (typeof window === "undefined") return false;

  const standaloneDisplay = window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone = Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);

  return standaloneDisplay || iosStandalone;
}

function detectIOS() {
  if (typeof window === "undefined") return false;

  const ua = window.navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(ua);
}

export function PWAOnboardingProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { toast } = useToast();
  const { user, loading } = useAuth();
  const [isInstalled, setIsInstalled] = useState(detectInstalledState);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installDismissed, setInstallDismissed] = useState(() => readStoredFlag(INSTALL_DISMISSED_KEY));
  const [notificationDismissed, setNotificationDismissed] = useState(() => readStoredFlag(NOTIFICATION_DISMISSED_KEY));
  const [notificationEnabled, setNotificationEnabled] = useState(() => readStoredFlag(NOTIFICATION_ENABLED_KEY));
  const [installDelayElapsed, setInstallDelayElapsed] = useState(false);
  const [notificationDelayElapsed, setNotificationDelayElapsed] = useState(false);
  const [hasMeaningfulAction, setHasMeaningfulAction] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">(
    getNotificationPermissionState()
  );
  const [isWorking, setIsWorking] = useState(false);
  const hasShownInstallLog = useRef(false);
  const hasShownNotificationLog = useRef(false);
  const isIOS = detectIOS();
  const canInstall = !isInstalled && Boolean(deferredPrompt);
  const shouldShowInstallBanner = canInstall && installDelayElapsed && !installDismissed;
  const canAskForNotifications = isPushSupported() && isNotificationPermissionSupported();
  const shouldShowNotificationBanner =
    !shouldShowInstallBanner &&
    canAskForNotifications &&
    notificationDelayElapsed &&
    !notificationDismissed &&
    !notificationEnabled &&
    notificationPermission === "default" &&
    Boolean(user) &&
    (isInstalled || hasMeaningfulAction);
  const shouldShowIOSInstallHint =
    !shouldShowInstallBanner &&
    !isInstalled &&
    !deferredPrompt &&
    isIOS &&
    installDelayElapsed &&
    !installDismissed;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(display-mode: standalone)");

    const syncInstalledState = () => {
      setIsInstalled(detectInstalledState());
    };

    syncInstalledState();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncInstalledState);
      return () => mediaQuery.removeEventListener("change", syncInstalledState);
    }

    mediaQuery.addListener(syncInstalledState);

    return () => mediaQuery.removeListener(syncInstalledState);
  }, []);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      console.info("[PWA] install prompt available");
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      setInstallDismissed(true);
      writeStoredFlag(INSTALL_DISMISSED_KEY, true);
      console.info("[PWA] install accepted");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  useEffect(() => {
    const syncNotificationPermission = () => {
      setNotificationPermission(getNotificationPermissionState());
    };

    syncNotificationPermission();
    window.addEventListener("focus", syncNotificationPermission);
    document.addEventListener("visibilitychange", syncNotificationPermission);

    return () => {
      window.removeEventListener("focus", syncNotificationPermission);
      document.removeEventListener("visibilitychange", syncNotificationPermission);
    };
  }, [isInstalled]);

  useEffect(() => {
    if (loading || user) return;

    setNotificationEnabled(false);
    writeStoredFlag(NOTIFICATION_ENABLED_KEY, false);
  }, [loading, user]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setInstallDelayElapsed(true);
    }, INSTALL_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!loading && user && !AUTH_ROUTES.has(location.pathname)) {
      setHasMeaningfulAction(true);
    }
  }, [loading, location.pathname, user]);

  useEffect(() => {
    if (!(isInstalled || hasMeaningfulAction)) return;

    const timer = window.setTimeout(() => {
      setNotificationDelayElapsed(true);
    }, NOTIFICATION_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [hasMeaningfulAction, isInstalled]);

  useEffect(() => {
    if (shouldShowInstallBanner && !hasShownInstallLog.current) {
      hasShownInstallLog.current = true;
      console.info("[PWA] install banner shown");
    }
  }, [shouldShowInstallBanner]);

  useEffect(() => {
    if (shouldShowNotificationBanner && !hasShownNotificationLog.current) {
      hasShownNotificationLog.current = true;
      console.info("[PWA] notification banner shown");
    }
  }, [shouldShowNotificationBanner]);

  const dismissInstall = () => {
    setInstallDismissed(true);
    writeStoredFlag(INSTALL_DISMISSED_KEY, true);
    console.info("[PWA] install dismissed");
  };

  const dismissNotifications = () => {
    setNotificationDismissed(true);
    writeStoredFlag(NOTIFICATION_DISMISSED_KEY, true);
    console.info("[PWA] notification dismissed");
  };

  const installApp = async () => {
    if (!deferredPrompt) return;

    setIsWorking(true);

    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;

      if (choice.outcome === "accepted") {
        setDeferredPrompt(null);
        setInstallDismissed(true);
        writeStoredFlag(INSTALL_DISMISSED_KEY, true);
        console.info("[PWA] install clicked and accepted");
        return;
      }

      setDeferredPrompt(null);
      setInstallDismissed(true);
      writeStoredFlag(INSTALL_DISMISSED_KEY, true);
      console.info("[PWA] install clicked and dismissed");
    } finally {
      setIsWorking(false);
    }
  };

  const enableNotifications = async () => {
    if (!canAskForNotifications) return;

    setIsWorking(true);

    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);

      if (permission === "denied") {
        setNotificationEnabled(false);
        setNotificationDismissed(true);
        writeStoredFlag(NOTIFICATION_ENABLED_KEY, false);
        writeStoredFlag(NOTIFICATION_DISMISSED_KEY, true);
        console.info("[PWA] notification permission denied");
        return;
      }

      if (permission !== "granted") {
        return;
      }

      const subscription = await subscribeToPush();

      if (!subscription) {
        throw new Error("Push subscription could not be completed.");
      }

      setNotificationEnabled(true);
      setNotificationDismissed(false);
      writeStoredFlag(NOTIFICATION_ENABLED_KEY, true);
      writeStoredFlag(NOTIFICATION_DISMISSED_KEY, false);

      toast({
        title: "Notifications enabled",
        description: "Duty alerts, approvals, and reminders will reach this device.",
      });

      console.info("[PWA] notification permission granted and subscription saved");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Subscription failed";

      toast({
        variant: "destructive",
        title: "Could not enable notifications",
        description: message,
      });
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <PWAOnboardingContext.Provider
      value={{
        isInstalled,
        canInstall,
        shouldShowInstallBanner,
        shouldShowNotificationBanner,
        shouldShowIOSInstallHint,
        notificationPermission,
        isWorking,
        installApp,
        dismissInstall,
        enableNotifications,
        dismissNotifications,
      }}
    >
      {children}
    </PWAOnboardingContext.Provider>
  );
}

export function usePWAOnboarding() {
  const context = useContext(PWAOnboardingContext);

  if (!context) {
    throw new Error("usePWAOnboarding must be used within PWAOnboardingProvider");
  }

  return context;
}