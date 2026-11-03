import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";

import { NotificationProvider } from "./components/NotificationSystem.jsx";

const GhanaCampus = lazy(() => import("./App.jsx"));

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((registration) =>
      registration.update()
    ).catch(() => {
      // Ignore registration failures so the app still loads normally.
    });
  });
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <NotificationProvider>
      <Suspense fallback={<div role="status">Loading Campus Ghana...</div>}>
        <GhanaCampus />
      </Suspense>
    </NotificationProvider>
  </StrictMode>
);
