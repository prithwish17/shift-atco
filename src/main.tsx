import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

// Register the service worker once so install and push flows can rely on it.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => {
    if (import.meta.env.DEV) {
      console.warn('[PWA] Service worker registration failed:', error);
    }
  });
}
