import { useState, useEffect, useCallback, useContext, createContext } from "react";

// Notification context for global access
export const NotificationContext = createContext();

export function NotificationProvider({ children }) {
  const [notifications, setNotifications] = useState([]);

  // Add a notification
  const notify = useCallback((message, type = "info", duration = 5000) => {
    const id = Date.now() + Math.random();
    setNotifications((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, duration);
  }, []);

  return (
    <NotificationContext.Provider value={{ notify }}>
      {children}
      <div className="notification-container" style={{ position: "fixed", top: 16, right: 16, zIndex: 9999 }}>
        {notifications.map((n) => (
          <div key={n.id} className={`notification notification-${n.type}`} style={{
            background: n.type === "error" ? "#fee2e2" : n.type === "success" ? "#d1fae5" : "#e0e7ef",
            color: n.type === "error" ? "#b91c1c" : n.type === "success" ? "#065f46" : "#334155",
            border: "1px solid #cbd5e1", borderRadius: 8, padding: "12px 20px", marginBottom: 8, minWidth: 220, boxShadow: "0 2px 8px #0002"
          }}>
            {n.message}
          </div>
        ))}
      </div>
    </NotificationContext.Provider>
  );
}

// Usage: const { notify } = useContext(NotificationContext); notify("Message", "success");
