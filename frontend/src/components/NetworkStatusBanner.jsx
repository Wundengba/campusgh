import { useEffect, useState } from "react";
import "./NetworkStatusBanner.css";

export function NetworkStatusBanner() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div className="network-status-banner" role="status" aria-live="polite">
      You're offline. Payments, sign-in, and live updates need an internet connection.
    </div>
  );
}
