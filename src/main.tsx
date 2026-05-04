import { createRoot } from "react-dom/client";
import posthog from "posthog-js";
import { PostHogProvider } from "@posthog/react";
import { initSentry } from "./lib/sentry";
import App from "./App.tsx";
import "./index.css";

// Initialize PostHog manually to ensure accurate domain tracking and env metadata
posthog.init(import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN as string, {
  api_host: (import.meta.env.VITE_PUBLIC_POSTHOG_HOST as string) || "https://us.i.posthog.com",
  capture_pageview: true, // Let posthog-js handle pageviews directly
});

// Register global context for cleaner analytics
posthog.register({
  environment: import.meta.env.MODE,
});

createRoot(document.getElementById("root")!).render(
  <PostHogProvider client={posthog}>
    <App />
  </PostHogProvider>
);

// Load monitoring after the initial paint so the SDK is not part of the boot bundle.
window.setTimeout(() => {
  void initSentry();
}, 1200);

// ──── Service Worker registration + update lifecycle ────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then((reg) => {
      // Check for updates every 60 s so long-lived tabs pick up deploys quickly.
      setInterval(() => reg.update(), 60_000);

      const promptReload = () => {
        // Tell the waiting worker to activate immediately.
        reg.waiting?.postMessage('SKIP_WAITING');
      };

      // If there's already a waiting worker (e.g. another tab triggered the install)
      if (reg.waiting) {
        promptReload();
      }

      // Listen for a new worker finishing install → becomes 'waiting'
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New version ready — activate it right away.
            promptReload();
          }
        });
      });
    })
    .catch((error) => {
      if (import.meta.env.DEV) {
        console.warn('[PWA] Service worker registration failed:', error);
      }
    });

  // When the new SW takes over, reload so the page gets the fresh index.html +
  // new assets.  The guard prevents an infinite loop.
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}
