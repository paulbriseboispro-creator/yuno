import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import "./index.css";

// Register the PWA service worker and force open tabs to reload as soon as a new
// build is deployed. Without this, returning visitors keep running the old
// precached bundle until a manual hard reload — which after the Lovable→Supabase
// migration left users stuck on a stale build whose checkout fetch rejected
// ("Failed to send a request to the Edge Function"). `registerType: 'autoUpdate'`
// (vite.config.ts) makes registerSW auto-reload once the new SW activates.
//
// Long-lived tabs (a club dashboard left open all night) never re-check the SW
// on their own — the browser only checks on navigation. The periodic
// registration.update() below closes that gap: a deploy reaches every open tab
// within ~30 minutes instead of "whenever the user next reloads".
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    setInterval(() => {
      registration.update().catch(() => {});
    }, 30 * 60 * 1000);
  },
});

// Log unhandled errors/rejections without crashing Vite's HMR state
window.addEventListener('error', (event) => {
  console.error('[Global Error]', event.error ?? event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Unhandled Promise Rejection]', event.reason);
});

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <App />
  </HelmetProvider>
);
