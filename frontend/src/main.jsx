import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import GhanaCampus from "./App.jsx";
import { NotificationProvider } from "./components/NotificationSystem.jsx";

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Ignore registration failures so the app still loads normally.
    });
  });
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <NotificationProvider>
      <GhanaCampus />
    </NotificationProvider>
  </StrictMode>
);
