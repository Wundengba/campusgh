import { Ico } from "./Ico.jsx";

export function Topbar({
  user,
  onLogout,
  onMenuClick,
  darkMode,
  onToggleDark,
  onOpenNotifications,
  onOpenProfile,
  onReloadApp,
  notificationCount,
  chatUnread,
  onOpenChat,
  systemName,
}) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="menu-btn" onClick={onMenuClick}><Ico name="menu" size={22} color="#fff" /></button>
        <span className="topbar-name" style={{ display: "none" }}>{systemName}</span>
      </div>
      <div className="topbar-right">
        <div className="topbar-actions">
          <button className="topbar-btn desktop-only-action" onClick={onOpenChat} title="Chat">
            <Ico name="chat" size={17} color="#fff" />
            {chatUnread > 0 && <span className="notif-badge">{chatUnread}</span>}
          </button>
          <button className="topbar-btn topbar-app-btn" onClick={onReloadApp} title="Reload app">
            <span className="topbar-app-logo"><img src="https://image2url.com/r2/default/images/1773576400522-25d9d22b-3e79-4a9a-adc2-eae0031fbfe1.png" alt="Campus Ghana" /></span>
          </button>
          <button className="topbar-btn desktop-only-action bell-mobile-visible" onClick={onOpenNotifications} title="Notifications">
            <Ico name="bell" size={17} color="#fff" />
            {notificationCount > 0 && <span className="notif-badge">{notificationCount}</span>}
          </button>
          <button className="topbar-btn" onClick={onToggleDark} title={darkMode ? "Light Mode" : "Dark Mode"}>
            <Ico name={darkMode ? "sun" : "moon"} size={17} color="#fff" />
          </button>
          <button className="topbar-btn" onClick={onOpenProfile} title="Profile">
            <Ico name="profile" size={17} color="#fff" />
          </button>
          <button className="topbar-btn" onClick={onLogout} title="Logout"><Ico name="logout" size={17} color="#fff" /></button>
        </div>
      </div>
    </header>
  );
}
