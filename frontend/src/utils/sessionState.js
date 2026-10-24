export const APP_SESSION_KEY = "campus_portal_session";
export const ADMIN_TAB_KEY = "admin_active_tab";
export const STUDENT_TAB_KEY = "student_active_tab";
export const SCHOOL_ADMIN_TAB_KEY = "school_admin_active_tab";

let appSessionMemory = null;

const tabMemory = {
  [ADMIN_TAB_KEY]: "dashboard",
  [STUDENT_TAB_KEY]: "dashboard",
  [SCHOOL_ADMIN_TAB_KEY]: "dashboard",
};

export function getSessionUserEmail() {
  return globalThis.__campus_user_email || "";
}

export function readAppSession() {
  if (appSessionMemory) return appSessionMemory;
  try {
    const raw = sessionStorage.getItem(APP_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.authSource ? parsed : null;
  } catch {
    return null;
  }
}

export function writeAppSession(session) {
  appSessionMemory = session || null;
  try {
    if (session) {
      sessionStorage.setItem(APP_SESSION_KEY, JSON.stringify(session));
    } else {
      sessionStorage.removeItem(APP_SESSION_KEY);
    }
  } catch {}
}

export function readStoredTab(key, fallback) {
  try {
    return sessionStorage.getItem(key) || tabMemory[key] || fallback;
  } catch {
    return tabMemory[key] || fallback;
  }
}

export function writeStoredTab(key, value) {
  tabMemory[key] = value;
  try {
    sessionStorage.setItem(key, value);
  } catch {}
}
