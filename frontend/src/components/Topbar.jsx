import { useEffect, useRef, useState } from "react";
import { Ico } from "./Ico.jsx";

export function Topbar({
  user,
  onLogout,
  onMenuClick,
  menuOpen = false,
  menuId = "primary-navigation",
  modalMenu = false,
  pageTitle,
  darkMode,
  onToggleDark,
  onOpenNotifications,
  onOpenProfile,
  profileLabel = "Profile",
  onOpenDashboard,
  onReloadApp,
  notificationCount,
  chatUnread,
  onOpenChat,
  systemName,
  showChat = true,
  showNotifications = true,
  showProfile = true,
}) {
  const menuButtonRef = useRef(null);
  const onMenuClickRef = useRef(onMenuClick);
  const wasMenuOpenRef = useRef(menuOpen);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef(null);
  const accountButtonRef = useRef(null);
  const displayName = String(
    user?.name || user?.full_name || user?.email?.split("@")[0] || "Account",
  );
  const accountInitials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const unreadNotifications = Math.max(0, Number(notificationCount) || 0);
  const unreadChats = Math.max(0, Number(chatUnread) || 0);
  const accountMenuId = `${menuId}-account-actions`;

  useEffect(() => {
    onMenuClickRef.current = onMenuClick;
  }, [onMenuClick]);

  useEffect(() => {
    if (menuOpen) setAccountMenuOpen(false);
  }, [menuOpen]);

  useEffect(() => {
    const navigation = document.getElementById(menuId);
    if (!navigation) return undefined;

    if (!menuOpen) {
      navigation.setAttribute("inert", "");
      return undefined;
    }

    navigation.removeAttribute("inert");
    const shouldTrapFocus =
      modalMenu || window.matchMedia("(max-width: 1023px)").matches;
    if (!shouldTrapFocus) return undefined;

    const getFocusableItems = () =>
      Array.from(
        navigation.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0);

    const focusableItems = getFocusableItems();
    const initialFocusTarget =
      focusableItems.find((element) => element.classList.contains("nav-item")) ||
      focusableItems[0];
    initialFocusTarget?.focus();

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onMenuClickRef.current?.();
        menuButtonRef.current?.focus();
        return;
      }

      if (event.key !== "Tab") return;
      const currentFocusableItems = getFocusableItems();
      if (!currentFocusableItems.length) {
        event.preventDefault();
        return;
      }

      const firstItem = currentFocusableItems[0];
      const lastItem = currentFocusableItems[currentFocusableItems.length - 1];
      const focusIsOutsideNavigation = !navigation.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === firstItem || focusIsOutsideNavigation)) {
        event.preventDefault();
        lastItem.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === lastItem || focusIsOutsideNavigation)
      ) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [menuId, menuOpen, modalMenu]);

  useEffect(() => {
    if (wasMenuOpenRef.current && !menuOpen) {
      menuButtonRef.current?.focus();
    }
    wasMenuOpenRef.current = menuOpen;
  }, [menuOpen]);

  useEffect(() => {
    if (!accountMenuOpen) return undefined;
    accountMenuRef.current
      ?.querySelector("button:not([disabled])")
      ?.focus();

    const handlePointerDown = (event) => {
      if (!accountMenuRef.current?.contains(event.target)) {
        setAccountMenuOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setAccountMenuOpen(false);
      accountButtonRef.current?.focus();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [accountMenuOpen]);

  const closeAccountMenu = (action) => {
    setAccountMenuOpen(false);
    accountButtonRef.current?.focus();
    action?.();
  };
  const pageHeading = pageTitle || systemName || "Campus Ghana";
  const secondaryHeading =
    systemName && systemName !== pageHeading ? systemName : "";
  const notificationLabel = unreadNotifications
    ? `Notifications, ${unreadNotifications} unread`
    : "Notifications";
  const runReload = onReloadApp || (() => window.location.reload());

  return (
    <header
      className={`topbar ${menuOpen ? "menu-open" : ""} ${accountMenuOpen ? "account-menu-open" : ""}`}
    >
      <button
        ref={menuButtonRef}
        className="menu-btn"
        type="button"
        onClick={() => {
          setAccountMenuOpen(false);
          onMenuClick?.();
        }}
        aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={menuOpen}
        aria-controls={menuId}
        title={menuOpen ? "Close navigation menu" : "Open navigation menu"}
      >
        <Ico name={menuOpen ? "close" : "menu"} size={21} />
      </button>
      <div className="topbar-left">
        <div className="topbar-title-group">
          <strong className="topbar-page-title">{pageHeading}</strong>
          {secondaryHeading && (
            <span className="topbar-name">{secondaryHeading}</span>
          )}
        </div>
      </div>
      <div className="topbar-right">
        <div className="topbar-actions">
          <button
            className="topbar-btn topbar-app-btn"
            type="button"
            onClick={() => onOpenDashboard?.()}
            aria-label="Go to dashboard"
            title="Go to dashboard"
          >
            <span className="topbar-app-logo">
              <img
                src="https://image2url.com/r2/default/images/1773576400522-25d9d22b-3e79-4a9a-adc2-eae0031fbfe1.png"
                alt=""
              />
            </span>
          </button>
          {showNotifications && (
            <button
              className="topbar-btn"
              type="button"
              onClick={() => onOpenNotifications?.()}
              aria-label={notificationLabel}
              title={notificationLabel}
            >
              <Ico name="bell" size={17} />
              {unreadNotifications > 0 && (
                <span className="notif-badge" aria-hidden="true">
                  {unreadNotifications > 99 ? "99+" : unreadNotifications}
                </span>
              )}
            </button>
          )}
        </div>
        <div
          className="topbar-account"
          ref={accountMenuRef}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setAccountMenuOpen(false);
            }
          }}
        >
          <button
            ref={accountButtonRef}
            className="topbar-account-btn"
            type="button"
            onClick={() => setAccountMenuOpen((open) => !open)}
            aria-label={`Account: ${displayName}`}
            aria-expanded={accountMenuOpen}
            aria-controls={accountMenuId}
            title={`Account: ${displayName}`}
          >
            <span className="topbar-account-avatar" aria-hidden="true">
              {accountInitials}
            </span>
            <span className="topbar-account-name">{displayName}</span>
          </button>
          <div
            id={accountMenuId}
            className="topbar-account-menu"
            role="group"
            aria-label="Account and app actions"
            hidden={!accountMenuOpen}
          >
            <div className="topbar-account-summary">
              <span className="topbar-account-avatar" aria-hidden="true">
                {accountInitials}
              </span>
              <strong>{displayName}</strong>
            </div>
            <div className="topbar-account-actions">
              {showProfile && onOpenProfile && (
                <button
                  type="button"
                  onClick={() => closeAccountMenu(onOpenProfile)}
                >
                  <Ico name="profile" size={18} />
                  <span>{profileLabel}</span>
                </button>
              )}
              {showChat && onOpenChat && (
                <button
                  type="button"
                  onClick={() => closeAccountMenu(onOpenChat)}
                  aria-label={unreadChats ? `Chat, ${unreadChats} unread` : "Chat"}
                >
                  <Ico name="chat" size={18} />
                  <span>Chat</span>
                  {unreadChats > 0 && (
                    <span className="topbar-account-badge" aria-hidden="true">
                      {unreadChats > 99 ? "99+" : unreadChats}
                    </span>
                  )}
                </button>
              )}
              {onToggleDark && (
                <button
                  type="button"
                  onClick={() => closeAccountMenu(onToggleDark)}
                  aria-pressed={Boolean(darkMode)}
                >
                  <Ico name={darkMode ? "sun" : "moon"} size={18} />
                  <span>{darkMode ? "Switch to light mode" : "Switch to dark mode"}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => closeAccountMenu(runReload)}
                title="Unsaved changes may be lost"
              >
                <Ico name="reload" size={18} />
                <span>Reload app</span>
              </button>
              <button
                type="button"
                className="is-sign-out"
                onClick={() => closeAccountMenu(onLogout)}
              >
                <Ico name="logout" size={18} />
                <span>Sign out</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
