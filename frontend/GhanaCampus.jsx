import { lazy, Suspense, useState, useEffect, useCallback, useContext, useMemo, useRef } from "react";
import { supabase } from "./src/lib/supabaseClient.js";
import { extractDocumentText, getDocumentTitle } from "./src/utils/documentImport.js";
import { Ico } from "./src/components/Ico.jsx";
import { Topbar } from "./src/components/Topbar.jsx";
import { SettingsContext } from "./src/context/SettingsContext.js";
import { useIsMobileLayout } from "./src/hooks/useIsMobileLayout.js";
import { useStudentPortalRecords } from "./src/hooks/useStudentPortalRecords.js";
import {
  DEFAULT_SETTINGS,
  calculateSubjectAggregate,
  getGrade,
  getStudentNavVisibility,
} from "./src/config/campusConfig.js";
import {
  getLearningLevelName,
  getLearningResourceLabel,
  isLearningLevel,
  LEARNING_LEVELS,
  LEARNING_RESOURCE_TYPES,
  LEARNING_SUBJECTS,
} from "./src/config/learningCatalog.js";
import {
  ANNOUNCEMENTS,
  ATTENDANCE_DATA,
  EVENTS_DATA,
  FINANCE_DATA,
  GHANA_REGIONS,
  SCHOOLS_DATA,
  SCORES_DATA,
  STUDENTS_DATA,
  SUBJECTS,
  TEACHERS_DATA,
} from "./src/data/demoData.js";
import {
  buildRecentActivity,
  fetchStudentSelection,
  hasRealTableError,
  isMissingColumnError,
  isMissingTableError,
  isProfilesTableMissingError,
  normalizeEventRow,
  normalizeFeeRow,
  normalizeResultRow,
  normalizeSchoolRow,
  normalizeScoreRow,
  normalizeSelectionList,
  normalizeTeacherRow,
  resolveStudentPhotoUrl,
  sortRecordsByStudentIndex,
  sortSchoolsByCategory,
  sortStudentsByIndex,
  sortTableRowsForDisplay,
  summarizeSelectionRecord,
} from "./src/utils/campusData.js";
import {
  ADMIN_TAB_KEY,
  SCHOOL_ADMIN_TAB_KEY,
  STUDENT_TAB_KEY,
  getSessionUserEmail,
  readAppSession,
  readStoredTab,
  writeAppSession,
  writeStoredTab,
} from "./src/utils/sessionState.js";

import { NotificationContext } from "./src/components/NotificationSystem.jsx";
import { GHANA_DISTRICTS } from "./src/data/ghanaDistricts.js";
import { resizeStudentPhoto } from "./src/utils/studentPhoto.js";
import {
  markProfilesTableUnavailable,
  profilesTableAvailable,
} from "./src/utils/profileTableState.js";

const Landing = lazy(() =>
  import("./src/components/Landing.jsx").then((module) => ({
    default: module.Landing,
  })),
);
const AcademicScores = lazy(() => import("./src/components/AcademicScores.jsx"));

// List of tables to subscribe for realtime notifications
const REALTIME_TABLES = [
  "events",
  "school_selections",
  "students",
  "teachers",
  "fees",
  "profiles",
  "users",
  "schools",
  "attendance",
];

function getEventMessage(table, eventType, payload) {
  switch (table) {
    case "events":
      return `Event ${eventType}: ${payload?.title || payload?.name || "Untitled"}`;
    case "school_selections":
      return `School selection ${eventType}`;
    case "students":
      return `Student ${eventType}: ${payload?.full_name || payload?.name || payload?.index_number || ""}`;
    case "teachers":
      return `Teacher ${eventType}: ${payload?.name || payload?.email || ""}`;
    case "fees":
      return `Fee record ${eventType}`;
    case "profiles":
      return `Profile ${eventType}`;
    case "users":
      return `User ${eventType}: ${payload?.email || ""}`;
    case "schools":
      return `School ${eventType}: ${payload?.name || ""}`;
    case "attendance":
      return `Attendance ${eventType}`;
    default:
      return `${table} ${eventType}`;
  }
}

const isUuidLikeValue = (value) => {
  const text = String(value ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text);
};
const isPreviewStudentUser = (value) => {
  const text = String(value ?? "").trim();
  return (
    !text ||
    text === "demo-student" ||
    text === "preview-student" ||
    text.startsWith("preview-") ||
    text.startsWith("local-") ||
    !isUuidLikeValue(text)
  );
};
const normalizeRoleKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
const normalizeSchoolIdentity = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();
const isSchoolScopedAccount = (record) =>
  !!(
    record &&
    (record.registered_school_id != null ||
      String(record.managed_school_name || "").trim())
  );
const resolvePortalFromAccount = (record, fallback = "student") => {
  if (isSchoolScopedAccount(record)) return "school-admin";
  const roleKey = normalizeRoleKey(record?.role || fallback);
  return roleKey === "student" ? "student" : "admin";
};

const BASE_ROLE_CATALOG = [
  {
    key: "admin",
    label: "Admin",
    color: "#1d4ed8",
    note: "Full platform control",
  },
  {
    key: "school_admin",
    label: "School Admin",
    color: "#7c3aed",
    note: "School-scoped operations",
  },
  {
    key: "teacher",
    label: "Teacher",
    color: "#d97706",
    note: "Academic records and attendance",
  },
  {
    key: "staff",
    label: "Staff",
    color: "#475569",
    note: "Support and office workflows",
  },
  {
    key: "student",
    label: "Student",
    color: "#dc2626",
    note: "Self-service access only",
  },
];

const DEFAULT_ROLE_MANAGE_FLAGS = {
  admin: true,
  school_admin: false,
  teacher: false,
  staff: false,
  student: false,
};

const buildRoleCatalog = (cfg = null) => {
  const roleMetaOverrides = cfg?.roleMetaOverrides || {};
  const customRoles = Array.isArray(cfg?.roleDefinitions)
    ? cfg.roleDefinitions
    : [];
  return [
    ...BASE_ROLE_CATALOG.map((role) => ({
      ...role,
      ...(roleMetaOverrides?.[role.key] || {}),
    })),
    ...customRoles,
  ];
};

const canManageRoles = (cfg = null, roleKey = "") => {
  const normalizedRoleKey = normalizeRoleKey(roleKey);
  const storedValue =
    cfg?.rolePrivileges?.[normalizedRoleKey]?.["roles.manage"];
  if (typeof storedValue === "boolean") return storedValue;
  return !!DEFAULT_ROLE_MANAGE_FLAGS[normalizedRoleKey];
};

const getAssignableRoles = (cfg = null, actorRole = "", scope = "teacher") => {
  const allRoles = buildRoleCatalog(cfg);
  if (canManageRoles(cfg, normalizeRoleKey(actorRole))) return allRoles;
  const allowedKeys =
    scope === "school-admin" ? ["school_admin"] : ["teacher", "staff"];
  const filteredRoles = allRoles.filter((role) =>
    allowedKeys.includes(role.key),
  );
  return filteredRoles.length ? filteredRoles : allRoles;
};

const getRoleMeta = (cfg = null, roleKey = "") => {
  const normalizedRoleKey = normalizeRoleKey(roleKey);
  const catalogRole = buildRoleCatalog(cfg).find(
    (role) => role.key === normalizedRoleKey,
  );
  if (catalogRole) return catalogRole;
  return {
    key: normalizedRoleKey,
    label: String(normalizedRoleKey || "user")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase()),
    color: "#475569",
    note: "",
  };
};

// STYLES
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&display=swap');
  :root {
    --primary: #1a56db; --primary-d: #1e3a8a; --primary-l: #dbeafe;
    --accent: #0891b2; --success: #16a34a; --warning: #d97706; --danger: #dc2626;
    --bg: #dfeaf8; --surface: #fff; --border: #e2e8f0;
    --text: #0f172a; --text2: #475569; --text3: #94a3b8;
    --sidebar-w: 252px; --topbar-h: 66px;
    --font: 'Sora', sans-serif;
    --radius: 12px;
    --shadow: 0 2px 8px rgba(0,0,0,.07), 0 4px 16px rgba(26,86,219,.07);
  }
  body.dark-mode {
    --bg: #0b1220;
    --surface: #0f172a;
    --border: #23324a;
    --text: #e2e8f0;
    --text2: #cbd5e1;
    --text3: #94a3b8;
    --shadow: 0 10px 30px rgba(2,6,23,.45);
  }
  * { box-sizing: border-box; margin:0; padding:0; }
  body {
    width: 100%;
    min-width: 320px;
    font-family: var(--font);
    background:
      radial-gradient(circle at 18% 10%, rgba(255,255,255,.95), rgba(255,255,255,0) 18%),
      radial-gradient(circle at 80% 12%, rgba(255,255,255,.7), rgba(255,255,255,0) 18%),
      linear-gradient(180deg, #dfeeff 0%, #dfeaf8 48%, #deebf9 100%);
    color: var(--text);
    overflow-x:hidden;
    -webkit-text-size-adjust:100%;
  }
  #root {
    width: 100%;
    min-width: 0;
  }
  .app.admin-app.student-app {
    width: 100%;
    max-width: none;
    margin: 0;
    padding: 12px;
    border-radius: 28px;
    background: rgba(255,255,255,.22);
    box-shadow: 0 18px 40px rgba(30,64,175,.12);
    border: 1px solid rgba(255,255,255,.45);
  }
  .shell {
    display:flex;
    min-height: calc(100vh - 56px);
    border-radius: 22px;
    background: rgba(255,255,255,.12);
    overflow:hidden;
  }
  img { max-width:100%; height:auto; }
  input, select, textarea, button { font-family: var(--font); }

  .app {
    display:flex;
    flex-direction:column;
    height:100vh;
    height:100dvh;
    min-height:0;
    overflow:hidden;
  }

  /* LANDING */
  .landing { height:100vh; height:100dvh; min-height:0; display:flex; align-items:center; justify-content:center;
    position:relative; overflow:hidden; isolation:isolate; padding:28px 20px; perspective:1200px;
    background:
        radial-gradient(circle at 8% 12%, rgba(146,184,255,.68) 0 88px, rgba(255,255,255,.88) 90px 96px, rgba(191,211,255,.52) 100px, transparent 112px),
        radial-gradient(circle at 98% 34%, rgba(182,204,255,.52) 0 48px, rgba(255,255,255,.9) 50px 55px, rgba(201,216,255,.48) 59px, transparent 69px),
        radial-gradient(circle at 4% 91%, rgba(153,190,255,.58) 0 88px, rgba(255,255,255,.88) 90px 96px, rgba(191,211,255,.5) 100px, transparent 112px),
      linear-gradient(145deg,#edf2ff 0%,#e4ebff 48%,#f5f6ff 100%); }
  .landing.landing-signup { position:fixed; inset:0; width:100%; height:100vh; height:100dvh;
    min-height:0; padding:max(12px,env(safe-area-inset-top)) max(12px,env(safe-area-inset-right))
      max(12px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left)); overflow:hidden; }
  .landing::before, .landing::after { content:""; position:absolute; z-index:-1; width:180px; height:180px; border-radius:50%;
    background:radial-gradient(circle at 32% 26%,#fff 0%,rgba(255,255,255,.78) 12%,rgba(211,226,255,.54) 54%,rgba(161,189,249,.3) 68%,rgba(255,255,255,.78) 73%,rgba(194,212,255,.22) 80%,transparent 83%);
    box-shadow:inset 8px 8px 18px rgba(255,255,255,.72),inset -8px -10px 24px rgba(108,142,211,.12),0 20px 42px rgba(108,142,211,.13);
    animation:landing-orb-float 9s ease-in-out infinite alternate; }
  .landing::before { top:13%; right:-118px; }
  .landing::after { bottom:7%; left:-126px; animation-delay:-4s; }
  .landing-box { position:relative; width:100%; max-width:420px; padding:27px 24px 21px; text-align:center;
    border:1px solid rgba(255,255,255,.7); border-radius:30px;
    background:linear-gradient(145deg,rgba(255,255,255,.42),rgba(240,244,255,.2));
    box-shadow:14px 18px 38px rgba(86,111,168,.12),-10px -10px 28px rgba(255,255,255,.6),inset 1px 1px 0 rgba(255,255,255,.82);
    transform:rotateX(1deg); transform-style:preserve-3d; backdrop-filter:blur(7px); }
  .landing .brand-mark { width:100%; margin:0 auto; display:flex; align-items:center; justify-content:center; }
  .landing-logo { width:112px; height:112px; border-radius:50%; margin:0 auto 14px; padding:8px; overflow:hidden;
    background:linear-gradient(145deg,rgba(255,255,255,.98),rgba(225,234,255,.85)); border:1px solid rgba(255,255,255,.98);
    box-shadow:8px 10px 23px rgba(73,107,178,.2),-6px -6px 16px rgba(255,255,255,.88),inset 1px 1px 4px rgba(255,255,255,.95);
    transform:translateZ(28px); }
  .landing-logo img { width:100%; height:100%; object-fit:contain; border-radius:50%; transform:scale(1.28); }
  .landing-title { font-size:1.75rem; font-weight:800; color:#15213d; margin-bottom:4px; letter-spacing:-.035em; transform:translateZ(18px); text-shadow:0 1px 0 rgba(255,255,255,.8); }
  .landing-sub { color:#66738e; margin-bottom:20px; font-size:.82rem; line-height:1.45; }
  .login-portal-switch { display:flex; gap:5px; padding:4px; margin:0 2px 14px; border-radius:18px;
    background:linear-gradient(145deg,rgba(209,220,246,.56),rgba(255,255,255,.66)); border:1px solid rgba(255,255,255,.86);
    box-shadow:inset 3px 3px 8px rgba(94,117,166,.1),inset -3px -3px 8px rgba(255,255,255,.88),0 5px 12px rgba(93,117,169,.08);
    transform:translateZ(12px); }
  .login-portal-option { flex:1; min-height:38px; display:flex; align-items:center; justify-content:center; gap:7px;
    border:0; border-radius:14px; background:transparent; color:#65728c; cursor:pointer; font-size:.78rem; font-weight:700;
    transition:background .18s ease,color .18s ease,box-shadow .18s ease; }
  .login-portal-option.active { background:linear-gradient(145deg,#fff,#edf3ff); color:#2251ba; box-shadow:3px 4px 9px rgba(80,109,173,.16),-2px -2px 5px rgba(255,255,255,.95); }
  .login-portal-option:focus-visible, .landing .btn-primary:focus-visible, .auth-pwd-toggle:focus-visible {
    outline:3px solid rgba(37,99,235,.35); outline-offset:2px; }
  .landing-install-wrap { display:grid; gap:8px; margin:0 0 16px; transform:translateZ(18px); }
  .landing-install-btn {
    width:100%; border:none; border-radius:16px; padding:14px 16px; cursor:pointer;
    display:flex; align-items:center; gap:12px; text-align:left;
    background:linear-gradient(135deg,#0f766e 0%,#1d4ed8 100%); color:#fff;
    box-shadow:0 16px 30px rgba(29,78,216,.18); transition:transform .18s ease, box-shadow .18s ease, opacity .18s ease;
  }
  .landing-install-btn:hover { transform:translateY(-1px); box-shadow:0 18px 34px rgba(29,78,216,.24); }
  .landing-install-btn:disabled { cursor:wait; opacity:.82; }
  .landing-install-icon {
    width:40px; height:40px; border-radius:12px; flex-shrink:0; display:flex; align-items:center; justify-content:center;
    background:rgba(255,255,255,.18); border:1px solid rgba(255,255,255,.22);
  }
  .landing-install-btn strong { display:block; font-size:.95rem; font-weight:800; }
  .landing-install-btn small { display:block; margin-top:2px; font-size:.76rem; line-height:1.45; color:rgba(255,255,255,.86); }
  .landing-install-help {
    padding:11px 12px; border-radius:14px; background:#f8fafc; border:1px solid #dbeafe; color:#475569; font-size:.78rem; line-height:1.5;
  }
  .feature-preview {
    margin-top:18px; padding:14px 12px 12px; border:1px solid rgba(196,212,255,0.9); border-radius:18px;
    background:linear-gradient(180deg, rgba(255,255,255,0.7), rgba(238,244,255,0.88)); box-shadow:0 14px 28px rgba(37,99,235,.06);
  }
  .feature-preview-header {
    display:flex; align-items:center; gap:8px; margin-bottom:10px; font-weight:700; color:#1e3a8a;
  }
  .feature-preview-badge {
    display:inline-flex; align-items:center; justify-content:center; padding:4px 8px; border-radius:999px; background:#dbeafe; color:#1d4ed8; font-size:.66rem; letter-spacing:.08em; text-transform:uppercase; }
  .feature-preview-title { font-size:.72rem; letter-spacing:.08em; text-transform:uppercase; }
  .feature-grid {
    display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px;
  }
  .feature-card {
    display:grid; gap:5px; padding:12px 10px; border-radius:14px; background:rgba(255,255,255,0.68); border:1px solid rgba(203,213,225,0.9); color:#1f2d3d; text-align:left;
  }
  .feature-card strong {
    font-size:.8rem; font-weight:800; color:#17263f;
  }
  .feature-card small {
    display:block; color:#53627d; font-size:.68rem; line-height:1.45;
  }
  .feature-icon {
    display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; border-radius:10px; background:#dbeafe; font-size:1rem; box-shadow:inset 0 0 0 1px rgba(147,197,253,.75);
  }
  .portal-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:8px; }
  .portal-btn { padding:16px 14px; border-radius:14px; border:2px solid #e2e8f0; background:#f8fafc;
    cursor:pointer; transition:all .2s; text-align:center; display:flex; flex-direction:column; align-items:center; justify-content:center; }
  .portal-btn:hover { border-color:var(--primary); background:var(--primary-l); transform:translateY(-2px); }
  .portal-btn-icon { font-size:1.45rem; margin-bottom:6px; }
  .portal-btn-label { font-weight:700; color:#0f172a; font-size:.95rem; text-align:center; }
  .portal-btn-sub { font-size:.78rem; color:#64748b; text-align:center; }

  .modal-backdrop { position:fixed; inset:0; background:rgba(15,23,42,.52); display:flex; align-items:center; justify-content:center; padding:20px; z-index:1200; }
  .modal-card { width:min(640px, 100%); max-height:85vh; overflow:auto; background:#fff; border-radius:20px; box-shadow:0 24px 80px rgba(15,23,42,.28); padding:24px; }
  .modal-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:18px; }
  .modal-title { font-size:1.2rem; font-weight:800; color:#0f172a; }
  .modal-sub { font-size:.86rem; color:#64748b; margin-top:4px; }
  .modal-close { border:none; background:#eef2ff; color:#1e3a8a; width:36px; height:36px; border-radius:10px; cursor:pointer; display:flex; align-items:center; justify-content:center; }
  .modal-actions { display:flex; justify-content:flex-end; gap:10px; margin-top:18px; }

  /* LOGIN */
  .login-form { display:flex; flex-direction:column; gap:12px; }
  .login-back { background:none; border:none; color:#1a56db; font-family:var(--font); cursor:pointer; font-size:.9rem; margin-bottom:4px; text-align:left; font-weight:600; display:flex; align-items:center; gap:6px; }
  .auth-input-wrap { position:relative; display:flex; align-items:center; }
  .auth-input-icon { position:absolute; left:12px; display:flex; align-items:center; justify-content:center; pointer-events:none; }
  .auth-pwd-toggle { position:absolute; right:10px; border:none; background:transparent; cursor:pointer; display:flex; align-items:center; justify-content:center; padding:4px; }
  .form-input { width:100%; padding:10px 12px; border:2px solid #e2e8f0; border-radius:10px;
    font-family:var(--font); font-size:.95rem; outline:none; transition:border-color .2s; }
  .landing .auth-input-wrap { min-height:54px; }
  .landing .form-input { height:54px; padding-top:0; padding-bottom:0; border:1px solid rgba(255,255,255,.95);
    border-radius:17px; background:linear-gradient(145deg,rgba(240,244,255,.9),rgba(255,255,255,.84)); color:#26344f; font-size:.78rem;
    box-shadow:inset 4px 4px 9px rgba(83,107,157,.12),inset -4px -4px 9px rgba(255,255,255,.98),0 4px 8px rgba(83,111,173,.06); }
  .landing .form-input::placeholder { color:#7b879e; opacity:1; }
  .landing .form-input:focus { border-color:#84b7ff; background:linear-gradient(145deg,#fff,#f7f9ff); box-shadow:0 0 0 3px rgba(59,130,246,.13),inset 2px 2px 5px rgba(83,107,157,.07),0 7px 15px rgba(83,111,173,.12); }
  .landing .auth-input-icon { left:12px; }
  .landing .auth-pwd-toggle { right:10px; }
  .login-help-row { display:flex; justify-content:space-between; gap:10px; color:#6f7d97; font-size:.66rem; line-height:1.35; text-align:left; }
  .login-help-row span:last-child { text-align:right; }
  .landing .btn-primary { min-height:54px; padding:0 18px; border-radius:24px;
    background:linear-gradient(100deg,#24b4ff 0%,#2560f2 54%,#6139f3 100%);
    border:1px solid rgba(255,255,255,.44); box-shadow:0 8px 0 rgba(42,65,194,.16),0 14px 22px rgba(49,86,227,.3),inset 0 2px 2px rgba(255,255,255,.42);
    justify-content:space-between; font-size:.9rem; transform:translateZ(22px); transition:transform .18s ease,box-shadow .18s ease,opacity .18s ease; }
  .landing .btn-primary:hover { opacity:1; box-shadow:0 10px 0 rgba(42,65,194,.14),0 18px 27px rgba(49,86,227,.36),inset 0 2px 2px rgba(255,255,255,.48); transform:translateY(-2px) translateZ(22px); }
  .landing .btn-primary:active { box-shadow:0 2px 0 rgba(42,65,194,.18),0 5px 10px rgba(49,86,227,.2),inset 0 2px 4px rgba(22,39,130,.18); transform:translateY(4px) translateZ(14px); }
  .landing .btn-primary:disabled { cursor:wait; opacity:.72; }
  .login-submit-arrow { width:27px; height:27px; display:flex; align-items:center; justify-content:center;
    border-radius:50%; background:rgba(255,255,255,.18); font-size:1.15rem; line-height:1; }
  .landing-footer { margin-top:28px; color:#75829b; font-size:.56rem; font-weight:700; letter-spacing:.2em; transform:translateZ(12px); }
  .landing-footer span { margin:0 5px; color:#3969d7; }
  @keyframes landing-orb-float { from { transform:translate3d(0,0,0) rotate(-5deg); } to { transform:translate3d(0,-12px,0) rotate(4deg); } }
  @media (prefers-reduced-motion:reduce) {
    .landing::before,.landing::after { animation:none; }
    .landing .btn-primary,.login-portal-option { transition:none; }
  }
  @media (max-height:700px) {
    .landing:not(.landing-signup) { align-items:flex-start; }
    .landing:not(.landing-signup) .landing-box {
      max-height:calc(100dvh - 56px);
      overflow-y:auto;
      overscroll-behavior:contain;
      scrollbar-width:thin;
    }
  }
  .auth-input-wrap .form-input { padding-left:40px; }
  .auth-input-wrap .form-input[type="password"], .auth-input-wrap .form-input[data-has-toggle="true"] { padding-right:40px; }
  .form-input:focus { border-color:var(--primary); }
  .btn-primary { width:100%; padding:11px 14px; background:linear-gradient(135deg,#1a56db,#1e3a8a);
    color:#fff; border:none; border-radius:10px; font-family:var(--font); font-weight:700;
    font-size:1rem; cursor:pointer; transition:opacity .2s; display:flex; align-items:center; justify-content:center; gap:8px; }
  .btn-primary:hover { opacity:.9; }
  .btn-secondary { padding:11px 14px; background:#f3f4f6; color:#374151; border:2px solid #e2e8f0;
    border-radius:10px; font-family:var(--font); font-weight:600; font-size:1rem; cursor:pointer;
    transition:all .2s; display:flex; align-items:center; justify-content:center; gap:8px; }
  .btn-secondary:hover { background:#e2e8f0; border-color:#cbd5e1; color:#1f2937; }
  .btn-success { padding:11px 14px; background:#16a34a; color:#fff; border:none; border-radius:10px;
    font-family:var(--font); font-weight:600; font-size:1rem; cursor:pointer; transition:opacity .2s;
    display:flex; align-items:center; justify-content:center; gap:8px; }
  .btn-success:hover { opacity:.9; }
  .btn-danger { padding:11px 14px; background:#dc2626; color:#fff; border:none; border-radius:10px;
    font-family:var(--font); font-weight:600; font-size:1rem; cursor:pointer; transition:opacity .2s;
    display:flex; align-items:center; justify-content:center; gap:8px; }
  .btn-danger:hover { opacity:.9; }

  /* TOPBAR */
  .topbar { position:fixed; top:0; left:0; right:0; z-index:100; height:var(--topbar-h);
    background:linear-gradient(135deg,#1a56db 0%,#1e3a8a 100%);
    display:flex; align-items:center; justify-content:space-between; padding:0 20px;
    box-shadow:0 2px 20px rgba(26,86,219,.4); }
  .topbar-left { display:flex; align-items:center; gap:12px; flex:1; min-width:0; padding-left:42px; }
  .topbar-logo { width:60px; height:60px; border-radius:14px; overflow:hidden; border:2px solid rgba(255,255,255,.3); }
  .brand-btn { background:none; border:none; padding:0; cursor:pointer; display:flex; align-items:center; justify-content:center; }
  .topbar-logo img { width:100%; height:100%; object-fit:cover; }
  .topbar-name { color:#fff; font-weight:800; font-size:1rem; }
  .topbar-right { display:flex; align-items:center; gap:8px; min-width:0; flex:0 1 auto; }
  .topbar-actions {
    display:flex;
    align-items:center;
    gap:0;
    background:rgba(255,255,255,.14);
    border:1px solid rgba(255,255,255,.22);
    border-radius:12px;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.08);
    overflow:hidden;
    max-width:100%;
  }
  .topbar-btn { background:transparent; border:none;
    color:#fff; width:36px; height:36px; border-radius:8px; cursor:pointer; display:flex;
    align-items:center; justify-content:center; position:relative; transition:background .2s; flex:0 0 auto; }
  .topbar-app-btn { width:44px; padding:0 6px; }
  .topbar-app-logo { width:28px; height:28px; border-radius:8px; overflow:hidden; border:1px solid rgba(255,255,255,.24); display:flex; align-items:center; justify-content:center; flex-shrink:0; }
  .topbar-app-logo img { width:100%; height:100%; object-fit:cover; display:block; }
  .topbar-actions .topbar-btn { border-radius:0; }
  .topbar-actions .topbar-btn + .topbar-btn { box-shadow:-1px 0 0 rgba(255,255,255,.14); }
  .topbar-btn:hover { background:rgba(255,255,255,.25); }
  .notif-badge { position:absolute; top:-4px; right:-4px; background:#ef4444; color:#fff;
    border-radius:99px; font-size:.6rem; font-weight:700; width:16px; height:16px;
    display:flex; align-items:center; justify-content:center; }
  .topbar-avatar { width:36px; height:36px; border-radius:8px; background:rgba(255,255,255,.2);
    border:2px solid rgba(255,255,255,.3); color:#fff; display:flex; align-items:center;
    justify-content:center; font-weight:700; font-size:.8rem; cursor:pointer; }
  .menu-btn { background:none; border:none; color:#fff; cursor:pointer; display:flex;
    align-items:center; justify-content:center; padding:4px; position:absolute; left:20px; top:50%; transform:translateY(-50%); z-index:2; }

  body.dark-mode .topbar-actions {
    background:rgba(15,23,42,.2);
    border-color:rgba(191,219,254,.16);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.04);
  }
  body.dark-mode .topbar-actions .topbar-btn + .topbar-btn { box-shadow:-1px 0 0 rgba(191,219,254,.1); }
  body.dark-mode .sidebar {
    background: linear-gradient(180deg, #0f172a 0%, #111b2f 100%);
    border-right-color: #1e2b42;
  }
  body.dark-mode .sidebar-brand { border-bottom-color: #1e2b42; }
  body.dark-mode .sidebar-section { color:#7f91ad; }
  body.dark-mode .nav-item { color:#cbd5e1; }
  body.dark-mode .nav-item:hover { background:#1a2740; color:#dbeafe; }
  body.dark-mode .nav-item.active {
    background: linear-gradient(135deg,#1d4ed8,#1e3a8a);
    color:#eff6ff;
    box-shadow: inset 0 0 0 1px #3b82f6;
  }
  body.dark-mode .nav-item.active::before { background:#93c5fd; }
  body.dark-mode .card,
  body.dark-mode .stat-card,
  body.dark-mode .results-panel,
  body.dark-mode .student-profile-card,
  body.dark-mode .selection-card,
  body.dark-mode .modal-card {
    background:#0f172a;
    border-color:#23324a;
  }
  body.dark-mode th {
    background:#111d31;
    color:#a8bddc;
    border-bottom-color:#23324a;
  }
  body.dark-mode td { color:#dbe7f8; border-bottom-color:#1f2c43; }
  body.dark-mode tr:hover td { background:#121f34; }
  body.dark-mode .form-control,
  body.dark-mode .form-input {
    background:#0b1324;
    border-color:#2a3a54;
    color:#e2e8f0;
  }
  body.dark-mode .form-control:focus,
  body.dark-mode .form-input:focus { border-color:#60a5fa; }
  body.dark-mode .form-label { color:#cbd5e1; }
  body.dark-mode .topbar-search {
    background: rgba(15,23,42,.45);
    border-color: rgba(148,163,184,.35);
  }
  body.dark-mode .topbar-search input::placeholder { color:rgba(191,219,254,.7); }
  body.dark-mode .topbar-search input { color:#e2e8f0; }
  body.dark-mode .bottom-nav {
    background: linear-gradient(180deg,#0f172a 0%,#111b2f 100%);
    border-top-color:#1e2b42;
  }
  body.dark-mode .bottom-nav-item { color:#9fb2cf; }
  body.dark-mode .bottom-nav-item:hover { background:#1a2740; }
  body.dark-mode .bottom-nav-item.active { color:#9fb2cf; background:none; box-shadow:none; }
  body.dark-mode .alert-info { background:#10233d; color:#bfdbfe; border-color:#1e3a8a; }
  body.dark-mode .alert-warning { background:#3a2c10; color:#fde68a; border-color:#a16207; }
  body.dark-mode .alert-success { background:#10261b; color:#bbf7d0; border-color:#166534; }
  body.dark-mode .alert-danger { background:#3b1317; color:#fecaca; border-color:#b91c1c; }
  body.dark-mode .student-profile-row { background:#0b1324; border-color:#23324a; }
  body.dark-mode .student-profile-row span { color:#e2e8f0; }
  body.dark-mode .school-profile-list {
    background:#0b1324;
    border-color:#23324a;
    box-shadow:none;
  }
  body.dark-mode .school-profile-row {
    border-bottom-color:#23324a;
    background:#0f172a;
  }
  body.dark-mode .school-profile-row:nth-child(even) { background:#111d31; }
  body.dark-mode .school-profile-label { color:#94a3b8; }
  body.dark-mode .school-profile-value { color:#e2e8f0; }
  body.dark-mode .student-profile-help,
  body.dark-mode .page-sub,
  body.dark-mode .stat-sub { color:#94a3b8; }

  /* SHELL */
  .shell {
    display:flex;
    flex:1;
    height:100%;
    min-height:0;
    overflow:hidden;
    padding-top:var(--topbar-h);
  }
  .sidebar { width:var(--sidebar-w); background:linear-gradient(180deg,#ffffff 0%,#f8fbff 100%); border-right:1px solid #dbe5f3;
    position:fixed; top:var(--topbar-h); bottom:0; left:0; overflow-y:auto; z-index:90;
    transition:transform .25s ease; padding:10px 10px 16px; scrollbar-width:thin; scrollbar-color:#c9d6ea transparent; }
  .sidebar::-webkit-scrollbar { width:8px; }
  .sidebar::-webkit-scrollbar-track { background:transparent; }
  .sidebar::-webkit-scrollbar-thumb { background:#c9d6ea; border-radius:99px; }
  .sidebar::-webkit-scrollbar-thumb:hover { background:#adc1de; }
  .sidebar.closed { transform:translateX(-100%); }
  .sidebar-brand { width:100%; padding:14px 12px 18px; border-bottom:1px solid #e6edf7; margin-bottom:8px; display:flex; align-items:center; justify-content:center; }
  .sidebar-brand img { width:64px; height:64px; border-radius:14px; border:2px solid #dbeafe; box-shadow:0 8px 20px rgba(30,58,138,.12); }
  .sidebar-section { font-size:.7rem; font-weight:700; color:#94a3b8; letter-spacing:.8px;
    text-transform:uppercase; padding:14px 12px 6px; }
  .nav-item { display:flex; align-items:center; gap:12px; width:100%; padding:11px 12px; margin:3px 0;
    background:none; border:none; cursor:pointer; font-family:var(--font); font-size:.875rem;
    color:#334155; border-radius:12px; transition:all .2s; text-align:left; position:relative; }
  .nav-item:hover { background:#eef5ff; color:var(--primary); transform:translateX(2px); }
  .nav-item.active { background:linear-gradient(135deg,#e8f1ff,#dbeafe); color:var(--primary); font-weight:700; box-shadow:inset 0 0 0 1px #c7ddff; }
  .nav-item.active::before { content:''; position:absolute; left:4px; top:8px; bottom:8px; width:4px; background:var(--primary); border-radius:99px; }
  .nav-item-icon { flex-shrink:0; }
  .nav-item-label { font-size:.9rem; letter-spacing:.1px; }
  .nav-item-badge { margin-left:auto; background:#ef4444; color:#fff; border-radius:99px;
    font-size:.65rem; font-weight:700; padding:2px 7px; }
  .nav-item:not(.active) svg { opacity:.88; }
  .nav-item:hover svg, .nav-item.active svg { opacity:1; transition:opacity .15s; filter:drop-shadow(0 1px 2px rgba(30,58,138,.18)); }
  .bottom-nav-item svg { opacity:.8; transition:all .2s ease; filter:grayscale(20%); }
  .bottom-nav-item:hover svg, .bottom-nav-item.active svg { opacity:1; filter:none; }

  .main {
    flex:1;
    min-width:0;
    min-height:0;
    height:calc(100vh - var(--topbar-h));
    height:calc(100dvh - var(--topbar-h));
    margin-left:var(--sidebar-w);
    padding:24px;
    overflow-x:hidden;
    overflow-y:auto;
    overscroll-behavior-y:contain;
    scrollbar-width:thin;
    scrollbar-color:#c9d6ea transparent;
    width:calc(100vw - var(--sidebar-w));
    max-width:100%;
  }
  .main::-webkit-scrollbar { width:8px; }
  .main::-webkit-scrollbar-thumb { background:#c9d6ea; border-radius:99px; }
  .main.full { margin-left:0; width:100%; }
  .page-actions-row { display:flex; gap:12px; margin-bottom:16px; flex-wrap:wrap; }
  .page-actions-row .form-control { flex:1 1 220px; min-width:0; }
  .page-actions-row .btn { flex-shrink:0; }
  .stats-grid-3 { grid-template-columns:repeat(3,minmax(0,1fr)); }
  .stats-grid-4-compact { grid-template-columns:repeat(4,minmax(0,1fr)); }
  .results-visual-grid-wide { grid-template-columns:1.2fr 1fr 1fr; }
  .enroll-shell { display:grid; gap:18px; }
  .enroll-hero {
    background:linear-gradient(145deg,#0f172a 0%,#163a7a 58%,#1d4ed8 100%);
    color:#fff;
    border-radius:22px;
    padding:24px 26px;
    box-shadow:0 24px 46px rgba(15,23,42,.22);
    display:flex;
    align-items:flex-start;
    justify-content:space-between;
    gap:18px;
    overflow:hidden;
    position:relative;
  }
  .enroll-hero::after {
    content:"";
    position:absolute;
    inset:auto -70px -90px auto;
    width:220px;
    height:220px;
    border-radius:50%;
    background:radial-gradient(circle,rgba(255,255,255,.2),rgba(255,255,255,0));
    pointer-events:none;
  }
  .enroll-hero-copy { position:relative; z-index:1; max-width:680px; }
  .enroll-hero-eyebrow { font-size:.72rem; font-weight:800; letter-spacing:.22em; text-transform:uppercase; color:#bfdbfe; margin-bottom:10px; }
  .enroll-hero-title { font-size:1.85rem; font-weight:900; letter-spacing:-.03em; line-height:1.05; }
  .enroll-hero-sub { margin-top:10px; max-width:56ch; color:rgba(226,232,240,.92); font-size:.96rem; line-height:1.55; }
  .enroll-hero-pills { position:relative; z-index:1; display:flex; flex-wrap:wrap; gap:10px; justify-content:flex-end; align-self:flex-end; }
  .enroll-hero-pill {
    display:inline-flex;
    align-items:center;
    gap:8px;
    padding:10px 12px;
    border-radius:999px;
    background:rgba(255,255,255,.12);
    border:1px solid rgba(255,255,255,.16);
    color:#eff6ff;
    font-size:.78rem;
    font-weight:700;
    backdrop-filter:blur(10px);
  }
  .enroll-panel { display:grid; grid-template-columns:minmax(200px,228px) minmax(0,1fr); gap:18px; align-items:start; }
  .enroll-sidebar {
    background:linear-gradient(180deg,#f8fbff 0%,#eef6ff 100%);
    border:1px solid #dbe7f5;
    border-radius:20px;
    padding:18px;
    box-shadow:0 18px 34px rgba(15,23,42,.08);
    display:grid;
    gap:16px;
  }
  .enroll-photo-card {
    background:#fff;
    border:1px solid #dbe7f5;
    border-radius:18px;
    padding:16px;
    display:grid;
    gap:12px;
    box-shadow:0 10px 24px rgba(15,23,42,.06);
    min-width:0;
    overflow:hidden;
  }
  .enroll-photo-head { display:flex; align-items:center; justify-content:space-between; gap:10px; min-width:0; }
  .enroll-photo-head > div { min-width:0; }
  .enroll-photo-title { font-size:.92rem; font-weight:800; color:#0f172a; }
  .enroll-photo-meta { font-size:.76rem; color:#64748b; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .enroll-photo-col { display:flex; flex-direction:column; align-items:center; gap:10px; min-width:0; }
  .enroll-photo-frame {
    width:min(100%, 152px);
    aspect-ratio:4 / 5;
    border-radius:18px;
    border:1px solid #c7d8ee;
    overflow:hidden;
    background:linear-gradient(180deg,#eff6ff 0%,#dbeafe 100%);
    display:flex;
    align-items:center;
    justify-content:center;
    position:relative;
    margin:0 auto;
  }
  .enroll-photo-empty {
    padding:14px;
    text-align:center;
    color:#64748b;
    font-size:.76rem;
    line-height:1.4;
    display:grid;
    gap:8px;
    place-items:center;
  }
  .enroll-photo-empty-copy { display:grid; gap:4px; }
  .enroll-photo-empty-title { font-size:.84rem; font-weight:800; color:#0f172a; }
  .enroll-photo-empty-sub { max-width:16ch; color:#64748b; font-size:.72rem; line-height:1.45; }
  .enroll-photo-empty-badge {
    width:42px;
    height:42px;
    border-radius:12px;
    background:rgba(255,255,255,.78);
    color:#1d4ed8;
    display:flex;
    align-items:center;
    justify-content:center;
    box-shadow:0 10px 22px rgba(29,78,216,.12);
  }
  .enroll-photo-input {
    position:absolute;
    width:1px;
    height:1px;
    padding:0;
    margin:-1px;
    overflow:hidden;
    clip:rect(0,0,0,0);
    white-space:nowrap;
    border:0;
  }
  .enroll-upload-stack {
    display:grid;
    gap:6px;
    min-width:0;
    width:100%;
    justify-items:center;
  }
  .enroll-upload-trigger {
    display:flex;
    align-items:center;
    justify-content:center;
    gap:8px;
    min-height:38px;
    padding:9px 12px;
    border-radius:12px;
    background:linear-gradient(180deg,#2563eb 0%,#1d4ed8 100%);
    border:1px solid #1d4ed8;
    color:#fff;
    font-size:.78rem;
    font-weight:800;
    cursor:pointer;
    box-shadow:0 10px 18px rgba(37,99,235,.18);
    transition:transform .15s ease, box-shadow .15s ease, border-color .15s ease;
    width:min(100%, 152px);
    text-align:center;
  }
  .enroll-upload-trigger:hover {
    transform:translateY(-1px);
    box-shadow:0 14px 24px rgba(37,99,235,.24);
    border-color:#1e40af;
  }
  .enroll-upload-meta {
    display:grid;
    gap:2px;
    min-width:0;
    text-align:center;
    max-width:152px;
  }
  .enroll-upload-file {
    font-size:.68rem;
    font-weight:700;
    color:#334155;
    min-width:0;
    overflow-wrap:anywhere;
    word-break:break-word;
    line-height:1.35;
  }
  .enroll-upload-caption { font-size:.68rem; color:#64748b; line-height:1.4; min-width:0; }
  .enroll-upload-note { font-size:.72rem; color:#64748b; line-height:1.5; }
  .enroll-mini-stats { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
  .enroll-mini-stat {
    background:#fff;
    border:1px solid #dbe7f5;
    border-radius:16px;
    padding:12px;
    box-shadow:0 8px 20px rgba(15,23,42,.05);
  }
  .enroll-mini-label { font-size:.72rem; text-transform:uppercase; letter-spacing:.08em; color:#64748b; font-weight:700; }
  .enroll-mini-value { margin-top:6px; font-size:1rem; font-weight:800; color:#0f172a; }
  .enroll-guidance {
    background:#0f172a;
    color:#e2e8f0;
    border-radius:18px;
    padding:16px;
    display:grid;
    gap:10px;
  }
  .enroll-guidance-title { font-size:.88rem; font-weight:800; color:#fff; }
  .enroll-guidance-list { display:grid; gap:10px; }
  .enroll-guidance-item { display:flex; align-items:flex-start; gap:10px; font-size:.78rem; line-height:1.5; }
  .enroll-guidance-dot {
    width:20px;
    height:20px;
    border-radius:999px;
    background:rgba(59,130,246,.2);
    color:#bfdbfe;
    display:flex;
    align-items:center;
    justify-content:center;
    flex-shrink:0;
    margin-top:1px;
    font-size:.7rem;
    font-weight:800;
  }
  .enroll-form-card { border-radius:20px; padding:0; overflow:hidden; }
  .enroll-form-head {
    display:flex;
    align-items:flex-start;
    justify-content:space-between;
    gap:14px;
    padding:20px 22px;
    border-bottom:1px solid #e2e8f0;
    background:linear-gradient(180deg,#ffffff 0%,#f8fbff 100%);
  }
  .enroll-form-kicker { font-size:.74rem; text-transform:uppercase; letter-spacing:.16em; color:#64748b; font-weight:800; margin-bottom:8px; }
  .enroll-form-title { font-size:1.2rem; font-weight:800; color:#0f172a; }
  .enroll-form-sub { margin-top:6px; color:#64748b; font-size:.86rem; line-height:1.5; max-width:52ch; }
  .enroll-form-status {
    padding:8px 12px;
    border-radius:999px;
    background:#ecfeff;
    color:#0f766e;
    border:1px solid #a5f3fc;
    font-size:.74rem;
    font-weight:800;
    white-space:nowrap;
  }
  .enroll-form-body { padding:22px; display:grid; gap:18px; }
  .enroll-section {
    border:1px solid #e2e8f0;
    border-radius:18px;
    padding:18px;
    background:linear-gradient(180deg,#ffffff 0%,#fbfdff 100%);
  }
  .enroll-section-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:14px; }
  .enroll-section-title { font-size:.96rem; font-weight:800; color:#0f172a; }
  .enroll-section-sub { margin-top:4px; font-size:.8rem; color:#64748b; line-height:1.45; }
  .enroll-section-badge {
    padding:7px 10px;
    border-radius:999px;
    background:#eff6ff;
    color:#1d4ed8;
    font-size:.72rem;
    font-weight:800;
    border:1px solid #bfdbfe;
    white-space:nowrap;
  }
  .enroll-fields { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px 16px; }
  .enroll-fields .form-group { margin:0; }
  .enroll-fields .form-group.full { grid-column:1 / -1; }
  .enroll-actions {
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:12px;
    padding:0 22px 22px;
  }
  .enroll-actions-note { font-size:.8rem; color:#64748b; max-width:42ch; line-height:1.5; }
  .enroll-actions-row { display:flex; gap:12px; }
  .enroll-success-card {
    background:linear-gradient(160deg,#ecfeff 0%,#eff6ff 100%);
    border:1px solid #bfdbfe;
    border-radius:22px;
    padding:28px;
    box-shadow:0 20px 40px rgba(15,23,42,.08);
    display:grid;
    gap:14px;
    max-width:640px;
  }
  .enroll-success-title { font-size:1.35rem; font-weight:900; color:#0f172a; }
  .enroll-success-sub { color:#475569; line-height:1.6; }
  .students-shell { display:grid; gap:18px; }
  .students-hero {
    background:linear-gradient(135deg,#0f172a 0%,#153a75 52%,#0284c7 100%);
    border-radius:22px;
    padding:24px 26px;
    color:#fff;
    display:flex;
    align-items:flex-start;
    justify-content:space-between;
    gap:18px;
    position:relative;
    overflow:hidden;
    box-shadow:0 24px 46px rgba(15,23,42,.22);
  }
  .students-hero::after {
    content:"";
    position:absolute;
    inset:auto -40px -80px auto;
    width:200px;
    height:200px;
    border-radius:50%;
    background:radial-gradient(circle,rgba(255,255,255,.2),rgba(255,255,255,0));
    pointer-events:none;
  }
  .students-hero-copy,
  .students-hero-actions { position:relative; z-index:1; }
  .students-hero-kicker { font-size:.72rem; font-weight:800; letter-spacing:.22em; text-transform:uppercase; color:#bfdbfe; margin-bottom:10px; }
  .students-hero-title { font-size:1.85rem; font-weight:900; letter-spacing:-.03em; line-height:1.05; }
  .students-hero-sub { margin-top:10px; max-width:58ch; color:rgba(226,232,240,.92); font-size:.95rem; line-height:1.55; }
  .students-hero-actions { display:grid; gap:10px; justify-items:end; min-width:220px; }
  .students-hero-note {
    padding:11px 12px;
    border-radius:16px;
    background:rgba(255,255,255,.12);
    border:1px solid rgba(255,255,255,.16);
    font-size:.78rem;
    color:#eff6ff;
    line-height:1.5;
    max-width:260px;
  }
  .students-summary-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
  .students-summary-card {
    background:#fff;
    border:1px solid #dbe7f5;
    border-radius:18px;
    padding:16px;
    box-shadow:0 14px 30px rgba(15,23,42,.06);
  }
  .students-summary-label { font-size:.72rem; text-transform:uppercase; letter-spacing:.1em; color:#64748b; font-weight:700; }
  .students-summary-value { margin-top:8px; font-size:1.45rem; font-weight:900; color:#0f172a; }
  .students-summary-sub { margin-top:6px; font-size:.78rem; color:#64748b; }
  .students-toolbar {
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:14px;
    padding:16px 18px;
    background:linear-gradient(180deg,#ffffff 0%,#f8fbff 100%);
    border:1px solid #dbe7f5;
    border-radius:20px;
    box-shadow:0 14px 30px rgba(15,23,42,.06);
  }
  .students-toolbar-copy { min-width:0; }
  .students-toolbar-title { font-size:1rem; font-weight:800; color:#0f172a; }
  .students-toolbar-sub { margin-top:4px; font-size:.82rem; color:#64748b; }
  .students-toolbar-actions { display:flex; gap:12px; align-items:center; flex:1; justify-content:flex-end; }
  .students-search { max-width:320px; margin:0; }
  .students-table-card { overflow:hidden; border-radius:20px; }
  .students-table-head {
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:12px;
    padding:18px 20px;
    border-bottom:1px solid #e2e8f0;
    background:linear-gradient(180deg,#ffffff 0%,#fbfdff 100%);
  }
  .students-table-title { font-size:1rem; font-weight:800; color:#0f172a; }
  .students-table-sub { margin-top:4px; font-size:.8rem; color:#64748b; }
  .students-table-status { font-size:.74rem; font-weight:800; color:#0f766e; background:#ecfeff; border:1px solid #a5f3fc; padding:8px 12px; border-radius:999px; }
  .students-avatar {
    display:block;
    width:40px;
    height:40px;
    border-radius:12px;
    object-fit:cover;
    border:1px solid #dbeafe;
    flex-shrink:0;
  }
  .students-avatar-placeholder {
    width:40px;
    height:40px;
    border-radius:12px;
    display:flex;
    align-items:center;
    justify-content:center;
    overflow:hidden;
    flex-shrink:0;
    background:#dbeafe;
    color:#1e40af;
    border:1px solid #bfdbfe;
    font-weight:800;
    font-size:.74rem;
  }
  .students-name-cell strong { display:block; font-size:.92rem; color:#0f172a; }
  .students-name-cell span { display:block; margin-top:3px; font-size:.76rem; color:#64748b; }
  .students-id-cell { font-weight:700; color:#1e3a8a; }
  .students-empty-state {
    background:linear-gradient(160deg,#f8fbff 0%,#eff6ff 100%);
    border:1px dashed #bfdbfe;
    border-radius:20px;
    padding:24px;
    text-align:center;
    color:#475569;
  }
  .school-reg-shell { display:grid; gap:18px; }
  .school-reg-hero {
    background:linear-gradient(135deg,#0f172a 0%,#115e59 58%,#0f766e 100%);
    color:#fff;
    border-radius:22px;
    padding:24px 26px;
    display:flex;
    align-items:flex-start;
    justify-content:space-between;
    gap:18px;
    box-shadow:0 24px 46px rgba(15,23,42,.2);
  }
  .school-reg-hero-copy { max-width:62ch; }
  .school-reg-kicker { font-size:.72rem; font-weight:800; letter-spacing:.22em; text-transform:uppercase; color:#99f6e4; margin-bottom:10px; }
  .school-reg-title { font-size:1.85rem; font-weight:900; letter-spacing:-.03em; line-height:1.05; }
  .school-reg-sub { margin-top:10px; color:rgba(240,253,250,.9); font-size:.94rem; line-height:1.55; }
  .school-reg-chip {
    display:inline-flex;
    align-items:center;
    gap:8px;
    padding:10px 12px;
    border-radius:999px;
    background:rgba(255,255,255,.12);
    border:1px solid rgba(255,255,255,.16);
    color:#ecfeff;
    font-size:.78rem;
    font-weight:700;
    white-space:nowrap;
  }
  .school-reg-grid { display:grid; grid-template-columns:minmax(220px,260px) minmax(0,1fr); gap:18px; align-items:start; }
  .school-reg-side {
    background:linear-gradient(180deg,#f8fffe 0%,#eefcf9 100%);
    border:1px solid #ccebe4;
    border-radius:20px;
    padding:18px;
    display:grid;
    gap:14px;
    box-shadow:0 16px 32px rgba(15,23,42,.06);
  }
  .school-reg-stat {
    background:#fff;
    border:1px solid #d8eee8;
    border-radius:16px;
    padding:14px;
  }
  .school-reg-stat-label { font-size:.72rem; text-transform:uppercase; letter-spacing:.1em; color:#64748b; font-weight:700; }
  .school-reg-stat-value { margin-top:8px; font-size:1.2rem; font-weight:900; color:#0f172a; }
  .school-reg-note {
    background:#0f172a;
    color:#e2e8f0;
    border-radius:16px;
    padding:16px;
    font-size:.8rem;
    line-height:1.6;
  }
  .school-reg-form-card { border-radius:20px; overflow:hidden; }
  .school-reg-head {
    display:flex;
    align-items:flex-start;
    justify-content:space-between;
    gap:14px;
    padding:20px 22px;
    border-bottom:1px solid #e2e8f0;
    background:linear-gradient(180deg,#ffffff 0%,#f8fffe 100%);
  }
  .school-reg-head-title { font-size:1.16rem; font-weight:800; color:#0f172a; }
  .school-reg-head-sub { margin-top:6px; color:#64748b; font-size:.84rem; line-height:1.5; max-width:56ch; }
  .school-reg-section { padding:20px 22px 0; }
  .school-reg-section + .school-reg-section { padding-top:18px; }
  .school-reg-section-title { font-size:.95rem; font-weight:800; color:#0f172a; margin-bottom:6px; }
  .school-reg-section-sub { font-size:.8rem; color:#64748b; line-height:1.45; margin-bottom:14px; }
  .school-reg-switch {
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:12px;
    padding:12px 14px;
    border:1px solid #dbe7f5;
    border-radius:14px;
    background:#f8fafc;
  }
  .school-reg-switch-copy { min-width:0; }
  .school-reg-switch-title { font-size:.84rem; font-weight:700; color:#0f172a; }
  .school-reg-switch-sub { font-size:.74rem; color:#64748b; margin-top:4px; }
  .school-reg-actions {
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:12px;
    padding:22px;
  }
  .school-reg-actions-note { font-size:.8rem; color:#64748b; line-height:1.5; max-width:44ch; }
  .school-reg-actions-row { display:flex; gap:12px; }
  .school-reg-success {
    max-width:620px;
    background:linear-gradient(155deg,#ecfeff 0%,#eef2ff 46%,#fdf2f8 100%);
    border:1px solid #a5f3fc;
    border-radius:22px;
    padding:28px;
    display:grid;
    gap:14px;
    box-shadow:0 22px 44px rgba(14,116,144,.14);
  }
  .school-reg-summary-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
  .school-reg-summary-card {
    background:linear-gradient(145deg,#ffffff 0%,#ecfeff 42%,#eef2ff 100%);
    border:1px solid #bfdbfe;
    border-radius:18px;
    padding:16px;
    box-shadow:0 16px 32px rgba(59,130,246,.12);
    position:relative;
    overflow:hidden;
  }
  .school-reg-summary-card::after {
    content:"";
    position:absolute;
    inset:auto -34px -40px auto;
    width:118px;
    height:118px;
    border-radius:50%;
    background:radial-gradient(circle,rgba(59,130,246,.18),rgba(168,85,247,0));
    pointer-events:none;
  }
  .school-reg-summary-label { font-size:.72rem; text-transform:uppercase; letter-spacing:.1em; color:#64748b; font-weight:700; }
  .school-reg-summary-value { margin-top:8px; font-size:1.35rem; font-weight:900; color:#172554; }
  .school-reg-summary-sub { margin-top:6px; font-size:.8rem; color:#475569; line-height:1.45; }
  .school-reg-toolbar {
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:14px;
    padding:16px 18px;
    background:linear-gradient(120deg,#eff6ff 0%,#ecfeff 52%,#fdf2f8 100%);
    border:1px solid #c7d2fe;
    border-radius:18px;
    box-shadow:0 16px 32px rgba(99,102,241,.12);
  }
  .school-reg-toolbar-copy { min-width:0; }
  .school-reg-toolbar-title { font-size:1rem; font-weight:800; color:#312e81; }
  .school-reg-toolbar-sub { margin-top:4px; font-size:.82rem; color:#475569; line-height:1.5; }
  .registered-school-list { display:grid; gap:16px; }
  .registered-school-card {
    border-radius:20px;
    overflow:hidden;
    border:1px solid #cbd5f5;
    box-shadow:0 18px 36px rgba(99,102,241,.1);
    background:linear-gradient(180deg,#ffffff 0%,#fcfcff 100%);
  }
  .registered-school-head {
    display:flex;
    align-items:flex-start;
    justify-content:space-between;
    gap:14px;
    padding:18px 20px;
    border-bottom:1px solid #dbeafe;
    background:linear-gradient(120deg,#eff6ff 0%,#ecfeff 58%,#fef3c7 100%);
  }
  .registered-school-meta { display:grid; gap:4px; }
  .registered-school-title { font-size:1rem; font-weight:800; color:#1e1b4b; }
  .registered-school-sub { font-size:.8rem; color:#475569; }
  .registered-school-badges { display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
  .registered-school-body { padding:18px 20px 20px; display:grid; gap:16px; }
  .registered-school-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
  .registered-school-stat { background:linear-gradient(135deg,#f8fafc 0%,#eef2ff 100%); border:1px solid #dbeafe; border-radius:14px; padding:12px; }
  .registered-school-stat label { display:block; font-size:.7rem; text-transform:uppercase; letter-spacing:.08em; color:#6366f1; font-weight:700; margin-bottom:6px; }
  .registered-school-stat strong { font-size:.92rem; color:#0f172a; }
  .school-admin-block { display:grid; gap:12px; }
  .school-admin-block-head { display:flex; align-items:center; justify-content:space-between; gap:10px; }
  .school-admin-block-sub { font-size:.8rem; color:#64748b; line-height:1.45; margin-top:4px; }
  .school-admin-list { display:grid; gap:10px; }
  .school-admin-row {
    display:flex;
    align-items:flex-start;
    justify-content:space-between;
    gap:12px;
    padding:12px 14px;
    border:1px solid #dbeafe;
    border-radius:14px;
    background:linear-gradient(135deg,#ffffff 0%,#f8fbff 100%);
  }
  .school-admin-row-copy { min-width:0; }
  .school-admin-row-copy strong { display:block; color:#0f172a; }
  .school-admin-row-copy span { display:block; margin-top:4px; font-size:.78rem; color:#64748b; overflow-wrap:anywhere; }
  .school-admin-form {
    display:grid;
    gap:12px;
    padding:14px;
    border:1px solid #c7d2fe;
    border-radius:16px;
    background:linear-gradient(135deg,#eef2ff 0%,#ecfeff 100%);
  }
  .school-admin-form-head { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
  .school-admin-form-title { font-size:.9rem; font-weight:800; color:#0f172a; }
  .school-admin-form-sub { margin-top:4px; font-size:.78rem; color:#64748b; }
  .school-workspace-shell { display:grid; gap:18px; }
  .school-workspace-hero {
    background:linear-gradient(130deg,#1d4ed8 0%,#0891b2 34%,#10b981 67%,#f59e0b 100%);
    border-radius:22px;
    padding:24px 26px;
    color:#fff;
    display:flex;
    align-items:flex-start;
    justify-content:space-between;
    gap:18px;
    box-shadow:0 26px 52px rgba(37,99,235,.24);
    position:relative;
    overflow:hidden;
  }
  .school-workspace-hero::after {
    content:"";
    position:absolute;
    inset:auto -60px -80px auto;
    width:220px;
    height:220px;
    border-radius:50%;
    background:radial-gradient(circle,rgba(255,255,255,.24),rgba(255,255,255,0));
    pointer-events:none;
  }
  .school-workspace-hero::before {
    content:"";
    position:absolute;
    inset:-30% auto auto -8%;
    width:220px;
    height:220px;
    border-radius:50%;
    background:radial-gradient(circle,rgba(255,255,255,.18),rgba(255,255,255,0));
    pointer-events:none;
  }
  .school-workspace-copy, .school-workspace-meta { position:relative; z-index:1; }
  .school-workspace-kicker { font-size:.72rem; font-weight:800; letter-spacing:.22em; text-transform:uppercase; color:#fef3c7; margin-bottom:10px; }
  .school-workspace-title { font-size:1.85rem; font-weight:900; letter-spacing:-.03em; line-height:1.05; }
  .school-workspace-sub { margin-top:10px; color:rgba(255,255,255,.94); font-size:.94rem; line-height:1.55; max-width:58ch; }
  .school-workspace-meta { display:grid; gap:10px; justify-items:end; min-width:220px; }
  .school-workspace-chip {
    display:inline-flex;
    align-items:center;
    gap:8px;
    padding:10px 12px;
    border-radius:999px;
    background:rgba(255,255,255,.18);
    border:1px solid rgba(255,255,255,.24);
    color:#ecfeff;
    font-size:.78rem;
    font-weight:700;
  }
  .school-workspace-note {
    max-width:280px;
    padding:12px 14px;
    border-radius:16px;
    background:rgba(255,255,255,.16);
    border:1px solid rgba(255,255,255,.22);
    color:#ecfeff;
    font-size:.8rem;
    line-height:1.5;
  }
  .school-workspace-summary { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:12px; }
  .school-workspace-summary-card {
    background:linear-gradient(145deg,#ffffff 0%,#eff6ff 40%,#ecfeff 100%);
    border:1px solid #bfdbfe;
    border-radius:18px;
    padding:16px;
    box-shadow:0 16px 32px rgba(14,165,233,.12);
    position:relative;
    overflow:hidden;
  }
  .school-workspace-summary-card::after {
    content:"";
    position:absolute;
    inset:auto -34px -42px auto;
    width:122px;
    height:122px;
    border-radius:50%;
    background:radial-gradient(circle,rgba(16,185,129,.2),rgba(59,130,246,0));
    pointer-events:none;
  }
  .school-workspace-summary-label { font-size:.72rem; text-transform:uppercase; letter-spacing:.1em; color:#0f766e; font-weight:700; }
  .school-workspace-summary-value { margin-top:8px; font-size:1.3rem; font-weight:900; color:#1e3a8a; }
  .school-workspace-summary-sub { margin-top:6px; font-size:.78rem; color:#475569; line-height:1.45; }
  .school-workspace-grid { display:grid; grid-template-columns:1.1fr .9fr; gap:18px; align-items:start; }
  .school-workspace-panel {
    background:linear-gradient(145deg,#ffffff 0%,#f8fbff 48%,#fefce8 100%);
    border:1px solid #dbeafe;
    border-radius:20px;
    padding:18px;
    box-shadow:0 16px 34px rgba(59,130,246,.1);
  }
  .school-workspace-panel-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:14px; }
  .school-workspace-panel-title { font-size:1rem; font-weight:800; color:#312e81; }
  .school-workspace-panel-sub { margin-top:4px; font-size:.82rem; color:#475569; line-height:1.5; }
  .school-insight-stack { display:grid; gap:18px; }
  .school-profile-list {
    display:grid;
    gap:0;
    border:1px solid #e2e8f0;
    border-radius:14px;
    overflow:hidden;
    background:#f8fafc;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.85);
  }
  .school-profile-row {
    display:grid;
    grid-template-columns:clamp(118px,36%,168px) minmax(0,1fr);
    align-items:center;
    column-gap:18px;
    row-gap:4px;
    padding:11px 14px;
    border-bottom:1px solid #e2e8f0;
    background:#fff;
    min-height:46px;
  }
  .school-profile-row:nth-child(even) { background:#fafbff; }
  .school-profile-row:last-child { border-bottom:none; }
  .school-profile-label {
    color:#64748b;
    font-size:.74rem;
    font-weight:700;
    letter-spacing:.06em;
    text-transform:uppercase;
    line-height:1.35;
    align-self:center;
    max-width:100%;
  }
  .school-profile-value {
    margin:0;
    color:#0f172a;
    font-size:.895rem;
    font-weight:600;
    text-align:right;
    justify-self:end;
    align-self:center;
    line-height:1.45;
    overflow-wrap:anywhere;
    word-break:break-word;
    max-width:100%;
  }
  @media (max-width:520px) {
    .school-profile-row {
      grid-template-columns:1fr;
      align-items:start;
      row-gap:6px;
      min-height:0;
      padding:12px 14px;
    }
    .school-profile-value {
      text-align:left;
      justify-self:start;
    }
  }
  .school-admin-mini-list { display:grid; gap:10px; }
  .school-admin-mini-row {
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:12px;
    padding:12px 14px;
    border-radius:14px;
    border:1px solid #dbeafe;
    background:linear-gradient(135deg,#ffffff 0%,#f8fbff 100%);
  }
  .school-settings-readonly-note {
    margin:0;
    border-radius:14px;
    border:1px solid #bfdbfe;
    padding:14px 16px;
    font-size:.84rem;
    line-height:1.55;
  }
  .school-admin-mini-copy strong { display:block; color:#1e1b4b; }
  .school-admin-mini-copy span { display:block; margin-top:4px; font-size:.78rem; color:#475569; overflow-wrap:anywhere; }
  .school-activity-empty { color:#475569; font-size:.86rem; }
  .school-workspace-footnote {
    background:linear-gradient(120deg,#eef2ff 0%,#ecfeff 52%,#fef9c3 100%);
    border:1px solid #c7d2fe;
    border-radius:18px;
    padding:16px 18px;
    color:#334155;
    line-height:1.6;
  }
  .school-settings-shell { display:grid; gap:18px; }
  .school-settings-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:18px; align-items:stretch; }
  .school-settings-card {
    background:linear-gradient(145deg,#ffffff 0%,#f8fbff 40%,#ecfeff 100%);
    border:1px solid #bfdbfe;
    border-radius:20px;
    padding:0;
    box-shadow:0 18px 36px rgba(14,165,233,.1);
    display:flex;
    flex-direction:column;
    min-height:100%;
    overflow:hidden;
  }
  .school-settings-card-body { padding:0 18px 18px; flex:1; display:flex; flex-direction:column; min-height:0; }
  .school-settings-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:18px 18px 14px; border-bottom:1px solid rgba(191,219,254,.65); margin-bottom:0; }
  .school-settings-title { font-size:1rem; font-weight:800; color:#1d4ed8; }
  .school-settings-sub { margin-top:4px; font-size:.82rem; color:#475569; line-height:1.5; }
  .school-settings-form-grid { display:grid; gap:14px; }
  .school-settings-card-actions {
    display:flex;
    justify-content:flex-end;
    align-items:center;
    gap:10px;
    margin-top:16px;
    padding-top:16px;
    border-top:1px solid rgba(191,219,254,.55);
    flex-wrap:wrap;
  }
  .school-settings-switch {
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:12px;
    padding:12px 14px;
    border:1px solid #c7d2fe;
    border-radius:14px;
    background:linear-gradient(135deg,#eef2ff 0%,#ecfeff 100%);
  }
  .school-settings-switch-title { font-size:.84rem; font-weight:700; color:#1e3a8a; }
  .school-settings-switch-sub { margin-top:4px; font-size:.76rem; color:#475569; line-height:1.45; }
  .role-priv-shell { display:grid; gap:18px; }
  .role-priv-overview { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; }
  .role-priv-stat {
    position:relative;
    overflow:hidden;
    border-radius:20px;
    border:1px solid #dbeafe;
    padding:18px;
    background:linear-gradient(145deg,#ffffff 0%,#eff6ff 48%,#ecfeff 100%);
    box-shadow:0 18px 36px rgba(59,130,246,.12);
  }
  .role-priv-stat::after {
    content:"";
    position:absolute;
    inset:auto -28px -34px auto;
    width:110px;
    height:110px;
    border-radius:50%;
    background:radial-gradient(circle,rgba(59,130,246,.18),rgba(59,130,246,0));
    pointer-events:none;
  }
  .role-priv-stat-label { position:relative; z-index:1; font-size:.72rem; text-transform:uppercase; letter-spacing:.12em; font-weight:800; color:#64748b; }
  .role-priv-stat-value { position:relative; z-index:1; margin-top:10px; font-size:1.65rem; font-weight:900; color:#0f172a; letter-spacing:-.03em; }
  .role-priv-stat-sub { position:relative; z-index:1; margin-top:6px; color:#475569; font-size:.82rem; line-height:1.5; }
  .role-priv-layout { display:grid; grid-template-columns:minmax(280px,320px) minmax(0,1fr); gap:18px; align-items:start; }
  .role-priv-sidebar,
  .role-priv-toolbar,
  .role-priv-group-card,
  .role-priv-summary-card {
    background:linear-gradient(145deg,#ffffff 0%,#f8fbff 45%,#eef6ff 100%);
    border:1px solid #dbeafe;
    border-radius:22px;
    box-shadow:0 18px 38px rgba(15,23,42,.08);
  }
  .role-priv-sidebar { padding:18px; display:grid; gap:14px; }
  .role-priv-sidebar-head { display:grid; gap:6px; }
  .role-priv-sidebar-title { font-size:1rem; font-weight:900; color:#0f172a; }
  .role-priv-sidebar-sub { color:#64748b; font-size:.82rem; line-height:1.5; }
  .role-priv-role-list { display:grid; gap:10px; }
  .role-priv-role-card {
    width:100%;
    border:1px solid #dbeafe;
    border-radius:18px;
    padding:14px 15px;
    background:#fff;
    text-align:left;
    cursor:pointer;
    transition:transform .18s ease, box-shadow .18s ease, border-color .18s ease, background .18s ease;
    display:grid;
    gap:8px;
  }
  .role-priv-role-card:hover { transform:translateY(-1px); box-shadow:0 14px 28px rgba(59,130,246,.1); }
  .role-priv-role-card.active { box-shadow:0 18px 32px rgba(59,130,246,.14); }
  .role-priv-role-head { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
  .role-priv-role-name { font-size:.96rem; font-weight:900; }
  .role-priv-role-note { color:#64748b; font-size:.78rem; line-height:1.45; }
  .role-priv-role-count { display:inline-flex; align-items:center; gap:6px; width:max-content; padding:6px 10px; border-radius:999px; font-size:.74rem; font-weight:800; background:#eff6ff; color:#1d4ed8; }
  .role-priv-create-card { display:grid; gap:12px; padding:14px; border:1px dashed #bfdbfe; border-radius:18px; background:linear-gradient(135deg,#eff6ff 0%,#f8fbff 100%); }
  .role-priv-create-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
  .role-priv-create-actions { display:flex; gap:8px; flex-wrap:wrap; }
  .role-priv-create-key { display:inline-flex; align-items:center; gap:6px; width:max-content; padding:6px 10px; border-radius:999px; background:#dbeafe; color:#1d4ed8; font-size:.72rem; font-weight:800; }
  .role-priv-create-help { color:#475569; font-size:.76rem; line-height:1.45; }
  .role-priv-create-title { font-size:.92rem; font-weight:900; color:#1d4ed8; }
  .role-priv-create-sub { color:#64748b; font-size:.78rem; line-height:1.45; }
  .role-priv-role-footer { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
  .role-priv-role-meta { display:inline-flex; align-items:center; gap:6px; padding:5px 9px; border-radius:999px; font-size:.72rem; font-weight:800; }
  .role-priv-role-meta.system { background:#e2e8f0; color:#334155; }
  .role-priv-role-meta.custom { background:#dcfce7; color:#166534; }
  .role-priv-main { display:grid; gap:16px; }
  .role-priv-toolbar { padding:18px 20px; display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
  .role-priv-toolbar-copy { display:grid; gap:6px; min-width:0; }
  .role-priv-toolbar-kicker { font-size:.72rem; text-transform:uppercase; letter-spacing:.14em; font-weight:800; color:#64748b; }
  .role-priv-toolbar-title { font-size:1.2rem; font-weight:900; letter-spacing:-.03em; }
  .role-priv-toolbar-sub { color:#64748b; font-size:.84rem; line-height:1.55; max-width:62ch; }
  .role-priv-toolbar-actions { display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
  .role-priv-content { display:grid; grid-template-columns:minmax(0,1fr) 320px; gap:16px; align-items:start; }
  .role-priv-groups { display:grid; gap:16px; }
  .role-priv-group-card { padding:18px; display:grid; gap:14px; }
  .role-priv-group-head { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; }
  .role-priv-group-title { font-size:1rem; font-weight:900; color:#0f172a; }
  .role-priv-group-sub { margin-top:4px; color:#64748b; font-size:.8rem; line-height:1.5; }
  .role-priv-group-actions { display:flex; gap:8px; flex-wrap:wrap; }
  .role-priv-items { display:grid; gap:10px; }
  .role-priv-item {
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:12px;
    padding:14px 15px;
    border-radius:16px;
    border:1px solid #e2e8f0;
    background:#fff;
    cursor:pointer;
    transition:border-color .18s ease, background .18s ease, transform .18s ease, box-shadow .18s ease;
  }
  .role-priv-item:hover { transform:translateY(-1px); box-shadow:0 12px 24px rgba(15,23,42,.08); }
  .role-priv-item.active { border-color:var(--role-accent,#1d4ed8); background:linear-gradient(135deg,rgba(255,255,255,.98) 0%, var(--role-soft,#eff6ff) 100%); }
  .role-priv-item-copy { min-width:0; }
  .role-priv-item-title { font-weight:800; color:#0f172a; font-size:.9rem; }
  .role-priv-item-meta { margin-top:4px; font-size:.75rem; color:#64748b; text-transform:uppercase; letter-spacing:.08em; font-weight:700; }
  .role-priv-item-toggle { flex-shrink:0; }
  .role-priv-summary-column { display:grid; gap:16px; }
  .role-priv-summary-card { padding:18px; display:grid; gap:12px; }
  .role-priv-summary-title { font-size:.98rem; font-weight:900; color:#0f172a; }
  .role-priv-summary-sub { color:#64748b; font-size:.8rem; line-height:1.5; }
  .role-priv-chip-list { display:flex; flex-wrap:wrap; gap:8px; }
  .role-priv-chip { display:inline-flex; align-items:center; gap:8px; padding:8px 10px; border-radius:999px; background:#eff6ff; color:#1d4ed8; font-size:.76rem; font-weight:800; }
  .role-priv-chip-group { color:#64748b; font-size:.7rem; text-transform:uppercase; letter-spacing:.08em; }
  .role-priv-empty { color:#64748b; font-size:.84rem; line-height:1.5; }
  .role-priv-summary-list { display:grid; gap:10px; }
  .role-priv-summary-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 0; border-bottom:1px solid #eaf2ff; }
  .role-priv-summary-row:last-child { border-bottom:none; }
  .role-priv-summary-name { font-weight:800; }
  .role-priv-summary-count { color:#475569; font-size:.82rem; font-weight:700; }
  .role-priv-save-card { padding:18px; display:grid; gap:12px; background:linear-gradient(135deg,#eef2ff 0%,#ecfeff 100%); border:1px solid #c7d2fe; border-radius:22px; box-shadow:0 18px 38px rgba(99,102,241,.12); }
  .role-priv-save-title { font-size:1rem; font-weight:900; color:#1e3a8a; }
  .role-priv-save-sub { color:#475569; font-size:.82rem; line-height:1.55; }
  .role-priv-promo-card { padding:18px; display:grid; gap:12px; background:linear-gradient(135deg,#fffbeb 0%,#fff7ed 100%); border:1px solid #fed7aa; border-radius:22px; box-shadow:0 18px 38px rgba(245,158,11,.12); }
  .role-priv-promo-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  .role-priv-promo-title { font-size:1rem; font-weight:900; color:#9a3412; }
  .role-priv-promo-sub { color:#7c2d12; font-size:.82rem; line-height:1.55; }
  .role-priv-promo-selected { display:grid; gap:10px; padding:12px 14px; border-radius:16px; border:1px solid #fdba74; background:rgba(255,255,255,.78); }
  .role-priv-promo-selected-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
  .role-priv-promo-selected-name { font-size:.92rem; font-weight:900; color:#7c2d12; }
  .role-priv-promo-selected-meta { color:#9a3412; font-size:.78rem; line-height:1.5; }
  .role-priv-promo-badges { display:flex; gap:8px; flex-wrap:wrap; }
  .role-priv-promo-badge { display:inline-flex; align-items:center; gap:6px; padding:6px 10px; border-radius:999px; background:#fff; border:1px solid #fed7aa; color:#9a3412; font-size:.72rem; font-weight:800; }
  .role-priv-promo-list { display:grid; gap:8px; max-height:280px; overflow:auto; padding-right:4px; }
  .role-priv-promo-item { width:100%; text-align:left; padding:12px 14px; border-radius:16px; border:1px solid #fed7aa; background:#fff; display:grid; gap:8px; cursor:pointer; transition:transform .18s ease, box-shadow .18s ease, border-color .18s ease; }
  .role-priv-promo-item:hover { transform:translateY(-1px); box-shadow:0 12px 24px rgba(245,158,11,.12); }
  .role-priv-promo-item.active { border-color:#ea580c; box-shadow:0 16px 30px rgba(245,158,11,.16); }
  .role-priv-promo-item-head { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
  .role-priv-promo-item-name { font-size:.88rem; font-weight:800; color:#7c2d12; }
  .role-priv-promo-item-email { color:#9a3412; font-size:.76rem; word-break:break-word; }
  .role-priv-promo-item-meta { display:flex; gap:8px; flex-wrap:wrap; }
  .role-priv-promo-note { color:#9a3412; font-size:.76rem; line-height:1.5; }
  .messages-page { display:flex; flex-direction:column; height:calc(100vh - 120px); overflow:hidden; }
  .messages-layout { display:grid; grid-template-columns:minmax(220px,280px) minmax(0,1fr); gap:0; flex:1; overflow:hidden; border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,.1); }
  .messages-composer { display:flex; gap:8px; flex-shrink:0; }
  .messages-composer .form-control { min-width:0; }
  .messages-bubble { max-width:min(60%, 420px); }
  .toggle-row { display:flex; justify-content:space-between; gap:16px; align-items:center; padding:12px 0; border-bottom:1px solid #f1f5f9; }
  .toggle-row span { font-weight:600; }
  .metric-row { display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid #f1f5f9; }
  .metric-row-badge { padding:4px 12px; border-radius:8px; font-weight:700; font-size:.85rem; min-width:80px; text-align:center; }
  .metric-row-count { font-weight:700; width:32px; text-align:right; }
  .subject-progress-row { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
  .subject-progress-label { min-width:160px; font-weight:600; font-size:.85rem; }
  .subject-progress-value { width:42px; text-align:right; font-weight:700; }
  .progress-scale { display:flex; justify-content:space-between; margin-top:10px; font-size:.75rem; color:#64748b; }
  .card-grid-auto { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:12px; }
  .card-grid-tight { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:16px; }
  .search-input-compact { max-width:340px; margin-bottom:12px; }
  .form-group-narrow { max-width:260px; }
  .form-group-slim { max-width:220px; }
  .announcement-head { display:flex; justify-content:space-between; gap:10px; }
  .mobile-record-list { display:grid; gap:12px; }
  .mobile-record-card { background:#fff; border:1px solid #e2e8f0; border-radius:14px; box-shadow:var(--shadow); padding:14px; }
  .mobile-record-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:12px; }
  .mobile-record-identity { display:flex; align-items:center; gap:10px; min-width:0; }
  .mobile-record-avatar { width:40px; height:40px; border-radius:12px; background:#dbeafe; color:#1e40af; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:.76rem; flex-shrink:0; border:1px solid #bfdbfe; overflow:hidden; }
  .mobile-record-avatar img { width:100%; height:100%; object-fit:cover; }
  .mobile-record-title { font-weight:800; color:#0f172a; line-height:1.25; }
  .mobile-record-sub { font-size:.78rem; color:#64748b; margin-top:3px; word-break:break-word; }
  .mobile-record-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px 12px; }
  .mobile-record-item label { display:block; font-size:.7rem; text-transform:uppercase; letter-spacing:.5px; color:#94a3b8; font-weight:700; margin-bottom:4px; }
  .mobile-record-item strong,
  .mobile-record-item span { display:block; color:#0f172a; font-size:.88rem; }
  .mobile-record-actions { display:flex; gap:10px; margin-top:12px; }
  .mobile-record-actions .btn { flex:1; justify-content:center; }

  /* CARDS & LAYOUT */
  .card { background:#fff; border-radius:var(--radius); border:1px solid var(--border); box-shadow:var(--shadow); }
  .card-padded { padding:20px; }
  .page-header { background:linear-gradient(135deg,#1e293b,#0f172a); border-radius:var(--radius); padding:24px 28px; margin-bottom:24px; color:#fff; overflow-wrap:anywhere; }
  .page-title { font-size:1.75rem; font-weight:800; }
  .page-sub { color:#94a3b8; margin-top:4px; font-size:.9rem; }

  .stats-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin-bottom:24px; }
  .stat-card { background:#fff; border-radius:var(--radius); border:1px solid var(--border); padding:20px; box-shadow:var(--shadow); }
  .stat-label { font-size:.78rem; color:var(--text3); font-weight:600; text-transform:uppercase; letter-spacing:.5px; margin-bottom:8px; }
  .stat-value { font-size:1.8rem; font-weight:800; color:var(--text); }
  .stat-sub { font-size:.78rem; color:var(--text3); margin-top:4px; }
  .stat-icon { width:40px; height:40px; border-radius:10px; display:flex; align-items:center; justify-content:center; margin-bottom:12px; }
  .dashboard-stat-card {
    position:relative;
    overflow:hidden;
    background:linear-gradient(155deg,var(--dash-bg-start,#eff6ff) 0%, var(--dash-bg-end,#dbeafe) 100%);
    border-color:var(--dash-border, rgba(148,163,184,.24));
    box-shadow:0 14px 28px -24px var(--dash-shadow, rgba(30,41,59,.18));
  }
  .dashboard-stat-card::before {
    content:"";
    position:absolute;
    inset:auto -10% -42% auto;
    width:120px;
    height:120px;
    border-radius:50%;
    background:radial-gradient(circle, var(--dash-glow, rgba(255,255,255,.38)) 0%, rgba(255,255,255,0) 68%);
    pointer-events:none;
  }
  .dashboard-stat-card::after {
    content:"";
    position:absolute;
    inset:0;
    background:linear-gradient(180deg, rgba(255,255,255,.14), rgba(255,255,255,0) 38%);
    pointer-events:none;
  }
  .dashboard-stat-card .stat-value {
    letter-spacing:-.03em;
    text-wrap:balance;
    font-size:2rem;
    line-height:1;
  }
  .dashboard-stat-card .stat-icon {
    background:rgba(255,255,255,.56) !important;
    box-shadow:inset 0 0 0 1px rgba(255,255,255,.45);
    backdrop-filter:blur(4px);
  }
  .dashboard-stat-card .stat-label,
  .dashboard-stat-card .stat-value,
  .dashboard-stat-card .stat-sub {
    color:var(--dash-text, #0f172a) !important;
    position:relative;
    z-index:1;
  }
  .dashboard-stat-card .stat-label {
    opacity:.72;
    letter-spacing:.11em;
    margin-bottom:10px;
  }
  .dashboard-stat-card .stat-sub {
    opacity:.78;
    margin-top:8px;
    max-width:22ch;
    line-height:1.35;
  }
  body.dark-mode .dashboard-stat-card {
    border-color:rgba(96,165,250,.18);
    box-shadow:0 18px 32px -24px rgba(2,6,23,.72);
  }
  body.dark-mode .dashboard-stat-card .stat-icon {
    background:rgba(15,23,42,.22) !important;
    box-shadow:inset 0 0 0 1px rgba(191,219,254,.12);
  }

  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  .grid3 { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; }

  /* TABLE */
  .table-wrap { overflow-x:auto; border-radius:var(--radius); }
  .table-wrap table { min-width:680px; }
  table { width:100%; border-collapse:collapse; font-size:.875rem; }
  th { background:#f8fafc; padding:10px 14px; text-align:left; font-weight:700; color:var(--text2); font-size:.78rem; text-transform:uppercase; letter-spacing:.5px; border-bottom:2px solid var(--border); }
  .students-table thead th {
    background:linear-gradient(180deg,#eff6ff 0%, #dbeafe 100%);
    color:#1e3a8a;
    border-bottom:1px solid #bfdbfe;
    padding:14px 14px 12px;
    vertical-align:bottom;
  }
  .students-table thead th:first-child { border-top-left-radius:14px; }
  .students-table thead th:last-child { border-top-right-radius:14px; }
  .students-th-label {
    display:inline-flex;
    align-items:center;
    min-height:32px;
    padding:6px 10px;
    border-radius:999px;
    background:rgba(255,255,255,.72);
    box-shadow:inset 0 0 0 1px rgba(147,197,253,.9);
    font-size:.72rem;
    font-weight:800;
    letter-spacing:.08em;
  }
  .students-table thead th[data-col="aggregate"] .students-th-label {
    background:rgba(254,243,199,.8);
    box-shadow:inset 0 0 0 1px rgba(245,158,11,.35);
    color:#92400e;
  }
  .students-table thead th[data-col="aggregate"] { text-align:center; }
  .students-table thead th[data-col="aggregate"] .students-th-label { justify-content:center; }
  .students-table thead th[data-col="student-id"] { text-align:center; }
  .students-table thead th[data-col="student-id"] .students-th-label { justify-content:center; }
  .students-table td.students-id-cell { text-align:center; color:#94a3b8; font-family:monospace; }
  .students-table td.students-aggregate-cell { text-align:center; }
  body.dark-mode .students-table thead th {
    background:linear-gradient(180deg,#122033 0%, #16263d 100%);
    color:#bfdbfe;
    border-bottom-color:#29405f;
  }
  body.dark-mode .students-th-label {
    background:rgba(15,23,42,.72);
    box-shadow:inset 0 0 0 1px rgba(59,130,246,.35);
    color:#dbeafe;
  }
  body.dark-mode .students-table thead th[data-col="aggregate"] .students-th-label {
    background:rgba(120,53,15,.22);
    box-shadow:inset 0 0 0 1px rgba(245,158,11,.25);
    color:#fde68a;
  }
  td { padding:12px 14px; border-bottom:1px solid #f1f5f9; color:var(--text); }
  tr:last-child td { border-bottom:none; }
  tr:hover td { background:#f9fbff; }

  /* SCHOOL AND CLASS GROUPING */
  .school-group { margin-bottom: 24px; }
  .school-header {
    background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%);
    color: white;
    padding: 16px 20px;
    border-radius: 12px 12px 0 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .school-name {
    font-size: 1.2rem;
    font-weight: 700;
    margin: 0;
  }
  .school-count {
    font-size: 0.9rem;
    opacity: 0.9;
    background: rgba(255,255,255,0.2);
    padding: 4px 12px;
    border-radius: 20px;
  }
  .class-group { margin-bottom: 16px; }
  .class-header {
    background: #f1f5f9;
    padding: 12px 16px;
    border-left: 4px solid #3b82f6;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .class-name {
    font-size: 1rem;
    font-weight: 600;
    color: #1e40af;
    margin: 0;
  }
  .class-count {
    font-size: 0.8rem;
    color: #64748b;
    background: #e2e8f0;
    padding: 2px 8px;
    border-radius: 12px;
  }

  /* MOBILE RESPONSIVE STYLES */
  @media (max-width: 768px) {
    .school-header {
      padding: 12px 16px;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
    }
    .school-name {
      font-size: 1.1rem;
    }
    .school-count {
      font-size: 0.8rem;
    }
    .class-header {
      padding: 10px 14px;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
    }
    .class-name {
      font-size: 0.9rem;
    }
    .class-count {
      font-size: 0.75rem;
    }
  }

  /* BADGE */
  .badge { display:inline-flex; align-items:center; padding:3px 10px; border-radius:99px; font-size:.72rem; font-weight:700; }
  .badge-success { background:#dcfce7; color:#16a34a; }
  .badge-warning { background:#fef9c3; color:#d97706; }
  .badge-danger { background:#fee2e2; color:#dc2626; }
  .badge-blue { background:#dbeafe; color:#1e40af; }
  .badge-gray { background:#f1f5f9; color:#64748b; }

  /* FORM */
  .form-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  .form-group { display:flex; flex-direction:column; gap:6px; }
  .form-label { font-weight:600; font-size:.85rem; color:#374155; }
  .form-control { padding:10px 12px; border:2px solid #e2e8f0; border-radius:8px;
    font-family:var(--font); font-size:.9rem; outline:none; transition:border-color .2s; background:#fff; }
  .form-control:focus { border-color:var(--primary); }
  .btn { padding:10px 20px; border-radius:8px; font-family:var(--font); font-weight:700;
    font-size:.875rem; cursor:pointer; border:none; transition:all .2s; display:inline-flex; align-items:center; gap:6px; }
  .btn-sm { padding:7px 14px; font-size:.8rem; }
  .btn-blue { background:var(--primary); color:#fff; }
  .btn-blue:hover { background:var(--primary-d); }
  .btn-red { background:#dc2626; color:#fff; }
  .btn-green { background:#16a34a; color:#fff; }
  .btn-outline { background:#fff; border:2px solid var(--border); color:var(--text2); }
  .btn-outline:hover { border-color:var(--primary); color:var(--primary); }
  .record-action-group { display:inline-flex; align-items:center; gap:8px; }
  .record-action-btn { border-radius:999px; padding:7px 13px; border:1px solid transparent; font-weight:700; letter-spacing:.01em; }
  .record-action-btn.action-edit { background:#eff6ff; border-color:#bfdbfe; color:#1d4ed8; }
  .record-action-btn.action-edit:hover { background:#dbeafe; border-color:#93c5fd; color:#1e3a8a; }
  .record-action-btn.action-delete { background:#fff1f2; border-color:#fecdd3; color:#be123c; }
  .record-action-btn.action-delete:hover { background:#ffe4e6; border-color:#fda4af; color:#9f1239; }
  body.dark-mode .record-action-btn.action-edit { background:rgba(30,64,175,.2); border-color:rgba(96,165,250,.45); color:#bfdbfe; }
  body.dark-mode .record-action-btn.action-delete { background:rgba(159,18,57,.2); border-color:rgba(251,113,133,.4); color:#fecdd3; }

  /* PROFILE CARD */
  .profile-header { display:flex; align-items:center; gap:20px; padding:24px; background:linear-gradient(135deg,#1e3a8a,#1a56db); color:#fff; border-radius:var(--radius); margin-bottom:20px; }
  .profile-avatar { width:80px; height:80px; border-radius:16px; background:rgba(255,255,255,.2);
    display:flex; align-items:center; justify-content:center; font-size:2rem; font-weight:800;
    border:3px solid rgba(255,255,255,.4); color:#fff; flex-shrink:0; }
  .profile-name { font-size:1.4rem; font-weight:800; }
  .profile-role { opacity:.8; font-size:.875rem; margin-top:4px; }
  .student-verified-badge {
    display:inline-block;
    width:19px;
    height:19px;
    margin-left:7px;
    vertical-align:-3px;
    flex:none;
    filter:drop-shadow(0 1px 1px rgba(15,23,42,.16));
  }
  .student-profile-shell { display:grid; gap:18px; }
  .student-profile-hero {
    background:
      radial-gradient(circle at 88% 12%,rgba(147,197,253,.28),transparent 13rem),
      linear-gradient(125deg,#0b1730 0%,#173b78 56%,#2563eb 100%);
    color:#fff;
    border-radius:22px;
    border:1px solid rgba(191,219,254,.35);
    box-shadow:0 18px 42px rgba(30,64,130,.2);
    padding:clamp(18px,3vw,30px);
    display:grid;
    grid-template-columns:auto minmax(0,1fr) auto;
    gap:20px;
    align-items:center;
  }
  .student-profile-avatar {
    width:88px;
    height:88px;
    border-radius:24px;
    border:3px solid rgba(255,255,255,.72);
    background:linear-gradient(135deg,rgba(255,255,255,.26),rgba(255,255,255,.08));
    display:flex;
    align-items:center;
    justify-content:center;
    font-size:1.65rem;
    font-weight:800;
    letter-spacing:.6px;
    box-shadow:0 10px 24px rgba(5,15,38,.22);
  }
  .student-profile-title { font-size:clamp(1.25rem,2.4vw,1.8rem); font-weight:800; letter-spacing:-.025em; overflow-wrap:anywhere; }
  .student-profile-meta { margin-top:8px; color:rgba(226,232,240,.9); font-size:.9rem; line-height:1.6; overflow-wrap:anywhere; }
  .student-profile-pill {
    display:inline-flex;
    align-items:center;
    gap:6px;
    background:rgba(255,255,255,.12);
    border:1px solid rgba(226,232,240,.25);
    border-radius:999px;
    padding:5px 10px;
    font-size:.74rem;
    font-weight:700;
    color:#e2e8f0;
    margin-top:10px;
  }
  .student-profile-term {
    text-align:right;
    background:rgba(255,255,255,.12);
    border:1px solid rgba(226,232,240,.26);
    border-radius:12px;
    padding:10px 12px;
    min-width:180px;
    max-width:100%;
  }
  .student-profile-term small { display:block; font-size:.72rem; color:#dbeafe; text-transform:uppercase; letter-spacing:.08em; margin-bottom:5px; }
  .student-profile-term strong { display:block; font-size:1rem; }
  .student-profile-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:18px; align-items:start; }
  .student-profile-card { background:#fff; border:1px solid var(--border); border-radius:14px; box-shadow:var(--shadow); }
  .student-profile-card-head {
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:10px;
    border-bottom:1px solid #e2e8f0;
    padding:17px 18px;
  }
  .student-profile-card-head h3 { font-size:.94rem; font-weight:800; color:#0f172a; letter-spacing:-.01em; }
  .student-profile-card-body { padding:16px 18px; }
  .student-profile-list { display:grid; gap:10px; }
  .student-profile-row {
    display:grid;
    grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr);
    align-items:start;
    gap:14px;
    padding:12px 14px;
    border-radius:12px;
    background:linear-gradient(135deg,#f8fafc,#f4f7fc);
    border:1px solid #e7edf5;
  }
  .student-profile-row label { font-size:.7rem; text-transform:uppercase; letter-spacing:.055em; color:#64748b; font-weight:700; line-height:1.5; }
  .student-profile-row span { min-width:0; font-size:.9rem; font-weight:650; color:#0f172a; text-align:right; overflow-wrap:anywhere; line-height:1.5; }
  .student-profile-kpis { display:grid; grid-template-columns:1fr; gap:10px; }
  .student-profile-kpi {
    border-radius:12px;
    padding:12px;
    border:1px solid #e2e8f0;
  }
  .student-profile-kpi label { display:block; font-size:.72rem; text-transform:uppercase; letter-spacing:.45px; font-weight:700; margin-bottom:6px; }
  .student-profile-kpi strong { display:block; font-size:1rem; font-weight:800; }
  .student-profile-kpi small { display:block; font-size:.76rem; margin-top:4px; }
  .student-profile-help { margin-top:10px; font-size:.82rem; color:#64748b; line-height:1.45; }

  /* GRADE CHIP */
  .grade-chip { display:inline-flex; align-items:center; justify-content:center; min-width:48px;
    padding:3px 10px; border-radius:8px; font-weight:700; font-size:.85rem; }

  /* RESULTS VISUALS */
  .results-visual-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px; margin-bottom:16px; }
  .results-panel { background:#fff; border-radius:var(--radius); border:1px solid var(--border); box-shadow:var(--shadow); padding:16px; }
  .results-panel h3 { font-size:.9rem; font-weight:800; color:#0f172a; margin-bottom:12px; }
  .results-donut { width:138px; height:138px; border-radius:50%; margin:0 auto; display:flex; align-items:center; justify-content:center; position:relative; }
  .results-donut::after { content:""; position:absolute; width:86px; height:86px; border-radius:50%; background:#fff; box-shadow:inset 0 0 0 1px #e2e8f0; }
  .results-donut-center { position:relative; z-index:1; text-align:center; }
  .results-donut-center strong { display:block; font-size:1.2rem; color:#0f172a; }
  .results-donut-center span { font-size:.72rem; color:#64748b; }
  .results-legend { margin-top:12px; display:grid; gap:6px; }
  .results-legend-item { display:flex; align-items:center; justify-content:space-between; font-size:.78rem; color:#334155; }
  .results-legend-item b { font-weight:700; }
  .results-dot { width:10px; height:10px; border-radius:50%; margin-right:8px; display:inline-block; }
  .results-bars { display:grid; gap:8px; }
  .results-bar-row { display:grid; grid-template-columns:88px 1fr 44px; align-items:center; gap:10px; font-size:.76rem; }
  .results-bar-track { height:10px; border-radius:99px; background:#e2e8f0; overflow:hidden; }
  .results-bar-fill { height:100%; border-radius:99px; }
  .results-line-chart { width:100%; height:170px; }
  .results-line-chart polyline { fill:none; stroke:#1d4ed8; stroke-width:3; stroke-linecap:round; stroke-linejoin:round; }
  .results-line-chart .area { fill:url(#resultsLineFill); stroke:none; opacity:.9; }
  .results-line-chart .point { fill:#1d4ed8; stroke:#fff; stroke-width:2; }
  .results-axis-labels { display:flex; justify-content:space-between; margin-top:8px; font-size:.72rem; color:#64748b; }

  /* PROGRESS */
  .progress { background:#e2e8f0; border-radius:99px; height:8px; overflow:hidden; }
  .progress-bar { height:100%; border-radius:99px; transition:width .4s; }

  /* ATTENDANCE CIRCLE */
  .att-circle { width:80px; height:80px; border-radius:50%; display:flex; flex-direction:column;
    align-items:center; justify-content:center; font-weight:800; font-size:1.1rem; }

  /* SELECTION */
  .selection-card { border:2px solid var(--border); border-radius:var(--radius); padding:14px 16px;
    cursor:pointer; transition:all .2s; display:flex; align-items:center; gap:12px; background:#fff; }
  .selection-card:hover { border-color:var(--primary); background:var(--primary-l); }
  .selection-card.selected { border-color:var(--primary); background:#eff6ff; }
  .cat-badge { width:28px; height:28px; border-radius:8px; display:flex; align-items:center;
    justify-content:center; font-weight:800; font-size:.8rem; flex-shrink:0; }
  .cat-A { background:#fef3c7; color:#92400e; }
  .cat-B { background:#dbeafe; color:#1e40af; }
  .cat-C { background:#dcfce7; color:#166534; }

  /* ALERT */
  .alert { padding:12px 16px; border-radius:var(--radius); font-size:.875rem; margin-bottom:16px; }
  .alert-success { background:#dcfce7; color:#16a34a; border:1px solid #bbf7d0; }
  .alert-warning { background:#fef9c3; color:#854d0e; border:1px solid #fde68a; }
  .alert-danger { background:#fee2e2; color:#dc2626; border:1px solid #fecaca; }
  .alert-info { background:#dbeafe; color:#1e40af; border:1px solid #bfdbfe; }

  /* CHAT */
  .chat-msg { padding:10px 14px; border-radius:12px; max-width:70%; margin-bottom:8px; font-size:.9rem; }
  .chat-msg.mine { background:var(--primary); color:#fff; margin-left:auto; }
  .chat-msg.theirs { background:#f1f5f9; color:var(--text); }

  /* MOBILE */
  .bottom-nav { display:none; position:fixed; bottom:0; left:0; right:0;
    background:linear-gradient(180deg,#ffffff 0%,#f8fbff 100%);
    border-top:1px solid #dbe5f3; z-index:100; padding:5px 7px; height:60px;
    box-shadow:0 -6px 14px rgba(15,23,42,.06); }
  .bottom-nav-grid { display:grid; height:100%; gap:4px; }
  .bottom-nav-item { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:8px 4px; border-radius:16px; transition:all .2s ease; font-size:.75rem; gap:6px; color:#64748b; background:none; border:none; cursor:pointer; position:relative; }
    background:none; border:none; cursor:pointer; font-family:var(--font); font-size:.64rem;
    color:#64748b; gap:1px; border-radius:8px; transition:all .2s; position:relative; }
  .bottom-nav-item svg { width:30px; height:30px; }
  .bottom-nav-item span { font-weight:600; letter-spacing:.02em; font-size:.7rem; transition:all .2s ease; }
  .bottom-nav-item:hover { background:#eef5ff; transform:translateY(-1px); }
  .bottom-nav-item.active { color:#3b82f6; background:linear-gradient(135deg,#dbeafe 0%,#bfdbfe 100%); box-shadow:0 4px 16px rgba(59,130,246,.2); transform:translateY(-1px); }

  .fade-in { animation: fadeIn .3s ease; }
  @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }

  .spinner { width:32px; height:32px; border:3px solid #e2e8f0; border-top-color:var(--primary);
    border-radius:50%; animation:spin .7s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }

  .sidebar-overlay { display:none; position:fixed; inset:0; background:rgba(15,23,42,.45); z-index:109; }
  @media (max-width:1023px) {
    .landing .form-input,
    .app .form-control,
    .app .form-input,
    .app input,
    .app select,
    .app textarea { font-size:16px; }
  }
  @media (max-width:1280px) {
    .stats-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .students-summary-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .students-table-head { flex-wrap:wrap; gap:10px; }
    .students-table-status { width:100%; text-align:center; }
  }
  @media (max-width:1023px) {
    .sidebar-overlay { display:block; }
  }

  @media (max-width:1023px) {
    .stats-grid { grid-template-columns:1fr 1fr; }
    .main { margin-left:0 !important; width:100%; }
    .sidebar { transform:translateX(-100%); z-index:110; }
    .sidebar:not(.closed) { transform:translateX(0); box-shadow:4px 0 24px rgba(15,23,42,.18); }
    .bottom-nav { display:block; }
    .main { padding-bottom:calc(80px + env(safe-area-inset-bottom)); }
    .school-workspace-summary { grid-template-columns:repeat(3,minmax(0,1fr)); }
    .school-workspace-grid { grid-template-columns:1fr; }
    .school-settings-grid { grid-template-columns:1fr 1fr; }
    .registered-school-head { flex-wrap:wrap; }
    .registered-school-badges { justify-content:flex-start; }
  }

  @media (max-width:767px) {
    :root { --topbar-h: 58px; }
    .topbar { padding:0 10px; gap:8px; }
    .topbar-left { gap:6px; flex:1; min-width:0; padding-left:34px; }
    .menu-btn {
      position:absolute;
      left:10px;
      top:50%;
      transform:translateY(-50%);
      z-index:2;
    }
    .topbar-right { gap:6px; max-width:none; margin-left:auto; }
    .topbar-actions { max-width:100%; }
    .desktop-only-action { display:none; }
    .bell-mobile-visible { display:flex; }
    .topbar-logo { width:50px; height:50px; }
    .topbar-btn { width:32px; height:32px; }

    .sidebar { width:min(280px,85vw); padding-bottom:80px; }

    .main { padding:14px 10px calc(82px + env(safe-area-inset-bottom)); }
    .page-header { padding:16px 18px; margin-bottom:16px; }
    .page-title { font-size:1.3rem; }
    .page-sub { font-size:.8rem; }

    .stats-grid { grid-template-columns:1fr 1fr; gap:10px; margin-bottom:16px; }
  .stats-grid-3,
  .stats-grid-4-compact { grid-template-columns:1fr 1fr; }
    .stat-card { padding:14px; }
    .stat-value { font-size:1.4rem; }
    .stat-icon { width:34px; height:34px; }

    .grid2, .grid3, .form-grid { grid-template-columns:1fr; gap:10px; }
  .results-visual-grid,
  .results-visual-grid-wide { grid-template-columns:1fr; }
    .results-donut { width:122px; height:122px; }
    .results-donut::after { width:74px; height:74px; }
  .results-bar-row { grid-template-columns:minmax(0,84px) 1fr 40px; gap:8px; }

    .card-padded { padding:14px; }

    .profile-header { flex-wrap:wrap; gap:14px; padding:18px; }
    .profile-avatar { width:64px; height:64px; font-size:1.6rem; }
    .profile-name { font-size:1.15rem; }
    .student-profile-hero { grid-template-columns:auto minmax(0,1fr); text-align:left; }
    .student-profile-term { grid-column:1 / -1; text-align:left; min-width:0; }
    .student-profile-grid { grid-template-columns:1fr; }
    .student-profile-row { grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr); gap:10px; }

    .chat-msg { max-width:88%; }
    .chat-layout { flex-direction:column; }
    .messages-page { height:auto; min-height:calc(100vh - 96px); overflow:visible; }
    .messages-layout { grid-template-columns:1fr; }
    .messages-bubble { max-width:88%; }
    .messages-composer { flex-wrap:wrap; }
    .messages-composer button,
    .messages-composer .btn { width:100%; }
    .toggle-row,
    .metric-row,
    .subject-progress-row,
    .announcement-head { flex-wrap:wrap; align-items:flex-start; }
    .metric-row-badge,
    .subject-progress-label,
    .subject-progress-value { min-width:0; width:auto; }
    .card-grid-auto,
    .card-grid-tight { grid-template-columns:1fr; }
    .search-input-compact,
    .form-group-narrow,
    .form-group-slim { max-width:none; width:100%; }
    .mobile-record-grid { grid-template-columns:1fr; }
    .mobile-record-actions { flex-direction:column; }

    .table-wrap { font-size:.8rem; -webkit-overflow-scrolling:touch; }
    .table-wrap table { min-width:620px; }
    th, td { padding:8px 10px; }

    .btn { padding:9px 14px; font-size:.82rem; }
    .modal-card { padding:16px; border-radius:16px; max-height:92vh; }
    .modal-actions { flex-wrap:wrap; }
    .modal-actions .btn { flex:1; justify-content:center; }

    .landing-box { padding:22px 18px; border-radius:28px; }
    .landing-title { font-size:1.45rem; }
    .landing-install-btn { padding:13px 14px; }
    .portal-btn { padding:13px 10px; }
    .enroll-panel { grid-template-columns:1fr; }
    .enroll-hero { flex-direction:column; padding:20px 18px; }
    .enroll-hero-title { font-size:1.55rem; }
    .enroll-hero-pills { justify-content:flex-start; }
    .enroll-layout { flex-direction:column; gap:16px; }
    .enroll-photo-col { width:100%; flex-basis:auto; align-items:flex-start; }
    .enroll-form-head,
    .enroll-actions { padding-left:18px; padding-right:18px; }
    .enroll-form-body { padding:18px; }
    .enroll-fields { grid-template-columns:1fr; }
    .enroll-actions { flex-direction:column; align-items:stretch; }
    .enroll-actions-row { width:100%; }
    .enroll-actions-row .btn { flex:1; justify-content:center; }
    .enroll-mini-stats { grid-template-columns:1fr 1fr; }
    .students-hero { flex-direction:column; padding:20px 18px; }
    .students-hero-title { font-size:1.55rem; }
    .students-hero-actions { justify-items:start; min-width:0; }
    .students-summary-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .students-toolbar { flex-direction:column; align-items:stretch; }
    .students-toolbar-actions { width:100%; justify-content:stretch; }
    .students-search { max-width:none; width:100%; }
    .students-toolbar-actions .btn { justify-content:center; }
    .role-priv-overview,
    .role-priv-content,
    .role-priv-layout { grid-template-columns:1fr; }
    .role-priv-toolbar,
    .role-priv-group-head { flex-direction:column; }
    .role-priv-toolbar-actions,
    .role-priv-group-actions { justify-content:flex-start; }
    .school-reg-hero { flex-direction:column; padding:20px 18px; }
    .school-reg-title { font-size:1.55rem; }
    .school-reg-grid { grid-template-columns:1fr; }
    .school-reg-head,
    .school-reg-section,
    .school-reg-actions { padding-left:18px; padding-right:18px; }
    .school-reg-actions { flex-direction:column; align-items:stretch; }
    .school-reg-actions-row { width:100%; }
    .school-reg-actions-row .btn { flex:1; justify-content:center; }
    .registered-school-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .registered-school-head,
    .registered-school-body { padding:16px; }
    .school-admin-row,
    .school-admin-mini-row { flex-direction:column; align-items:stretch; }
    .school-admin-block-head,
    .school-admin-form-head,
    .school-workspace-panel-head,
    .school-settings-head { flex-direction:column; align-items:flex-start; }
    .school-workspace-hero { flex-direction:column; padding:20px 18px; }
    .school-workspace-title { font-size:1.55rem; }
    .school-workspace-meta { justify-items:start; min-width:0; width:100%; }
    .school-workspace-note { max-width:none; width:100%; }
    .school-workspace-summary { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .school-settings-grid { grid-template-columns:1fr; }

    .selection-card { padding:11px 12px; }
    .bottom-nav { height:calc(76px + env(safe-area-inset-bottom)); padding:6px 5px calc(6px + env(safe-area-inset-bottom)); }
    .bottom-nav-item { font-size:.6rem; gap:4px; }
    .bottom-nav-item svg { width:30px; height:30px; }
    .bottom-nav-item span { font-size:.56rem; }
  }

  @media (max-width:479px) {
    .stats-grid { grid-template-columns:1fr 1fr; gap:8px; }
    .stat-card { padding:12px; }
    .stat-value { font-size:1.2rem; }
    .stat-label { font-size:.7rem; }

    .page-header { padding:12px 14px; }
    .page-title { font-size:1.15rem; }

    .main { padding:10px 8px calc(78px + env(safe-area-inset-bottom)); }
    .card-padded { padding:12px; }

    .profile-header { padding:14px; gap:10px; }
    .profile-avatar { width:54px; height:54px; font-size:1.3rem; }
    .profile-name { font-size:1rem; }
    .profile-role { font-size:.78rem; }
    .student-profile-avatar { width:64px; height:64px; font-size:1.2rem; border-radius:18px; }
    .student-profile-title { font-size:1.1rem; }
    .student-profile-meta { font-size:.8rem; }
    .student-profile-row { grid-template-columns:1fr; gap:4px; }
    .student-profile-row span { text-align:left; }
    .student-profile-card-head, .student-profile-card-body { padding:12px; }
    .student-profile-row { padding:9px 10px; }

    .portal-grid { grid-template-columns:1fr 1fr; gap:8px; }
    .portal-btn { padding:12px 8px; }
    .portal-btn-label { font-size:.85rem; }
    .page-actions-row .form-control,
    .page-actions-row .btn { width:100%; flex-basis:100%; }

    .landing-box { padding:22px 14px; border-radius:26px; }
    .landing-title { font-size:1.55rem; }
    .landing-logo { width:112px; height:112px; }
    .landing-install-btn { padding:12px 13px; gap:10px; }
    .landing-install-icon { width:36px; height:36px; }

    .btn { padding:8px 12px; }
    .btn-sm { padding:6px 10px; font-size:.76rem; }

    .modal-card { padding:12px; }
    .modal-title { font-size:1rem; }

    .topbar { padding:0 8px; }
    .topbar-left { gap:4px; padding-left:30px; }
    .menu-btn { left:8px; }
    .topbar-right { gap:4px; max-width:calc(100% - 32px); }
    .topbar-actions { border-radius:10px; }
    .portal-grid { grid-template-columns:1fr; }
    .stats-grid-3,
    .stats-grid-4-compact { grid-template-columns:1fr; }
    .role-priv-sidebar,
    .role-priv-toolbar,
    .role-priv-group-card,
    .role-priv-summary-card,
    .role-priv-save-card { padding:14px; border-radius:18px; }
    .role-priv-item { padding:12px; }
    .role-priv-role-card { padding:12px; }
    .mobile-record-head { flex-direction:column; }
    .mobile-record-identity { width:100%; }
    .metric-row-count { margin-left:auto; }
    .school-reg-summary-grid,
    .registered-school-grid,
    .school-workspace-summary { grid-template-columns:1fr; }
    .school-reg-toolbar { flex-direction:column; align-items:stretch; }
    .school-reg-toolbar .btn { width:100%; justify-content:center; }
  }

  @media (max-width:430px) {
    .topbar { padding:0 7px; }
    .topbar-left { gap:4px; padding-left:28px; }
    .menu-btn { left:7px; }
    .topbar-right { gap:4px; max-width:calc(100% - 28px); }
    .topbar-btn { width:30px; height:30px; }
    .topbar-app-btn { width:38px; padding:0 4px; }
    .topbar-app-logo { width:22px; height:22px; }

    .main { padding:10px 8px calc(80px + env(safe-area-inset-bottom)); }
    .page-header { padding:12px 14px; }
    .page-title { font-size:1.12rem; }
    .page-sub { font-size:.76rem; }

    .stats-grid,
    .stats-grid-3,
    .stats-grid-4-compact,
    .portal-grid { grid-template-columns:1fr; }

    .results-bar-row { grid-template-columns:minmax(0,76px) 1fr 34px; gap:6px; font-size:.72rem; }
    .messages-bubble { max-width:92%; }
    .metric-row-badge { min-width:0; }
    .metric-row-count { width:auto; margin-left:auto; }
    .subject-progress-label { min-width:110px; }
    .subject-progress-value { width:36px; }

    .bottom-nav { height:calc(72px + env(safe-area-inset-bottom)); padding:5px 4px calc(5px + env(safe-area-inset-bottom)); }
    .bottom-nav-grid { gap:2px; }
    .bottom-nav-item { font-size:.56rem; gap:3px; }
    .bottom-nav-item svg { width:28px; height:28px; }
    .bottom-nav-item span { font-size:.52rem; }
    .enroll-hero { padding:18px 16px; border-radius:18px; }
    .enroll-hero-title { font-size:1.38rem; }
    .enroll-sidebar { padding:14px; border-radius:18px; }
    .enroll-photo-card,
    .enroll-guidance,
    .enroll-section { border-radius:16px; }
    .enroll-form-head,
    .enroll-form-body,
    .enroll-actions { padding-left:14px; padding-right:14px; }
    .enroll-form-head { flex-direction:column; }
    .enroll-actions-row { flex-direction:column; }
    .enroll-actions-row .btn { width:100%; }
    .enroll-mini-stats { grid-template-columns:1fr; }
    .students-hero { padding:18px 16px; border-radius:18px; }
    .students-hero-title { font-size:1.38rem; }
    .students-summary-grid { grid-template-columns:1fr; }
    .students-toolbar { padding:14px; border-radius:18px; }
    .students-toolbar-actions { flex-direction:column; }
    .students-toolbar-actions .btn { width:100%; }
    .students-table-head { flex-direction:column; align-items:flex-start; padding:14px; }
    .school-reg-hero { padding:18px 16px; border-radius:18px; }
    .school-reg-title { font-size:1.36rem; }
    .school-reg-side { padding:14px; border-radius:18px; }
    .school-reg-head { flex-direction:column; padding:16px 14px; }
    .school-reg-section { padding-left:14px; padding-right:14px; }
    .school-reg-actions { padding:18px 14px 14px; }
    .school-reg-actions-row { flex-direction:column; }
    .school-reg-actions-row .btn { width:100%; }
    .registered-school-head,
    .registered-school-body { padding:14px; }
    .registered-school-grid { grid-template-columns:1fr; }
    .school-admin-row,
    .school-admin-form-head { flex-direction:column; align-items:flex-start; }
  }

  @media (max-width:399px) {
    .topbar { padding:0 6px; }
    .topbar-left { padding-left:26px; }
    .menu-btn { left:6px; }
    .topbar-right { gap:3px; max-width:calc(100% - 28px); }
    .topbar-actions { border-radius:9px; }
    .topbar-btn { width:28px; height:28px; }
    .topbar-app-btn { width:34px; padding:0 4px; }
    .topbar-app-logo { width:20px; height:20px; border-radius:6px; }
    .notif-badge { width:14px; height:14px; font-size:.52rem; top:-3px; right:-3px; }
    .page-actions-row { gap:8px; }
    .page-actions-row .form-control,
    .page-actions-row .btn { flex-basis:100%; width:100%; }
    .results-donut { width:104px; height:104px; }
    .results-donut::after { width:62px; height:62px; }
    .results-donut-center strong { font-size:1rem; }
    .results-donut-center span { font-size:.66rem; }
    .subject-progress-row { gap:8px; }
    .subject-progress-label,
    .subject-progress-value { font-size:.76rem; }
    .card-padded { padding:10px; }
    .modal-card { padding:10px; border-radius:14px; }
    th, td { padding:6px; font-size:.76rem; }
  }

  @media (min-width:1024px) {
    .topbar-left { justify-content:center; }
    .topbar-search {
      flex:0 1 60vw;
      max-width:760px;
      min-width:420px;
      margin-left:16px;
      margin-right:auto;
    }
    .sidebar { transform:translateX(0) !important; }
    .sidebar.closed { transform:translateX(-100%) !important; }
    .main { margin-left:var(--sidebar-w); }
    .main.full { margin-left:0; width:100vw; }
    .menu-btn { display:flex; }
  }

  @media (min-width:1280px) {
    .stats-grid { grid-template-columns:repeat(4,1fr); }
  }
  @media (max-width:480px) {
    .stats-grid { grid-template-columns:1fr; }
    .page-title { font-size:1.3rem; }
  }

  /* LIVE TESTS */
  .tests-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:20px; margin-top:20px; }
  .test-card { background:#fff; border-radius:16px; padding:20px; box-shadow:var(--shadow); border:1px solid var(--border); }
  .origin-badge { display:inline-flex; align-items:center; justify-content:center; margin-left:8px; padding:2px 6px; background:linear-gradient(135deg,#eef2ff 0%,#e0e7ff 100%); border-radius:12px; border:1px solid rgba(99,102,241,.2); }
  .test-header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px; }
  .test-title { font-size:1.1rem; font-weight:700; color:#0f172a; flex:1; margin-right:12px; }
  .test-status { font-size:.8rem; font-weight:600; padding:4px 8px; border-radius:12px; background:#f3f4f6; white-space:nowrap; }
  .test-meta { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px; }
  .test-subject, .test-class, .test-type, .test-duration, .test-questions { font-size:.8rem; color:#64748b; background:#f8fafc; padding:4px 8px; border-radius:8px; }
  .test-description { font-size:.9rem; color:#475569; margin-bottom:16px; line-height:1.5; }
  .test-score { display:flex; align-items:center; gap:6px; font-weight:600; color:#16a34a; margin-bottom:16px; }
  .test-actions { display:flex; gap:10px; }
  .test-actions button { flex:1; border-radius:14px; }
  .mapped-badge { display:inline-flex; align-items:center; gap:8px; padding:10px 14px; border-radius:999px; background:#eff6ff; color:#075985; font-weight:600; font-size:.86rem; margin-bottom:12px; border:1px solid rgba(14,165,233,.18); }

  .learning-hub-level-picker { padding:22px; margin-bottom:20px; border:1px solid var(--border); border-radius:20px; background:var(--surface); color:var(--text); }
  .learning-hub-level-heading h2 { margin:0 0 5px; font-size:1.05rem; }
  .learning-hub-level-heading p { margin:0; color:var(--text2); font-size:.9rem; }
  .learning-hub-filters { display:grid; grid-template-columns:repeat(2,minmax(180px,1fr)); gap:14px; max-width:620px; margin:20px 0; }
  .learning-hub-filters label { display:grid; gap:6px; color:var(--text2); font-size:.85rem; font-weight:600; }
  .learning-dashboard-cta { display:flex; align-items:center; justify-content:space-between; gap:16px; }
  .learning-dashboard-cta h3 { margin:0 0 6px; }
  .learning-dashboard-cta p { margin:0; color:var(--text2); line-height:1.5; }
  @media (max-width:640px) {
    .learning-hub-filters { grid-template-columns:1fr; }
    .learning-dashboard-cta { align-items:flex-start; flex-direction:column; }
  }

  .study-content-page .page-header { background:linear-gradient(135deg,#1e293b 0%,#334155 50%,#475569 100%); border-radius:24px; padding:28px 32px; margin-bottom:28px; color:#fff; box-shadow:0 24px 60px rgba(30,41,59,.15); }
  .study-content-page .page-header .page-title { font-size:2rem; margin-bottom:8px; }
  .study-content-page .page-header .page-sub { color:rgba(241,245,249,.85); font-size:1rem; max-width:720px; line-height:1.6; }
  .study-content-page .page-actions-row { align-items:center; justify-content:space-between; gap:16px; margin-bottom:28px; }
  .study-content-page .page-actions-row .btn-blue { min-width:185px; }

  .study-content-page .activity-panel { background:linear-gradient(180deg,#ffffff 0%,#f1f5f9 50%,#e2e8f0 100%); border-radius:24px; padding:28px; margin-bottom:28px; border:1px solid rgba(71,85,105,.18); box-shadow:0 24px 60px rgba(30,41,59,.08); }
  .study-content-page .activity-header { display:flex; justify-content:space-between; gap:18px; flex-wrap:wrap; align-items:flex-start; margin-bottom:22px; }
  .study-content-page .activity-summary-grid { gap:18px; }
  .study-content-page .activity-summary-card { background:linear-gradient(135deg,#ffffff 0%,#f8fafc 100%); padding:22px; border-radius:20px; border:1px solid rgba(203,213,225,.8); box-shadow:0 14px 40px rgba(30,41,59,.06); transition:transform .2s ease, border-color .2s ease, box-shadow .2s ease; }
  .study-content-page .activity-summary-card:hover { transform:translateY(-1px); border-color:rgba(59,130,246,.25); box-shadow:0 20px 50px rgba(30,41,59,.1); }
  .study-content-page .summary-label { font-size:.82rem; text-transform:uppercase; letter-spacing:.08em; color:#64748b; margin-bottom:10px; }
  .study-content-page .summary-value { font-size:1.9rem; font-weight:800; color:#1e293b; }

  .study-content-page .activity-table-card { background:linear-gradient(135deg,#ffffff 0%,#f8fafc 100%); padding:24px; border-radius:24px; border:1px solid rgba(203,213,225,.8); box-shadow:0 18px 44px rgba(30,41,59,.08); margin-top:20px; }
  .study-content-page .activity-table th { background:linear-gradient(135deg,#f1f5f9 0%,#e2e8f0 100%); color:#1e293b; font-weight:700; text-transform:uppercase; letter-spacing:.04em; }
  .study-content-page .activity-table tbody tr:hover { background:linear-gradient(135deg,#f8fafc 0%,#f1f5f9 100%); }
  .study-content-page .activity-table td { color:#475569; }
  .study-content-page .lesson-activity-summary { background:linear-gradient(135deg,#eff6ff 0%,#dbeafe 100%); border-radius:16px; padding:16px 18px; margin-bottom:20px; color:#1e293b; border:1px solid rgba(59,130,246,.2); position:relative; }
  .study-content-page .lesson-activity-summary::before { content:''; position:absolute; top:0; left:0; width:4px; height:100%; background:linear-gradient(180deg,#3b82f6,#1d4ed8); border-radius:16px 0 0 16px; }

  .study-content-page .empty-state { padding:42px 20px; color:#64748b; }
  .study-content-page .tests-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:24px; margin-top:28px; }
  .study-content-page .test-card { background:linear-gradient(135deg,#ffffff 0%,#f8fafc 100%); border-radius:24px; padding:28px; box-shadow:0 24px 60px rgba(30,41,59,.08); border:1px solid rgba(203,213,225,.8); transition:transform .2s ease, box-shadow .2s ease; display:flex; flex-direction:column; position:relative; overflow:hidden; }
  .study-content-page .test-card::before { content:''; position:absolute; top:0; left:0; right:0; height:4px; background:linear-gradient(90deg,#3b82f6,#1d4ed8,#7c3aed); }
  .study-content-page .test-card:hover { transform:translateY(-4px); box-shadow:0 32px 80px rgba(30,41,59,.15); }
  .study-content-page .test-header { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; margin-bottom:20px; padding-bottom:16px; border-bottom:1px solid rgba(203,213,225,.6); }
  .study-content-page .test-title { font-size:1.2rem; line-height:1.35; font-weight:600; color:#1e293b; margin-bottom:4px; }
  .study-content-page .origin-badge { display:inline-flex; align-items:center; justify-content:center; margin-left:8px; padding:2px 6px; background:linear-gradient(135deg,#eef2ff 0%,#e0e7ff 100%); border-radius:12px; border:1px solid rgba(99,102,241,.2); }
  .study-content-page .test-status { background:linear-gradient(135deg,#fef3c7 0%,#fde68a 100%); color:#92400e; padding:6px 12px; border-radius:20px; font-size:.75rem; font-weight:600; text-transform:uppercase; letter-spacing:.05em; border:1px solid rgba(245,158,11,.3); }
  .study-content-page .test-meta { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:20px; }
  .study-content-page .test-meta span { background:linear-gradient(135deg,#f1f5f9 0%,#e2e8f0 100%); color:#475569; border:1px solid rgba(148,163,184,.4); padding:8px 12px; border-radius:16px; font-size:.82rem; font-weight:500; transition:transform .15s ease, box-shadow .15s ease; }
  .study-content-page .test-meta span:hover { transform:translateY(-1px); box-shadow:0 4px 12px rgba(30,41,59,.1); }
  .study-content-page .test-description { margin-bottom:18px; line-height:1.7; color:#64748b; font-size:.95rem; padding:16px; background:linear-gradient(135deg,#fafbfc 0%,#f1f5f9 100%); border-radius:12px; border-left:4px solid #3b82f6; }
  .study-content-page .test-actions { display:flex; gap:12px; flex-wrap:wrap; margin-top:auto; padding-top:16px; border-top:1px solid rgba(203,213,225,.6); }
  .study-content-page .test-actions button { min-width:140px; padding:10px 16px; border-radius:12px; font-weight:600; font-size:.85rem; transition:all .2s ease; border:none; cursor:pointer; }
  .study-content-page .test-actions button:hover { transform:translateY(-1px); box-shadow:0 8px 20px rgba(30,41,59,.15); }
  .study-content-page .test-actions .btn-sm { padding:9px 16px; }

  @media (max-width: 768px) {
    .study-content-page .test-card { padding:20px; }
    .study-content-page .test-header { flex-direction:column; align-items:flex-start; gap:12px; }
    .study-content-page .test-actions { flex-direction:column; }
    .study-content-page .test-actions button { min-width:100%; }
  }

  .activity-panel { background:#f8fafc; border:1px solid #e2e8f0; border-radius:20px; padding:20px; margin-bottom:24px; }
  .activity-summary-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:12px; margin-top:16px; }
  .activity-summary-card { background:#fff; border-radius:16px; padding:16px; border:1px solid #e2e8f0; }
  .summary-label { font-size:.85rem; color:#64748b; margin-bottom:8px; }
  .summary-value { font-size:1.5rem; font-weight:700; color:#0f172a; }
  .activity-table-card { background:#fff; border-radius:16px; border:1px solid #e2e8f0; padding:16px; margin-top:18px; }
  .activity-table-wrap { overflow-x:auto; }
  .activity-table { width:100%; border-collapse:collapse; }
  .activity-table th,
  .activity-table td { text-align:left; padding:12px 10px; border-bottom:1px solid #e2e8f0; font-size:.86rem; color:#334155; }
  .activity-table th { color:#0f172a; font-weight:700; }
  .lesson-activity-summary { background:#f1f5f9; border-radius:14px; padding:10px 14px; margin-bottom:16px; font-size:.9rem; color:#0f172a; }

  .empty-state { text-align:center; padding:60px 20px; color:#6b7280; }
  .empty-title { font-size:1.2rem; font-weight:600; margin:16px 0 8px; }
  .empty-subtitle { font-size:.9rem; }

  /* Test Editor Modal */
  .modal-overlay { position:fixed; inset:0; background:rgba(15,23,42,.52); display:flex; align-items:center; justify-content:center; padding:20px; z-index:1200; }
  .modal-content { width:min(800px, 100%); max-height:85vh; overflow:auto; background:#fff; border-radius:20px; box-shadow:0 24px 80px rgba(15,23,42,.28); }
  .modal-content.large-modal { width:min(1000px, 100%); }
  .modal-content.fullscreen-modal {
    width: 100%;
    height: 100%;
    max-height: none;
    min-height: 100%;
    margin: 0;
    border-radius: 0;
    overflow: hidden;
  }
  .modal-content.fullscreen-modal .modal-body {
    height: calc(100% - 84px);
    overflow: auto;
  }
  .modal-content.fullscreen-modal {
    width: 100%;
    height: 100%;
    max-height: none;
    min-height: 100%;
    margin: 0;
    border-radius: 0;
    overflow: hidden;
  }
  .modal-content.fullscreen-modal .modal-body {
    height: calc(100% - 84px);
    overflow: auto;
  }
  .modal-header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:18px; padding:24px 24px 0; }
  .modal-header h3 { font-size:1.3rem; font-weight:800; color:#0f172a; margin:0; }
  .modal-close { border:none; background:#eef2ff; color:#1e3a8a; width:36px; height:36px; border-radius:10px; cursor:pointer; display:flex; align-items:center; justify-content:center; }
  .modal-body { padding:0 24px; }
  .modal-footer { display:flex; justify-content:flex-end; gap:10px; margin-top:18px; padding:0 24px 24px; }

  .questions-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; }
  .questions-list { display:flex; flex-direction:column; gap:16px; }
  .question-item { background:#f8fafc; border-radius:12px; padding:16px; border:1px solid #e2e8f0; }
  .question-header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px; flex-wrap:wrap; gap:8px; }
  .question-number { font-weight:700; color:#1a56db; margin-right:8px; }
  .question-text { flex:1; font-weight:500; }
  .question-meta { display:flex; gap:12px; align-items:center; }
  .question-type { font-size:.75rem; color:#6b7280; background:#f3f4f6; padding:2px 6px; border-radius:4px; text-transform:uppercase; font-weight:600; }
  .question-points { font-size:.8rem; color:#64748b; background:#fff; padding:2px 6px; border-radius:6px; border:1px solid #e2e8f0; }
  .question-answers { margin-top:12px; }
  .answer-option { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
  .answer-option.correct .answer-text { font-weight:600; color:#16a34a; }
  .answer-letter { font-weight:700; color:#374151; min-width:20px; }
  .question-explanation { margin-top:12px; padding:12px; background:#ecfdf5; border-radius:8px; border-left:4px solid #16a34a; }

  .form-group { margin-bottom:16px; }
  .form-group label { display:block; font-weight:600; color:#374151; margin-bottom:6px; }
  .form-row { display:flex; gap:12px; }
  .form-row .form-group { flex:1; }
  .answer-input-row { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
  .answer-input-row input[type="radio"] { margin:0; }
  .answer-input-row input[type="text"] { flex:1; }
  .btn-icon { border:none; background:#f3f4f6; color:#6b7280; width:32px; height:32px; border-radius:6px; cursor:pointer; display:flex; align-items:center; justify-content:center; }

  /* Test Taking */
  .test-taking { max-width:800px; margin:0 auto; }
  .test-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; padding:20px; background:#fff; border-radius:16px; box-shadow:var(--shadow); }
  .test-timer { display:flex; align-items:center; gap:6px; font-weight:700; font-size:1.1rem; }
  .test-progress { margin-bottom:24px; }
  .progress-bar { height:8px; background:#e2e8f0; border-radius:4px; overflow:hidden; margin-bottom:8px; }
  .progress-fill { height:100%; background:linear-gradient(90deg,#1a56db,#3b82f6); transition:width .3s ease; }
  .progress-text { text-align:center; font-size:.9rem; color:#64748b; }
  .question-card { background:#fff; border-radius:16px; padding:24px; box-shadow:var(--shadow); margin-bottom:24px; }
  .question-text { font-size:1.1rem; font-weight:600; margin-bottom:20px; line-height:1.6; }
  .question-answers { display:flex; flex-direction:column; gap:12px; }
  .answer-option { display:flex; align-items:center; gap:12px; padding:16px; border:2px solid #e2e8f0; border-radius:12px; cursor:pointer; transition:all .2s; }
  .answer-option:hover { border-color:#1a56db; background:#f0f9ff; }
  .answer-option input[type="radio"] { margin:0; width:18px; height:18px; }
  .answer-label { display:flex; align-items:center; gap:8px; flex:1; }
  .short-answer-input { margin-top:12px; }
  .short-answer-input .form-input { padding:12px; font-size:1rem; }
  .long-text-input { margin-top:12px; }
  .long-text-input .form-input { padding:12px; font-size:1rem; line-height:1.5; }
  .true-false-options { display:flex; gap:12px; }
  .true-false-options .answer-option { flex:1; justify-content:center; }
  .test-navigation { display:flex; justify-content:space-between; gap:16px; }
  .test-navigation button { flex:1; max-width:200px; }

  @media (max-width:768px) {
    .tests-grid { grid-template-columns:1fr; }
    .test-header { flex-direction:column; align-items:flex-start; gap:8px; }
    .test-actions { flex-direction:column; }
    .modal-content { width:95%; margin:20px; }
    .form-row { flex-direction:column; }
    .test-navigation { flex-direction:column; }
    .test-navigation button { max-width:none; }
  }

/* PARENT PORTAL STYLES */
.portal-container {
  min-height: 100vh;
  background: #f8fafc;
  display: flex;
  flex-direction: column;
}

.portal-container.dark-mode {
  background: #0f172a;
  color: #e2e8f0;
}

.portal-main {
  display: flex;
  flex: 1;
  position: relative;
}

.portal-sidebar {
  width: 280px;
  background: white;
  border-right: 1px solid #e2e8f0;
  position: fixed;
  top: 60px;
  left: 0;
  bottom: 60px;
  z-index: 1000;
  transform: translateX(-100%);
  transition: transform 0.3s ease;
  overflow-y: auto;
}

.portal-sidebar.open {
  transform: translateX(0);
}

.portal-container.dark-mode .portal-sidebar {
  background: #1e293b;
  border-right: 1px solid #334155;
}

.sidebar-content {
  padding: 20px;
}

.portal-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-section {
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 16px 0 8px 0;
  padding: 0 12px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: #475569;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 14px;
  font-weight: 500;
}

.nav-item:hover {
  background: #f1f5f9;
}

.nav-item.active {
  background: var(--nav-color);
  color: white;
}

.portal-container.dark-mode .nav-item {
  color: #cbd5e1;
}

.portal-container.dark-mode .nav-item:hover {
  background: #334155;
}

.portal-content-area {
  flex: 1;
  margin-left: 0;
  margin-bottom: 60px;
  padding: 20px;
  overflow-y: auto;
}

.portal-content {
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 24px;
}

.page-header h1 {
  font-size: 28px;
  font-weight: 700;
  color: #1e293b;
  margin: 0 0 8px 0;
}

.portal-container.dark-mode .page-header h1 {
  color: #f1f5f9;
}

.page-header p {
  color: #64748b;
  margin: 0;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 20px;
  margin-bottom: 32px;
}

.dashboard-card {
  background: white;
  border-radius: 12px;
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 16px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.portal-container.dark-mode .dashboard-card {
  background: #1e293b;
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
}

.card-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f1f5f9;
}

.card-content h3 {
  font-size: 24px;
  font-weight: 700;
  color: #1e293b;
  margin: 0 0 4px 0;
}

.portal-container.dark-mode .card-content h3 {
  color: #f1f5f9;
}

.card-content p {
  color: #64748b;
  margin: 0;
  font-size: 14px;
}

.children-overview h2 {
  font-size: 20px;
  font-weight: 600;
  color: #1e293b;
  margin: 32px 0 16px 0;
}

.portal-container.dark-mode .children-overview h2 {
  color: #f1f5f9;
}

.children-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.child-card {
  background: white;
  border-radius: 12px;
  padding: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.child-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}

.portal-container.dark-mode .child-card {
  background: #1e293b;
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
}

.child-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f1f5f9;
}

.child-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.child-info h4 {
  font-size: 16px;
  font-weight: 600;
  color: #1e293b;
  margin: 0 0 4px 0;
}

.portal-container.dark-mode .child-info h4 {
  color: #f1f5f9;
}

.child-info p {
  color: #64748b;
  margin: 0;
  font-size: 14px;
}

.children-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.child-detail-card {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.portal-container.dark-mode .child-detail-card {
  background: #1e293b;
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
}

.child-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}

.child-avatar-large {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f1f5f9;
}

.child-avatar-large img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.child-details h3 {
  font-size: 20px;
  font-weight: 600;
  color: #1e293b;
  margin: 0 0 8px 0;
}

.portal-container.dark-mode .child-details h3 {
  color: #f1f5f9;
}

.child-details p {
  color: #64748b;
  margin: 4px 0;
}

.child-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #64748b;
}

.empty-state h3 {
  font-size: 18px;
  font-weight: 600;
  color: #475569;
  margin: 16px 0 8px 0;
}

.portal-container.dark-mode .empty-state h3 {
  color: #cbd5e1;
}

.empty-state p {
  margin: 0;
}

.notifications-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.notification-item {
  background: white;
  border-radius: 8px;
  padding: 16px;
  border-left: 4px solid #3b82f6;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.notification-item.unread {
  border-left-color: #f59e0b;
  background: #fefce8;
}

.portal-container.dark-mode .notification-item {
  background: #1e293b;
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
}

.notification-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.notification-header h4 {
  font-size: 16px;
  font-weight: 600;
  color: #1e293b;
  margin: 0;
}

.portal-container.dark-mode .notification-header h4 {
  color: #f1f5f9;
}

.notification-date {
  font-size: 12px;
  color: #64748b;
}

.notification-item p {
  color: #475569;
  margin: 8px 0;
  line-height: 1.5;
}

.notification-item small {
  color: #64748b;
  font-size: 12px;
}

.portal-bottom-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: white;
  border-top: 1px solid #e2e8f0;
  display: flex;
  justify-content: space-around;
  padding: 8px 0;
  z-index: 1000;
}

.portal-container.dark-mode .portal-bottom-nav {
  background: #1e293b;
  border-top: 1px solid #334155;
}

.bottom-nav-item {
  background: none;
  border: none;
  padding: 8px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.bottom-nav-item.active {
  background: rgba(59, 130, 246, 0.1);
}

.portal-container > .sidebar-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.5);
  z-index: 999;
}

.portal-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  gap: 16px;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #e2e8f0;
  border-top: 4px solid #3b82f6;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.btn-secondary {
  background: #f1f5f9;
  color: #475569;
  border: 1px solid #cbd5e1;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  transition: all 0.2s ease;
}

.btn-secondary:hover {
  background: #e2e8f0;
  border-color: #94a3b8;
}

.portal-container.dark-mode .btn-secondary {
  background: #334155;
  color: #cbd5e1;
  border-color: #475569;
}

.portal-container.dark-mode .btn-secondary:hover {
  background: #475569;
  border-color: #64748b;
}

/* Mobile responsive */
@media (max-width: 768px) {
  .portal-sidebar {
    width: 100%;
  }

  .portal-content-area {
    padding: 16px;
  }

  .dashboard-grid {
    grid-template-columns: 1fr;
  }

  .children-grid {
    grid-template-columns: 1fr;
  }

  .child-header {
    flex-direction: column;
    text-align: center;
  }

  .child-actions {
    justify-content: center;
  }

  .page-header h1 {
    font-size: 24px;
  }
}

/* Shared soft-blue workspace theme */
.app {
  background:
    radial-gradient(circle at 100% 0%, rgba(201,219,255,.34), transparent 30rem),
    radial-gradient(circle at 0% 50%, rgba(224,235,255,.42), transparent 32rem),
    linear-gradient(145deg,#f4f7ff 0%,#edf2ff 55%,#f8f9ff 100%);
  background-attachment:fixed;
}
.app .topbar {
  background:rgba(248,250,255,.88);
  border-bottom:1px solid rgba(208,220,244,.76);
  box-shadow:0 6px 24px rgba(67,94,153,.08);
  backdrop-filter:blur(18px);
  -webkit-backdrop-filter:blur(18px);
}
.app .menu-btn,
.app .topbar-btn { color:#38598e; }
.app .menu-btn svg,
.app .topbar-btn svg { color:#38598e !important; }
.app .topbar-actions {
  background:rgba(226,235,252,.68);
  border-color:rgba(202,216,242,.85);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.85);
}
.app .topbar-actions .topbar-btn + .topbar-btn { box-shadow:-1px 0 0 rgba(157,178,216,.3); }
.app .topbar-btn:hover { background:rgba(197,215,250,.62); }
.app .topbar-app-logo {
  border-color:rgba(171,193,232,.55);
  box-shadow:0 3px 8px rgba(58,91,157,.12);
}
.app .sidebar {
  background:rgba(249,251,255,.88);
  border-right-color:rgba(208,220,244,.82);
  box-shadow:8px 0 30px rgba(75,101,157,.035);
  backdrop-filter:blur(16px);
  -webkit-backdrop-filter:blur(16px);
}
.app .sidebar-brand { border-bottom-color:rgba(208,220,244,.7); }
.app .sidebar-brand img {
  border-color:rgba(255,255,255,.92);
  border-radius:20px;
  box-shadow:0 8px 22px rgba(73,107,178,.15);
}
.app .sidebar-section { color:#8494b2; letter-spacing:.11em; }
.app .nav-item { border-radius:14px; }
.app .nav-item:hover { background:rgba(223,234,255,.74); }
.app .nav-item.active {
  background:linear-gradient(115deg,rgba(226,237,255,.98),rgba(240,245,255,.88));
  box-shadow:inset 0 0 0 1px rgba(162,190,240,.42),0 5px 14px rgba(80,113,179,.07);
}
.app .main { background:transparent; }
.app .card,
.app .stat-card:not(.dashboard-stat-card),
.app .student-profile-card,
.app .mobile-record-card,
.app .results-panel,
.app .selection-card {
  background:rgba(255,255,255,.88);
  border-color:rgba(212,223,243,.86);
  border-radius:18px;
  box-shadow:0 10px 28px rgba(70,98,157,.065),inset 0 1px 0 rgba(255,255,255,.92);
}
.app .card-padded { padding:22px; }
.app .page-header {
  background:linear-gradient(135deg,rgba(255,255,255,.94),rgba(233,241,255,.9));
  border:1px solid rgba(211,224,247,.82);
  border-radius:22px;
  color:#182947;
  box-shadow:0 12px 28px rgba(69,99,160,.075);
}
.app .page-title { color:#182947; }
.app .page-sub { color:#71809a; }
.app .form-control,
.app .form-input,
.app select,
.app textarea {
  border-color:rgba(204,217,240,.95);
  border-radius:12px;
  background:rgba(255,255,255,.82);
  color:#263752;
  box-shadow:inset 0 1px 2px rgba(79,106,158,.035);
  transition:border-color .18s ease,box-shadow .18s ease,background .18s ease;
}
.app .form-control:focus,
.app .form-input:focus,
.app select:focus,
.app textarea:focus {
  border-color:#8bb5f7;
  outline:none;
  background:#fff;
  box-shadow:0 0 0 3px rgba(78,133,224,.13),0 4px 12px rgba(75,110,175,.06);
}
.app .btn { border-radius:12px; transition:transform .16s ease,box-shadow .16s ease,background .16s ease; }
.app .btn-blue {
  background:linear-gradient(105deg,#26a5ee 0%,#3265ed 58%,#5848e8 100%);
  box-shadow:0 6px 16px rgba(49,101,220,.18);
}
.app .btn-blue:hover { background:linear-gradient(105deg,#168ed8,#2856dc 58%,#4939d2); transform:translateY(-1px); }
.app .btn-outline { background:rgba(255,255,255,.8); border-radius:12px; }
.app .table-wrap {
  border:1px solid rgba(211,223,243,.8);
  background:rgba(255,255,255,.82);
  box-shadow:0 8px 24px rgba(70,98,157,.045);
}
.app th { background:linear-gradient(180deg,#f5f8ff,#ebf1ff); color:#536684; }
.app tr:hover td { background:rgba(235,242,255,.62); }
.app .modal-card {
  border:1px solid rgba(214,225,244,.9);
  background:rgba(250,252,255,.97);
  box-shadow:0 24px 70px rgba(44,66,111,.2);
  backdrop-filter:blur(16px);
}
.app .bottom-nav {
  border-top:1px solid rgba(210,222,244,.85);
  background:rgba(248,250,255,.92);
  box-shadow:0 -8px 24px rgba(73,99,153,.06);
  backdrop-filter:blur(16px);
  -webkit-backdrop-filter:blur(16px);
}
.app .bottom-nav-item { border-radius:14px; }
.app .bottom-nav-item:hover { background:rgba(226,237,255,.68); }
.app .bottom-nav-item.active {
  color:#315fc0;
  background:linear-gradient(135deg,#e6efff,#f4f7ff);
  box-shadow:inset 0 0 0 1px rgba(176,199,239,.5);
}
body.dark-mode .app {
  background:
    radial-gradient(circle at 100% 0%,rgba(36,69,126,.23),transparent 30rem),
    radial-gradient(circle at 0% 50%,rgba(25,49,92,.2),transparent 32rem),
    linear-gradient(145deg,#0b1220,#101a2d 58%,#0d1628);
}
body.dark-mode .app .topbar {
  background:rgba(13,22,39,.9);
  border-bottom-color:rgba(76,101,145,.35);
}
body.dark-mode .app .menu-btn,
body.dark-mode .app .topbar-btn,
body.dark-mode .app .menu-btn svg,
body.dark-mode .app .topbar-btn svg { color:#d5e3ff !important; }
body.dark-mode .app .topbar-actions {
  background:rgba(40,58,91,.58);
  border-color:rgba(111,139,186,.3);
}
body.dark-mode .app .topbar-actions .topbar-btn + .topbar-btn { box-shadow:-1px 0 0 rgba(148,174,218,.15); }
body.dark-mode .app .sidebar {
  background:rgba(14,24,42,.94);
  border-right-color:rgba(76,101,145,.35);
}
body.dark-mode .app .sidebar-brand { border-bottom-color:rgba(76,101,145,.32); }
body.dark-mode .app .sidebar-section { color:#8295b7; }
body.dark-mode .app .nav-item:hover { background:rgba(42,64,103,.48); }
body.dark-mode .app .nav-item.active {
  background:linear-gradient(115deg,rgba(36,70,130,.72),rgba(30,53,96,.82));
  box-shadow:inset 0 0 0 1px rgba(105,149,223,.3);
}
body.dark-mode .app .card,
body.dark-mode .app .stat-card:not(.dashboard-stat-card),
body.dark-mode .app .student-profile-card,
body.dark-mode .app .mobile-record-card,
body.dark-mode .app .results-panel,
body.dark-mode .app .selection-card {
  background:rgba(17,29,50,.92);
  border-color:rgba(66,89,130,.48);
  box-shadow:0 12px 30px rgba(0,0,0,.14),inset 0 1px 0 rgba(255,255,255,.025);
}
body.dark-mode .app .page-header {
  background:linear-gradient(135deg,rgba(21,37,64,.96),rgba(23,43,78,.9));
  border-color:rgba(76,101,145,.4);
  color:#e4edff;
}
body.dark-mode .app .page-title { color:#e4edff; }
body.dark-mode .app .page-sub { color:#aabbd8; }
body.dark-mode .app .form-control,
body.dark-mode .app .form-input,
body.dark-mode .app select,
body.dark-mode .app textarea {
  background:rgba(12,21,37,.9);
  border-color:rgba(74,98,140,.55);
  color:#e2eaff;
}
body.dark-mode .app .form-control:focus,
body.dark-mode .app .form-input:focus,
body.dark-mode .app select:focus,
body.dark-mode .app textarea:focus {
  border-color:#70a3f4;
  background:#101d33;
  box-shadow:0 0 0 3px rgba(78,133,224,.16);
}
body.dark-mode .app .table-wrap {
  background:rgba(15,26,45,.88);
  border-color:rgba(66,89,130,.44);
}
body.dark-mode .app th { background:linear-gradient(180deg,#172944,#14233b); color:#c0d2f2; }
body.dark-mode .app tr:hover td { background:rgba(29,48,78,.5); }
body.dark-mode .app .modal-card {
  background:rgba(15,26,45,.97);
  border-color:rgba(76,101,145,.48);
}
body.dark-mode .app .bottom-nav {
  background:rgba(13,22,39,.94);
  border-top-color:rgba(76,101,145,.36);
}
body.dark-mode .app .bottom-nav-item:hover { background:rgba(42,64,103,.48); }
body.dark-mode .app .bottom-nav-item.active {
  color:#c4d8ff;
  background:linear-gradient(135deg,rgba(36,70,130,.52),rgba(30,53,96,.62));
  box-shadow:inset 0 0 0 1px rgba(105,149,223,.24);
}

/* Admin workspace */
.admin-app {
  background:#f4f7fc;
}
.admin-app .topbar {
  background:#fff;
  border-bottom:1px solid #e6ebf3;
  box-shadow:0 2px 12px rgba(22,42,78,.04);
}
.admin-app .topbar-left { padding-left:42px; }
.admin-app .topbar-name {
  display:block !important;
  color:#142748;
  font-size:.95rem;
  font-weight:800;
}
.admin-app .menu-btn,
.admin-app .topbar-btn,
.admin-app .menu-btn svg,
.admin-app .topbar-btn svg { color:#435979 !important; }
.admin-app .topbar-actions {
  background:#f4f7fb;
  border-color:#e4eaf3;
  box-shadow:none;
}
.admin-app .topbar-actions .topbar-btn + .topbar-btn { box-shadow:-1px 0 0 #e1e8f1; }
.admin-app .topbar-btn:hover { background:#e9eff8; }
.admin-app .sidebar {
  background:#102344;
  border-right:1px solid #20385d;
  box-shadow:8px 0 24px rgba(16,35,68,.08);
  backdrop-filter:none;
}
.admin-app .sidebar-brand {
  justify-content:flex-start;
  gap:11px;
  padding:12px 9px 18px;
  border-bottom-color:rgba(195,213,241,.14);
}
.admin-app .sidebar-brand img {
  width:42px;
  height:42px;
  flex:0 0 42px;
  border:1px solid rgba(255,255,255,.25);
  border-radius:12px;
  box-shadow:none;
}
.admin-sidebar-brand-copy { display:grid; gap:3px; text-align:left; }
.admin-sidebar-brand-copy strong {
  color:#f8fbff;
  font-size:.87rem;
  font-weight:800;
  letter-spacing:-.01em;
}
.admin-sidebar-brand-copy small {
  color:#91a7ca;
  font-size:.58rem;
  font-weight:750;
  letter-spacing:.14em;
}
.admin-app .sidebar-section {
  padding:17px 11px 6px;
  color:#8196b8;
  font-size:.62rem;
  font-weight:750;
  letter-spacing:.13em;
}
.admin-app .nav-item {
  gap:11px;
  padding:9px 11px;
  margin:2px 0;
  border-radius:9px;
  color:#b8c8df;
  transition:background .16s ease,color .16s ease;
}
.admin-app .nav-item:hover {
  background:rgba(255,255,255,.08);
  color:#fff;
  transform:none;
}
.admin-app .nav-item.active {
  background:#244c87;
  color:#fff;
  font-weight:700;
  box-shadow:inset 0 0 0 1px rgba(151,190,255,.16);
}
.admin-app .nav-item.active::before { width:3px; background:#77b7ff; }
.admin-app .nav-item .nav-item-icon,
.admin-app .nav-item .nav-item-label,
.admin-app .nav-item > span:last-child {
  color:inherit !important;
}
.admin-app .nav-item .nav-item-icon { opacity:.9; }
.admin-app .nav-item.active .nav-item-icon { opacity:1; }
.admin-app .main { padding:28px 32px 36px; }
.admin-app .main.full { margin-left:0; }
.admin-app .admin-dashboard-header {
  position:relative;
  display:flex;
  align-items:flex-end;
  justify-content:space-between;
  gap:20px;
  margin-bottom:22px;
  padding:22px 24px;
  border:0;
  border-radius:20px;
  background:
    radial-gradient(circle at 88% 18%,rgba(255,255,255,.2),transparent 14rem),
    linear-gradient(135deg,#d7eeff 0%, #8dc5ff 10%, #4c9ef5 40%, #276ae7 100%);
  box-shadow:0 12px 26px rgba(37,99,235,.18);
  overflow:hidden;
}
.admin-dashboard-eyebrow {
  margin-bottom:7px;
  color:#c8dcff;
  font-size:.68rem;
  font-weight:800;
  letter-spacing:.13em;
  text-transform:uppercase;
}
.admin-app .admin-dashboard-header .page-title {
  color:#fff;
  font-size:1.75rem;
  font-weight:800;
  letter-spacing:-.035em;
}
.admin-app .admin-dashboard-header .page-sub {
  margin-top:5px;
  color:rgba(255,255,255,.82);
  font-size:.86rem;
}
.admin-dashboard-header-meta {
  display:grid;
  justify-items:end;
  gap:4px;
  color:rgba(255,255,255,.9);
  text-align:right;
}
.admin-app .admin-dashboard-header-meta [aria-label="Current date and time"] {
  justify-content:flex-end;
  margin-top:0 !important;
  color:rgba(255,255,255,.95) !important;
  font-size:.78rem !important;
}
.admin-dashboard-period { color:rgba(255,255,255,.76); font-size:.72rem; font-weight:650; }
.admin-dashboard-heading {
  display:flex;
  min-width:0;
  align-items:center;
  gap:15px;
}
.admin-dashboard-avatar {
  display:grid;
  width:54px;
  height:54px;
  flex:0 0 54px;
  place-items:center;
  border:1px solid #e6e9fb;
  border-radius:16px;
  background:linear-gradient(145deg,#eef1ff,#f7edff);
  color:#6659d9;
  font-size:1rem;
  font-weight:850;
  box-shadow:0 5px 12px rgba(82,102,220,.1);
}
.admin-dashboard-session {
  display:grid;
  gap:3px;
  min-width:158px;
  padding:9px 12px;
  border:1px solid #e9eaf4;
  border-radius:11px;
  background:rgba(255,255,255,.8);
  text-align:left;
}
.admin-dashboard-session span {
  color:#929ab0;
  font-size:.58rem;
  font-weight:800;
  letter-spacing:.1em;
}
.admin-dashboard-session strong { color:#26334f; font-size:.8rem; }
.admin-dashboard-session small { color:#75809a; font-size:.7rem; }
.student-dashboard-heading { min-width:0; }
.student-dashboard-welcome {
  display:flex;
  align-items:center;
  gap:14px;
}
.student-dashboard-avatar {
  display:flex;
  width:54px;
  height:54px;
  flex:0 0 54px;
  align-items:center;
  justify-content:center;
  overflow:hidden;
  border:2px solid rgba(255,255,255,.64);
  border-radius:15px;
  background:rgba(255,255,255,.18);
  color:#fff;
  font-size:1.05rem;
  font-weight:800;
  box-shadow:0 5px 12px rgba(20,35,90,.16);
}
.student-dashboard-avatar img {
  width:100%;
  height:100%;
  object-fit:cover;
}
.student-dashboard-deadline {
  margin:12px 0 0 68px;
  color:#fff1c2;
  font-size:.76rem;
  font-weight:750;
}
.student-dashboard-shell {
  display:grid;
  grid-template-columns:minmax(260px,330px) minmax(0,1fr);
  gap:20px;
  align-items:start;
  width:min(100%, 1080px);
  margin:0 auto;
}
.student-dashboard-profile-card {
  position:relative;
  overflow:hidden;
  display:grid;
  gap:16px;
  padding:22px 18px 18px;
  border:1px solid rgba(255,255,255,.7);
  border-radius:26px;
  background:linear-gradient(180deg,rgba(255,255,255,.68),rgba(255,255,255,.56));
  box-shadow:0 16px 34px rgba(85,108,178,.12), inset 0 1px 0 rgba(255,255,255,.85);
}
.student-dashboard-profile-card::before {
  content:"";
  position:absolute;
  inset:-20% auto auto -18%;
  width:180px;
  height:180px;
  border-radius:50%;
  background:radial-gradient(circle, rgba(72,155,255,.2), rgba(72,155,255,0));
  pointer-events:none;
}
.student-dashboard-profile-header {
  display:flex;
  align-items:center;
  justify-content:center;
}
.student-dashboard-profile-name {
  position:relative;
  z-index:1;
  display:flex;
  align-items:flex-start;
  gap:8px;
  flex-wrap:wrap;
  color:#24344d;
  font-size:1.06rem;
  font-weight:800;
  line-height:1.4;
}
.student-dashboard-profile-meta,
.student-dashboard-profile-deadline {
  position:relative;
  z-index:1;
  color:#53657f;
  font-size:.8rem;
  line-height:1.5;
}
.student-dashboard-profile-deadline {
  display:inline-flex;
  align-items:center;
  padding:10px 12px;
  border:1px solid rgba(129,155,220,.22);
  border-radius:12px;
  background:rgba(255,255,255,.42);
  color:#2d5fc1;
  font-weight:700;
}
.student-dashboard-mini-grid {
  position:relative;
  z-index:1;
  display:grid;
  gap:10px;
  margin-top:4px;
}
.student-dashboard-mini-item {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  padding:11px 12px;
  border:1px solid rgba(147,170,222,.18);
  border-radius:14px;
  background:rgba(255,255,255,.36);
  color:#4a5d7a;
  font-size:.72rem;
}
.student-dashboard-mini-item strong {
  color:#20304d;
  font-size:.82rem;
}
.student-dashboard-quick-links {
  position:relative;
  z-index:1;
  display:flex;
  flex-wrap:wrap;
  gap:8px;
  margin-top:4px;
}
.student-dashboard-quick-link {
  appearance:none;
  border:1px solid rgba(123,104,255,.18);
  border-radius:999px;
  padding:9px 12px;
  font-size:.68rem;
  font-weight:800;
  letter-spacing:.06em;
  text-transform:uppercase;
  cursor:pointer;
  transition:transform .15s ease, box-shadow .15s ease;
  background:#fff;
  color:#4a536b;
}
.student-dashboard-quick-link:hover {
  transform:translateY(-1px);
  box-shadow:0 8px 18px rgba(103,115,201,.08);
}
.student-dashboard-quick-link.primary {
  background:#eef3ff;
  color:#3f5ec7;
  border-color:rgba(89,120,214,.24);
}
.student-dashboard-quick-link.secondary {
  background:#f5f7ff;
  color:#424f74;
  border-color:rgba(148,163,184,.25);
}
.student-dashboard-quick-link.neutral {
  background:#fff;
  color:#49586d;
  border-color:rgba(148,163,184,.2);
}
.student-dashboard-main-column {
  display:grid;
  gap:18px;
}
.student-dashboard-progress-row {
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:14px;
}
.student-dashboard-progress-card {
  position:relative;
  display:grid;
  gap:7px;
  padding:16px 16px 14px;
  border:1px solid rgba(148,163,184,.18);
  border-radius:18px;
  background:linear-gradient(180deg, rgba(255,255,255,.76), rgba(242,247,255,.72));
  box-shadow:0 10px 22px rgba(88,105,172,.06);
}
.student-dashboard-progress-card.accent {
  background:linear-gradient(180deg, rgba(235,245,255,.9), rgba(221,233,255,.74));
}
.student-dashboard-progress-card.warm {
  background:linear-gradient(180deg, rgba(255,247,237,.9), rgba(255,230,207,.74));
}
.student-dashboard-card-kicker {
  color:#6c7ea6;
  font-size:.62rem;
  font-weight:800;
  letter-spacing:.12em;
  text-transform:uppercase;
}
.student-dashboard-progress-card strong {
  color:#1f2d45;
  font-size:.92rem;
  line-height:1.5;
}
.student-dashboard-progress-value {
  color:#1f3d8f;
  font-size:1.7rem;
  font-weight:800;
  letter-spacing:-.04em;
}
.student-dashboard-progress-card small {
  color:#5b6d89;
  font-size:.71rem;
}
.student-dashboard-progress-panel {
  display:grid;
  gap:12px;
  padding:18px 18px 16px;
  border:1px solid rgba(255,255,255,.75);
  border-radius:22px;
  background:linear-gradient(180deg, rgba(255,255,255,.7), rgba(241,246,255,.58));
  box-shadow:0 14px 28px rgba(88,105,172,.06);
}
.student-dashboard-panel-heading {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
}
.student-dashboard-panel-heading h3 {
  margin:0;
  color:#24314b;
  font-size:1rem;
}
.student-dashboard-progress-list {
  display:grid;
  gap:12px;
}
.student-dashboard-progress-item {
  display:grid;
  gap:8px;
}
.student-dashboard-progress-copy {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  color:#42567a;
  font-size:.72rem;
}
.student-dashboard-progress-item strong {
  color:#1d3151;
  font-size:.8rem;
}
.student-dashboard-progress-bar {
  position:relative;
  height:10px;
  overflow:hidden;
  border-radius:999px;
  background:rgba(205,216,241,.7);
}
.student-dashboard-progress-bar i {
  display:block;
  height:100%;
  border-radius:inherit;
  background:linear-gradient(90deg, #5fa5ff, #7d6cf0 58%, #3ec5c1);
}
.student-dashboard-hero-card {
  padding:18px 18px 14px;
  border:1px solid rgba(255,255,255,.72);
  border-radius:24px;
  background:linear-gradient(180deg,rgba(255,255,255,.66),rgba(244,248,255,.54));
  box-shadow:0 18px 34px rgba(92,108,180,.08), inset 0 1px 0 rgba(255,255,255,.88);
}
.student-dashboard-header-meta {
  display:flex;
  align-items:flex-end;
  justify-content:space-between;
  gap:12px;
  margin-bottom:16px;
  color:#71809f;
  font-size:.72rem;
}
.student-dashboard-metric-row {
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:14px;
}
.student-dashboard-metric-tile {
  position:relative;
  overflow:hidden;
  display:grid;
  gap:8px;
  padding:18px 16px 15px;
  border:1px solid rgba(145,169,214,.18);
  border-radius:18px;
  background:linear-gradient(180deg, var(--dash-bg-start) 0%, var(--dash-bg-end) 100%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.72);
}
.student-dashboard-metric-tile .stat-icon {
  position:absolute;
  top:12px;
  right:12px;
  width:34px;
  height:34px;
  border-radius:10px;
  background:rgba(255,255,255,.7) !important;
  box-shadow:none;
}
.student-dashboard-metric-tile .stat-label {
  max-width:calc(100% - 44px);
  margin:0;
  color:var(--dash-text);
  opacity:.8;
  font-size:.62rem;
  letter-spacing:.08em;
  text-transform:uppercase;
}
.student-dashboard-metric-tile .stat-value {
  margin:0;
  color:var(--dash-text);
  font-size:1.7rem;
  font-weight:800;
  letter-spacing:-.04em;
}
.student-dashboard-metric-tile .stat-sub {
  color:var(--dash-text);
  opacity:.82;
  font-size:.74rem;
}
.student-dashboard-lower-grid {
  display:grid;
  grid-template-columns:minmax(0,1.25fr) minmax(220px,.75fr);
  gap:16px;
}
.student-dashboard-summary-panel,
.student-dashboard-news-panel {
  min-width:0;
  padding:17px;
  border:1px solid rgba(203,213,225,.7);
  border-radius:20px;
  background:rgba(255,255,255,.74);
  box-shadow:0 12px 22px rgba(15,23,42,.04);
}
.student-dashboard-news-panel {
  display:grid;
  gap:12px;
  align-content:start;
}
.student-dashboard-news-box {
  padding:14px 14px 0;
  border-top:1px solid rgba(148,163,184,.18);
}
.student-dashboard-news-box strong {
  display:block;
  color:#1f2a44;
  font-size:.9rem;
  line-height:1.45;
  margin-bottom:6px;
}
.student-dashboard-news-box p {
  color:#4f5d75;
  font-size:.8rem;
  line-height:1.6;
  margin:0;
}
@media (max-width: 820px) {
  .student-dashboard-shell,
  .student-dashboard-lower-grid,
  .student-dashboard-metric-row {
    grid-template-columns:1fr;
  }
  .student-dashboard-header-meta {
    flex-direction:column;
    align-items:flex-start;
  }
  .student-dashboard-quick-links {
    gap:10px;
  }
}
.admin-app .admin-dashboard .stats-grid {
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:15px;
  margin-bottom:20px;
}
.admin-app .admin-dashboard .dashboard-stat-card {
  min-width:0;
  padding:18px;
  border:1px solid var(--dash-border);
  border-left:3px solid var(--dash-accent);
  border-radius:14px;
  background:linear-gradient(145deg,var(--dash-bg-start),var(--dash-bg-end));
  box-shadow:0 8px 18px var(--dash-shadow);
}
.admin-app .admin-dashboard .dashboard-stat-card::before,
.admin-app .admin-dashboard .dashboard-stat-card::after { display:none; }
.admin-app .admin-dashboard .dashboard-stat-card .stat-icon {
  position:absolute;
  top:15px;
  right:15px;
  width:34px;
  height:34px;
  margin:0;
  border-radius:10px;
  background:rgba(255,255,255,.76) !important;
  box-shadow:none;
  backdrop-filter:none;
}
.admin-app .admin-dashboard .dashboard-stat-card .stat-label {
  max-width:calc(100% - 34px);
  margin-bottom:14px;
  color:var(--dash-text) !important;
  opacity:.78;
  font-size:.68rem;
  font-weight:750;
  letter-spacing:.055em;
}
.admin-app .admin-dashboard .dashboard-stat-card .stat-value {
  color:var(--dash-text) !important;
  font-size:1.9rem;
  line-height:1;
}
.admin-app .admin-dashboard .dashboard-stat-card .stat-sub {
  margin-top:8px;
  color:var(--dash-text) !important;
  opacity:.76;
  font-size:.72rem;
}
.admin-level-counts {
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:7px;
  margin-top:2px;
}
.admin-level-count {
  display:grid;
  min-width:0;
  justify-items:center;
  gap:4px;
  padding:7px 3px;
  border-radius:9px;
  background:rgba(255,255,255,.62);
}
.admin-level-count strong {
  color:#087a4d;
  font-size:1.15rem;
  line-height:1;
}
.admin-level-count span {
  color:#526579;
  font-size:.58rem;
  font-weight:750;
  text-align:center;
}
.admin-level-count:nth-child(1) { background:rgba(255,255,255,.7); }
.admin-level-count:nth-child(1) strong { color:#2563eb; }
.admin-level-count:nth-child(2) { background:rgba(255,255,255,.7); }
.admin-level-count:nth-child(2) strong { color:#ea7c20; }
.admin-level-count:nth-child(3) { background:rgba(255,255,255,.7); }
.admin-level-count:nth-child(3) strong { color:#7c3aed; }
.admin-app .admin-dashboard .grid2 { gap:16px; }
.admin-app .admin-dashboard .card {
  border:1px solid #e5eaf2;
  border-radius:14px;
  background:#fff;
  box-shadow:0 5px 16px rgba(24,49,86,.04);
}
.admin-app .admin-dashboard .card-padded { padding:20px; }
.admin-app .admin-dashboard .card h3 {
  color:#203654 !important;
  font-size:.95rem !important;
  padding-left:10px;
  border-left:3px solid #4f7ef0;
}
.admin-app .admin-dashboard .grid2 > .card:nth-child(2) h3 { border-left-color:#f59e0b; }
.admin-app .admin-dashboard .progress {
  height:7px;
  overflow:hidden;
  border-radius:99px;
  background:#edf1f7;
}
.admin-app .admin-dashboard .progress-bar { border-radius:99px; }
.admin-app .admin-dashboard-header {
  align-items:center;
  margin-bottom:18px;
  padding:17px 19px;
  border:1px solid #e9ebf5;
  border-radius:15px;
  background:
    radial-gradient(circle at 91% 5%,rgba(154,132,238,.12),transparent 13rem),
    linear-gradient(110deg,#fff,#fbfbff 65%,#f8f7ff);
  box-shadow:0 5px 18px rgba(32,45,82,.045);
}
.admin-app .admin-dashboard-header .page-title {
  color:#202b46;
  font-size:1.35rem;
  font-weight:780;
  letter-spacing:-.04em;
}
.admin-app .admin-dashboard-header .page-sub {
  margin-top:4px;
  color:#7c879e;
  font-size:.76rem;
}
.admin-dashboard-eyebrow { color:#7770c8; font-size:.59rem; }
.admin-dashboard-header-meta {
  align-items:end;
  color:#66718a;
}
.admin-app .admin-dashboard-header-meta [aria-label="Current date and time"] {
  color:#66718a !important;
  font-size:.68rem !important;
}
.admin-app .admin-dashboard .dashboard-stat-card {
  border:1px solid #e9ebf3;
  border-top:2px solid var(--dash-accent);
  border-radius:13px;
  background:#fff;
  box-shadow:0 5px 16px rgba(32,45,82,.045);
}
.admin-app .admin-dashboard .dashboard-stat-card .stat-icon {
  border:1px solid rgba(232,235,246,.9);
  background:#f7f8fc !important;
}
.admin-app .admin-dashboard .dashboard-stat-card .stat-label {
  color:#76819a !important;
  font-size:.61rem;
  letter-spacing:.08em;
}
.admin-app .admin-dashboard .dashboard-stat-card .stat-value {
  color:#26334f !important;
  font-size:1.72rem;
}
.admin-app .admin-dashboard .dashboard-stat-card .stat-sub {
  color:#8992a7 !important;
  font-size:.67rem;
}
.admin-app .admin-dashboard .admin-level-count {
  border:1px solid #eff0f6;
  background:#fafaff;
}
.admin-app .admin-dashboard .admin-level-count span { color:#78829a; }
.admin-app .admin-dashboard .grid2 { grid-template-columns:minmax(0,1.35fr) minmax(270px,.8fr); }
.admin-app .admin-dashboard .admin-dashboard-panel {
  min-width:0;
  padding:17px;
}
.admin-app .admin-dashboard .admin-dashboard-panel h3 {
  margin:4px 0 0;
  padding:0;
  border:0;
  color:#26334f !important;
  font-size:.88rem !important;
  letter-spacing:-.02em;
}
.admin-dashboard-panel-heading {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  margin-bottom:11px;
}
.admin-dashboard-panel-eyebrow {
  display:block;
  color:#969db1;
  font-size:.57rem;
  font-weight:800;
  letter-spacing:.11em;
}
.admin-dashboard-panel-icon {
  display:grid;
  width:31px;
  height:31px;
  place-items:center;
  border-radius:10px;
  background:#eef1ff;
  color:#5f70db;
  font-size:1rem;
  font-weight:800;
}
.admin-dashboard-panel-icon-purple {
  background:#f3edff;
  color:#875bd4;
}
.admin-dashboard-activity {
  display:flex;
  min-width:0;
  align-items:center;
  gap:10px;
  padding:10px 0;
  border-bottom:1px solid #f0f1f6;
}
.admin-dashboard-activity:last-child { border-bottom:0; }
.admin-dashboard-activity-dot {
  width:8px;
  height:8px;
  flex:0 0 8px;
  border-radius:50%;
  background:var(--activity-color,#94a3b8);
  box-shadow:0 0 0 4px color-mix(in srgb,var(--activity-color,#94a3b8) 12%,transparent);
}
.admin-dashboard-activity-text {
  min-width:0;
  flex:1;
  color:#4b5670;
  font-size:.76rem;
  line-height:1.45;
}
.admin-dashboard-activity-time {
  flex:0 0 auto;
  color:#9aa2b4;
  font-size:.64rem;
}
.admin-dashboard-level { margin:15px 0; }
.admin-dashboard-level-heading {
  display:flex;
  align-items:center;
  justify-content:space-between;
  margin-bottom:7px;
  color:#58637d;
  font-size:.74rem;
  font-weight:650;
}
.admin-dashboard-level-heading strong { color:#34405b; font-size:.74rem; }
.admin-dashboard-level-heading small { color:#929ab0; font-size:.64rem; font-weight:600; }
.admin-app .admin-dashboard .admin-dashboard-level .progress { height:6px; }
.admin-dashboard-level-total {
  display:flex;
  align-items:center;
  justify-content:space-between;
  margin-top:16px;
  padding-top:12px;
  border-top:1px solid #eff0f6;
  color:#818ba1;
  font-size:.7rem;
}
.admin-dashboard-level-total strong { color:#26334f; font-size:.88rem; }
body.dark-mode .admin-app { background:#0d1729; }
body.dark-mode .admin-app .topbar {
  background:#111f35;
  border-bottom-color:#263956;
}
body.dark-mode .admin-app .topbar-name { color:#e4edff; }
body.dark-mode .admin-app .topbar-actions {
  background:#1b2c47;
  border-color:#2c4161;
}
body.dark-mode .admin-app .topbar-actions .topbar-btn + .topbar-btn { box-shadow:-1px 0 0 #2c4161; }
body.dark-mode .admin-app .topbar-btn:hover { background:#2a3e5e; }
body.dark-mode .admin-app .admin-dashboard-header {
  border:0;
  background:
    radial-gradient(circle at 88% 18%,rgba(129,140,248,.26),transparent 14rem),
    linear-gradient(115deg,#1d4ed8 0%,#4338ca 56%,#6d28d9 100%);
  box-shadow:0 12px 26px rgba(30,41,95,.32);
}
body.dark-mode .admin-app .admin-dashboard-header .page-title { color:#fff; }
body.dark-mode .admin-app .admin-dashboard-header .page-sub { color:rgba(255,255,255,.82); }
body.dark-mode .admin-dashboard-eyebrow { color:#c8dcff; }
body.dark-mode .admin-dashboard-period { color:rgba(255,255,255,.76); }
body.dark-mode .admin-app .admin-dashboard-header-meta [aria-label="Current date and time"] { color:rgba(255,255,255,.95) !important; }
body.dark-mode .admin-app .admin-dashboard .dashboard-stat-card {
  border-color:#293c5b;
  border-left-color:var(--dash-accent);
  background:linear-gradient(145deg,#1a2b47,#15243b);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.025),0 7px 18px rgba(0,0,0,.2);
}
body.dark-mode .admin-app .admin-dashboard .dashboard-stat-card .stat-value { color:#e3ecfa !important; }
body.dark-mode .admin-app .admin-dashboard .dashboard-stat-card .stat-label { color:#e5edfc !important; }
body.dark-mode .admin-app .admin-dashboard .dashboard-stat-card .stat-sub { color:#c0cde0 !important; }
body.dark-mode .admin-app .admin-dashboard .dashboard-stat-card .stat-icon { background:#223550 !important; }
body.dark-mode .admin-level-count { background:rgba(9,18,33,.52); }
body.dark-mode .admin-level-count span { color:#d5e0f0; }
body.dark-mode .admin-level-count:nth-child(1) strong { color:#93c5fd; }
body.dark-mode .admin-level-count:nth-child(2) strong { color:#fdba74; }
body.dark-mode .admin-level-count:nth-child(3) strong { color:#c4b5fd; }
body.dark-mode .admin-app .admin-dashboard .card {
  border-color:#293c5b;
  background:#15243b;
}
body.dark-mode .admin-app .admin-dashboard .card h3 { color:#e3ecfa !important; }
body.dark-mode .admin-app .admin-dashboard-header {
  border-color:#2d3850;
  background:linear-gradient(110deg,#121b2b,#19223a);
}
body.dark-mode .admin-app .admin-dashboard-header .page-title { color:#e7ebf5; }
body.dark-mode .admin-app .admin-dashboard-header .page-sub,
body.dark-mode .admin-app .admin-dashboard-header-meta,
body.dark-mode .admin-app .admin-dashboard-header-meta [aria-label="Current date and time"] { color:#a0abc1 !important; }
body.dark-mode .admin-dashboard-eyebrow { color:#aaa2fa; }
body.dark-mode .admin-dashboard-avatar,
body.dark-mode .admin-dashboard-session {
  border-color:#354260;
  background:#1b2942;
  color:#c7c1ff;
}
body.dark-mode .admin-dashboard-session strong { color:#e3e9f7; }
body.dark-mode .admin-dashboard-session small,
body.dark-mode .admin-dashboard-session span { color:#a0abc1; }
body.dark-mode .admin-app .admin-dashboard .dashboard-stat-card {
  border-color:#2d3850;
  border-top-color:var(--dash-accent);
  background:#121b2b;
}
body.dark-mode .admin-app .admin-dashboard .dashboard-stat-card .stat-value { color:#e3e9f7 !important; }
body.dark-mode .admin-app .admin-dashboard .dashboard-stat-card .stat-label,
body.dark-mode .admin-app .admin-dashboard .dashboard-stat-card .stat-sub { color:#a0abc1 !important; }
body.dark-mode .admin-app .admin-dashboard .dashboard-stat-card .stat-icon { border-color:#34415d; background:#1b2942 !important; }
body.dark-mode .admin-app .admin-dashboard .admin-level-count { border-color:#354260; background:#1b2942; }
body.dark-mode .admin-app .admin-dashboard .admin-level-count span { color:#a0abc1; }
body.dark-mode .admin-app .admin-dashboard .admin-dashboard-panel h3 { color:#e3e9f7 !important; }
body.dark-mode .admin-dashboard-panel-eyebrow,
body.dark-mode .admin-dashboard-activity-time,
body.dark-mode .admin-dashboard-level-total { color:#a0abc1; }
body.dark-mode .admin-dashboard-activity { border-bottom-color:#2d3850; }
body.dark-mode .admin-dashboard-activity-text,
body.dark-mode .admin-dashboard-level-heading { color:#c0c9d9; }
body.dark-mode .admin-dashboard-level-heading strong,
body.dark-mode .admin-dashboard-level-total strong { color:#e3e9f7; }
body.dark-mode .admin-dashboard-level-total { border-top-color:#2d3850; }
@media (max-width: 1000px) {
  .admin-app .admin-dashboard .stats-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
}
@media (max-width: 767px) {
  .admin-app .topbar-left { padding-left:34px; }
  .admin-app .topbar-name { font-size:.8rem; }
  .admin-app .main { padding:18px 12px calc(82px + env(safe-area-inset-bottom)); }
  .admin-app .admin-dashboard-header {
    align-items:flex-start;
    flex-direction:column;
    gap:10px;
    margin-bottom:16px;
    padding:18px;
  }
  .admin-dashboard-heading { align-items:flex-start; gap:11px; }
  .admin-dashboard-avatar { width:44px; height:44px; flex-basis:44px; border-radius:13px; }
  .admin-app .admin-dashboard-header .page-title { font-size:1.18rem; }
  .admin-dashboard-session { min-width:0; }
  .admin-app .admin-dashboard .grid2 { grid-template-columns:1fr; }
  .admin-dashboard-activity { align-items:flex-start; flex-wrap:wrap; }
  .admin-dashboard-activity-text { flex-basis:calc(100% - 24px); }
  .admin-dashboard-activity-time { margin-left:18px; }
  .student-dashboard-welcome { align-items:flex-start; gap:11px; }
  .student-dashboard-avatar {
    width:46px;
    height:46px;
    flex-basis:46px;
    border-radius:13px;
  }
  .admin-app .student-dashboard-header .page-title { font-size:1.35rem; }
  .student-dashboard-deadline { margin-left:57px; }
  .admin-dashboard-header-meta { justify-items:start; text-align:left; }
  .admin-app .admin-dashboard-header-meta [aria-label="Current date and time"] { justify-content:flex-start; }
  .admin-app .admin-dashboard .stats-grid { gap:10px; }
  .admin-app .admin-dashboard .dashboard-stat-card { padding:14px; }
  .admin-app .admin-dashboard .dashboard-stat-card .stat-icon { top:12px; right:12px; }
  .admin-app .admin-dashboard .dashboard-stat-card .stat-value { font-size:1.55rem; }
}
.admin-app { background:#eef1fa; }
.admin-app .sidebar {
  background:rgba(255,255,255,.68);
  border-right:1px solid rgba(255,255,255,.82);
  box-shadow:5px 0 22px rgba(72,81,143,.07);
  -webkit-backdrop-filter:blur(22px) saturate(145%);
  backdrop-filter:blur(22px) saturate(145%);
}
.admin-app .sidebar-brand { border-bottom-color:rgba(255,255,255,.72); }
.admin-app .sidebar-brand img { border-color:rgba(255,255,255,.9); }
.admin-sidebar-brand-copy strong { color:#252b42; }
.admin-sidebar-brand-copy small { color:#959aae; }
.admin-app .sidebar-section { color:#a0a4b4; }
.admin-app .nav-item { color:#686f85; }
.admin-app .nav-item:hover {
  background:#f7f7fb;
  color:#4e55a4;
}
.admin-app .nav-item.active {
  background:#f0efff;
  color:#5f59ca;
  box-shadow:inset 0 0 0 1px #e8e6ff;
}
.admin-app .nav-item.active::before { background:#766cf0; }
.admin-app .main {
  background:
    radial-gradient(ellipse at 82% 9%,rgba(177,168,255,.2),transparent 32rem),
    radial-gradient(ellipse at 8% 78%,rgba(133,194,255,.16),transparent 34rem),
    linear-gradient(135deg,#f3f5fc,#edf0fa 52%,#f2effb);
}
.admin-app .topbar {
  background:rgba(255,255,255,.76);
  border-bottom-color:rgba(255,255,255,.85);
  box-shadow:0 6px 24px rgba(65,75,136,.055);
  -webkit-backdrop-filter:blur(20px) saturate(150%);
  backdrop-filter:blur(20px) saturate(150%);
}
.admin-app .admin-dashboard {
  position:relative;
  isolation:isolate;
  padding:18px;
  overflow:hidden;
  border:1px solid rgba(255,255,255,.92);
  border-radius:22px;
  background:
    linear-gradient(135deg,rgba(255,255,255,.78),rgba(247,248,255,.55) 44%,rgba(238,234,255,.58));
  box-shadow:
    0 0 0 1px rgba(112,134,242,.38),
    0 0 0 4px rgba(112,134,242,.08),
    0 14px 42px rgba(85,89,174,.18),
    inset 0 1px 0 rgba(255,255,255,.98),
    inset 0 0 28px rgba(255,255,255,.48);
  -webkit-backdrop-filter:blur(24px) saturate(150%);
  backdrop-filter:blur(24px) saturate(150%);
}
.admin-app .admin-dashboard-header {
  align-items:center;
  margin-bottom:18px;
  padding:4px 2px 16px;
  border:0;
  border-bottom:1px solid rgba(255,255,255,.8);
  border-radius:0;
  background:linear-gradient(90deg,rgba(255,255,255,.2),rgba(255,255,255,.46),rgba(255,255,255,.16));
  box-shadow:0 1px 0 rgba(116,128,196,.08);
}
.admin-app .admin-dashboard-header .page-title {
  color:#252b42;
  font-size:1.42rem;
  font-weight:750;
  letter-spacing:-.035em;
}
.admin-app .admin-dashboard-header .page-sub { color:#858ba0; }
.admin-dashboard-eyebrow { color:#7c75d7; }
.admin-dashboard-header-meta { color:#757c91; }
.admin-app .admin-dashboard-header-meta [aria-label="Current date and time"] {
  color:#757c91 !important;
}
.admin-app .admin-dashboard .stats-grid {
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:15px;
  margin-bottom:16px;
}
.admin-app .admin-dashboard .dashboard-stat-card {
  min-height:130px;
  padding:18px;
  border:1px solid rgba(255,255,255,.94);
  border-radius:14px;
  background:
    linear-gradient(145deg,rgba(255,255,255,.82),rgba(255,255,255,.48)),
    linear-gradient(120deg,rgba(203,213,255,.22),rgba(232,214,255,.2));
  box-shadow:
    0 8px 20px rgba(90,97,163,.08),
    inset 0 1px 0 rgba(255,255,255,.98),
    inset 0 0 18px rgba(255,255,255,.34);
  -webkit-backdrop-filter:blur(18px) saturate(145%);
  backdrop-filter:blur(18px) saturate(145%);
}
.admin-app .admin-dashboard .dashboard-stat-card .stat-icon {
  border:1px solid rgba(255,255,255,.9);
  background:rgba(255,255,255,.62) !important;
  box-shadow:0 3px 10px rgba(89,99,160,.06),inset 0 1px 0 #fff;
}
.admin-app .admin-dashboard .dashboard-stat-card .stat-label {
  color:#81879a !important;
  font-size:.66rem;
  letter-spacing:.045em;
}
.admin-app .admin-dashboard .dashboard-stat-card .stat-value {
  color:#282e47 !important;
  font-size:1.8rem;
}
.admin-app .admin-dashboard .dashboard-stat-card .stat-sub {
  color:#979caf !important;
}
.admin-app .admin-dashboard .grid2 { gap:15px; }
.admin-app .admin-dashboard .admin-dashboard-overview {
  grid-template-columns:minmax(0,1.7fr) minmax(270px,.9fr);
  margin-bottom:15px;
}
.admin-app .admin-dashboard .admin-dashboard-lower {
  grid-template-columns:minmax(0,1.25fr) minmax(270px,.9fr);
}
.admin-app .admin-dashboard .admin-dashboard-panel {
  padding:18px;
  border:1px solid rgba(255,255,255,.94);
  border-radius:14px;
  background:
    linear-gradient(145deg,rgba(255,255,255,.79),rgba(255,255,255,.45)),
    linear-gradient(130deg,rgba(211,218,255,.15),rgba(232,218,255,.18));
  box-shadow:
    0 8px 22px rgba(90,97,163,.075),
    inset 0 1px 0 rgba(255,255,255,.98),
    inset 0 0 22px rgba(255,255,255,.38);
  -webkit-backdrop-filter:blur(20px) saturate(145%);
  backdrop-filter:blur(20px) saturate(145%);
}
.admin-app .admin-dashboard .admin-dashboard-panel h3 {
  color:#2c3249 !important;
  font-size:.92rem !important;
}
.admin-dashboard-panel-heading { margin-bottom:13px; }
.admin-dashboard-panel-eyebrow {
  color:#9a9fb0;
  font-size:.58rem;
}
.admin-dashboard-chart-caption {
  color:#969bad;
  font-size:.67rem;
}
.admin-dashboard-chart-summary {
  display:flex;
  align-items:baseline;
  gap:7px;
  margin:2px 0 4px;
}
.admin-dashboard-chart-summary strong {
  color:#292f48;
  font-size:1.32rem;
}
.admin-dashboard-chart-summary span {
  color:#9298aa;
  font-size:.68rem;
}
.admin-dashboard-chart-wrap { min-width:0; }
.admin-dashboard-chart {
  display:block;
  width:100%;
  height:180px;
  overflow:visible;
}
.admin-dashboard-chart-gridline {
  stroke:rgba(128,137,185,.2);
  stroke-dasharray:3 5;
  stroke-width:1;
}
.admin-dashboard-chart-area { fill:url(#admin-dashboard-chart-gradient); }
.admin-dashboard-chart-line {
  fill:none;
  stroke:#7569e8;
  stroke-linecap:round;
  stroke-linejoin:round;
  stroke-width:3;
}
.admin-dashboard-chart-point {
  fill:rgba(255,255,255,.94);
  stroke:#7569e8;
  stroke-width:2.5;
}
.admin-dashboard-chart-months {
  display:flex;
  justify-content:space-between;
  margin:0 3px;
  color:#989daf;
  font-size:.64rem;
}
.admin-dashboard-chart-empty,
.admin-dashboard-school-empty {
  display:grid;
  min-height:160px;
  place-items:center;
  color:#9298aa;
  font-size:.76rem;
  text-align:center;
}
.admin-dashboard-school-count {
  display:grid;
  min-width:28px;
  height:28px;
  padding:0 7px;
  place-items:center;
  border-radius:9px;
  background:#f0efff;
  color:#655ed0;
  font-size:.72rem;
  font-weight:750;
}
.admin-dashboard-school-list { display:grid; }
.admin-dashboard-school {
  display:flex;
  min-width:0;
  align-items:center;
  gap:10px;
  padding:11px 0;
  border-bottom:1px solid rgba(255,255,255,.72);
}
.admin-dashboard-school:last-child { border-bottom:0; }
.admin-dashboard-school-mark {
  display:grid;
  width:34px;
  height:34px;
  flex:0 0 34px;
  place-items:center;
  border-radius:10px;
  background:#f0efff;
  color:#6a61d1;
  font-size:.78rem;
  font-weight:750;
}
.admin-dashboard-school:nth-child(3n + 2) .admin-dashboard-school-mark {
  background:#eef6ff;
  color:#4d8fd2;
}
.admin-dashboard-school:nth-child(3n) .admin-dashboard-school-mark {
  background:#fff5e8;
  color:#c58a39;
}
.admin-dashboard-school-copy {
  display:grid;
  min-width:0;
  gap:4px;
}
.admin-dashboard-school-copy strong {
  overflow:hidden;
  color:#4b526a;
  font-size:.73rem;
  font-weight:650;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.admin-dashboard-school-copy small {
  color:#979caf;
  font-size:.64rem;
}
body.dark-mode .admin-app .sidebar {
  background:#111f35;
  border-right-color:#263956;
  -webkit-backdrop-filter:blur(22px);
  backdrop-filter:blur(22px);
}
body.dark-mode .admin-app .sidebar-brand { border-bottom-color:#263956; }
body.dark-mode .admin-sidebar-brand-copy strong { color:#e4edff; }
body.dark-mode .admin-sidebar-brand-copy small,
body.dark-mode .admin-app .sidebar-section { color:#91a2bc; }
body.dark-mode .admin-app .nav-item { color:#b8c8df; }
body.dark-mode .admin-app .nav-item:hover { background:#1b2c47; color:#fff; }
body.dark-mode .admin-app .nav-item.active {
  background:#263b60;
  color:#dce7ff;
  box-shadow:inset 0 0 0 1px #354d77;
}
body.dark-mode .admin-app .main { background:#0d1729; }
body.dark-mode .admin-app .topbar {
  background:rgba(17,31,53,.84);
  border-bottom-color:#263956;
}
body.dark-mode .admin-app .admin-dashboard {
  border-color:rgba(150,165,255,.38);
  background:linear-gradient(135deg,rgba(24,38,64,.88),rgba(27,35,67,.76) 54%,rgba(43,32,72,.72));
  box-shadow:
    0 0 0 1px rgba(119,139,255,.48),
    0 0 0 4px rgba(112,134,242,.1),
    0 14px 42px rgba(0,0,0,.26),
    inset 0 1px 0 rgba(255,255,255,.16);
}
body.dark-mode .admin-app .admin-dashboard-header {
  border-bottom-color:rgba(183,194,255,.19);
  background:linear-gradient(90deg,rgba(255,255,255,.015),rgba(255,255,255,.055),rgba(255,255,255,.015));
}
body.dark-mode .admin-app .admin-dashboard-header .page-title { color:#e7ebf5; }
body.dark-mode .admin-app .admin-dashboard-header .page-sub,
body.dark-mode .admin-dashboard-header-meta,
body.dark-mode .admin-app .admin-dashboard-header-meta [aria-label="Current date and time"] {
  color:#a0abc1 !important;
}
body.dark-mode .admin-app .admin-dashboard .dashboard-stat-card,
body.dark-mode .admin-app .admin-dashboard .admin-dashboard-panel {
  border-color:rgba(190,200,255,.19);
  background:linear-gradient(145deg,rgba(34,49,78,.78),rgba(25,38,65,.66));
  box-shadow:0 8px 20px rgba(0,0,0,.14),inset 0 1px 0 rgba(255,255,255,.12);
}
body.dark-mode .admin-app .admin-dashboard .dashboard-stat-card .stat-value,
body.dark-mode .admin-dashboard-chart-summary strong,
body.dark-mode .admin-app .admin-dashboard .admin-dashboard-panel h3 {
  color:#e3e9f7 !important;
}
body.dark-mode .admin-app .admin-dashboard .dashboard-stat-card .stat-label,
body.dark-mode .admin-app .admin-dashboard .dashboard-stat-card .stat-sub,
body.dark-mode .admin-dashboard-chart-summary span,
body.dark-mode .admin-dashboard-chart-caption,
body.dark-mode .admin-dashboard-chart-months,
body.dark-mode .admin-dashboard-chart-empty,
body.dark-mode .admin-dashboard-school-empty {
  color:#a0abc1 !important;
}
body.dark-mode .admin-dashboard-chart-gridline { stroke:#293751; }
body.dark-mode .admin-dashboard-school { border-bottom-color:#293751; }
body.dark-mode .admin-dashboard-chart-point { fill:#213353; }
body.dark-mode .admin-dashboard-school-copy strong { color:#d2dbee; }
body.dark-mode .admin-dashboard-school-copy small { color:#a0abc1; }
.student-app {
  background:
    radial-gradient(ellipse at 86% 9%,rgba(176,166,255,.21),transparent 33rem),
    radial-gradient(ellipse at 12% 72%,rgba(127,193,255,.17),transparent 34rem),
    linear-gradient(135deg,#f3f5fc,#edf0fa 52%,#f2effb);
}
.student-app .topbar {
  background:rgba(255,255,255,.74);
  border-bottom-color:rgba(255,255,255,.85);
  box-shadow:0 6px 24px rgba(65,75,136,.055);
  -webkit-backdrop-filter:blur(20px) saturate(150%);
  backdrop-filter:blur(20px) saturate(150%);
}
.student-app .menu-btn {
  width:36px;
  height:36px;
  border:1px solid rgba(255,255,255,.9);
  border-radius:12px;
  background:linear-gradient(145deg,rgba(255,255,255,.9),rgba(239,239,255,.72));
  box-shadow:0 4px 13px rgba(78,83,151,.1),inset 0 1px 0 #fff;
  color:#665fd0 !important;
  -webkit-backdrop-filter:blur(14px);
  backdrop-filter:blur(14px);
  transition:background .16s ease,box-shadow .16s ease,transform .16s ease;
}
.student-app .menu-btn:hover {
  background:rgba(255,255,255,.96);
  box-shadow:0 6px 16px rgba(78,83,151,.16),inset 0 1px 0 #fff;
}
.student-app .menu-btn svg { color:#665fd0 !important; }
.student-app .sidebar-overlay {
  background:rgba(45,48,83,.2);
  -webkit-backdrop-filter:blur(5px) saturate(115%);
  backdrop-filter:blur(5px) saturate(115%);
}
.student-app .sidebar {
  background:linear-gradient(155deg,rgba(255,255,255,.86),rgba(248,248,255,.73) 62%,rgba(241,240,255,.76));
  border:1px solid rgba(255,255,255,.92);
  border-left:0;
  border-radius:0 20px 20px 0;
  box-shadow:8px 0 34px rgba(59,63,121,.15),inset 0 1px 0 rgba(255,255,255,.98);
  -webkit-backdrop-filter:blur(22px) saturate(145%);
  backdrop-filter:blur(22px) saturate(145%);
}
.student-app .sidebar-brand {
  justify-content:flex-start;
  gap:10px;
  padding:12px 9px 16px;
  border-bottom-color:rgba(206,210,239,.46);
}
.student-app .sidebar-brand img {
  width:40px;
  height:40px;
  flex:0 0 40px;
  border:1px solid rgba(255,255,255,.98);
  border-radius:12px;
  box-shadow:0 4px 12px rgba(76,84,157,.12);
}
.student-app .admin-sidebar-brand-copy strong { color:#303650; }
.student-app .admin-sidebar-brand-copy small { color:#898fa7; }
.student-app .sidebar-section {
  padding:15px 11px 6px;
  color:#9399ae;
  font-size:.62rem;
  letter-spacing:.12em;
}
.student-app .nav-item {
  gap:10px;
  padding:9px 11px;
  margin:2px 0;
  border-radius:10px;
  color:#606981;
  font-size:.82rem;
  transition:background .16s ease,color .16s ease,box-shadow .16s ease;
}
.student-app .nav-item .nav-item-icon {
  width:19px !important;
  height:19px !important;
  color:#7e879f !important;
  filter:grayscale(.82) saturate(.35) !important;
}
.student-app .nav-item .nav-item-label,
.student-app .nav-item > span:last-child {
  color:inherit !important;
  font-weight:600 !important;
}
.student-app .nav-item:hover {
  background:rgba(255,255,255,.7);
  color:#5552b7;
  transform:none;
}
.student-app .nav-item.active {
  background:linear-gradient(110deg,rgba(222,224,255,.88),rgba(249,249,255,.78));
  color:#514bb5;
  box-shadow:inset 0 0 0 1px rgba(126,120,222,.2),0 4px 12px rgba(80,85,179,.075);
}
.student-app .nav-item.active::before {
  left:0;
  top:7px;
  bottom:7px;
  width:3px;
  background:linear-gradient(180deg,#7195f2,#8a72e9);
}
.student-app .nav-item.active .nav-item-icon {
  color:#625bd0 !important;
  filter:none !important;
}
.student-app .main {
  background:
    radial-gradient(ellipse at 82% 9%,rgba(177,168,255,.2),transparent 32rem),
    radial-gradient(ellipse at 8% 78%,rgba(133,194,255,.16),transparent 34rem),
    linear-gradient(135deg,#f3f5fc,#edf0fa 52%,#f2effb);
}
.student-app .admin-dashboard.student-dashboard {
  position:relative;
  isolation:isolate;
  padding:18px;
  overflow:hidden;
  border:1px solid rgba(255,255,255,.92);
  border-radius:22px;
  background:linear-gradient(135deg,rgba(255,255,255,.78),rgba(247,248,255,.55) 44%,rgba(238,234,255,.58));
  box-shadow:
    0 0 0 1px rgba(112,134,242,.38),
    0 0 0 4px rgba(112,134,242,.08),
    0 14px 42px rgba(85,89,174,.18),
    inset 0 1px 0 rgba(255,255,255,.98),
    inset 0 0 28px rgba(255,255,255,.48);
  -webkit-backdrop-filter:blur(24px) saturate(150%);
  backdrop-filter:blur(24px) saturate(150%);
}
.student-app .student-dashboard-header {
  align-items:center;
  margin-bottom:16px;
  padding:4px 2px 16px;
  border:0;
  border-bottom:1px solid rgba(255,255,255,.8);
  border-radius:0;
  background:linear-gradient(90deg,rgba(255,255,255,.2),rgba(255,255,255,.46),rgba(255,255,255,.16));
  box-shadow:0 1px 0 rgba(116,128,196,.08);
}
.student-app .student-dashboard-header .page-title {
  color:#252b42;
  font-size:1.32rem;
  font-weight:750;
  letter-spacing:-.035em;
}
.student-app .student-dashboard-header .page-sub,
.student-app .student-dashboard-header-meta,
.student-app .student-dashboard-header-meta [aria-label="Current date and time"] {
  color:#7c849c !important;
}
.student-app .student-dashboard-heading { display:grid; gap:9px; }
.student-app .student-dashboard-welcome { gap:13px; }
.student-app .student-dashboard-avatar {
  border:2px solid rgba(255,255,255,.92);
  background:linear-gradient(145deg,#dfe5ff,#f0e2ff);
  box-shadow:0 5px 16px rgba(94,103,183,.15);
  color:#6459c9;
}
.student-app .admin-dashboard-eyebrow { color:#7770c8; }
.student-app .student-dashboard-deadline {
  margin:0 0 0 68px;
  color:#92723b;
}
.student-app .admin-dashboard-period { color:#8289a0; }
.student-app .admin-dashboard.student-dashboard .stats-grid {
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:14px;
  margin-bottom:15px;
}
.student-app .admin-dashboard.student-dashboard .dashboard-stat-card {
  min-width:0;
  min-height:128px;
  padding:17px;
  border:1px solid rgba(255,255,255,.94);
  border-radius:14px;
  background:
    linear-gradient(145deg,rgba(255,255,255,.82),rgba(255,255,255,.48)),
    linear-gradient(120deg,rgba(203,213,255,.22),rgba(232,214,255,.2));
  box-shadow:0 8px 20px rgba(90,97,163,.08),inset 0 1px 0 rgba(255,255,255,.98),inset 0 0 18px rgba(255,255,255,.34);
  -webkit-backdrop-filter:blur(18px) saturate(145%);
  backdrop-filter:blur(18px) saturate(145%);
}
.student-app .admin-dashboard.student-dashboard .dashboard-stat-card .stat-icon {
  border:1px solid rgba(255,255,255,.9);
  background:rgba(255,255,255,.66) !important;
  box-shadow:0 3px 10px rgba(89,99,160,.06),inset 0 1px 0 #fff;
}
.student-app .admin-dashboard.student-dashboard .dashboard-stat-card .stat-label {
  color:#81879a !important;
  font-size:.65rem;
  letter-spacing:.045em;
}
.student-app .admin-dashboard.student-dashboard .dashboard-stat-card .stat-value {
  color:#282e47 !important;
  font-size:1.65rem !important;
}
.student-app .admin-dashboard.student-dashboard .dashboard-stat-card .stat-sub {
  color:#9298aa !important;
}
.student-app .student-dashboard-overview {
  grid-template-columns:minmax(0,1.65fr) minmax(260px,.9fr);
  gap:14px;
  margin-bottom:14px;
}
.student-app .student-dashboard .admin-dashboard-panel,
.student-app .student-dashboard-announcements {
  min-width:0;
  padding:17px;
  border:1px solid rgba(255,255,255,.94);
  border-radius:14px;
  background:linear-gradient(145deg,rgba(255,255,255,.79),rgba(255,255,255,.45)),linear-gradient(130deg,rgba(211,218,255,.15),rgba(232,218,255,.18));
  box-shadow:0 8px 22px rgba(90,97,163,.075),inset 0 1px 0 rgba(255,255,255,.98),inset 0 0 22px rgba(255,255,255,.38);
  -webkit-backdrop-filter:blur(20px) saturate(145%);
  backdrop-filter:blur(20px) saturate(145%);
}
.student-app .student-dashboard .admin-dashboard-panel h3,
.student-app .student-dashboard-announcements h3 {
  margin:4px 0 0;
  padding:0;
  border:0;
  color:#2c3249 !important;
  font-size:.9rem !important;
}
.student-app .student-dashboard .admin-dashboard-panel-heading { margin-bottom:12px; }
.student-app .student-dashboard .admin-dashboard-panel-eyebrow { color:#969bad; }
.student-app .student-dashboard .admin-dashboard-chart-gridline { stroke:rgba(128,137,185,.2); }
.student-app .student-dashboard .admin-dashboard-chart-line {
  stroke:#7569e8;
  stroke-width:3;
}
.student-app .student-dashboard .admin-dashboard-chart-point {
  fill:rgba(255,255,255,.94);
  stroke:#7569e8;
}
.student-dashboard-snapshot-list { display:grid; }
.student-dashboard-snapshot-row {
  display:flex;
  min-width:0;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  padding:11px 0;
  border-bottom:1px solid rgba(255,255,255,.72);
  color:#747c93;
  font-size:.72rem;
}
.student-dashboard-snapshot-row strong {
  color:#39425d;
  font-size:.72rem;
  font-weight:700;
  text-align:right;
}
.student-dashboard-actions {
  display:flex;
  flex-wrap:wrap;
  gap:8px;
  margin-top:14px;
}
.student-dashboard-actions .btn { padding:8px 11px; font-size:.7rem; }
.student-app .student-dashboard-announcements { margin-top:0 !important; }
.student-app .student-dashboard-announcements .alert {
  border:1px solid rgba(255,255,255,.7);
  border-radius:10px;
  background:rgba(255,255,255,.34);
  color:#4f5871;
}
.student-app {
  background:
    radial-gradient(circle at 15% 15%, rgba(144, 210, 255, 0.65), transparent 24%),
    radial-gradient(circle at 88% 5%, rgba(170, 228, 255, 0.8), transparent 26%),
    linear-gradient(180deg, #bfe8ff 0%, #cfeeff 18%, #edf8ff 100%);
}
.student-app .topbar {
  background: rgba(255,255,255,0.38);
  border-bottom-color: rgba(93,151,186,0.18);
  backdrop-filter: blur(10px);
}
.student-app .sidebar {
  background: rgba(255,255,255,0.18);
  border-right-color: rgba(108,156,193,0.2);
  backdrop-filter: blur(10px);
}
.student-app .nav-item {
  color:#446583;
}
.student-app .nav-item.active {
  background: linear-gradient(90deg, rgba(59,130,246,.12), rgba(14,165,233,.05));
  box-shadow: inset 0 0 0 1px rgba(59,130,246,.14);
}
.student-app .nav-item.active::before {
  background: linear-gradient(180deg, #2d9cdb, #67d1ff);
}
.student-app .nav-item.active .nav-item-icon,
.student-app .nav-item.active .nav-item-label {
  color: #1f5bb2 !important;
}
.student-app .main {
  background: transparent;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 24px 16px 30px;
}
.student-app .admin-dashboard.student-dashboard {
  position: relative;
  isolation: isolate;
  max-width: 960px;
  width: min(100%, 960px);
  margin: 0 auto;
  padding: 18px 18px 18px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,.82);
  border-radius: 28px;
  background: rgba(255,255,255,0.18);
  box-shadow: 0 18px 38px rgba(62,111,153,.12), inset 0 1px 0 rgba(255,255,255,.75);
  backdrop-filter: blur(16px);
}
.student-app .admin-dashboard.student-dashboard::before {
  content: "";
  position: absolute;
  inset: 12px 14px auto 14px;
  height: 82px;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(255,255,255,.28), rgba(255,255,255,.12));
  border: 1px solid rgba(255,255,255,.26);
  z-index: 0;
}
.student-app .student-dashboard-header {
  position: relative;
  z-index: 1;
  align-items: center;
  margin-bottom: 16px;
  padding: 14px 8px 14px;
  border: 0;
  border-bottom: 1px solid rgba(148,186,214,.18);
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
.student-app .student-dashboard-header .page-title {
  color: #173f62;
  font-size: 1.7rem;
  font-weight: 800;
  letter-spacing: -0.04em;
}
.student-app .student-dashboard-header .page-sub,
.student-app .student-dashboard-header-meta,
.student-app .student-dashboard-header-meta [aria-label="Current date and time"] {
  color: #53758c !important;
}
.student-app .student-dashboard-heading { display:grid; gap:9px; }
.student-app .student-dashboard-welcome { gap:13px; }
.student-app .student-dashboard-avatar {
  border: 2px solid rgba(255,255,255,.9);
  background: linear-gradient(135deg, #4a8af6 0%, #57c5f7 100%);
  box-shadow: 0 8px 16px rgba(58,113,168,.18);
  color: #fff;
}
.student-app .admin-dashboard-eyebrow { color: #0a76b8; }
.student-app .student-dashboard-deadline {
  margin: 0 0 0 68px;
  color: #1d7ec9;
}
.student-app .admin-dashboard-period { color: #557691; }
.student-app .admin-dashboard.student-dashboard .stats-grid {
  position: relative;
  z-index: 1;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 15px;
}
.student-app .admin-dashboard.student-dashboard .dashboard-stat-card {
  min-width: 0;
  min-height: 126px;
  padding: 16px 14px 12px;
  border: 1px solid rgba(148,186,214,.25);
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(255,255,255,.72), rgba(235,246,255,.9));
  box-shadow: 0 10px 20px rgba(69,109,146,.08), inset 0 1px 0 rgba(255,255,255,.72);
}
.student-app .admin-dashboard.student-dashboard .dashboard-stat-card .stat-icon {
  border: 1px solid rgba(148,186,214,.3);
  background: rgba(255,255,255,.86) !important;
  box-shadow: 0 3px 10px rgba(69,109,146,.05);
}
.student-app .admin-dashboard.student-dashboard .dashboard-stat-card .stat-label {
  color: #6b8ea8 !important;
  font-size: .62rem;
  letter-spacing: .045em;
}
.student-app .admin-dashboard.student-dashboard .dashboard-stat-card .stat-value {
  color: #12395e !important;
  font-size: 1.5rem !important;
  line-height: 1.1;
}
.student-app .admin-dashboard.student-dashboard .dashboard-stat-card .stat-sub {
  color: #7190ad !important;
}
.student-app .student-dashboard-overview {
  position: relative;
  z-index: 1;
  grid-template-columns: minmax(0,1.7fr) minmax(220px,.9fr);
  gap: 14px;
  margin-bottom: 12px;
}
.student-app .student-dashboard .admin-dashboard-panel,
.student-app .student-dashboard-announcements,
.student-app .student-dashboard-summary-panel,
.student-app .student-dashboard-news-panel {
  min-width: 0;
  padding: 14px 14px 12px;
  border: 1px solid rgba(146,186,215,.22);
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(255,255,255,.7), rgba(241,249,255,.88));
  box-shadow: 0 8px 18px rgba(78,118,153,.06);
}
.student-app .student-dashboard .admin-dashboard-panel h3,
.student-app .student-dashboard-announcements h3 {
  margin: 4px 0 0;
  padding: 0;
  border: 0;
  color: #153d61 !important;
  font-size: .9rem !important;
}
.student-app .student-dashboard .admin-dashboard-panel-heading { margin-bottom: 12px; }
.student-app .student-dashboard .admin-dashboard-panel-eyebrow { color: #4d7eb9; }
.student-app .student-dashboard .admin-dashboard-chart-gridline { stroke: rgba(115,154,200,.2); }
.student-app .student-dashboard .admin-dashboard-chart-line {
  stroke: #55aceb;
  stroke-width: 3;
}
.student-app .student-dashboard .admin-dashboard-chart-point {
  fill: rgba(255,255,255,.94);
  stroke: #52aeeb;
}
.student-dashboard-snapshot-list { display:grid; }
.student-dashboard-snapshot-row {
  display:flex;
  min-width:0;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  padding:10px 0;
  border-bottom:1px solid rgba(127,162,192,.14);
  color:#526e86;
  font-size:.72rem;
}
.student-dashboard-snapshot-row strong {
  color:#153d61;
  font-size:.72rem;
  font-weight:700;
  text-align:right;
}
.student-dashboard-actions {
  display:flex;
  flex-wrap:wrap;
  gap:8px;
  margin-top:14px;
}
.student-dashboard-actions .btn { padding:8px 11px; font-size:.7rem; }
.student-app .student-dashboard-announcements { margin-top:0 !important; }
.student-app .student-dashboard-announcements .alert {
  border:1px solid rgba(142,199,232,.18);
  border-radius:10px;
  background:rgba(255,255,255,.28);
  color:#44667c;
}
.student-app .student-dashboard-focus-card {
  background: linear-gradient(180deg, #ffffff 0%, #f3f9ff 100%);
  border:1px solid rgba(82,174,235,.18);
  box-shadow: 0 10px 20px rgba(75,113,148,.06);
}
.student-app .student-dashboard-focus-card.primary { border-color: rgba(75,142,235,.22); }
.student-app .student-dashboard-focus-card.success { border-color: rgba(42,179,130,.2); }
.student-app .student-dashboard-focus-card.warning { border-color: rgba(245,160,87,.18); }
.student-app .student-dashboard-focus-card strong,
.student-app .student-dashboard-focus-card small,
.student-app .student-dashboard-news-box strong,
.student-app .student-dashboard-news-box p,
.student-app .student-dashboard-snapshot-row,
.student-app .student-dashboard-snapshot-row strong,
.student-app .student-dashboard .admin-dashboard-panel h3,
.student-app .student-dashboard-announcements h3 {
  color:#153d61 !important;
}
.student-app .student-dashboard-focus-label,
.student-app .student-dashboard .admin-dashboard-panel-eyebrow,
.student-app .student-dashboard .admin-dashboard-chart-caption,
.student-app .student-dashboard-snapshot-row span {
  color:#5c7d99 !important;
}
.student-app .student-dashboard-quick-link.primary {
  background: linear-gradient(135deg, #44a7f7 0%, #2b7ce8 100%);
  border-color: rgba(57,124,215,.2);
  color: #fff;
  box-shadow: 0 8px 18px rgba(57,124,215,.18);
}
.student-app .student-dashboard-quick-link.secondary {
  background: rgba(255,255,255,.7);
  border-color: rgba(146,186,215,.2);
  color: #365d80;
}
.student-app .student-dashboard-summary-panel .student-dashboard-snapshot-row,
.student-app .student-dashboard-news-panel .student-dashboard-news-box {
  border-color: rgba(146,186,215,.12);
}

.admin-app,
.admin-app .shell,
.admin-app .main {
  width:100%;
  min-width:0;
  max-width:100%;
}
.admin-app .main {
  flex:1 1 0;
  width:auto;
  overflow-x:hidden;
}
.admin-app .main > *,
.admin-app .main .fade-in,
.admin-app .main .grid2,
.admin-app .main .grid3,
.admin-app .main .form-grid,
.admin-app .main .stats-grid,
.admin-app .main .card,
.admin-app .main .page-header,
.admin-app .main .table-wrap {
  min-width:0;
  max-width:100%;
}
.admin-app .main .grid2 > *,
.admin-app .main .grid3 > *,
.admin-app .main .form-grid > *,
.admin-app .main .stats-grid > * {
  min-width:0;
}
.admin-app .main .table-wrap {
  overflow-x:auto;
  overscroll-behavior-x:contain;
  -webkit-overflow-scrolling:touch;
}
.admin-app .main :where(h1,h2,h3,h4,p,span,strong,small,label,a,button) {
  overflow-wrap:anywhere;
}
.admin-app .main :where(img,video,canvas,svg,iframe) {
  max-width:100%;
}
@media (max-width: 1000px) {
  .student-app .admin-dashboard.student-dashboard .stats-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
}
@media (max-width: 767px) {
  .student-app .admin-dashboard.student-dashboard { padding:12px; border-radius:17px; }
  .student-app .student-dashboard-header { padding-top:0; }
  .student-app .admin-dashboard.student-dashboard .stats-grid { grid-template-columns:1fr; }
  .student-app .student-dashboard-overview { grid-template-columns:1fr; }
  .student-app .student-dashboard-heading { gap:8px; }
  .student-app .student-dashboard-deadline { margin-left:57px; }
  .student-app .sidebar {
    width:min(292px,86vw);
    padding:10px 12px calc(88px + env(safe-area-inset-bottom));
    border-radius:0 22px 22px 0;
  }
}
@media (max-width: 1000px) {
  .admin-app .admin-dashboard .stats-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
}
@media (max-width: 767px) {
  .admin-app .admin-dashboard { padding:12px; border-radius:17px; }
  .admin-app .admin-dashboard-header { padding-top:0; }
  .admin-app .admin-dashboard .stats-grid { grid-template-columns:1fr; }
  .admin-app .admin-dashboard .admin-dashboard-overview,
  .admin-app .admin-dashboard .admin-dashboard-lower { grid-template-columns:1fr; }
  .admin-dashboard-chart { height:160px; }
}
`;

function DashboardDateTime() {
  const { cfg } = useContext(SettingsContext);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  let day = "-";
  let date = "-";
  let time = "-";
  try {
    const locale = cfg.locale || "en-GH";
    const timeZone = cfg.timezone || "Africa/Accra";
    day = new Intl.DateTimeFormat(locale, {
      timeZone,
      weekday: "long",
    }).format(now);
    date = new Intl.DateTimeFormat(locale, {
      timeZone,
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(now);
    time = new Intl.DateTimeFormat(locale, {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(now);
  } catch (error) {
    console.error("Could not format dashboard date and time:", error);
    day = date = time = "Check date and time settings";
  }

  return (
    <div
      aria-label="Current date and time"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "6px 14px",
        marginTop: 8,
        color: "#64748b",
        fontSize: ".85rem",
        fontWeight: 600,
      }}
    >
      <span>{day}</span>
      <span>{date}</span>
      <time>{time}</time>
    </div>
  );
}

// DASHBOARD (Admin)
function AdminDashboard({
  userName,
  studentsData,
  registeredSchools,
  financeSummary,
  recentActivity,
  isLoading,
}) {
  const students = Array.isArray(studentsData) ? studentsData : [];
  const registeredSchoolsList = Array.isArray(registeredSchools)
    ? registeredSchools
    : [];
  const totalStudents = students.length;
  const currentDate = new Date();
  const registrationMonths = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth() - 5 + index,
      1,
    );
    return {
      date,
      label: date.toLocaleDateString(undefined, { month: "short" }),
      count: 0,
    };
  });
  const registrationMonthIndexes = new Map(
    registrationMonths.map((month, index) => [
      `${month.date.getFullYear()}-${month.date.getMonth()}`,
      index,
    ]),
  );
  students.forEach((student) => {
    if (!student.created_at) return;
    const createdAt = new Date(student.created_at);
    if (Number.isNaN(createdAt.getTime())) return;
    const monthIndex = registrationMonthIndexes.get(
      `${createdAt.getFullYear()}-${createdAt.getMonth()}`,
    );
    if (monthIndex !== undefined) registrationMonths[monthIndex].count += 1;
  });
  const registrationChartPoints = registrationMonths.map((month, index) => ({
    ...month,
    x: 32 + (index * 536) / (registrationMonths.length - 1),
    y:
      164 -
      (month.count /
        Math.max(1, ...registrationMonths.map((item) => item.count))) *
        116,
  }));
  const registrationLinePath = registrationChartPoints
    .map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`)
    .join(" ");
  const registrationAreaPath = `${registrationLinePath} L 568 178 L 32 178 Z`;
  const hasRegistrationData = registrationMonths.some((month) => month.count > 0);
  const registeredRegionCount = new Set(
    registeredSchoolsList
      .map((school) =>
        String(school.region || "").trim().toLocaleLowerCase()
          .replace(/\s+region$/, "")
          .replace(/\s+/g, " "),
      )
      .filter((region) => region && region !== "unknown"),
  ).size;
  const registeredSchoolNames = new Map(
    registeredSchoolsList.map((school) => [String(school.id), school.name]),
  );
  const studentSchoolCount = new Set(
    students
      .map((student) => {
        const linkedSchool = student.registered_school_id == null
          ? ""
          : registeredSchoolNames.get(String(student.registered_school_id));
        return String(student.institution || student.school_name || linkedSchool || "")
          .trim()
          .toLocaleLowerCase();
      })
      .filter(Boolean),
  ).size;
  const studentLevels = students.reduce(
    (counts, student) => {
      const studentClass = String(student.class || student.class_name || "");
      if (/\bjhs\b|\bjunior\s+high\b|\bbasic\s*[789]\b/i.test(studentClass)) {
        counts.jhs += 1;
      } else if (/\bshs\b|\bsenior\s+high\b/i.test(studentClass)) {
        counts.shs += 1;
      } else if (/\b(university|universit|tertiary|college|level\s*\d+)\b/i.test(studentClass)) {
        counts.universities += 1;
      }
      return counts;
    },
    { jhs: 0, shs: 0, universities: 0 },
  );
  return (
    <div className="fade-in admin-dashboard">
      <div className="page-header admin-dashboard-header">
        <div className="admin-dashboard-heading">
          <div>
            <div className="admin-dashboard-eyebrow">OVERVIEW</div>
            <div className="page-title">Welcome back, {userName || "Admin"}</div>
            <div className="page-sub">
              Here's what's happening across your campus today.
            </div>
          </div>
        </div>
        <div className="admin-dashboard-header-meta">
          <DashboardDateTime />
        </div>
      </div>
      <div className="stats-grid">
        {[
          {
            label: "Total Students",
            value: String(totalStudents),
            sub: isLoading
              ? "Loading live student records..."
              : "Registered student accounts",
            icon: "students",
            ic: "#6d63df",
          },
          {
            label: "Schools Represented",
            value: String(studentSchoolCount),
            sub: "Distinct schools in student records",
            icon: "schools",
            ic: "#4b9be8",
          },
          {
            label: "Regions Registered",
            value: String(registeredRegionCount),
            sub: isLoading ? "Loading registered schools..." : "Regions with registered schools",
            icon: "pending",
            ic: "#e5a84b",
          },
        ].map((s) => (
          <div
            key={s.label}
            className="stat-card dashboard-stat-card"
            style={{
              "--dash-accent": s.ic,
            }}
          >
            <div className="stat-icon">
              <Ico name={s.icon} size={20} color={s.ic} />
            </div>
            <div className="stat-label">{s.label}</div>
            <div className="stat-value">{s.value}</div>
            <div className="stat-sub">{s.sub}</div>
          </div>
        ))}
      </div>
      <div className="grid2 admin-dashboard-overview">
        <section className="card card-padded admin-dashboard-panel admin-dashboard-chart-panel">
          <div className="admin-dashboard-panel-heading">
            <div>
              <span className="admin-dashboard-panel-eyebrow">STUDENT ENROLLMENT</span>
              <h3>Registration overview</h3>
            </div>
            <span className="admin-dashboard-chart-caption">Last 6 months</span>
          </div>
          <div className="admin-dashboard-chart-summary">
            <strong>{totalStudents.toLocaleString()}</strong>
            <span>student records</span>
          </div>
          {hasRegistrationData ? (
            <div className="admin-dashboard-chart-wrap">
              <svg
                className="admin-dashboard-chart"
                viewBox="0 0 600 210"
                role="img"
                aria-label="Monthly student registrations over the last six months"
              >
                <defs>
                  <linearGradient id="admin-dashboard-chart-gradient" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#8278ee" stopOpacity=".22" />
                    <stop offset="100%" stopColor="#8278ee" stopOpacity=".01" />
                  </linearGradient>
                </defs>
                {[48, 106, 164].map((y) => (
                  <line
                    key={y}
                    x1="30"
                    x2="570"
                    y1={y}
                    y2={y}
                    className="admin-dashboard-chart-gridline"
                  />
                ))}
                <path d={registrationAreaPath} className="admin-dashboard-chart-area" />
                <path d={registrationLinePath} className="admin-dashboard-chart-line" />
                {registrationChartPoints.map((point) => (
                  <circle
                    key={point.label + point.date.getFullYear()}
                    cx={point.x}
                    cy={point.y}
                    r="4"
                    className="admin-dashboard-chart-point"
                  >
                    <title>
                      {point.label}: {point.count} registrations
                    </title>
                  </circle>
                ))}
              </svg>
              <div className="admin-dashboard-chart-months" aria-hidden="true">
                {registrationChartPoints.map((point) => (
                  <span key={point.label + point.date.getFullYear()}>
                    {point.label}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="admin-dashboard-chart-empty">
              No student registrations with dates in the last six months.
            </div>
          )}
        </section>
        <section className="card card-padded admin-dashboard-panel admin-dashboard-schools-panel">
          <div className="admin-dashboard-panel-heading">
            <div>
              <span className="admin-dashboard-panel-eyebrow">SCHOOL DIRECTORY</span>
              <h3>Registered schools</h3>
            </div>
            <span className="admin-dashboard-school-count">
              {registeredSchoolsList.length}
            </span>
          </div>
          {registeredSchoolsList.length ? (
            <div className="admin-dashboard-school-list">
              {registeredSchoolsList.slice(0, 5).map((school) => (
                <div key={school.id} className="admin-dashboard-school">
                  <span className="admin-dashboard-school-mark" aria-hidden="true">
                    {String(school.name || "S").trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="admin-dashboard-school-copy">
                    <strong>{school.name}</strong>
                    <small>{school.region || "Region not specified"}</small>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="admin-dashboard-school-empty">
              No registered schools available.
            </div>
          )}
        </section>
      </div>
      <div className="grid2 admin-dashboard-overview admin-dashboard-lower">
        <section className="card card-padded admin-dashboard-panel">
          <div className="admin-dashboard-panel-heading">
            <div>
              <span className="admin-dashboard-panel-eyebrow">CAMPUS UPDATES</span>
              <h3>Recent activity</h3>
            </div>
            <span className="admin-dashboard-panel-icon" aria-hidden="true">R</span>
          </div>
          {(recentActivity?.length ? recentActivity.slice(0, 5) : [
            {
              id: "empty",
              text: "No recent activity available from current records.",
              timeLabel: "",
              dot: "#94a3b8",
            },
          ]).map((a, i) => (
            <div key={a.id || i} className="admin-dashboard-activity">
              <span className="admin-dashboard-activity-dot" style={{ "--activity-color": a.dot }} />
              <span className="admin-dashboard-activity-text">{a.text}</span>
              <time className="admin-dashboard-activity-time">{a.timeLabel}</time>
            </div>
          ))}
        </section>
        <section className="card card-padded admin-dashboard-panel">
          <div className="admin-dashboard-panel-heading">
            <div>
              <span className="admin-dashboard-panel-eyebrow">LEARNER OVERVIEW</span>
              <h3>Education level</h3>
            </div>
            <span className="admin-dashboard-panel-icon admin-dashboard-panel-icon-purple" aria-hidden="true">L</span>
          </div>
          {[
            {
              label: "JHS",
              count: studentLevels.jhs,
              color: "#2563eb",
            },
            {
              label: "SHS",
              count: studentLevels.shs,
              color: "#ea580c",
            },
            {
              label: "Universities",
              count: studentLevels.universities,
              color: "#9333ea",
            },
          ].map((level) => {
            const percentage = totalStudents
              ? Math.round((level.count / totalStudents) * 100)
              : 0;
            return (
            <div key={level.label} className="admin-dashboard-level">
              <div className="admin-dashboard-level-heading">
                <span>{level.label}</span>
                <strong>{level.count}<small>{`   ${percentage}%`}</small></strong>
              </div>
              <div
                className="progress"
                role="progressbar"
                aria-label={`${level.label} students`}
                aria-valuemin={0}
                aria-valuemax={totalStudents || 1}
                aria-valuenow={level.count}
              >
                <div
                  className="progress-bar"
                  style={{
                    width: `${percentage}%`,
                    background: level.color,
                  }}
                />
              </div>
            </div>
            );
          })}
          <div className="admin-dashboard-level-total">
            <span>Total student records</span>
            <strong>{totalStudents.toLocaleString()}</strong>
          </div>
        </section>
      </div>
    </div>
  );
}

function ActionStatusModal({ state, onClose }) {
  const isSuccess = state.type === "success";

  useEffect(() => {
    if (!state?.open) {
      return undefined;
    }

    const timer = setTimeout(
      () => {
        onClose();
      },
      state.type === "failure" ? 4500 : 2200,
    );
    return () => clearTimeout(timer);
  }, [onClose, state?.open, state?.type, state?.title, state?.message]);

  if (!state?.open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        style={{ maxWidth: 460 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head" style={{ marginBottom: 12 }}>
          <div>
            <div
              className="modal-title"
              style={{ color: isSuccess ? "#166534" : "#991b1b" }}
            >
              {state.title ||
                (isSuccess ? "Update Successful" : "Update Failed")}
            </div>
            <div
              className="modal-sub"
              style={{ fontSize: ".88rem", marginTop: 6, color: "#475569" }}
            >
              {state.message ||
                (isSuccess
                  ? "Your changes were saved."
                  : "Something went wrong while saving your changes.")}
            </div>
          </div>
        </div>
        <div className="modal-actions" style={{ marginTop: 10 }}>
          <button
            className={`btn ${isSuccess ? "btn-blue" : "btn-red"}`}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

const buildStudentDraft = (student = null) => {
  const studentClass = student?.class || student?.class_name || "";
  const normalizedParentContact =
    student?.parent_contact ||
    student?.parent_phone ||
    student?.guardian_phone ||
    student?.guardian_contact ||
    "";
  const generatedIndex = getStudentIdFromParentContact(
    normalizedParentContact,
    studentClass,
  );

  return {
    full_name: student?.full_name || student?.name || "",
    gender: student?.gender || "",
    index:
      generatedIndex ||
      student?.index ||
      student?.index_number ||
      student?.index_no ||
      "",
    class: student?.class || student?.class_name || "",
    region: student?.region || "Ashanti",
    parent_contact: normalizedParentContact,
    registered_school_id:
      student?.registered_school_id != null
        ? String(student.registered_school_id)
        : "",
    date_of_birth: student?.date_of_birth || "",
    // aggregate removed
    status: student?.status || "pending",
    photo_url: student?.photo_url || "",
  };
};

const normalizeStudentRecord = (student = {}, fallbackIndex = 0) => {
  const studentClass = student.class || student.class_name || "";
  const normalizedParentContact =
    student.parent_contact ||
    student.parent_phone ||
    student.guardian_phone ||
    student.guardian_contact ||
    "";
  const generatedIndex = getStudentIdFromParentContact(
    normalizedParentContact,
    studentClass,
  );

  return {
    ...student,
    id: student.id ?? fallbackIndex + 1,
    full_name: student.full_name || student.name || "Unnamed Student",
    index:
      generatedIndex ||
      student.index ||
      student.index_number ||
      student.index_no ||
      `AUTO${fallbackIndex + 1}`,
    class: studentClass,
    region: student.region || "Unknown",
    date_of_birth: student.date_of_birth || "",
    // aggregate removed
    status: student.status || "pending",
    email: student.email || null,
    institution: student.institution || student.school_name || student.school || "",
    school_name: student.school_name || student.school || "",
    parent_contact: normalizedParentContact,
    photo_url: resolveStudentPhotoUrl(student),
    registered_school_id: student.registered_school_id ?? null,
    created_at: student.created_at || null,
    updated_at: student.updated_at || null,
  };
};

const getStudentEducationLevel = (student) => {
  const explicitLevel = String(
    student?.education_level || student?.educationLevel || student?.level || "",
  ).toLowerCase();
  const className = String(student?.class || student?.class_name || "").toLowerCase();
  const level = explicitLevel || className;
  if (/\bjhs\b|junior high/.test(level)) return "JHS";
  if (/\bshs\b|senior high/.test(level)) return "SHS";
  if (/university|tertiary|college/.test(level)) return "University";
  return "Other";
};

const isBasic8Student = (studentClass) => {
  if (!studentClass) return false;
  return /basic\s*8/i.test(String(studentClass).trim());
};

const isBasic9Student = (studentClass) => {
  if (!studentClass) return false;
  return /basic\s*9/i.test(String(studentClass).trim());
};

const getStudentIdFromParentContact = (parentContact, studentClass) => {
  if (isBasic8Student(studentClass) || isBasic9Student(studentClass)) return null;
  const normalized = normalizeParentContactValue(parentContact);
  if (!normalized) return null;
  return normalized.endsWith("27") ? normalized : `${normalized}27`;
};

const normalizeParentContactValue = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D+/g, "");
  if (!digits) return raw;
  if (digits.length === 9) return `0${digits}`;
  if (digits.length === 10 && digits.startsWith("0")) return digits;
  if (digits.length === 12 && digits.startsWith("233")) {
    return `0${digits.slice(3)}`;
  }
  return digits;
};

const buildTeacherDraft = (teacher = null) => ({
  name: teacher?.name || teacher?.full_name || "",
  employee_id: teacher?.employee_id || "",
  role:
    normalizeRoleKey(teacher?.role || teacher?.user_role || "teacher") ||
    "teacher",
  gender: teacher?.gender || "",
  subject: teacher?.subject || "",
  class: teacher?.class || teacher?.class_name || "",
  phone: teacher?.phone || "",
  email: teacher?.email || "",
  qualification: teacher?.qualification || "",
  date_of_birth: teacher?.date_of_birth || "",
  hire_date: teacher?.hire_date || "",
  address: teacher?.address || "",
});

const TEACHER_PROFILE_FIELD_KEYS = [
  "employee_id",
  "gender",
  "qualification",
  "date_of_birth",
  "hire_date",
  "address",
];
const TEACHER_FORM_SCHEMA_VERSION = "teacher-form-v2";
const resolveClassOptions = (cfg) => {
  const rows = Array.isArray(cfg?.classOptions) ? cfg.classOptions : [];
  const cleaned = rows.map((row) => String(row || "").trim()).filter(Boolean);
  return cleaned;
};

function StudentEditorModal({
  open,
  title,
  draft,
  saving,
  onChange,
  onClose,
  onSave,
  registeredSchools = [],
  canAssignRegisteredSchool = false,
}) {
  const { cfg } = useContext(SettingsContext);
  const classOptions = resolveClassOptions(cfg);
  const classOptionsWithCurrent =
    draft.class && !classOptions.includes(draft.class)
      ? [draft.class, ...classOptions]
      : classOptions;

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">{title}</div>
            <div className="modal-sub">
              Update the core student record used across admissions, attendance,
              fees, and school reporting.
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>

          </button>
        </div>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Full Name</label>
            <input
              className="form-control"
              value={draft.full_name}
              onChange={(e) => onChange("full_name", e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Student ID</label>
            <input
              className="form-control"
              value={draft.index}
              onChange={(e) => onChange("index", e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Gender</label>
            <select
              className="form-control"
              value={draft.gender || ""}
              onChange={(e) => onChange("gender", e.target.value)}
            >
              <option value="">Not provided</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Class</label>
            <select
              className="form-control"
              value={draft.class}
              onChange={(e) => onChange("class", e.target.value)}
            >
              {!classOptions.length && (
                <option value="">No classes configured in Settings</option>
              )}
              {classOptionsWithCurrent.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Region</label>
            <select
              className="form-control"
              value={draft.region}
              onChange={(e) => onChange("region", e.target.value)}
            >
              {GHANA_REGIONS.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </div>
          {canAssignRegisteredSchool && (
            <div className="form-group">
              <label className="form-label">Registered School</label>
              <select
                className="form-control"
                value={draft.registered_school_id || ""}
                onChange={(e) =>
                  onChange("registered_school_id", e.target.value)
                }
              >
                <option value="">Not assigned</option>
                {registeredSchools.map((school) => (
                  <option key={school.id} value={String(school.id)}>
                    {school.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {/* Aggregate input removed */}
          <div className="form-group">
            <label className="form-label">Status</label>
            <select
              className="form-control"
              value={draft.status}
              onChange={(e) => onChange("status", e.target.value)}
            >
              <option value="pending">pending</option>
              <option value="confirmed">confirmed</option>
              <option value="active">active</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Parent Contact</label>
            <input
              className="form-control"
              value={draft.parent_contact || ""}
              onChange={(e) => onChange("parent_contact", e.target.value)}
              placeholder="e.g. 0241234567"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Date of Birth</label>
            <input
              className="form-control"
              type="date"
              value={draft.date_of_birth || ""}
              onChange={(e) => onChange("date_of_birth", e.target.value)}
            />
          </div>
          <div className="form-group" style={{ gridColumn: "1 / -1" }}>
            <label className="form-label">Photo URL</label>
            <input
              className="form-control"
              value={draft.photo_url}
              onChange={(e) => onChange("photo_url", e.target.value)}
              placeholder="Optional photo URL"
            />
          </div>
        </div>
        <div className="modal-actions">
          <button
            className="btn btn-outline"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button className="btn btn-blue" onClick={onSave} disabled={saving}>
            {saving ? "Saving..." : "Save Student"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TeacherEditorModal({
  open,
  title,
  draft,
  roleOptions,
  saving,
  onChange,
  onClose,
  onSave,
}) {
  const { cfg } = useContext(SettingsContext);
  const classOptions = resolveClassOptions(cfg);
  const classOptionsWithCurrent =
    draft.class && !classOptions.includes(draft.class)
      ? [draft.class, ...classOptions]
      : classOptions;

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        style={{ maxWidth: 760 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <div className="modal-title">{title}</div>
            <div className="modal-sub">
              Create or update the teacher profile used in academic and school
              operations.
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>

          </button>
        </div>
        <div className="alert alert-info" style={{ marginBottom: 14 }}>
          Fill in the staff profile fields below. Scroll inside this dialog if
          you do not see the full form.
        </div>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Teacher Name</label>
            <input
              className="form-control"
              value={draft.name}
              onChange={(e) => onChange("name", e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Employee ID</label>
            <input
              className="form-control"
              value={draft.employee_id}
              onChange={(e) => onChange("employee_id", e.target.value)}
              placeholder="Optional staff ID"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Role</label>
            <select
              className="form-control"
              value={draft.role}
              onChange={(e) => onChange("role", e.target.value)}
            >
              {roleOptions.map((role) => (
                <option key={role.key} value={role.key}>
                  {role.label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Gender</label>
            <select
              className="form-control"
              value={draft.gender}
              onChange={(e) => onChange("gender", e.target.value)}
            >
              <option value="">Select gender</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Subject</label>
            <input
              className="form-control"
              value={draft.subject}
              onChange={(e) => onChange("subject", e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Class</label>
            <select
              className="form-control"
              value={draft.class}
              onChange={(e) => onChange("class", e.target.value)}
            >
              {!classOptions.length && (
                <option value="">No classes configured in Settings</option>
              )}
              {classOptionsWithCurrent.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Phone</label>
            <input
              className="form-control"
              value={draft.phone}
              onChange={(e) => onChange("phone", e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              className="form-control"
              type="email"
              value={draft.email}
              onChange={(e) => onChange("email", e.target.value)}
              placeholder="teacher@school.edu"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Qualification</label>
            <input
              className="form-control"
              value={draft.qualification}
              onChange={(e) => onChange("qualification", e.target.value)}
              placeholder="e.g. B.Ed Mathematics"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Date of Birth</label>
            <input
              className="form-control"
              type="date"
              value={draft.date_of_birth}
              onChange={(e) => onChange("date_of_birth", e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Hire Date</label>
            <input
              className="form-control"
              type="date"
              value={draft.hire_date}
              onChange={(e) => onChange("hire_date", e.target.value)}
            />
          </div>
          <div className="form-group" style={{ gridColumn: "1 / -1" }}>
            <label className="form-label">Address</label>
            <input
              className="form-control"
              value={draft.address}
              onChange={(e) => onChange("address", e.target.value)}
              placeholder="Residential address"
            />
          </div>
        </div>
        <div className="modal-actions">
          <button
            className="btn btn-outline"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button className="btn btn-blue" onClick={onSave} disabled={saving}>
            {saving ? "Saving..." : "Save Teacher"}
          </button>
        </div>
      </div>
    </div>
  );
}

// STUDENTS LIST
const StudentsPage = lazy(() =>
  import("./src/components/StudentsManagementPage.jsx").then((module) => ({
    default: module.StudentsPage,
  })),
);

// ENROLL
function EnrollPage({ onBack, registeredSchoolId = null, onEnrolled = null, registeredSchools = [], isSuperAdmin = false }) {
  const { cfg } = useContext(SettingsContext);
  const classOptions = resolveClassOptions(cfg);
  const classOptionsKey = classOptions.join("||");
  const [form, setForm] = useState({
    name: "",
    index: "",
    dob: "",
    class: classOptions[0] || "",
    region: "Ashanti",
    guardian: "",
    phone: "",
    photoUrl: "",
    registeredSchoolId: registeredSchoolId || "",
  });
  const [photoPreview, setPhotoPreview] = useState(null);
  const [photoFileName, setPhotoFileName] = useState("");
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loginSetupMessage, setLoginSetupMessage] = useState("");
  const autoGeneratedIndexRef = useRef("");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const generateStudentId = (studentContact, studentClass) => {
    const generatedId = getStudentIdFromParentContact(studentContact, studentClass);
    if (!generatedId) {
      if (
        autoGeneratedIndexRef.current &&
        form.index === autoGeneratedIndexRef.current
      ) {
        set("index", "");
      }
      autoGeneratedIndexRef.current = "";
      return;
    }

    if (!form.index || form.index === autoGeneratedIndexRef.current) {
      set("index", generatedId);
      autoGeneratedIndexRef.current = generatedId;
    }
  };

  useEffect(() => {
    const contactValue = form.phone || form.guardian || "";
    generateStudentId(contactValue, form.class);
  }, [form.phone, form.class]);

  useEffect(() => {
    if (form.registeredSchoolId) {
      const selectedSchool = registeredSchools.find(
        (s) => String(s.id) === String(form.registeredSchoolId),
      );
      if (selectedSchool?.region && selectedSchool.region !== form.region) {
        set("region", selectedSchool.region);
      }
    }
  }, [form.registeredSchoolId, registeredSchools]);

  useEffect(() => {
    const nextClass = classOptions[0] || "";
    if (!classOptions.includes(form.class) && form.class !== nextClass) {
      setForm((current) => ({ ...current, class: nextClass }));
    }
  }, [classOptionsKey, form.class]);
  const completionCount = [
    form.name,
    form.index,
    form.dob,
    form.class,
    form.region,
    form.guardian,
    form.phone,
  ].filter((value) => String(value || "").trim()).length;

  const handlePhotoChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setPhotoFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPhotoPreview(ev.target.result);
      set("photoUrl", ev.target.result);
    };
    reader.readAsDataURL(file);
  };

  const enrollStudent = async () => {
    if (!form.name.trim()) {
      alert("Name is required.");
      return;
    }
    if (isSuperAdmin && !form.registeredSchoolId) {
      alert("Please select a registered school to enroll this student.");
      return;
    }
    if (!form.index.trim()) {
      alert("Student ID is required. Please select a school first to auto-generate it, or enter one manually.");
      return;
    }
    if (!form.class.trim()) {
      alert("No class is configured. Create classes in Settings first.");
      return;
    }

    setSaving(true);
    const student = {
      id: Date.now(),
      full_name: form.name.trim(),
      index: form.index.trim(),
      class: form.class,
      region: form.region,
      // aggregate removed
      status: "pending",
      photo_url: form.photoUrl.trim() || "",
    };

    if (supabase) {
      const selectedSchool = registeredSchools.find(
        (s) =>
          String(s.id) ===
          String(registeredSchoolId != null ? registeredSchoolId : form.registeredSchoolId),
      );
      const payload = {
        full_name: student.full_name,
        index_number: student.index,
        index: student.index,
        class: student.class,
        region: selectedSchool?.region || student.region,
        // aggregate removed
        status: student.status,
        ...(registeredSchoolId != null
          ? { registered_school_id: registeredSchoolId }
          : isSuperAdmin && form.registeredSchoolId
          ? { registered_school_id: form.registeredSchoolId }
          : {}),
        date_of_birth: form.dob || null,
        parent_contact: form.guardian || form.phone || null,
        personal_contact: form.phone || null,
        photo_url: student.photo_url || null,
      };

      let insertPayload = { ...payload };
      let missingScopeColumn = false;
      let lastError = null;
      let insertedStudentId = null;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const { data, error } = await supabase
          .from("students")
          .insert(insertPayload)
          .select("id")
          .single();
        if (!error) {
          insertedStudentId = data?.id || null;
          lastError = null;
          break;
        }
        lastError = error;
        if (!isMissingColumnError(error)) break;

        const msg = String(error.message || "");
        const quotedMatch = msg.match(/'([^']+)'/);
        const doubleQuotedMatch = msg.match(/"([^"]+)"/);
        const missingColumn = (
          quotedMatch?.[1] ||
          doubleQuotedMatch?.[1] ||
          ""
        ).trim();

        if (!missingColumn) break;
        if (
          missingColumn === "registered_school_id" &&
          registeredSchoolId != null
        ) {
          // Allow enrollment to continue on older schemas, but mark it as unscoped.
          missingScopeColumn = true;
        }

        if (!(missingColumn in insertPayload)) break;
        delete insertPayload[missingColumn];
      }

      if (lastError) {
        const errMsg = String(lastError.message || "");
        const normalizedErr = errMsg.toLowerCase();
        if (
          normalizedErr.includes("row-level security") ||
          normalizedErr.includes("violates row-level security policy") ||
          normalizedErr.includes("unauthorized")
        ) {
          alert(
            "Enrollment failed: Supabase access is blocked by auth/RLS. Sign in again, then run backend/supabase/migrations/001_public_portal_tables.sql and backend/supabase/migrations/009_ensure_student_profile_fields.sql in Supabase SQL editor.",
          );
          setSaving(false);
          return;
        }
        alert(
          "Enrollment failed: " +
            (lastError.message ||
              "Unknown error. Check Supabase RLS policies for the students table."),
        );
        setSaving(false);
        return;
      }

      if (missingScopeColumn) {
        alert(
          "Student enrolled, but this database is missing registered_school_id on students. Run backend/supabase/migrations/004_add_registered_school_scope.sql so future records are school-scoped.",
        );
      }

      if (!insertedStudentId) {
        setLoginSetupMessage(
          "The student record was saved, but its login could not be set up automatically. Use Set Up Student Logins in the student directory to retry.",
        );
      } else {
        const { data, error } = await supabase.functions.invoke(
          "provision-student-logins",
          { body: { student_id: insertedStudentId } },
        );
        if (error || data?.failed || data?.results?.[0]?.status !== "ready") {
          setLoginSetupMessage(
            `The student was enrolled, but login setup failed: ${
              data?.results?.[0]?.message ||
              error?.message ||
              "The provisioning service did not confirm the account."
            } Use Set Up Student Logins in the student directory to retry.`,
          );
        } else {
          setLoginSetupMessage(
            "Student login is ready. Sign in with the Student ID and the parent/guardian contact on record. The student should change the temporary password after first sign-in.",
          );
        }
      }
    } else {
      setLoginSetupMessage(
        "Supabase is not configured, so this local student record does not have a student login.",
      );
    }

    if (typeof onEnrolled === "function") {
      try {
        await onEnrolled();
      } catch {
        // Keep enrollment successful even if post-save refresh fails.
      }
    }

    setSaving(false);
    setDone(true);
  };

  if (done)
    return (
      <div className="fade-in">
        <div className="enroll-success-card">
          <div className="alert alert-success" style={{ marginBottom: 0 }}>
            Student enrolled successfully!
          </div>
          {loginSetupMessage && (
            <div
              className={`alert ${
                loginSetupMessage.startsWith("Student login is ready")
                  ? "alert-success"
                  : "alert-warning"
              }`}
              style={{ marginTop: 12 }}
              role="status"
            >
              {loginSetupMessage}
            </div>
          )}
          <div className="enroll-success-title">Admissions record created</div>
          <div className="enroll-success-sub">
            The student profile has been added and is ready for scores,
            placement updates, and guardian communication workflows.
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button className="btn btn-outline" onClick={onBack}>
              {"<- Back to Students"}
            </button>
          </div>
        </div>
      </div>
    );
  return (
    <div className="fade-in">
      <div className="enroll-shell">
        <div className="enroll-hero">
          <div className="enroll-hero-copy">
            <div className="enroll-hero-eyebrow">Admissions Desk</div>
            <div className="enroll-hero-title">
              Enroll a student with a cleaner intake workflow
            </div>
            <div className="enroll-hero-sub">
              Capture the core identity, placement, and guardian details in one
              professional screen that feels consistent with an admissions
              office, not a demo form.
            </div>
          </div>
          <div className="enroll-hero-pills">
            <span className="enroll-hero-pill">
              <Ico name="students" size={14} color="#bfdbfe" /> Student record
            </span>
            <span className="enroll-hero-pill">
              <Ico name="confirmed" size={14} color="#bfdbfe" /> Ready for
              placement
            </span>
            <span className="enroll-hero-pill">
              <Ico name="profile" size={14} color="#bfdbfe" /> Guardian linked
            </span>
          </div>
        </div>

        <div className="enroll-panel">
          <aside className="enroll-sidebar">
            <div className="enroll-photo-card">
              <div className="enroll-photo-head">
                <div>
                  <div className="enroll-photo-title">Profile Preview</div>
                  <div className="enroll-photo-meta">
                    Admissions card snapshot
                  </div>
                </div>
                <span className="enroll-section-badge">
                  {completionCount}/7 fields
                </span>
              </div>
              <div className="enroll-photo-col">
                <div className="enroll-photo-frame">
                  {photoPreview ? (
                    <img
                      src={photoPreview}
                      alt="Preview"
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  ) : (
                    <div className="enroll-photo-empty">
                      <div className="enroll-photo-empty-badge">
                        <Ico name="profile" size={20} color="#1d4ed8" />
                      </div>
                      <div className="enroll-photo-empty-copy">
                        <div className="enroll-photo-empty-title">
                          Photo not uploaded
                        </div>
                        <div className="enroll-photo-empty-sub">
                          Add a clear passport-style image for the student
                          record.
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <div className="enroll-upload-stack">
                  <input
                    id="student-photo-upload"
                    type="file"
                    accept="image/*"
                    className="enroll-photo-input"
                    onChange={handlePhotoChange}
                  />
                  <label
                    htmlFor="student-photo-upload"
                    className="enroll-upload-trigger"
                  >
                    <Ico name="upload" size={14} color="#fff" />{" "}
                    {photoPreview ? "Replace photo" : "Upload photo"}
                  </label>
                  <div className="enroll-upload-meta">
                    <div className="enroll-upload-file">
                      {photoFileName || "No file selected"}
                    </div>
                    <div className="enroll-upload-caption">
                      PNG or JPG. Centered portrait preferred.
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="enroll-mini-stats">
              <div className="enroll-mini-stat">
                <div className="enroll-mini-label">Class</div>
                <div className="enroll-mini-value">{form.class}</div>
              </div>
              <div className="enroll-mini-stat">
                <div className="enroll-mini-label">Region</div>
                <div className="enroll-mini-value">{form.region}</div>
              </div>
            </div>

            <div className="enroll-guidance">
              <div className="enroll-guidance-title">Before you save</div>
              <div className="enroll-guidance-list">
                <div className="enroll-guidance-item">
                  <span className="enroll-guidance-dot">1</span>
                  <span>
                    Use the official student ID format so later score imports
                    and attendance records match cleanly.
                  </span>
                </div>
                <div className="enroll-guidance-item">
                  <span className="enroll-guidance-dot">2</span>
                  <span>
                    Confirm the guardian phone number now to reduce corrections
                    during fees and announcement workflows.
                  </span>
                </div>
                <div className="enroll-guidance-item">
                  <span className="enroll-guidance-dot">3</span>
                  <span>
                    Choose the correct class and region up front so placement
                    dashboards stay accurate.
                  </span>
                </div>
              </div>
            </div>
          </aside>

          <div className="card enroll-form-card">
            <div className="enroll-form-head">
              <div>
                <div className="enroll-form-kicker">Student Intake Form</div>
                <div className="enroll-form-title">Core admission details</div>
                <div className="enroll-form-sub">
                  Enter the student profile once, then let the rest of the
                  portal reuse it across academics, communication, and
                  reporting.
                </div>
              </div>
              <div className="enroll-form-status">Draft ready</div>
            </div>

            <div className="enroll-form-body">
              <section className="enroll-section">
                <div className="enroll-section-head">
                  <div>
                    <div className="enroll-section-title">Identity</div>
                    <div className="enroll-section-sub">
                      Basic student information used everywhere else in the
                      portal.
                    </div>
                  </div>
                  <span className="enroll-section-badge">Required</span>
                </div>
                <div className="enroll-fields">
                  <div className="form-group">
                    <label className="form-label">Full Name</label>
                    <input
                      className="form-control"
                      placeholder="e.g. Ama Owusu Mensah"
                      value={form.name}
                      onChange={(e) => set("name", e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Student ID</label>
                    <input
                      className="form-control"
                      placeholder="e.g. 024123456727"
                      value={form.index}
                      onChange={(e) => set("index", e.target.value)}
                    />
                                    <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: 6 }}>
                      ID is auto-generated from the guardian phone + 27 when available, except for Basic 8 and Basic 9 students.
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Date of Birth</label>
                    <input
                      type="date"
                      className="form-control"
                      value={form.dob}
                      onChange={(e) => set("dob", e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Parent/Guardian Name</label>
                    <input
                      className="form-control"
                      placeholder="Parent or guardian full name"
                      value={form.guardian}
                      onChange={(e) => set("guardian", e.target.value)}
                    />
                  </div>
                </div>
              </section>

              <section className="enroll-section">
                <div className="enroll-section-head">
                  <div>
                    <div className="enroll-section-title">
                      Academic Class Placement
                    </div>
                    <div className="enroll-section-sub">
                      Assign the student to the right learning group and origin
                      region for reporting.
                    </div>
                  </div>
                  <span className="enroll-section-badge">Placement</span>
                </div>
                <div className="enroll-fields">
                  <div className="form-group">
                    <label className="form-label">Class</label>
                    <select
                      className="form-control"
                      value={form.class}
                      onChange={(e) => set("class", e.target.value)}
                    >
                      {!classOptions.length && (
                        <option value="">No classes configured in Settings</option>
                      )}
                      {classOptions.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Region</label>
                    <select
                      className="form-control"
                      value={form.region}
                      onChange={(e) => set("region", e.target.value)}
                    >
                      {GHANA_REGIONS.map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>

              <section className="enroll-section">
                <div className="enroll-section-head">
                  <div>
                    <div className="enroll-section-title">Family contact</div>
                    <div className="enroll-section-sub">
                      Keep one reliable guardian contact on file for fees,
                      notices, and attendance follow-up.
                    </div>
                  </div>
                  <span className="enroll-section-badge">Contact</span>
                </div>
                <div className="enroll-fields">
                  <div className="form-group full">
                    <label className="form-label">Phone</label>
                    <input
                      className="form-control"
                      placeholder="Guardian or student phone"
                      value={form.phone}
                      onChange={(e) => {
                        const value = e.target.value.replace(/\D/g, "").slice(0, 10);
                        set("phone", value);
                      }}
                    />
                    <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: 6 }}>
                      Enter a guardian phone number and the Student ID will be generated automatically.
                    </div>
                  </div>
                </div>
              </section>

              {isSuperAdmin && (
                <section className="enroll-section">
                  <div className="enroll-section-head">
                    <div>
                      <div className="enroll-section-title">Registered School Assignment</div>
                      <div className="enroll-section-sub">
                        Assign the student to a registered school for management and operations.
                      </div>
                    </div>
                    <span className="enroll-section-badge">Required</span>
                  </div>
                  <div className="enroll-fields">
                    <div className="form-group full">
                      <label className="form-label">Registered School</label>
                      <select
                        className="form-control"
                        value={form.registeredSchoolId}
                        onChange={(e) => set("registeredSchoolId", e.target.value)}
                      >
                        <option value="">-- Select a registered school --</option>
                        {registeredSchools.map((school) => (
                          <option key={school.id} value={school.id}>
                            {school.name}
                            {school.region ? ` (${school.region})` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </section>
              )}
            </div>

            <div className="enroll-actions">
              <div className="enroll-actions-note">
                Required fields are validated before save. Once enrolled, the
                record can be used for scores, attendance, announcements, and
                placement updates.
              </div>
              <div className="enroll-actions-row">
                <button className="btn btn-outline" onClick={onBack}>
                  Cancel
                </button>
                <button
                  className="btn btn-blue"
                  onClick={enrollStudent}
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Enroll Student"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

//   SCORES
function ScoresPage({ studentsData, tableInfo }) {
  const hasScoresError = hasRealTableError(tableInfo);
  const isMobile = useIsMobileLayout();
  const students = studentsData?.length
    ? sortStudentsByIndex(studentsData)
    : [];
  const studentsMap = new Map();
  students.forEach((student) => {
    studentsMap.set(String(student.id), student);
    studentsMap.set(String(student.index), student);
  });
  const scoreRows = Array.isArray(tableInfo?.rows)
    ? sortRecordsByStudentIndex(
        tableInfo.rows.map((row, index) =>
          normalizeScoreRow(row, studentsMap, index),
        ),
      )
    : [];
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Test Scores</div>
      </div>
      {hasScoresError && (
        <div className="alert alert-warning">
          Supabase scores table is unavailable.
        </div>
      )}
      {isMobile ? (
        <div className="mobile-record-list">
          {(scoreRows.length ? scoreRows : students).map((student) => {
            if (scoreRows.length) {
              const grade = getGrade(student.score);
              return (
                <div key={`score-${student.id}`} className="mobile-record-card">
                  <div className="mobile-record-head">
                    <div>
                      <div className="mobile-record-title">
                        {student.studentName}
                      </div>
                      <div className="mobile-record-sub">
                        Student ID: {student.index}
                      </div>
                    </div>
                    <span
                      className="grade-chip"
                      style={{ background: grade.bg, color: grade.color }}
                    >
                      {student.score}
                    </span>
                  </div>
                  <div className="mobile-record-grid">
                    <div className="mobile-record-item">
                      <label>Subject</label>
                      <span>{student.subject}</span>
                    </div>
                    <div className="mobile-record-item">
                      <label>Exam</label>
                      <span className="badge badge-blue">
                        {student.examType}
                      </span>
                    </div>
                  </div>
                </div>
              );
            }
            // Aggregate removed; fallback grade logic removed
            return (
              <div key={student.id} className="mobile-record-card">
                <div className="mobile-record-head">
                  <div>
                    <div className="mobile-record-title">
                      {student.full_name}
                    </div>
                    <div className="mobile-record-sub">
                      Student ID: {student.index}
                    </div>
                  </div>
                  {/* No aggregate/grade shown */}
                  <span
                    className={`badge ${student.status === "confirmed" ? "badge-success" : "badge-warning"}`}
                  >
                    {student.status}
                  </span>
                </div>
                <div className="mobile-record-grid">
                  <div className="mobile-record-item">
                    <label>Class</label>
                    <span>{student.class}</span>
                  </div>
                  <div className="mobile-record-item">
                    <label>Aggregate</label>
                    <span
                      className="grade-chip"
                      style={{ background: grade.bg, color: grade.color }}
                    >
                      {aggregate}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Student ID</th>
                <th>{scoreRows.length ? "Subject" : "Class"}</th>
                <th>{scoreRows.length ? "Score" : "Aggregate"}</th>
                <th>{scoreRows.length ? "Exam" : "Status"}</th>
              </tr>
            </thead>
            <tbody>
              {(scoreRows.length ? scoreRows : students).map((student) => {
                if (scoreRows.length) {
                  const grade = getGrade(student.score);
                  return (
                    <tr key={`score-${student.id}`}>
                      <td>
                        <strong>{student.studentName}</strong>
                      </td>
                      <td style={{ fontFamily: "monospace" }}>
                        {student.index}
                      </td>
                      <td>{student.subject}</td>
                      <td>
                        <span
                          className="grade-chip"
                          style={{ background: grade.bg, color: grade.color }}
                        >
                          {student.score}
                        </span>
                      </td>
                      <td>
                        <span className="badge badge-blue">
                          {student.examType}
                        </span>
                      </td>
                    </tr>
                  );
                }
                const aggregate = Number(student.aggregate ?? 0);
                const grade = getGrade(100 - Math.min(aggregate * 5, 95));
                return (
                  <tr key={student.id}>
                    <td>
                      <strong>{student.full_name}</strong>
                    </td>
                    <td style={{ fontFamily: "monospace" }}>{student.index}</td>
                    <td>{student.class}</td>
                    <td>
                      <span
                        className="grade-chip"
                        style={{ background: grade.bg, color: grade.color }}
                      >
                        {aggregate}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`badge ${student.status === "confirmed" ? "badge-success" : "badge-warning"}`}
                      >
                        {student.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

//   ANALYTICS
function AnalyticsPage({
  studentsData,
  schoolsData,
  selectionsData,
  scoreTableInfo,
}) {
  const hasScoreAnalyticsError = hasRealTableError(scoreTableInfo);
  const students = studentsData?.length ? studentsData : [];
  const schools = schoolsData?.length ? schoolsData : [];
  const selections = selectionsData?.length ? selectionsData : [];
  const averageAggregate = students.length
    ? (
        students.reduce(
          (sum, student) => sum + Number(student.aggregate || 0),
          0,
        ) / students.length
      ).toFixed(1)
    : "-";
  const byRegion = students.reduce((acc, student) => {
    const region = student.region || "Unknown";
    acc[region] = (acc[region] || 0) + 1;
    return acc;
  }, {});
  const regionStats = Object.entries(byRegion)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6);
  const maxRegionCount = Math.max(1, ...regionStats.map(([, count]) => count));
  const categoryCounts = schools.reduce(
    (acc, school) => {
      const key = String(school.category || "C").toUpperCase();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    },
    { A: 0, B: 0, C: 0 },
  );
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Analytics</div>
        <div className="page-sub">
          Live overview from accessible Supabase tables
        </div>
      </div>
      {hasScoreAnalyticsError && (
        <div className="alert alert-warning">
          Detailed score analytics are unavailable because the Supabase scores
          table is not accessible.
        </div>
      )}
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        {[
          {
            label: "Students",
            value: students.length,
            bg: "#dbeafe",
            c: "#1d4ed8",
          },
          {
            label: "Submitted Selections",
            value: selections.length,
            bg: "#dcfce7",
            c: "#15803d",
          },
          {
            label: "Average Aggregate",
            value: averageAggregate,
            bg: "#fef3c7",
            c: "#b45309",
          },
          {
            label: "Schools",
            value: schools.length,
            bg: "#ede9fe",
            c: "#6d28d9",
          },
        ].map((item) => (
          <div
            key={item.label}
            className="stat-card"
            style={{ background: item.bg }}
          >
            <div className="stat-label" style={{ color: item.c }}>
              {item.label}
            </div>
            <div className="stat-value" style={{ color: item.c }}>
              {item.value}
            </div>
          </div>
        ))}
      </div>
      <div className="grid2">
        <div className="card card-padded">
          <h3 style={{ fontWeight: 700, marginBottom: 16, fontSize: "1rem" }}>
            Students By Region
          </h3>
          {regionStats.map(([region, count]) => (
            <div key={region} style={{ marginBottom: 10 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 4,
                  fontSize: ".8rem",
                }}
              >
                <span style={{ fontWeight: 600 }}>{region}</span>
                <span style={{ fontWeight: 700, color: "#1d4ed8" }}>
                  {count}
                </span>
              </div>
              <div className="progress">
                <div
                  className="progress-bar"
                  style={{
                    width: `${(count / maxRegionCount) * 100}%`,
                    background: "#1d4ed8",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="card card-padded">
          <h3 style={{ fontWeight: 700, marginBottom: 16, fontSize: "1rem" }}>
            School Category Coverage
          </h3>
          {[
            ["Category A", categoryCounts.A, "#fef3c7", "#d97706"],
            ["Category B", categoryCounts.B, "#dbeafe", "#1e40af"],
            ["Category C", categoryCounts.C, "#dcfce7", "#16a34a"],
            [
              "Confirmed",
              selections.filter(
                (row) => String(row.status || "").toLowerCase() === "confirmed",
              ).length,
              "#fee2e2",
              "#dc2626",
            ],
          ].map(([label, count, bg, color]) => (
            <div key={label} className="metric-row">
              <span
                className="metric-row-badge"
                style={{ background: bg, color }}
              >
                {label}
              </span>
              <div className="progress" style={{ flex: 1 }}>
                <div
                  className="progress-bar"
                  style={{
                    width: `${(count / Math.max(students.length || schools.length || 1, 1)) * 100}%`,
                    background: color,
                  }}
                />
              </div>
              <span className="metric-row-count">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

//   ATTENDANCE (Admin)
function AttendancePage({
  studentsData,
  tableInfo,
  registeredSchoolId = null,
}) {
  const hasAttendanceError = hasRealTableError(tableInfo);
  const isMobile = useIsMobileLayout();
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const rows = studentsData?.length ? studentsData : [];
  const [marks, setMarks] = useState({});
  const [statusModal, setStatusModal] = useState({
    open: false,
    type: "success",
    title: "",
    message: "",
  });
  const [loadingMarks, setLoadingMarks] = useState(false);

  useEffect(() => {
    setMarks(Object.fromEntries(rows.map((s) => [s.id, "Present"])));
  }, [studentsData]);

  useEffect(() => {
    const loadAttendance = async () => {
      if (!supabase) return;
      if (hasAttendanceError) {
        setLoadingMarks(false);
        return;
      }
      setLoadingMarks(true);
      let query = supabase.from("attendance").select("*").eq("date", date);
      if (registeredSchoolId != null)
        query = query.eq("registered_school_id", registeredSchoolId);
      const { data, error } = await query;
      if (!error && Array.isArray(data) && data.length) {
        const next = Object.fromEntries(rows.map((s) => [s.id, "Present"]));
        data.forEach((record) => {
          const match = rows.find(
            (student) =>
              String(student.id) === String(record.student_id) ||
              String(student.index) === String(record.index_number),
          );
          if (match) next[match.id] = record.status || "Present";
        });
        setMarks(next);
      }
      setLoadingMarks(false);
    };
    loadAttendance();
  }, [date, rows, hasAttendanceError]);

  const saveAttendance = async () => {
    if (hasAttendanceError) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Attendance Update Failed",
        message:
          "Attendance table is not accessible, so updates cannot be synced right now.",
      });
      return;
    }
    try {
      if (supabase) {
        const payload = rows.map((student) => ({
          student_id: student.id,
          index_number: student.index || student.index_number || null,
          ...(registeredSchoolId != null
            ? { registered_school_id: registeredSchoolId }
            : {}),
          date,
          status: marks[student.id] || "Present",
        }));
        for (const item of payload) {
          const { error } = await supabase.from("attendance").insert(item);
          if (error && !isMissingColumnError(error)) {
            const { error: upsertError } = await supabase
              .from("attendance")
                .upsert(item, { onConflict: "student_id,date" });
            if (upsertError) throw upsertError;
          }
        }
      }
      setStatusModal({
        open: true,
        type: "success",
        title: "Attendance Updated",
        message: `Attendance was saved for ${date}.`,
      });
    } catch (error) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Attendance Update Failed",
        message:
          error?.message || "Could not save attendance. Please try again.",
      });
    }
  };
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Attendance</div>
      </div>
      {hasAttendanceError && (
        <div className="alert alert-warning">
          Attendance table is not accessible in Supabase yet. This page can
          display students, but attendance cannot sync online.
        </div>
      )}
      <div className="page-actions-row" style={{ alignItems: "center" }}>
        <input
          type="date"
          className="form-control"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <button
          className="btn btn-blue"
          onClick={saveAttendance}
          disabled={hasAttendanceError}
        >
          Save Attendance
        </button>
      </div>
      {loadingMarks && (
        <div className="alert alert-info">Loading attendance...</div>
      )}
      <ActionStatusModal
        state={statusModal}
        onClose={() => setStatusModal((s) => ({ ...s, open: false }))}
      />
      {isMobile ? (
        <div className="mobile-record-list">
          {rows.map((s) => (
            <div key={s.id} className="mobile-record-card">
              <div className="mobile-record-head">
                <div>
                  <div className="mobile-record-title">{s.full_name}</div>
                  <div className="mobile-record-sub">{s.class}</div>
                </div>
                <span
                  className={`badge ${marks[s.id] === "Present" ? "badge-success" : marks[s.id] === "Absent" ? "badge-danger" : "badge-warning"}`}
                >
                  {marks[s.id] || "Present"}
                </span>
              </div>
              <div className="mobile-record-actions">
                {["Present", "Absent", "Late"].map((st) => (
                  <button
                    key={st}
                    className="btn btn-sm"
                    style={{
                      background:
                        marks[s.id] === st
                          ? st === "Present"
                            ? "#dcfce7"
                            : st === "Absent"
                              ? "#fee2e2"
                              : "#fef9c3"
                          : "#f1f5f9",
                      color:
                        marks[s.id] === st
                          ? st === "Present"
                            ? "#16a34a"
                            : st === "Absent"
                              ? "#dc2626"
                              : "#d97706"
                          : "#64748b",
                      border: "none",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontFamily: "var(--font)",
                      fontWeight: 600,
                      fontSize: ".75rem",
                      padding: "8px 10px",
                    }}
                    onClick={() => setMarks((m) => ({ ...m, [s.id]: st }))}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Class</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.full_name}</strong>
                  </td>
                  <td>{s.class}</td>
                  <td>
                    <div style={{ display: "flex", gap: 8 }}>
                      {["Present", "Absent", "Late"].map((st) => (
                        <button
                          key={st}
                          className="btn btn-sm"
                          style={{
                            background:
                              marks[s.id] === st
                                ? st === "Present"
                                  ? "#dcfce7"
                                  : st === "Absent"
                                    ? "#fee2e2"
                                    : "#fef9c3"
                                : "#f1f5f9",
                            color:
                              marks[s.id] === st
                                ? st === "Present"
                                  ? "#16a34a"
                                  : st === "Absent"
                                    ? "#dc2626"
                                    : "#d97706"
                                : "#64748b",
                            border: "none",
                            borderRadius: 8,
                            cursor: "pointer",
                            fontFamily: "var(--font)",
                            fontWeight: 600,
                            fontSize: ".75rem",
                            padding: "5px 10px",
                          }}
                          onClick={() =>
                            setMarks((m) => ({ ...m, [s.id]: st }))
                          }
                        >
                          {st}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

//   FEES (Admin)
function FeesAdmin({
  studentsData,
  feesData,
  tableInfo,
  registeredSchoolId = null,
}) {
  const hasFeesError = hasRealTableError(tableInfo);
  const students = studentsData || [];
  const [fees, setFees] = useState(feesData || []);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    student_id: "",
    term: "First Term",
    amount: "",
    paid: "0",
    due_date: "",
  });
  useEffect(() => {
    setFees(feesData || []);
  }, [feesData]);
  const saveFee = async () => {
    const student = students.find(
      (row) => String(row.id) === String(form.student_id),
    );
    const amount = Number(form.amount);
    const paid = Number(form.paid);
    if (!student || !form.term.trim()) {
      setError("Select a student and enter a term.");
      return;
    }
    if (
      !Number.isFinite(amount) ||
      !Number.isFinite(paid) ||
      amount < 0 ||
      paid < 0 ||
      paid > amount
    ) {
      setError("Enter valid fee amounts. Paid must be between zero and the total amount.");
      return;
    }
    if (!supabase) {
      setError("Supabase is not configured; this fee record cannot be saved.");
      return;
    }
    setSaving(true);
    setError("");
    const payload = {
      student_id: student.id,
      index_number: student.index_number || student.index || null,
      term: form.term.trim(),
      amount,
      paid,
      status: paid >= amount ? "paid" : paid > 0 ? "partial" : "unpaid",
      due_date: form.due_date || null,
      ...(registeredSchoolId != null
        ? { registered_school_id: registeredSchoolId }
        : {}),
    };
    const request = editingId
      ? supabase.from("fees").update(payload).eq("id", editingId)
      : supabase.from("fees").insert(payload);
    const { data, error: saveError } = await request.select("*").single();
    if (saveError) {
      setError(`Fee record was not saved: ${saveError.message}`);
    } else {
      const normalized = normalizeFeeRow(data);
      setFees((current) => [
        normalized,
        ...current.filter((row) => String(row.id) !== String(normalized.id)),
      ]);
      setEditingId(null);
      setForm({
        student_id: "",
        term: "First Term",
        amount: "",
        paid: "0",
        due_date: "",
      });
    }
    setSaving(false);
  };
  const editFee = (fee) => {
    setEditingId(fee.id);
    setForm({
      student_id: String(fee.student_id || ""),
      term: fee.term || "First Term",
      amount: String(fee.amount ?? 0),
      paid: String(fee.paid ?? 0),
      due_date: fee.due_date || "",
    });
  };
  const totalCollected = fees.reduce(
    (sum, fee) => sum + Number(fee.paid || 0),
    0,
  );
  const totalOutstanding = fees.reduce(
    (sum, fee) =>
      sum + Math.max(Number(fee.amount || 0) - Number(fee.paid || 0), 0),
    0,
  );
  const studentsPaid = new Set(
    fees.filter((fee) => String(fee.status) === "paid").map((fee) => fee.student_id),
  ).size;
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Fees Management</div>
      </div>
      {hasFeesError && (
        <div className="alert alert-warning">
          Fees table is not accessible in Supabase yet. Totals below reflect
          only live rows currently available to the frontend.
        </div>
      )}
      {error && <div className="alert alert-warning">{error}</div>}
      <div className="card card-padded" style={{ marginBottom: 16 }}>
        <div className="page-title" style={{ fontSize: "1rem", marginBottom: 12 }}>
          {editingId ? "Update Fee Record" : "Add Fee Record"}
        </div>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Student</label>
            <select
              className="form-control"
              value={form.student_id}
              onChange={(event) => setForm((current) => ({ ...current, student_id: event.target.value }))}
            >
              <option value="">Select student</option>
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.full_name || student.name} ({student.index_number || student.index})
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Term</label>
            <input
              className="form-control"
              value={form.term}
              onChange={(event) => setForm((current) => ({ ...current, term: event.target.value }))}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Amount (GHS)</label>
            <input
              type="number"
              min="0"
              className="form-control"
              value={form.amount}
              onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Paid (GHS)</label>
            <input
              type="number"
              min="0"
              className="form-control"
              value={form.paid}
              onChange={(event) => setForm((current) => ({ ...current, paid: event.target.value }))}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Due Date</label>
            <input
              type="date"
              className="form-control"
              value={form.due_date}
              onChange={(event) => setForm((current) => ({ ...current, due_date: event.target.value }))}
            />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn btn-blue" onClick={saveFee} disabled={saving || hasFeesError}>
            {saving ? "Saving..." : editingId ? "Update Fee" : "Save Fee"}
          </button>
          {editingId && (
            <button
              className="btn btn-outline"
              onClick={() => {
                setEditingId(null);
                setForm({ student_id: "", term: "First Term", amount: "", paid: "0", due_date: "" });
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
      <div className="stats-grid stats-grid-3" style={{ marginBottom: 20 }}>
        {[
          {
            label: "Total Collected",
            value: `GHS ${totalCollected.toLocaleString()}`,
            color: "#dcfce7",
            c: "#16a34a",
          },
          {
            label: "Outstanding",
            value: `GHS ${totalOutstanding.toLocaleString()}`,
            color: "#fee2e2",
            c: "#dc2626",
          },
          {
            label: "Students Paid",
            value: String(studentsPaid),
            color: "#dbeafe",
            c: "#1e40af",
          },
        ].map((s) => (
          <div
            key={s.label}
            className="stat-card"
            style={{ background: s.color }}
          >
            <div className="stat-label" style={{ color: s.c }}>
              {s.label}
            </div>
            <div
              className="stat-value"
              style={{ color: s.c, fontSize: "1.4rem" }}
            >
              {s.value}
            </div>
          </div>
        ))}
      </div>
      <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Student ID</th>
                <th>Term</th>
                <th>Amount</th>
                <th>Paid</th>
                <th>Balance</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {fees.map((fee) => {
                const student = students.find(
                  (row) => String(row.id) === String(fee.student_id),
                );
                const bal = fee.amount - fee.paid;
                return (
                  <tr key={fee.id}>
                    <td>
                      <strong>{student?.full_name || student?.name || fee.index_number || "Student"}</strong>
                    </td>
                    <td>{fee.index_number || student?.index || student?.index_number || "-"}</td>
                    <td>{fee.term}</td>
                    <td>GHS {fee.amount}</td>
                    <td>GHS {fee.paid}</td>
                    <td
                      style={{
                        color: bal > 0 ? "#dc2626" : "#16a34a",
                        fontWeight: 700,
                      }}
                    >
                      GHS {bal}
                    </td>
                    <td>
                      <span
                        className={`badge ${fee.status === "paid" ? "badge-success" : fee.status === "partial" ? "badge-warning" : "badge-danger"}`}
                      >
                        {fee.status}
                      </span>
                    </td>
                    <td>
                      <button className="btn btn-sm btn-outline" onClick={() => editFee(fee)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!fees.length && (
                <tr>
                  <td
                    colSpan="8"
                    style={{
                      textAlign: "center",
                      padding: 24,
                      color: "#64748b",
                    }}
                  >
                    No fee records have been saved yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
      </div>
    </div>
  );
}

//   SCHOOLS
function SchoolsPage({ schoolsData }) {
  const isMobile = useIsMobileLayout();
  const schools = sortSchoolsByCategory(
    schoolsData?.length ? schoolsData : SCHOOLS_DATA,
  );
  const counts = schools.reduce(
    (acc, school) => {
      const key = String(school.category || "").toUpperCase();
      if (key === "A" || key === "B" || key === "C") acc[key] += 1;
      return acc;
    },
    { A: 0, B: 0, C: 0 },
  );
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Schools</div>
        <div className="page-sub">{`Secondary school database (${schools.length} schools: A ${counts.A}, B ${counts.B}, C ${counts.C})`}</div>
      </div>
      {isMobile ? (
        <div className="mobile-record-list">
          {schools.map((s) => (
            <div key={s.id} className="mobile-record-card">
              <div className="mobile-record-head">
                <div>
                  <div className="mobile-record-title">{s.name}</div>
                  <div className="mobile-record-sub">{s.region}</div>
                </div>
                <span
                  className={`badge ${s.category === "A" ? "badge-warning" : s.category === "B" ? "badge-blue" : "badge-success"}`}
                >
                  Cat {s.category}
                </span>
              </div>
              <div className="mobile-record-grid">
                <div className="mobile-record-item">
                  <label>Cutoff</label>
                  <strong>{s.cutoff}</strong>
                </div>
                <div className="mobile-record-item">
                  <label>Slots</label>
                  <strong>{s.slots}</strong>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>School</th>
                <th>Region</th>
                <th>Category</th>
                <th>Cutoff</th>
                <th>Slots</th>
              </tr>
            </thead>
            <tbody>
              {schools.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong>
                  </td>
                  <td>{s.region}</td>
                  <td>
                    <span
                      className={`badge ${s.category === "A" ? "badge-warning" : s.category === "B" ? "badge-blue" : "badge-success"}`}
                    >
                      Cat {s.category}
                    </span>
                  </td>
                  <td style={{ fontWeight: 700 }}>{s.cutoff}</td>
                  <td>{s.slots}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RegisteredSchoolsPage({
  schools,
  admins,
  onRegisterNew,
  onCreateSchoolAdmin,
  onUpdateSchool,
  setupError = "",
  currentUser = null,
}) {
  const { cfg: globalCfg } = useContext(SettingsContext);
  const isMobile = useIsMobileLayout();
  const [expandedSchoolId, setExpandedSchoolId] = useState(null);
  const [editingSchoolId, setEditingSchoolId] = useState(null);
  const [forms, setForms] = useState({});
  const [editForm, setEditForm] = useState({});
  const [savingSchoolId, setSavingSchoolId] = useState(null);
  const [pageError, setPageError] = useState("");
  const activeCount = schools.filter((school) => school.active).length;
  const totalAdmins = admins.length;
  const schoolAdminRoleOptions = getAssignableRoles(
    globalCfg,
    currentUser?.role || "admin",
    "school-admin",
  );
  const defaultSchoolAdminRole =
    schoolAdminRoleOptions.find((role) => role.key === "school_admin")?.key ||
    schoolAdminRoleOptions[0]?.key ||
    "school_admin";

  const setForm = (schoolId, key, value) => {
    setForms((current) => ({
      ...current,
      [schoolId]: {
        full_name: "",
        email: "",
        phone: "",
        password: "",
        role: defaultSchoolAdminRole,
        ...current[schoolId],
        [key]: value,
      },
    }));
  };

  const createAdmin = async (school) => {
    const form = forms[school.id] || {
      full_name: "",
      email: "",
      phone: "",
      password: "",
      role: defaultSchoolAdminRole,
    };
    if (!form.full_name.trim() || !form.email.trim() || !form.password.trim()) {
      setPageError(
        "Full name, email, and password are required to create a school admin.",
      );
      return;
    }

    setSavingSchoolId(school.id);
    setPageError("");
    try {
      await onCreateSchoolAdmin(school, form);
      setForms((current) => ({
        ...current,
        [school.id]: {
          full_name: "",
          email: "",
          phone: "",
          password: "",
          role: defaultSchoolAdminRole,
        },
      }));
      setExpandedSchoolId(null);
    } catch (err) {
      setPageError(
        String(err?.message || "Unable to create the school admin right now."),
      );
    } finally {
      setSavingSchoolId(null);
    }
  };

  const startEditSchool = (school) => {
    setEditForm({
      name: school.name || "",
      location: school.location || "",
      region: school.region || "Ashanti",
      type: school.type || "",
      category: school.category || "",
      active: !!school.active,
    });
    setEditingSchoolId(school.id);
    setExpandedSchoolId(null); // Close admin form if open
  };

  const cancelEditSchool = () => {
    setEditingSchoolId(null);
    setEditForm({});
  };

  const saveEditSchool = async (school) => {
    if (!editForm.name.trim()) {
      setPageError("School name is required.");
      return;
    }

    setSavingSchoolId(school.id);
    setPageError("");
    try {
      await onUpdateSchool(school.id, editForm);
      setEditingSchoolId(null);
      setEditForm({});
    } catch (err) {
      setPageError(
        String(err?.message || "Unable to update the school right now."),
      );
    } finally {
      setSavingSchoolId(null);
    }
  };

  const isSuperAdmin = currentUser?.role === "admin";

  return (
    <div className="fade-in">
      <div className="school-reg-shell">
        <div className="school-reg-hero">
          <div className="school-reg-hero-copy">
            <div className="school-reg-kicker">Super Admin Registry</div>
            <div className="school-reg-title">
              Registered schools and school admins
            </div>
            <div className="school-reg-sub">
              Manage registered schools separately from the admissions placement
              list, and assign a dedicated admin account to each school.
            </div>
          </div>
          <div className="school-reg-chip">
            <Ico name="schools" size={14} color="#99f6e4" /> {schools.length}{" "}
            registered schools
          </div>
        </div>

        <div className="school-reg-summary-grid">
          <div className="school-reg-summary-card">
            <div className="school-reg-summary-label">Registered Schools</div>
            <div className="school-reg-summary-value">{schools.length}</div>
            <div className="school-reg-summary-sub">
              Every school tenant currently onboarded to the platform.
            </div>
          </div>
          <div className="school-reg-summary-card">
            <div className="school-reg-summary-label">Active Schools</div>
            <div className="school-reg-summary-value">{activeCount}</div>
            <div className="school-reg-summary-sub">
              Schools available for active use and school-admin access.
            </div>
          </div>
          <div className="school-reg-summary-card">
            <div className="school-reg-summary-label">School Admins</div>
            <div className="school-reg-summary-value">{totalAdmins}</div>
            <div className="school-reg-summary-sub">
              Admin accounts assigned across all registered schools.
            </div>
          </div>
        </div>

        <div className="school-reg-toolbar">
          <div className="school-reg-toolbar-copy">
            <div className="school-reg-toolbar-title">Registry operations</div>
            <div className="school-reg-toolbar-sub">
              Review school onboarding status, assign school admins, and keep
              each school record organized from one place.
            </div>
          </div>
          <button className="btn btn-blue" onClick={onRegisterNew}>
            <Ico name="enroll" size={16} color="#fff" /> Register School
          </button>
        </div>

        {(setupError || pageError) && (
          <div className="alert alert-warning">{setupError || pageError}</div>
        )}

        {!schools.length ? (
          <div className="students-empty-state">
            No registered schools yet. Use Register School to create the first
            school tenant and assign its admin.
          </div>
        ) : (
          <div className="registered-school-list">
            {schools.map((school) => {
              const schoolAdmins = admins.filter(
                (admin) =>
                  String(admin.registered_school_id) === String(school.id),
              );
              const form = forms[school.id] || {
                full_name: "",
                email: "",
                phone: "",
                password: "",
                role: defaultSchoolAdminRole,
              };
              const open = expandedSchoolId === school.id;
              return (
                <div key={school.id} className="card registered-school-card">
                  <div className="registered-school-head">
                    <div className="registered-school-meta">
                      <div className="registered-school-title">
                        {school.name}
                      </div>
                      <div className="registered-school-sub">
                        {school.location ? `${school.location}, ` : ""}
                        {school.region}   {school.type || "Mixed"}
                      </div>
                    </div>
                    <div
                      className="registered-school-badges"
                      style={
                        isMobile ? { justifyContent: "flex-start" } : undefined
                      }
                    >
                      <span
                        className={`badge ${school.category === "A" ? "badge-warning" : school.category === "B" ? "badge-blue" : "badge-success"}`}
                      >
                        Grade {school.category}
                      </span>
                      <span
                        className={`badge ${school.active ? "badge-success" : "badge-gray"}`}
                      >
                        {school.active ? "Active" : "Inactive"}
                      </span>
                    </div>
                    {isSuperAdmin && (
                      <div className="registered-school-actions">
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() => startEditSchool(school)}
                          disabled={editingSchoolId === school.id}
                        >
                          <Ico name="edit" size={14} /> Edit
                        </button>
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() => {
                            if (confirm(`Are you sure you want to delete ${school.name}?`)) {
                              setSavingSchoolId(school.id);
                              setPageError("");
                              supabase.from('registered_schools').delete().eq('id', school.id).then(
                                ({error}) => {
                                  if(error) throw error;
                                  setPageError("");
                                }
                              ).catch(err => {
                                setPageError(String(err?.message || "Unable to delete school"));
                              }).finally(() => setSavingSchoolId(null));
                            }
                          }}
                          disabled={savingSchoolId === school.id}
                          style={{ color: "#dc2626" }}
                        >
                          <Ico name="delete" size={14} /> Delete
                        </button>
                      </div>
                    )}
                  </div>
                  {editingSchoolId === school.id && (
                    <div className="registered-school-edit-form card" style={{marginTop: 12, padding: 20, background: "#f8f9fa", border: "1px solid #e2e8f0"}}>
                      <div style={{marginBottom: 16}}>
                        <h4 style={{marginBottom: 4}}>Edit School</h4>
                        <p style={{fontSize: ".85rem", color: "#64748b"}}>Update school information below.</p>
                      </div>
                      <div className="form-grid">
                        <div className="form-group">
                          <label className="form-label">School Name</label>
                          <input
                            className="form-control"
                            value={editForm.name || ""}
                            onChange={(e) => setEditForm({...editForm, name: e.target.value})}
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label">Location</label>
                          <input
                            className="form-control"
                            value={editForm.location || ""}
                            onChange={(e) => setEditForm({...editForm, location: e.target.value})}
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label">Region</label>
                          <select
                            className="form-control"
                            value={editForm.region || ""}
                            onChange={(e) => setEditForm({...editForm, region: e.target.value})}
                          >
                            <option value="">Select Region</option>
                            {['Greater Accra','Ashanti','Western','Central','Eastern','Volta','Northern','Upper East','Upper West','Bono','Oti','Ahafo','Bono East','North East','Savannah','Western North'].map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                        </div>
                        <div className="form-group">
                          <label className="form-label">Category</label>
                          <select
                            className="form-control"
                            value={editForm.category || ""}
                            onChange={(e) => setEditForm({...editForm, category: e.target.value})}
                          >
                            <option value="">Select Category</option>
                            <option value="A">Grade A</option>
                            <option value="B">Grade B</option>
                            <option value="C">Grade C</option>
                          </select>
                        </div>
                        <div className="form-group">
                          <label className="form-label">Type</label>
                          <input
                            className="form-control"
                            value={editForm.type || ""}
                            onChange={(e) => setEditForm({...editForm, type: e.target.value})}
                            placeholder="e.g. JHS, SHS, Mixed"
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label">
                            <input
                              type="checkbox"
                              checked={editForm.active === true}
                              onChange={(e) => setEditForm({...editForm, active: e.target.checked})}
                              style={{marginRight: 8}}
                            />
                            Active
                          </label>
                        </div>
                      </div>
                      <div style={{display: "flex", gap: 12, marginTop: 16}}>
                        <button
                          className="btn btn-blue"
                          onClick={() => saveEditSchool(school)}
                          disabled={savingSchoolId === school.id}
                        >
                          {savingSchoolId === school.id ? "Saving..." : "Save Changes"}
                        </button>
                        <button
                          className="btn btn-outline"
                          onClick={cancelEditSchool}
                          disabled={savingSchoolId === school.id}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="registered-school-body">
                    <div className="registered-school-grid">
                      <div className="registered-school-stat">
                        <label>Grade</label>
                        <strong>{school.category || "-"}</strong>
                      </div>
                      <div className="registered-school-stat">
                        <label>School Type</label>
                        <strong>{school.type || "-"}</strong>
                      </div>
                      <div className="registered-school-stat">
                        <label>Admins</label>
                        <strong>{schoolAdmins.length}</strong>
                      </div>
                      <div className="registered-school-stat">
                        <label>Region</label>
                        <strong>{school.region || "-"}</strong>
                      </div>
                    </div>

                    <div className="school-admin-block">
                      <div className="school-admin-block-head">
                        <div>
                          <div
                            className="school-reg-section-title"
                            style={{ marginBottom: 0 }}
                          >
                            School Admins
                          </div>
                          <div className="school-admin-block-sub">
                            Access management for this school tenant and its
                            operational workspace.
                          </div>
                        </div>
                      </div>
                      <div className="school-admin-list">
                        {schoolAdmins.map((admin) => (
                          <div key={admin.id} className="school-admin-row">
                            <div className="school-admin-row-copy">
                              <strong>{admin.full_name}</strong>
                              <span>{admin.email}</span>
                              <span>{admin.phone || "No phone added"}</span>
                              <span>
                                {
                                  getRoleMeta(
                                    globalCfg,
                                    admin.role || defaultSchoolAdminRole,
                                  ).label
                                }
                              </span>
                            </div>
                            <span
                              className={`badge ${admin.status === "active" ? "badge-success" : "badge-gray"}`}
                            >
                              {admin.status || "active"}
                            </span>
                          </div>
                        ))}
                        {!schoolAdmins.length && (
                          <div
                            className="students-empty-state"
                            style={{ padding: 16 }}
                          >
                            No admin assigned yet for this school.
                          </div>
                        )}
                      </div>

                      {open ? (
                        <div className="school-admin-form">
                          <div className="school-admin-form-head">
                            <div>
                              <div className="school-admin-form-title">
                                Create school admin
                              </div>
                              <div className="school-admin-form-sub">
                                This admin can sign in with the credentials
                                created here.
                              </div>
                            </div>
                            <button
                              className="btn btn-outline btn-sm"
                              onClick={() => setExpandedSchoolId(null)}
                            >
                              Close
                            </button>
                          </div>
                          <div className="form-grid">
                            <div className="form-group">
                              <label className="form-label">Full Name</label>
                              <input
                                className="form-control"
                                value={form.full_name}
                                onChange={(e) =>
                                  setForm(
                                    school.id,
                                    "full_name",
                                    e.target.value,
                                  )
                                }
                              />
                            </div>
                            <div className="form-group">
                              <label className="form-label">Email</label>
                              <input
                                className="form-control"
                                type="email"
                                value={form.email}
                                onChange={(e) =>
                                  setForm(school.id, "email", e.target.value)
                                }
                              />
                            </div>
                            <div className="form-group">
                              <label className="form-label">Role</label>
                              <select
                                className="form-control"
                                value={form.role}
                                onChange={(e) =>
                                  setForm(school.id, "role", e.target.value)
                                }
                              >
                                {schoolAdminRoleOptions.map((role) => (
                                  <option key={role.key} value={role.key}>
                                    {role.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="form-group">
                              <label className="form-label">Phone</label>
                              <input
                                className="form-control"
                                value={form.phone}
                                onChange={(e) =>
                                  setForm(school.id, "phone", e.target.value)
                                }
                              />
                            </div>
                            <div className="form-group">
                              <label className="form-label">Password</label>
                              <input
                                className="form-control"
                                type="password"
                                value={form.password}
                                onChange={(e) =>
                                  setForm(school.id, "password", e.target.value)
                                }
                              />
                            </div>
                          </div>
                          <div className="school-reg-actions-row">
                            <button
                              className="btn btn-blue"
                              onClick={() => createAdmin(school)}
                              disabled={savingSchoolId === school.id}
                            >
                              {savingSchoolId === school.id
                                ? "Creating..."
                                : "Create Admin"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          className="btn btn-outline"
                          onClick={() => setExpandedSchoolId(school.id)}
                        >
                          Create School Admin
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const SchoolRegistrationPage = lazy(() => import("./src/components/SchoolRegistrationPage.jsx"));

function SchoolAdminDashboardPage({
  user,
  school,
  admins,
  pendingRows,
  confirmedRows,
  studentsData,
  teachersData,
  feesData,
  loading,
}) {
  const totalCollected = (feesData || []).reduce(
    (sum, fee) => sum + Number(fee.paid || 0),
    0,
  );
  const totalOutstanding = (feesData || []).reduce(
    (sum, fee) =>
      sum + Math.max(Number(fee.amount || 0) - Number(fee.paid || 0), 0),
    0,
  );
  const latestRows = [...confirmedRows, ...pendingRows]
    .sort(
      (left, right) =>
        new Date(right.reviewedAt || 0).getTime() -
        new Date(left.reviewedAt || 0).getTime(),
    )
    .slice(0, 6);

  return (
    <div className="fade-in">
      <div className="school-workspace-shell">
        <div className="school-workspace-hero">
          <div className="school-workspace-copy">
            <div className="school-workspace-kicker">School Workspace</div>
            <div className="school-workspace-title">
              {school?.name || user?.managed_school_name || "School Workspace"}
            </div>
            <DashboardDateTime />
            <div className="school-workspace-sub">
              A refined operations view for the school account, covering student
              records, finance activity, admin access, and recent school-facing
              candidate activity.
            </div>
          </div>
          <div className="school-workspace-meta">
            <div className="school-workspace-chip">
              <Ico name="schools" size={14} color="#99f6e4" />{" "}
              {school?.region || "Region pending"}
            </div>
            <div className="school-workspace-note">
              Use this workspace to monitor school operations and confirm admin
              assignments. Registry school profile changes are done by platform
              administrators.
            </div>
          </div>
        </div>

        {loading && (
          <div className="alert alert-info">Loading school workspace...</div>
        )}
        {!school && !loading && (
          <div className="alert alert-warning">
            This admin account is not yet linked to a registered school record.
          </div>
        )}

        <div className="school-workspace-summary">
          <div className="school-workspace-summary-card">
            <div className="school-workspace-summary-label">Managed School</div>
            <div className="school-workspace-summary-value">
              {school?.name || user?.managed_school_name || "Not linked"}
            </div>
            <div className="school-workspace-summary-sub">
              Primary school record attached to this admin account.
            </div>
          </div>
          <div className="school-workspace-summary-card">
            <div className="school-workspace-summary-label">Students</div>
            <div className="school-workspace-summary-value">
              {studentsData.length}
            </div>
            <div className="school-workspace-summary-sub">
              Student records currently linked to this school.
            </div>
          </div>
          <div className="school-workspace-summary-card">
            <div className="school-workspace-summary-label">Teachers</div>
            <div className="school-workspace-summary-value">
              {teachersData.length}
            </div>
            <div className="school-workspace-summary-sub">
              School staff records available inside this workspace.
            </div>
          </div>
          <div className="school-workspace-summary-card">
            <div className="school-workspace-summary-label">Fees Collected</div>
            <div className="school-workspace-summary-value">
              GHS {totalCollected.toLocaleString()}
            </div>
            <div className="school-workspace-summary-sub">
              Outstanding: GHS {totalOutstanding.toLocaleString()}
            </div>
          </div>
          <div className="school-workspace-summary-card">
            <div className="school-workspace-summary-label">School Admins</div>
            <div className="school-workspace-summary-value">
              {admins.length}
            </div>
            <div className="school-workspace-summary-sub">
              Admin accounts assigned to this school.
            </div>
          </div>
        </div>

        <div className="school-workspace-grid">
          <div className="school-workspace-panel">
            <div className="school-workspace-panel-head">
              <div>
                <div className="school-workspace-panel-title">
                  School profile
                </div>
                <div className="school-workspace-panel-sub">
                  High-level identity details used across the school-admin
                  workspace.
                </div>
              </div>
            </div>
            <div className="school-profile-list">
              <div className="school-profile-row">
                <span className="school-profile-label">Name</span>
                <span className="school-profile-value">
                  {school?.name || user?.managed_school_name || " "}
                </span>
              </div>
              <div className="school-profile-row">
                <span className="school-profile-label">Region</span>
                <span className="school-profile-value">
                  {school?.region || " "}
                </span>
              </div>
              <div className="school-profile-row">
                <span className="school-profile-label">Location</span>
                <span className="school-profile-value">
                  {school?.location || " "}
                </span>
              </div>
              <div className="school-profile-row">
                <span className="school-profile-label">Grade</span>
                <span className="school-profile-value">
                  {school?.category || " "}
                </span>
              </div>
              <div className="school-profile-row">
                <span className="school-profile-label">Type</span>
                <span className="school-profile-value">
                  {school?.type || " "}
                </span>
              </div>
              <div className="school-profile-row">
                <span className="school-profile-label">Status</span>
                <span className="school-profile-value">
                  {school?.active ? "Active" : "Inactive"}
                </span>
              </div>
            </div>
          </div>

          <div className="school-insight-stack">
            <div className="school-workspace-panel">
              <div className="school-workspace-panel-head">
                <div>
                  <div className="school-workspace-panel-title">
                    Assigned admins
                  </div>
                  <div className="school-workspace-panel-sub">
                    People who currently manage the school through the platform.
                  </div>
                </div>
              </div>
              <div className="school-admin-mini-list">
                {admins.map((admin) => (
                  <div key={admin.id} className="school-admin-mini-row">
                    <div className="school-admin-mini-copy">
                      <strong>{admin.full_name}</strong>
                      <span>{admin.email}</span>
                    </div>
                    <span
                      className={`badge ${admin.status === "active" ? "badge-success" : "badge-gray"}`}
                    >
                      {admin.status || "active"}
                    </span>
                  </div>
                ))}
                {!admins.length && (
                  <div className="school-activity-empty">
                    No additional school admins have been assigned yet.
                  </div>
                )}
              </div>
            </div>

            <div className="school-workspace-panel">
              <div className="school-workspace-panel-head">
                <div>
                  <div className="school-workspace-panel-title">
                    Recent candidate activity
                  </div>
                  <div className="school-workspace-panel-sub">
                    Selections and placement activity where this school appears
                    in scope.
                  </div>
                </div>
              </div>
              {latestRows.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Student</th>
                        <th>1st Choice</th>
                        <th>2nd Choice</th>
                        <th>Status</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latestRows.map((row) => (
                        <tr key={row.id}>
                          <td>
                            <strong>{row.studentName}</strong>
                          </td>
                          <td>{row.first}</td>
                          <td>{row.second}</td>
                          <td>
                            <span
                              className={`badge ${row.status === "confirmed" ? "badge-success" : "badge-blue"}`}
                            >
                              {row.status}
                            </span>
                          </td>
                          <td>
                            {row.reviewedAt
                              ? new Date(row.reviewedAt).toLocaleDateString()
                              : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="school-activity-empty">
                  No selection activity mentioning this school yet.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ManagedSchoolPage({
  school,
  admins,
  user,
  onSaveProfile,
  allowProfileEdit = true,
}) {
  const [form, setForm] = useState({
    name: "",
    location: "",
    region: "",
    type: "",
    category: "",
  });
  const [saving, setSaving] = useState(false);
  const [statusModal, setStatusModal] = useState({
    open: false,
    type: "success",
    title: "",
    message: "",
  });

  useEffect(() => {
    setForm({
      name: school?.name || user?.managed_school_name || "",
      location: school?.location || "",
      region: school?.region || "Ashanti",
      type: school?.type || "",
      category: school?.category || "",
    });
  }, [school, user]);

  const set = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));

  const saveProfile = async () => {
    if (!allowProfileEdit) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Not allowed",
        message:
          "School registry profile can only be changed by platform administrators.",
      });
      return;
    }
    if (!form.name.trim()) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Save Failed",
        message: "School name is required.",
      });
      return;
    }
    setSaving(true);
    try {
      await onSaveProfile?.({
        name: form.name.trim(),
        location: form.location.trim(),
        region: form.region,
        type: form.type,
        category: form.category,
      });
      setStatusModal({
        open: true,
        type: "success",
        title: "School Updated",
        message: "School profile settings were saved.",
      });
    } catch (error) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Save Failed",
        message: error?.message || "Could not save school profile settings.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fade-in">
      <ActionStatusModal
        state={statusModal}
        onClose={() =>
          setStatusModal((current) => ({ ...current, open: false }))
        }
      />
      <div className="school-settings-shell">
        <div className="school-workspace-hero">
          <div className="school-workspace-copy">
            <div className="school-workspace-kicker">Managed School</div>
            <div className="school-workspace-title">
              School profile and access
            </div>
            <div className="school-workspace-sub">
              {allowProfileEdit
                ? "Review the official school record, update profile details, and confirm which administrators currently manage the school."
                : "Review the official school record and which administrators currently manage the school. Profile changes are managed by platform administrators."}
            </div>
          </div>
          <div className="school-workspace-meta">
            <div className="school-workspace-chip">
              <Ico name="profile" size={14} color="#99f6e4" /> Admin settings
            </div>
            <div className="school-workspace-note">
              {allowProfileEdit
                ? "Changes made here affect how the school appears across its workspace and onboarding registry."
                : "Registry details are read-only in this portal. Contact a super admin to update the school record."}
            </div>
          </div>
        </div>

        <div className="school-settings-grid">
          <div className="school-settings-card">
            <div className="school-settings-head">
              <div>
                <div className="school-settings-title">Registry details</div>
                <div className="school-settings-sub">
                  The current school identity record as stored in the platform
                  registry.
                </div>
              </div>
            </div>
            <div className="school-settings-card-body">
              <div className="school-profile-list">
                <div className="school-profile-row">
                  <span className="school-profile-label">School Name</span>
                  <span className="school-profile-value">
                    {school?.name || user?.managed_school_name || " "}
                  </span>
                </div>
                <div className="school-profile-row">
                  <span className="school-profile-label">Region</span>
                  <span className="school-profile-value">
                    {school?.region || " "}
                  </span>
                </div>
                <div className="school-profile-row">
                  <span className="school-profile-label">Location</span>
                  <span className="school-profile-value">
                    {school?.location || " "}
                  </span>
                </div>
                <div className="school-profile-row">
                  <span className="school-profile-label">Grade</span>
                  <span className="school-profile-value">
                    {school?.category || " "}
                  </span>
                </div>
                <div className="school-profile-row">
                  <span className="school-profile-label">Type</span>
                  <span className="school-profile-value">
                    {school?.type || " "}
                  </span>
                </div>
                <div className="school-profile-row">
                  <span className="school-profile-label">Status</span>
                  <span className="school-profile-value">
                    {school?.active ? "Active" : "Inactive"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {allowProfileEdit ? (
            <div className="school-settings-card">
              <div className="school-settings-head">
                <div>
                  <div className="school-settings-title">Edit profile</div>
                  <div className="school-settings-sub">
                    Update the school profile details used throughout the
                    school-admin portal.
                  </div>
                </div>
              </div>
              <div className="school-settings-card-body">
                <div className="school-settings-form-grid">
                  <div className="form-grid">
                    <div className="form-group">
                      <label className="form-label">School Name</label>
                      <input
                        className="form-control"
                        value={form.name}
                        onChange={(e) => set("name", e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Location</label>
                      <input
                        className="form-control"
                        value={form.location}
                        onChange={(e) => set("location", e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Region</label>
                      <select
                        className="form-control"
                        value={form.region}
                        onChange={(e) => set("region", e.target.value)}
                      >
                        {GHANA_REGIONS.map((region) => (
                          <option key={region}>{region}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">School Type</label>
                      <select
                        className="form-control"
                        value={form.type}
                        onChange={(e) => set("type", e.target.value)}
                      >
                        <option value="">Select school type</option>
                        <option>Mixed</option>
                        <option>Boys</option>
                        <option>Girls</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Grade</label>
                      <select
                        className="form-control"
                        value={form.category}
                        onChange={(e) => set("category", e.target.value)}
                      >
                        <option value="">Select grade</option>
                        <option>A</option>
                        <option>B</option>
                        <option>C</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div className="school-settings-card-actions">
                  <button
                    type="button"
                    className="btn btn-blue"
                    onClick={saveProfile}
                    disabled={saving}
                  >
                    {saving ? "Saving..." : "Save Profile"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="school-settings-card">
              <div className="school-settings-head">
                <div>
                  <div className="school-settings-title">School profile</div>
                  <div className="school-settings-sub">
                    School name, location, and registry fields are maintained by
                    platform administrators.
                  </div>
                </div>
              </div>
              <div className="school-settings-card-body">
                <div className="alert alert-info school-settings-readonly-note">
                  You can review registry details in the first column. To
                  request a correction, contact your super admin or support
                  team.
                </div>
              </div>
            </div>
          )}

          <div className="school-settings-card">
            <div className="school-settings-head">
              <div>
                <div className="school-settings-title">Admin accounts</div>
                <div className="school-settings-sub">
                  People currently responsible for managing this school on the
                  platform.
                </div>
              </div>
            </div>
            <div className="school-settings-card-body">
              <div className="school-admin-mini-list">
                {admins.map((admin) => (
                  <div key={admin.id} className="school-admin-mini-row">
                    <div className="school-admin-mini-copy">
                      <strong>{admin.full_name}</strong>
                      <span>{admin.email}</span>
                      <span>{admin.phone || "No phone added"}</span>
                    </div>
                    <span
                      className={`badge ${admin.status === "active" ? "badge-success" : "badge-gray"}`}
                    >
                      {admin.status || "active"}
                    </span>
                  </div>
                ))}
                {!admins.length && (
                  <div className="school-activity-empty">
                    No school-admin records found for this school yet.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

//   PENDING SELECTIONS
function PendingSelections({
  rows,
  loading,
  onApprove,
  readOnly = false,
  pageTitle = "Pending Selections",
  pageSub = "Review and approve student school selections",
  emptyMessage = "There are currently no pending selections requiring review.",
}) {
  const isMobile = useIsMobileLayout();
  const displayRows = sortRecordsByStudentIndex(rows || []);

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">{pageTitle}</div>
        <div className="page-sub">{pageSub}</div>
      </div>
      {loading && (
        <div className="alert alert-info">Loading pending selections...</div>
      )}
      {isMobile ? (
        <div className="mobile-record-list">
          {displayRows.map((s) => {
            const picks = normalizeSelectionList(s.rawRow || s);
            return (
              <div key={s.id} className="mobile-record-card">
                <div className="mobile-record-head">
                  <div>
                    <div className="mobile-record-title">
                      {String(s.user_email).split("@")[0].replace(/\./g, " ")}
                    </div>
                    <div className="mobile-record-sub">{s.user_email}</div>
                    <div className="mobile-record-sub">
                      Diag: {s.match_source || "unknown"} | picks:{" "}
                      {Number(s.selection_count || 0)} | parse:{" "}
                      {s.parse_status || "unknown"}
                    </div>
                  </div>
                  <strong style={{ color: "#0f172a" }}>{s.aggregate}</strong>
                </div>
                <div className="mobile-record-grid">
                  {picks.length > 0 ? (
                    picks.map((pick, idx) => (
                      <div className="mobile-record-item" key={pick.id || idx}>
                        <label>
                          {pick.rank
                            ? `${pick.rank}${pick.rank === 1 ? "st" : pick.rank === 2 ? "nd" : pick.rank === 3 ? "rd" : "th"} Choice`
                            : `Choice`}
                        </label>
                        <span>{pick.name}</span>
                      </div>
                    ))
                  ) : (
                    <div className="mobile-record-item">
                      <span>No selections</span>
                    </div>
                  )}
                </div>
                <div className="mobile-record-actions">
                  {s.approved ? (
                    <span className="badge badge-success">Approved</span>
                  ) : readOnly ? (
                    <span className="badge badge-blue">Review only</span>
                  ) : (
                    <button
                      className="btn btn-sm btn-green"
                      onClick={() => onApprove?.(s.id)}
                    >
                      Approve
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {!displayRows.length && !loading && (
            <div
              className="mobile-record-card"
              style={{ textAlign: "center", color: "#64748b" }}
            >
              {emptyMessage}
            </div>
          )}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Selected Schools</th>
                <th>Aggregate</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((s) => {
                const picks = normalizeSelectionList(s.rawRow || s);
                return (
                  <tr key={s.id}>
                    <td>
                      <strong>
                        {String(s.user_email).split("@")[0].replace(/\./g, " ")}
                      </strong>
                      <br />
                      <span style={{ fontSize: ".75rem", color: "#94a3b8" }}>
                        {s.user_email}
                      </span>
                      <br />
                      <span style={{ fontSize: ".72rem", color: "#64748b" }}>
                        Diag: {s.match_source || "unknown"} | picks:{" "}
                        {Number(s.selection_count || 0)} | parse:{" "}
                        {s.parse_status || "unknown"}
                      </span>
                    </td>
                    <td>
                      {picks.length > 0 ? (
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "6px",
                          }}
                        >
                          {picks.map((pick, idx) => (
                            <span
                              key={pick.id || idx}
                              style={{
                                display: "inline-block",
                                background: "#e0e7ff",
                                color: "#3730a3",
                                borderRadius: "8px",
                                padding: "3px 10px",
                                fontWeight: 600,
                                fontSize: ".88em",
                                border: "1px solid #c7d2fe",
                                letterSpacing: ".01em",
                              }}
                            >
                              {pick.rank
                                ? `${pick.rank}${pick.rank === 1 ? "st" : pick.rank === 2 ? "nd" : pick.rank === 3 ? "rd" : "th"}: `
                                : ""}
                              {pick.name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span>No selections</span>
                      )}
                    </td>
                    <td style={{ fontWeight: 700 }}>{s.aggregate}</td>
                    <td>
                      {s.approved ? (
                        <span className="badge badge-success">Approved</span>
                      ) : readOnly ? (
                        <span className="badge badge-blue">Review only</span>
                      ) : (
                        <button
                          className="btn btn-sm btn-green"
                          onClick={() => onApprove?.(s.id)}
                        >
                          Approve
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!displayRows.length && !loading && (
                <tr>
                  <td
                    colSpan="4"
                    style={{
                      textAlign: "center",
                      padding: 24,
                      color: "#64748b",
                    }}
                  >
                    {emptyMessage}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

//   CONFIRMED PLACEMENTS
function ConfirmedPlacements({ rows, loading }) {
  const isMobile = useIsMobileLayout();
  const confirmedRows = rows || [];
  const displayRows = sortRecordsByStudentIndex(confirmedRows);
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Confirmed Mock Placements</div>
      </div>
      {loading && (
        <div className="alert alert-info">
          Loading confirmed mock placements...
        </div>
      )}
      {isMobile ? (
        <div className="mobile-record-list">
          {displayRows.map((s) => (
            <div key={s.id} className="mobile-record-card">
              <div className="mobile-record-head">
                <div>
                  <div className="mobile-record-title">{s.studentName}</div>
                  <div className="mobile-record-sub">
                    Placed at {s.placedAt}
                  </div>
                  <div className="mobile-record-sub">
                    Diag: {s.match_source || "unknown"} | picks:{" "}
                    {Number(s.selection_count || 0)} | parse:{" "}
                    {s.parse_status || "unknown"}
                  </div>
                </div>
                <span
                  className={`badge ${s.category === "A" ? "badge-warning" : s.category === "B" ? "badge-blue" : "badge-success"}`}
                >
                  Cat {s.category}
                </span>
              </div>
              <div className="mobile-record-grid">
                <div className="mobile-record-item">
                  <label>Aggregate</label>
                  <strong>{s.aggregate}</strong>
                </div>
                <div className="mobile-record-item">
                  <label>Date</label>
                  <span>
                    {s.reviewedAt
                      ? new Date(s.reviewedAt).toLocaleDateString()
                      : "-"}
                  </span>
                </div>
              </div>
            </div>
          ))}
          {!displayRows.length && !loading && (
            <div
              className="mobile-record-card"
              style={{ textAlign: "center", color: "#64748b" }}
            >
              No confirmed selections found in Supabase.
            </div>
          )}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Placed At</th>
                <th>Category</th>
                <th>Aggregate</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((s) => {
                return (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.studentName}</strong>
                      <br />
                      <span style={{ fontSize: ".72rem", color: "#64748b" }}>
                        Diag: {s.match_source || "unknown"} | picks:{" "}
                        {Number(s.selection_count || 0)} | parse:{" "}
                        {s.parse_status || "unknown"}
                      </span>
                    </td>
                    <td>{s.placedAt}</td>
                    <td>
                      <span
                        className={`badge ${s.category === "A" ? "badge-warning" : s.category === "B" ? "badge-blue" : "badge-success"}`}
                      >
                        Cat {s.category}
                      </span>
                    </td>
                    <td style={{ fontWeight: 700 }}>{s.aggregate}</td>
                    <td>
                      {s.reviewedAt
                        ? new Date(s.reviewedAt).toLocaleDateString()
                        : "-"}
                    </td>
                  </tr>
                );
              })}
              {!displayRows.length && !loading && (
                <tr>
                  <td
                    colSpan="5"
                    style={{
                      textAlign: "center",
                      padding: 24,
                      color: "#64748b",
                    }}
                  >
                    No confirmed selections found in Supabase.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

//   RESULTS SUMMARY
function ResultsPage({ studentsData, tableInfo }) {
  const isMobile = useIsMobileLayout();
  const rankedStudents = [...(studentsData || [])]
    .filter((student) => student && student.full_name)
    .sort(
      (left, right) =>
        Number(left.aggregate ?? 999) - Number(right.aggregate ?? 999),
    );
  const studentsMap = new Map();
  rankedStudents.forEach((student) => {
    studentsMap.set(String(student.id), student);
    studentsMap.set(String(student.index), student);
  });
  const resultRows = Array.isArray(tableInfo?.rows)
    ? tableInfo.rows
        .map((row, index) => normalizeResultRow(row, studentsMap, index))
        .sort((left, right) => left.rank - right.rank)
    : [];
  const displayRows = resultRows.length
    ? resultRows
    : rankedStudents.map((student, i) => {
        const aggregate = Number(student.aggregate ?? 0);
        const averageScore = Math.max(0, 100 - aggregate * 5);
        const grade = getGrade(averageScore);
        return {
          id: student.id,
          rank: i + 1,
          studentName: student.full_name,
          averageScore,
          aggregate,
          grade: grade.grade,
          gradeColor: grade.color,
          gradeBg: grade.bg,
        };
      });
  const donutSegments = Array.from({ length: 9 }, (_, index) =>
    String(index + 1),
  );
  const gradePalette = Object.fromEntries(
    donutSegments.map((grade) => [
      grade,
      getGrade([95, 82, 77, 72, 67, 62, 57, 52, 25][Number(grade) - 1])
        .color,
    ]),
  );
  const gradeCounts = displayRows.reduce(
    (acc, row) => {
      const key = getGrade(Number(row.averageScore || 0)).grade;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    },
    Object.fromEntries(donutSegments.map((grade) => [grade, 0])),
  );
  const totalCount = Math.max(displayRows.length, 1);
  const passCount = displayRows.filter(
    (row) => Number(row.averageScore || 0) >= 50,
  ).length;
  const avgScore = displayRows.length
    ? Math.round(
        displayRows.reduce(
          (sum, row) => sum + Number(row.averageScore || 0),
          0,
        ) / displayRows.length,
      )
    : 0;
  const passRate = Math.round((passCount / totalCount) * 100);
  const topRows = [...displayRows].slice(0, 6);
  const topScore = Math.max(
    ...displayRows.map((row) => Number(row.averageScore || 0)),
    1,
  );
  const trendRows = [...displayRows].slice(0, 8);
  const chartW = 380;
  const chartH = 170;
  const points = trendRows
    .map((row, idx) => {
      const x =
        trendRows.length > 1
          ? (idx * (chartW - 30)) / (trendRows.length - 1) + 15
          : chartW / 2;
      const y =
        chartH -
        ((Math.max(0, Math.min(100, Number(row.averageScore || 0))) / 100) *
          120 +
          20);
      return `${x},${y}`;
    })
    .join(" ");
  const areaPoints = points
    ? `${points} ${chartW - 15},${chartH - 10} 15,${chartH - 10}`
    : "";
  let progress = 0;
  const donutStops = donutSegments
    .map((grade) => {
      const portion = (gradeCounts[grade] || 0) / totalCount;
      const start = Math.round(progress * 360);
      progress += portion;
      const end = Math.round(progress * 360);
      return `${gradePalette[grade]} ${start}deg ${end}deg`;
    })
    .join(", ");
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Results Summary</div>
      </div>
      <div className="stats-grid stats-grid-4-compact">
        <div className="stat-card" style={{ background: "#eef2ff" }}>
          <div className="stat-label" style={{ color: "#1e3a8a" }}>
            Total Students
          </div>
          <div className="stat-value" style={{ color: "#1e3a8a" }}>
            {displayRows.length}
          </div>
          <div className="stat-sub" style={{ color: "#1e3a8a" }}>
            Result rows in current view
          </div>
        </div>
        <div className="stat-card" style={{ background: "#dcfce7" }}>
          <div className="stat-label" style={{ color: "#166534" }}>
            Average Score
          </div>
          <div className="stat-value" style={{ color: "#166534" }}>
            {displayRows.length ? `${avgScore}%` : "N/A"}
          </div>
          <div className="stat-sub" style={{ color: "#166534" }}>
            Across ranked students
          </div>
        </div>
        <div className="stat-card" style={{ background: "#fef3c7" }}>
          <div className="stat-label" style={{ color: "#92400e" }}>
            Pass Rate
          </div>
          <div className="stat-value" style={{ color: "#92400e" }}>
            {displayRows.length ? `${passRate}%` : "N/A"}
          </div>
          <div className="stat-sub" style={{ color: "#92400e" }}>
            {passCount}/{displayRows.length} at 50% and above
          </div>
        </div>
        <div className="stat-card" style={{ background: "#dbeafe" }}>
          <div className="stat-label" style={{ color: "#1e40af" }}>
            Top Performer
          </div>
          <div
            className="stat-value"
            style={{ color: "#1e40af", fontSize: "1.15rem" }}
          >
            {displayRows[0]?.studentName || "N/A"}
          </div>
          <div className="stat-sub" style={{ color: "#1e40af" }}>
            {displayRows[0]
              ? `${displayRows[0].averageScore}%`
              : "No score data"}
          </div>
        </div>
      </div>
      <div className="results-visual-grid">
        <div className="results-panel">
          <h3>Grade Distribution</h3>
          <div
            className="results-donut"
            style={{
              background: `conic-gradient(${donutStops || "#e2e8f0 0deg 360deg"})`,
            }}
          >
            <div className="results-donut-center">
              <strong>{displayRows.length}</strong>
              <span>Students</span>
            </div>
          </div>
          <div className="results-legend">
            {donutSegments.map((grade) => (
              <div key={grade} className="results-legend-item">
                <span style={{ display: "inline-flex", alignItems: "center" }}>
                  <span
                    className="results-dot"
                    style={{ background: gradePalette[grade] }}
                  />
                  Grade {grade}
                </span>
                <b>{gradeCounts[grade] || 0}</b>
              </div>
            ))}
          </div>
        </div>
        <div className="results-panel">
          <h3>Top Performers</h3>
          <div className="results-bars">
            {topRows.map((row) => (
              <div
                key={`bar-${row.id}-${row.rank}`}
                className="results-bar-row"
              >
                <span>#{row.rank}</span>
                <div className="results-bar-track">
                  <div
                    className="results-bar-fill"
                    style={{
                      width: `${Math.round((Number(row.averageScore || 0) / topScore) * 100)}%`,
                      background:
                        row.averageScore >= 75
                          ? "#16a34a"
                          : row.averageScore >= 60
                            ? "#d97706"
                            : "#dc2626",
                    }}
                  />
                </div>
                <strong>{row.averageScore}%</strong>
              </div>
            ))}
            {!topRows.length && (
              <div style={{ color: "#64748b", fontSize: ".82rem" }}>
                No ranked data to display.
              </div>
            )}
          </div>
        </div>
        <div className="results-panel">
          <h3>Performance Trend</h3>
          {trendRows.length ? (
            <>
              <svg
                className="results-line-chart"
                viewBox={`0 0 ${chartW} ${chartH}`}
                preserveAspectRatio="none"
              >
                <defs>
                  <linearGradient
                    id="resultsLineFill"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.45" />
                    <stop
                      offset="100%"
                      stopColor="#60a5fa"
                      stopOpacity="0.04"
                    />
                  </linearGradient>
                </defs>
                <line
                  x1="15"
                  y1={chartH - 10}
                  x2={chartW - 15}
                  y2={chartH - 10}
                  stroke="#cbd5e1"
                  strokeWidth="1"
                />
                <line
                  x1="15"
                  y1="20"
                  x2="15"
                  y2={chartH - 10}
                  stroke="#cbd5e1"
                  strokeWidth="1"
                />
                <polygon className="area" points={areaPoints} />
                <polyline points={points} />
                {trendRows.map((row, idx) => {
                  const x =
                    trendRows.length > 1
                      ? (idx * (chartW - 30)) / (trendRows.length - 1) + 15
                      : chartW / 2;
                  const y =
                    chartH -
                    ((Math.max(
                      0,
                      Math.min(100, Number(row.averageScore || 0)),
                    ) /
                      100) *
                      120 +
                      20);
                  return (
                    <circle
                      key={`point-${row.id}-${idx}`}
                      className="point"
                      cx={x}
                      cy={y}
                      r="4"
                    />
                  );
                })}
              </svg>
              <div className="results-axis-labels">
                <span>Highest Rank</span>
                <span>Lower Rank</span>
              </div>
            </>
          ) : (
            <div style={{ color: "#64748b", fontSize: ".82rem" }}>
              No trend data available.
            </div>
          )}
        </div>
      </div>
      {isMobile ? (
        <div className="mobile-record-list">
          {displayRows.map((row) => (
            <div key={row.id} className="mobile-record-card">
              <div className="mobile-record-head">
                <div>
                  <div className="mobile-record-title">
                    #{row.rank} {row.studentName}
                  </div>
                  <div className="mobile-record-sub">
                    Average score {row.averageScore}%
                  </div>
                </div>
                <span
                  className="grade-chip"
                  style={{ background: row.gradeBg, color: row.gradeColor }}
                >
                  {row.grade}
                </span>
              </div>
              <div className="mobile-record-grid">
                <div className="mobile-record-item">
                  <label>Aggregate</label>
                  <strong>{row.aggregate}</strong>
                </div>
                <div className="mobile-record-item">
                  <label>Score</label>
                  <strong>{row.averageScore}%</strong>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Student</th>
                <th>Avg Score</th>
                <th>Aggregate</th>
                <th>Grade</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((student, i) => {
                const grade = getGrade(student.averageScore);
                return (
                  <tr key={`result-${student.id}`}>
                    <td>
                      <strong
                        style={{
                          color:
                            i === 0
                              ? "#d97706"
                              : i === 1
                                ? "#94a3b8"
                                : i === 2
                                  ? "#a37043"
                                  : "#0f172a",
                        }}
                      >
                        #{student.rank}
                      </strong>
                    </td>
                    <td>
                      <strong>{student.studentName}</strong>
                    </td>
                    <td style={{ fontWeight: 700 }}>{student.averageScore}%</td>
                    <td>{student.aggregate}</td>
                    <td>
                      <span
                        className="grade-chip"
                        style={{
                          background: student.gradeBg || grade.bg,
                          color: student.gradeColor || grade.color,
                        }}
                      >
                        {student.grade || grade.grade}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {!rankedStudents.length && (
                <tr>
                  <td
                    colSpan="5"
                    style={{
                      textAlign: "center",
                      padding: 24,
                      color: "#64748b",
                    }}
                  >
                    No student aggregates available.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

//   LIVE TESTS
function LiveTestsPage({ currentUser }) {
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTest, setEditingTest] = useState(null);
  const [testForm, setTestForm] = useState({
    title: '',
    description: '',
    subject: '',
    class: '',
    test_type: 'mixed',
    duration_minutes: 30
  });

  useEffect(() => {
    loadTests();
  }, []);

  const loadTests = async () => {
    if (!supabase) {
      setTests([]);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('live_tests')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTests(data || []);
    } catch (error) {
      console.error('Error loading tests:', error);
      setTests([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTest = async () => {
    if (!supabase || !testForm.title.trim()) return;

    try {
      const { data, error } = await supabase
        .from('live_tests')
        .insert([{
          ...testForm,
          created_by: currentUser?.id
        }])
        .select()
        .single();

      if (error) throw error;

      setTests([data, ...tests]);
      setShowCreateModal(false);
      setTestForm({
        title: '',
        description: '',
        subject: '',
        class: '',
        test_type: 'mixed',
        duration_minutes: 30
      });
    } catch (error) {
      console.error('Error creating test:', error);
      const errorMessage = error?.message || error?.error_description || 'Unknown error';
      alert(`Failed to create test:\n${errorMessage}`);
    }
  };

  const handleToggleTest = async (testId, isActive) => {
    if (!supabase) return;

    try {
      const updateData = {
        is_active: isActive,
        start_time: isActive ? new Date().toISOString() : null,
        end_time: isActive ? null : new Date().toISOString()
      };

      const { error } = await supabase
        .from('live_tests')
        .update(updateData)
        .eq('id', testId);

      if (error) throw error;

      setTests(tests.map(test =>
        test.id === testId
          ? { ...test, ...updateData }
          : test
      ));
    } catch (error) {
      console.error('Error toggling test:', error);
      alert('Failed to update test status. Please try again.');
    }
  };

  const handleDeleteTest = async (testId) => {
    if (!supabase || !confirm('Are you sure you want to delete this test? This action cannot be undone.')) return;

    try {
      const { error } = await supabase
        .from('live_tests')
        .delete()
        .eq('id', testId);

      if (error) throw error;

      setTests(tests.filter(test => test.id !== testId));
    } catch (error) {
      console.error('Error deleting test:', error);
      alert('Failed to delete test. Please try again.');
    }
  };

  const formatDuration = (minutes) => {
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  const getTestStatus = (test) => {
    if (test.is_active) return { text: 'Active', color: '#16a34a' };
    if (test.end_time) return { text: 'Completed', color: '#6b7280' };
    return { text: 'Draft', color: '#f59e0b' };
  };

  if (loading) {
    return (
      <div className="fade-in">
        <div className="page-header">
          <div className="page-title">Live Tests</div>
        </div>
        <div className="loading-spinner">Loading tests...</div>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Live Tests</div>
        <button
          className="btn-primary"
          onClick={() => setShowCreateModal(true)}
          style={{ backgroundColor: '#7c3aed' }}
        >
          <Ico name="plus" size={18} color="#fff" />
          Create Test
        </button>
      </div>

      {!supabase && (
        <div className="alert alert-warning">
          Supabase is not configured. Live tests require database connectivity.
        </div>
      )}

      <div className="tests-grid">
        {tests.length === 0 ? (
          <div className="empty-state">
            <Ico name="quiz" size={48} color="#9ca3af" />
            <div className="empty-title">No tests created yet</div>
            <div className="empty-subtitle">Create your first live test to get started</div>
          </div>
        ) : (
          tests.map(test => {
            const status = getTestStatus(test);
            return (
              <div key={test.id} className="test-card">
                <div className="test-header">
                  <div className="test-title">{test.title}</div>
                  <div className="test-status" style={{ color: status.color }}>
                    {status.text}
                  </div>
                </div>

                <div className="test-meta">
                  {test.subject && <span className="test-subject">{test.subject}</span>}
                  {test.class && <span className="test-class">{test.class}</span>}
                  <span className="test-type">{test.test_type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
                  <span className="test-duration">{formatDuration(test.duration_minutes)}</span>
                  <span className="test-questions">{test.total_questions} questions</span>
                </div>

                {test.description && (
                  <div className="test-description">{test.description}</div>
                )}

                <div className="test-actions">
                  <button
                    className="btn-secondary"
                    onClick={() => setEditingTest(test)}
                  >
                    <Ico name="edit" size={16} color="#374151" />
                    Edit Questions
                  </button>

                  <button
                    className={`btn-${test.is_active ? 'danger' : 'success'}`}
                    onClick={() => handleToggleTest(test.id, !test.is_active)}
                  >
                    <Ico name={test.is_active ? 'stop' : 'play'} size={16} color="#fff" />
                    {test.is_active ? 'Stop Test' : 'Start Test'}
                  </button>

                  <button
                    className="btn-danger"
                    onClick={() => handleDeleteTest(test.id)}
                  >
                    <Ico name="trash" size={16} color="#fff" />
                    Delete
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Create Test Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create New Test</h3>
              <button
                className="modal-close"
                onClick={() => setShowCreateModal(false)}
              >
                <Ico name="close" size={20} color="#6b7280" />
              </button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label>Test Title *</label>
                <input
                  type="text"
                  className="form-input"
                  value={testForm.title}
                  onChange={e => setTestForm({...testForm, title: e.target.value})}
                  placeholder="Enter test title"
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  className="form-input"
                  value={testForm.description}
                  onChange={e => setTestForm({...testForm, description: e.target.value})}
                  placeholder="Enter test description (optional)"
                  rows={3}
                />
              </div>

              <div className="form-group">
                <label>Test Type</label>
                <select
                  className="form-input"
                  value={testForm.test_type}
                  onChange={e => setTestForm({...testForm, test_type: e.target.value})}
                >
                  <option value="mixed">Mixed Question Types</option>
                  <option value="multiple_choice">Multiple Choice Only</option>
                  <option value="true_false">True/False Only</option>
                  <option value="short_answer">Short Answer Only</option>
                  <option value="fill_in">Fill in the Blank Only</option>
                  <option value="long_text">Long Text/Essay Only</option>
                </select>
                <small style={{ color: '#6b7280', fontSize: '0.8rem' }}>
                  Select the primary question type(s) for this test
                </small>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Subject</label>
                  <input
                    type="text"
                    className="form-input"
                    value={testForm.subject}
                    onChange={e => setTestForm({...testForm, subject: e.target.value})}
                    placeholder="e.g., Mathematics"
                  />
                </div>

                <div className="form-group">
                  <label>Class</label>
                  <input
                    type="text"
                    className="form-input"
                    value={testForm.class}
                    onChange={e => setTestForm({...testForm, class: e.target.value})}
                    placeholder="e.g., JHS 3"
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Duration (minutes)</label>
                <input
                  type="number"
                  className="form-input"
                  value={testForm.duration_minutes}
                  onChange={e => setTestForm({...testForm, duration_minutes: parseInt(e.target.value) || 30})}
                  min={5}
                  max={300}
                />
              </div>
            </div>

            <div className="modal-footer">
              <button
                className="btn-secondary"
                onClick={() => setShowCreateModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleCreateTest}
                disabled={!testForm.title.trim()}
                style={{ backgroundColor: '#7c3aed' }}
              >
                Create Test
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Test Modal */}
      {editingTest && (
        <TestEditorModal
          test={editingTest}
          onClose={() => setEditingTest(null)}
          onUpdate={loadTests}
        />
      )}
    </div>
  );
}

// Test Editor Modal Component
function TestEditorModal({ test, onClose, onUpdate }) {
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddQuestion, setShowAddQuestion] = useState(false);

  // Determine default question type based on test type
  const getDefaultQuestionType = () => {
    if (test.test_type === 'mixed') return 'multiple_choice';
    return test.test_type;
  };

  const [questionForm, setQuestionForm] = useState({
    question_text: '',
    question_type: getDefaultQuestionType(),
    points: 1,
    correct_answer: '',
    explanation: '',
    answers: [{ answer_text: '', is_correct: false }, { answer_text: '', is_correct: false }]
  });

  useEffect(() => {
    loadQuestions();
  }, [test.id]);

  const loadQuestions = async () => {
    if (!supabase) {
      setQuestions([]);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('test_questions')
        .select(`
          *,
          test_answers (*)
        `)
        .eq('test_id', test.id)
        .order('order_index');

      if (error) throw error;
      setQuestions(data || []);
    } catch (error) {
      console.error('Error loading questions:', error);
      setQuestions([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAddQuestion = async () => {
    if (!supabase || !questionForm.question_text.trim()) return;

    try {
      // Insert question
      const { data: questionData, error: questionError } = await supabase
        .from('test_questions')
        .insert([{
          test_id: test.id,
          question_text: questionForm.question_text,
          question_type: questionForm.question_type,
          points: questionForm.points,
          correct_answer: questionForm.correct_answer,
          explanation: questionForm.explanation,
          order_index: questions.length
        }])
        .select()
        .single();

      if (questionError) throw questionError;

      // Insert answers for multiple choice
      if (questionForm.question_type === 'multiple_choice') {
        const answersToInsert = questionForm.answers
          .filter(answer => answer.answer_text.trim())
          .map((answer, index) => ({
            question_id: questionData.id,
            answer_text: answer.answer_text,
            is_correct: answer.is_correct,
            order_index: index
          }));

        if (answersToInsert.length > 0) {
          const { error: answersError } = await supabase
            .from('test_answers')
            .insert(answersToInsert);

          if (answersError) throw answersError;
        }
      }

      // Update total questions count
      await supabase
        .from('live_tests')
        .update({ total_questions: questions.length + 1 })
        .eq('id', test.id);

      setShowAddQuestion(false);
      setQuestionForm({
        question_text: '',
        question_type: getDefaultQuestionType(),
        points: 1,
        correct_answer: '',
        explanation: '',
        answers: [{ answer_text: '', is_correct: false }, { answer_text: '', is_correct: false }]
      });
      loadQuestions();
      onUpdate();
    } catch (error) {
      console.error('Error adding question:', error);
      alert('Failed to add question. Please try again.');
    }
  };

  const addAnswerOption = () => {
    setQuestionForm({
      ...questionForm,
      answers: [...questionForm.answers, { answer_text: '', is_correct: false }]
    });
  };

  const updateAnswer = (index, field, value) => {
    const newAnswers = [...questionForm.answers];
    newAnswers[index] = { ...newAnswers[index], [field]: value };
    setQuestionForm({ ...questionForm, answers: newAnswers });
  };

  const removeAnswer = (index) => {
    if (questionForm.answers.length > 2) {
      setQuestionForm({
        ...questionForm,
        answers: questionForm.answers.filter((_, i) => i !== index)
      });
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content large-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>Edit Test: {test.title}</h3>
            <div style={{ fontSize: '0.9rem', color: '#6b7280', marginTop: '4px' }}>
              Test Type: {test.test_type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>
            <Ico name="close" size={20} color="#6b7280" />
          </button>
        </div>

        <div className="modal-body">
          <div className="questions-header">
            <h4>Questions ({questions.length})</h4>
            <button
              className="btn-primary"
              onClick={() => setShowAddQuestion(true)}
              style={{ backgroundColor: '#10b981' }}
            >
              <Ico name="plus" size={16} color="#fff" />
              Add Question
            </button>
          </div>

          {loading ? (
            <div className="loading-spinner">Loading questions...</div>
          ) : questions.length === 0 ? (
            <div className="empty-state">
              <Ico name="quiz" size={32} color="#9ca3af" />
              <div className="empty-title">No questions added yet</div>
              <div className="empty-subtitle">Add questions to make this test functional</div>
            </div>
          ) : (
            <div className="questions-list">
              {questions.map((question, index) => (
                <div key={question.id} className="question-item">
                  <div className="question-header">
                    <span className="question-number">{index + 1}.</span>
                    <span className="question-text">{question.question_text}</span>
                    <div className="question-meta">
                      <span className="question-type">{question.question_type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
                      <span className="question-points">{question.points} pts</span>
                    </div>
                  </div>

                  {question.question_type === 'multiple_choice' && question.test_answers && (
                    <div className="question-answers">
                      {question.test_answers.map((answer, ansIndex) => (
                        <div key={answer.id} className={`answer-option ${answer.is_correct ? 'correct' : ''}`}>
                          <span className="answer-letter">{String.fromCharCode(65 + ansIndex)}</span>
                          <span className="answer-text">{answer.answer_text}</span>
                          {answer.is_correct && <Ico name="check" size={14} color="#16a34a" />}
                        </div>
                      ))}
                    </div>
                  )}

                  {question.question_type === 'true_false' && (
                    <div className="question-answers">
                      <div className={`answer-option ${question.correct_answer === 'true' ? 'correct' : ''}`}>
                        <span className="answer-text">True</span>
                        {question.correct_answer === 'true' && <Ico name="check" size={14} color="#16a34a" />}
                      </div>
                      <div className={`answer-option ${question.correct_answer === 'false' ? 'correct' : ''}`}>
                        <span className="answer-text">False</span>
                        {question.correct_answer === 'false' && <Ico name="check" size={14} color="#16a34a" />}
                      </div>
                    </div>
                  )}

                  {(question.question_type === 'short_answer' || question.question_type === 'fill_in') && question.correct_answer && (
                    <div className="question-answers">
                      <div className="answer-option correct">
                        <span className="answer-text">
                          {question.question_type === 'fill_in' ? 'Acceptable answers: ' : 'Correct answer: '}
                          {question.correct_answer}
                        </span>
                        <Ico name="check" size={14} color="#16a34a" />
                      </div>
                    </div>
                  )}

                  {question.question_type === 'long_text' && question.correct_answer && (
                    <div className="question-answers">
                      <div className="answer-option">
                        <span className="answer-text">
                          <strong>Grading criteria:</strong> {question.correct_answer}
                        </span>
                        <Ico name="edit" size={14} color="#f59e0b" />
                      </div>
                    </div>
                  )}

                  {question.explanation && (
                    <div className="question-explanation">
                      <strong>Explanation:</strong> {question.explanation}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {/* Add Question Modal */}
      {showAddQuestion && (
        <div className="modal-overlay" onClick={() => setShowAddQuestion(false)}>
          <div className="modal-content large-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add Question</h3>
              <button
                className="modal-close"
                onClick={() => setShowAddQuestion(false)}
              >
                <Ico name="close" size={20} color="#6b7280" />
              </button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label>Question Text *</label>
                <textarea
                  className="form-input"
                  value={questionForm.question_text}
                  onChange={e => setQuestionForm({...questionForm, question_text: e.target.value})}
                  placeholder="Enter your question"
                  rows={3}
                />
              </div>

              <div className="form-row">
                {test.test_type === 'mixed' && (
                  <div className="form-group">
                    <label>Question Type</label>
                    <select
                      className="form-input"
                      value={questionForm.question_type}
                      onChange={e => setQuestionForm({...questionForm, question_type: e.target.value})}
                    >
                      <option value="multiple_choice">Multiple Choice</option>
                      <option value="true_false">True/False</option>
                      <option value="short_answer">Short Answer</option>
                      <option value="fill_in">Fill in the Blank</option>
                      <option value="long_text">Long Text/Essay</option>
                    </select>
                  </div>
                )}

                {test.test_type !== 'mixed' && (
                  <div className="form-group">
                    <label>Question Type</label>
                    <div className="form-input" style={{ backgroundColor: '#f8fafc', color: '#6b7280' }}>
                      {questionForm.question_type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      <small style={{ display: 'block', marginTop: '4px', fontSize: '0.8rem' }}>
                        (Fixed for {test.test_type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())} tests)
                      </small>
                    </div>
                  </div>
                )}

                <div className="form-group">
                  <label>Points</label>
                  <input
                    type="number"
                    className="form-input"
                    value={questionForm.points}
                    onChange={e => setQuestionForm({...questionForm, points: parseInt(e.target.value) || 1})}
                    min={1}
                    max={10}
                  />
                </div>
              </div>

              {questionForm.question_type === 'multiple_choice' && (
                <div className="form-group">
                  <label>Answer Options</label>
                  {questionForm.answers.map((answer, index) => (
                    <div key={index} className="answer-input-row">
                      <input
                        type="radio"
                        name="correct-answer"
                        checked={answer.is_correct}
                        onChange={() => {
                          const newAnswers = questionForm.answers.map((ans, i) => ({
                            ...ans,
                            is_correct: i === index
                          }));
                          setQuestionForm({...questionForm, answers: newAnswers});
                        }}
                      />
                      <input
                        type="text"
                        className="form-input"
                        value={answer.answer_text}
                        onChange={e => updateAnswer(index, 'answer_text', e.target.value)}
                        placeholder={`Option ${String.fromCharCode(65 + index)}`}
                      />
                      {questionForm.answers.length > 2 && (
                        <button
                          type="button"
                          className="btn-icon"
                          onClick={() => removeAnswer(index)}
                        >
                          <Ico name="trash" size={16} color="#ef4444" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={addAnswerOption}
                    style={{ marginTop: '8px' }}
                  >
                    <Ico name="plus" size={14} color="#374151" />
                    Add Option
                  </button>
                </div>
              )}

              {questionForm.question_type === 'true_false' && (
                <div className="form-group">
                  <label>Correct Answer</label>
                  <select
                    className="form-input"
                    value={questionForm.correct_answer}
                    onChange={e => setQuestionForm({...questionForm, correct_answer: e.target.value})}
                  >
                    <option value="">Select answer</option>
                    <option value="true">True</option>
                    <option value="false">False</option>
                  </select>
                </div>
              )}

              {questionForm.question_type === 'short_answer' && (
                <div className="form-group">
                  <label>Correct Answer</label>
                  <input
                    type="text"
                    className="form-input"
                    value={questionForm.correct_answer}
                    onChange={e => setQuestionForm({...questionForm, correct_answer: e.target.value})}
                    placeholder="Enter the correct answer"
                  />
                </div>
              )}

              {questionForm.question_type === 'fill_in' && (
                <div className="form-group">
                  <label>Correct Answer(s)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={questionForm.correct_answer}
                    onChange={e => setQuestionForm({...questionForm, correct_answer: e.target.value})}
                    placeholder="Enter correct answer(s), separate multiple with | (e.g., answer1|answer2)"
                  />
                  <small style={{ color: '#6b7280', fontSize: '0.8rem' }}>
                    For fill-in-the-blank, you can specify multiple acceptable answers separated by |
                  </small>
                </div>
              )}

              {questionForm.question_type === 'long_text' && (
                <div className="form-group">
                  <label>Grading Rubric/Keywords</label>
                  <textarea
                    className="form-input"
                    value={questionForm.correct_answer}
                    onChange={e => setQuestionForm({...questionForm, correct_answer: e.target.value})}
                    placeholder="Enter key points, keywords, or grading criteria for evaluation"
                    rows={4}
                  />
                  <small style={{ color: '#6b7280', fontSize: '0.8rem' }}>
                    For essay questions, enter keywords, key points, or grading criteria that should be present in the answer
                  </small>
                </div>
              )}

              <div className="form-group">
                <label>Explanation (Optional)</label>
                <textarea
                  className="form-input"
                  value={questionForm.explanation}
                  onChange={e => setQuestionForm({...questionForm, explanation: e.target.value})}
                  placeholder="Explain the correct answer"
                  rows={2}
                />
              </div>
            </div>

            <div className="modal-footer">
              <button
                className="btn-secondary"
                onClick={() => setShowAddQuestion(false)}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleAddQuestion}
                disabled={!questionForm.question_text.trim()}
                style={{ backgroundColor: '#10b981' }}
              >
                Add Question
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

//   FINANCE
function FinancePage({ financeSummary, tableInfo }) {
  const hasFinanceError = hasRealTableError(tableInfo);
  const summary = financeSummary || FINANCE_DATA;
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Finance</div>
      </div>
      {hasFinanceError && (
        <div className="alert alert-warning">
          Finance metrics are currently derived from accessible fee rows because
          the Supabase fees table is not available.
        </div>
      )}
      <div className="stats-grid">
        {[
          {
            label: "Total Income",
            value: `GHS ${(summary.income / 1000).toFixed(0)}k`,
            sub: "This year",
            bg: "#dcfce7",
            c: "#16a34a",
          },
          {
            label: "Total Expenses",
            value: `GHS ${(summary.expenses / 1000).toFixed(0)}k`,
            sub: "This year",
            bg: "#fee2e2",
            c: "#dc2626",
          },
          {
            label: "Fees Collected",
            value: `GHS ${(summary.fees_collected / 1000).toFixed(0)}k`,
            sub: "All terms",
            bg: "#dbeafe",
            c: "#1e40af",
          },
          {
            label: "Outstanding",
            value: `GHS ${(summary.outstanding / 1000).toFixed(0)}k`,
            sub: "Pending",
            bg: "#fef3c7",
            c: "#d97706",
          },
        ].map((s) => (
          <div key={s.label} className="stat-card" style={{ background: s.bg }}>
            <div className="stat-label" style={{ color: s.c }}>
              {s.label}
            </div>
            <div
              className="stat-value"
              style={{ color: s.c, fontSize: "1.5rem" }}
            >
              {s.value}
            </div>
            <div className="stat-sub" style={{ color: s.c }}>
              {s.sub}
            </div>
          </div>
        ))}
      </div>
      <div className="card card-padded">
        <h3 style={{ fontWeight: 700, marginBottom: 16 }}>Expense Breakdown</h3>
        {[
          ["Staff Salaries", "62,000", "#1e40af"],
          ["Utilities", "12,000", "#d97706"],
          ["Maintenance", "8,000", "#7c3aed"],
          ["Supplies", "7,000", "#16a34a"],
        ].map(([cat, amt, c]) => (
          <div
            key={cat}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 12,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontWeight: 600,
                fontSize: ".875rem",
                flex: "1 1 140px",
              }}
            >
              {cat}
            </span>
            <div className="progress" style={{ flex: "999 1 160px" }}>
              <div
                className="progress-bar"
                style={{
                  width: `${parseInt(amt.replace(",", "")) / 890}%`,
                  background: c,
                }}
              />
            </div>
            <span style={{ fontWeight: 700, color: c, marginLeft: "auto" }}>
              GHS {amt}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

//   TEACHERS
function TeachersPage({
  teachersData,
  tableInfo,
  onCreateTeacher = null,
  onUpdateTeacher = null,
  currentUser = null,
  emptyRemoteMessage = "No teacher rows available from Supabase.",
}) {
  const { cfg: globalCfg } = useContext(SettingsContext);
  const hasTeachersError = hasRealTableError(tableInfo);
  const isMobile = useIsMobileLayout();
  const rows = teachersData?.length ? teachersData : [];
  const [editingTeacher, setEditingTeacher] = useState(undefined);
  const [teacherDraft, setTeacherDraft] = useState(() => buildTeacherDraft());
  const [savingTeacher, setSavingTeacher] = useState(false);
  const [statusModal, setStatusModal] = useState({
    open: false,
    type: "success",
    title: "",
    message: "",
  });
  const canCreateTeacher = typeof onCreateTeacher === "function";
  const canEditTeacher = typeof onUpdateTeacher === "function";
  const actorRole = currentUser?.role || "admin";
  const assignableRolesBase = getAssignableRoles(
    globalCfg,
    actorRole,
    "teacher",
  );
  const roleOptions = assignableRolesBase.some(
    (role) => role.key === teacherDraft.role,
  )
    ? assignableRolesBase
    : [
        ...assignableRolesBase,
        getRoleMeta(globalCfg, teacherDraft.role || "teacher"),
      ].filter(
        (role, index, list) =>
          list.findIndex((entry) => entry.key === role.key) === index,
      );

  useEffect(() => {
    if (editingTeacher === undefined) return;
    setTeacherDraft((current) => ({
      ...buildTeacherDraft(editingTeacher || null),
      ...current,
    }));
  }, [editingTeacher]);

  const openCreateTeacher = () => {
    setEditingTeacher(null);
    setTeacherDraft(buildTeacherDraft());
  };

  const openEditTeacher = (teacher) => {
    setEditingTeacher(teacher);
    setTeacherDraft(buildTeacherDraft(teacher));
  };

  const closeTeacherEditor = () => {
    if (savingTeacher) return;
    setEditingTeacher(undefined);
    setTeacherDraft(buildTeacherDraft());
  };

  const saveTeacher = async () => {
    if (!teacherDraft.name.trim() || !teacherDraft.subject.trim()) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Teacher Save Failed",
        message: "Teacher name and subject are required.",
      });
      return;
    }
    setSavingTeacher(true);
    try {
      if (editingTeacher) {
        await onUpdateTeacher?.(editingTeacher, teacherDraft);
      } else {
        await onCreateTeacher?.(teacherDraft);
      }
      closeTeacherEditor();
      setStatusModal({
        open: true,
        type: "success",
        title: "Teacher Saved",
        message: "Teacher record saved successfully.",
      });
    } catch (error) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Teacher Save Failed",
        message: error?.message || "Could not save the teacher record.",
      });
    } finally {
      setSavingTeacher(false);
    }
  };
  return (
    <div className="fade-in">
      <ActionStatusModal
        state={statusModal}
        onClose={() =>
          setStatusModal((current) => ({ ...current, open: false }))
        }
      />
      <div className="page-header">
        <div className="page-title">Teachers</div>
      </div>
      {hasTeachersError && (
        <div className="alert alert-warning">
          Teachers table is not accessible in Supabase yet.
        </div>
      )}
      {(canCreateTeacher || canEditTeacher) && (
        <div className="page-actions-row">
          <button className="btn btn-blue" onClick={openCreateTeacher}>
            <Ico name="teachers" size={16} color="#fff" /> Add Teacher
          </button>
        </div>
      )}
      {isMobile ? (
        <div className="mobile-record-list">
          {rows.map((teacher) => (
            <div key={teacher.id} className="mobile-record-card">
              <div className="mobile-record-head">
                <div>
                  <div className="mobile-record-title">{teacher.name}</div>
                  <div className="mobile-record-sub">
                    {teacher.subject}  {" "}
                    {getRoleMeta(globalCfg, teacher.role || "teacher").label}
                  </div>
                </div>
                <span className="badge badge-blue">
                  {teacher.class || "Unassigned"}
                </span>
              </div>
              <div className="mobile-record-grid">
                <div className="mobile-record-item">
                  <label>Role</label>
                  <span>
                    {getRoleMeta(globalCfg, teacher.role || "teacher").label}
                  </span>
                </div>
                <div className="mobile-record-item">
                  <label>Employee ID</label>
                  <span>{teacher.employee_id || "-"}</span>
                </div>
                <div className="mobile-record-item">
                  <label>Class</label>
                  <span>{teacher.class || "-"}</span>
                </div>
                <div className="mobile-record-item">
                  <label>Phone</label>
                  <span>{teacher.phone || "-"}</span>
                </div>
                <div className="mobile-record-item">
                  <label>Email</label>
                  <span>{teacher.email || "-"}</span>
                </div>
                <div className="mobile-record-item">
                  <label>Gender</label>
                  <span>{teacher.gender || "-"}</span>
                </div>
                <div className="mobile-record-item">
                  <label>Qualification</label>
                  <span>{teacher.qualification || "-"}</span>
                </div>
                <div className="mobile-record-item">
                  <label>Date of Birth</label>
                  <span>{teacher.date_of_birth || "-"}</span>
                </div>
                <div className="mobile-record-item">
                  <label>Hire Date</label>
                  <span>{teacher.hire_date || "-"}</span>
                </div>
                <div className="mobile-record-item">
                  <label>Address</label>
                  <span>{teacher.address || "-"}</span>
                </div>
              </div>
              {canEditTeacher && (
                <div className="mobile-record-actions">
                  <button
                    className="btn btn-outline"
                    onClick={() => openEditTeacher(teacher)}
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>
          ))}
          {!rows.length && (
            <div
              className="mobile-record-card"
              style={{ textAlign: "center", color: "#64748b" }}
            >
              {emptyRemoteMessage}
            </div>
          )}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Employee ID</th>
                <th>Role</th>
                <th>Subject</th>
                <th>Classes</th>
                <th>Contact</th>
                <th>Profile</th>
                {canEditTeacher && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.name}</strong>
                    <div
                      style={{
                        fontSize: ".78rem",
                        color: "#64748b",
                        marginTop: 4,
                      }}
                    >
                      {t.address || "No address added"}
                    </div>
                  </td>
                  <td>{t.employee_id || "-"}</td>
                  <td>{getRoleMeta(globalCfg, t.role || "teacher").label}</td>
                  <td>{t.subject}</td>
                  <td>{t.class}</td>
                  <td>
                    <div style={{ fontFamily: "monospace" }}>{t.phone}</div>
                    <div
                      style={{
                        fontSize: ".78rem",
                        color: "#64748b",
                        marginTop: 4,
                      }}
                    >
                      {t.email || "-"}
                    </div>
                  </td>
                  <td>
                    <div>{t.qualification || "-"}</div>
                    <div
                      style={{
                        fontSize: ".78rem",
                        color: "#64748b",
                        marginTop: 4,
                      }}
                    >
                      {t.gender || "-"}   DOB: {t.date_of_birth || "-"}   Hired:{" "}
                      {t.hire_date || "-"}
                    </div>
                  </td>
                  {canEditTeacher && (
                    <td>
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={() => openEditTeacher(t)}
                      >
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td
                    colSpan={canEditTeacher ? "8" : "7"}
                    style={{
                      textAlign: "center",
                      padding: 24,
                      color: "#64748b",
                    }}
                  >
                    {emptyRemoteMessage}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <TeacherEditorModal
        key={`${TEACHER_FORM_SCHEMA_VERSION}-${editingTeacher?.id || "new"}`}
        open={editingTeacher !== undefined}
        title={editingTeacher ? "Edit Teacher" : "Add Teacher"}
        draft={teacherDraft}
        roleOptions={roleOptions}
        saving={savingTeacher}
        onChange={(key, value) =>
          setTeacherDraft((current) => ({ ...current, [key]: value }))
        }
        onClose={closeTeacherEditor}
        onSave={saveTeacher}
      />
    </div>
  );
}

//   EVENTS
function EventsPage({ eventsData, tableInfo, registeredSchoolId = null }) {
  const hasEventsError = hasRealTableError(tableInfo);
  const [form, setForm] = useState({
    title: "",
    date: "",
    type: "event",
    desc: "",
  });
  const [events, setEvents] = useState(
    eventsData?.length ? eventsData.map(normalizeEventRow) : [],
  );
  const [adding, setAdding] = useState(false);
  const [statusModal, setStatusModal] = useState({
    open: false,
    type: "success",
    title: "",
    message: "",
  });

  useEffect(() => {
    setEvents(eventsData?.length ? eventsData.map(normalizeEventRow) : []);
  }, [eventsData]);

  const add = async () => {
    if (!form.title) return;
    if (supabase) {
      const { data, error } = await supabase
        .from("events")
        .insert({
          title: form.title,
          event_date: form.date || null,
          type: form.type,
          ...(registeredSchoolId != null
            ? { registered_school_id: registeredSchoolId }
            : {}),
          description: form.desc || null,
        })
        .select("id, title, event_date, type, description")
        .single();

      if (error && isMissingColumnError(error) && registeredSchoolId != null) {
        setStatusModal({
          open: true,
          type: "failure",
          title: "Event Save Failed",
          message:
            "School-scoped events require backend/supabase/migrations/004_add_registered_school_scope.sql. Run the migration, then refresh.",
        });
        return;
      }

      if (!error && data) {
        setEvents((e) => [
          ...e,
          {
            id: data.id,
            title: data.title || form.title,
            date: data.event_date || form.date,
            type: data.type || form.type,
            desc: data.description || form.desc,
          },
        ]);
        setStatusModal({
          open: true,
          type: "success",
          title: "Event Saved",
          message: "The event was saved to Supabase.",
        });
      } else {
        const tableMissing = isMissingTableError(error, "events");
        const columnMissing = isMissingColumnError(error);
        const message = tableMissing
          ? "Events table is not configured in Supabase. Run backend/supabase/migrations/001_public_portal_tables.sql, then refresh."
          : columnMissing && registeredSchoolId != null
          ? "School-scoped events require backend/supabase/migrations/004_add_registered_school_scope.sql. Run the migration, then refresh."
          : String(error?.message || "").toLowerCase().includes("row-level security") ||
            String(error?.message || "").toLowerCase().includes("violates row-level security")
          ? "The write was blocked by Supabase auth/RLS. Check your policies and make sure the current user has insert permissions on the events table."
          : `Event was saved locally only. Supabase write failed.${error?.message ? ` ${error.message}` : ""}`;

        setEvents((e) => [...e, { id: Date.now(), ...form }]);
        setStatusModal({
          open: true,
          type: "failure",
          title: "Supabase Save Failed",
          message,
        });
      }
    } else {
      setEvents((e) => [...e, { id: Date.now(), ...form }]);
      setStatusModal({
        open: true,
        type: "failure",
        title: "Saved Locally",
        message:
          "Supabase is not configured, so the event was saved locally only.",
      });
    }
    setAdding(false);
    setForm({ title: "", date: "", type: "event", desc: "" });
  };
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Events & Calendar</div>
      </div>
      {hasEventsError && (
        <div className="alert alert-warning">
          Events table could not be queried fully. Existing live rows are shown
          below.
        </div>
      )}
      <ActionStatusModal
        state={statusModal}
        onClose={() => setStatusModal((s) => ({ ...s, open: false }))}
      />
      <div style={{ marginBottom: 16 }}>
        <button className="btn btn-blue" onClick={() => setAdding(!adding)}>
          {adding ? "Cancel" : "+ Add Event"}
        </button>
      </div>
      {adding && (
        <div className="card card-padded" style={{ marginBottom: 16 }}>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Title</label>
              <input
                className="form-control"
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
              />
            </div>
            <div className="form-group">
              <label className="form-label">Date</label>
              <input
                type="date"
                className="form-control"
                value={form.date}
                onChange={(e) =>
                  setForm((f) => ({ ...f, date: e.target.value }))
                }
              />
            </div>
            <div className="form-group">
              <label className="form-label">Type</label>
              <select
                className="form-control"
                value={form.type}
                onChange={(e) =>
                  setForm((f) => ({ ...f, type: e.target.value }))
                }
              >
                <option value="event">Event</option>
                <option value="exam">Exam</option>
                <option value="meeting">Meeting</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <input
                className="form-control"
                value={form.desc}
                onChange={(e) =>
                  setForm((f) => ({ ...f, desc: e.target.value }))
                }
              />
            </div>
          </div>
          <button
            className="btn btn-blue"
            style={{ marginTop: 12 }}
            onClick={add}
          >
            Save Event
          </button>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {events.map((e) => (
          <div
            key={e.id}
            className="card card-padded"
            style={{ display: "flex", gap: 16, alignItems: "center" }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 12,
                background:
                  e.type === "exam"
                    ? "#fee2e2"
                    : e.type === "meeting"
                      ? "#dbeafe"
                      : "#dcfce7",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.4rem",
                flexShrink: 0,
              }}
            >
              {e.type === "exam" ? (
                <Ico name="docs" size={22} color="#dc2626" />
              ) : e.type === "meeting" ? (
                <Ico name="students" size={22} color="#1e40af" />
              ) : (
                <Ico name="events" size={22} color="#16a34a" />
              )}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{e.title}</div>
              <div style={{ fontSize: ".85rem", color: "#64748b" }}>
                {e.date} - {e.desc}
              </div>
            </div>
            <span
              className={`badge ${e.type === "exam" ? "badge-danger" : e.type === "meeting" ? "badge-blue" : "badge-success"}`}
            >
              {e.type}
            </span>
          </div>
        ))}
        {!events.length && (
          <div
            className="card card-padded"
            style={{ textAlign: "center", color: "#64748b" }}
          >
            No event rows are currently available from Supabase.
          </div>
        )}
      </div>
    </div>
  );
}

//   SETTINGS
function SettingsPage() {
  const { cfg: globalCfg, updateCfg, session } = useContext(SettingsContext);
  const [cfg, setCfg] = useState(globalCfg);
  const [newClassOption, setNewClassOption] = useState("");
  const [selectedClassOption, setSelectedClassOption] = useState("");
  const [statusModal, setStatusModal] = useState({
    open: false,
    type: "success",
    title: "",
    message: "",
  });
  const scrollRef = useRef(null);

  // Sync local form state when global settings change (e.g. on first load from Supabase)
  useEffect(() => {
    setCfg(globalCfg);
  }, [globalCfg]);

  const set = (k, v) => {
    if (scrollRef.current) {
      scrollRef.current._savedScrollTop = scrollRef.current.scrollTop;
    }
    setCfg((c) => ({ ...c, [k]: v }));
  };
  const setStudentNavVisibility = (key, enabled) => {
    setCfg((current) => ({
      ...current,
      ...(key === "results" ? { showResultsToStudents: enabled } : {}),
      studentNavVisibility: {
        ...getStudentNavVisibility(current),
        [key]: enabled,
      },
    }));
  };
  const classOptions = resolveClassOptions(cfg);
  useEffect(() => {
    setSelectedClassOption((current) =>
      classOptions.includes(current) ? current : classOptions[0] || "",
    );
  }, [classOptions.join("||")]);

  // Restore scroll position after state changes
  useEffect(() => {
    if (scrollRef.current && scrollRef.current._savedScrollTop !== undefined) {
      scrollRef.current.scrollTop = scrollRef.current._savedScrollTop;
      delete scrollRef.current._savedScrollTop;
    }
  });
  const persistClassOptions = async (nextClassOptions) => {
    const nextCfg = { ...cfg, classOptions: nextClassOptions };
    setCfg(nextCfg);
    updateCfg(nextCfg);

    if (!supabase) return;

    // Always mirror to app_settings so dropdowns can still load
    // even if the dedicated classes table is temporarily unavailable.
    const { error: mirroredSaveError } = await supabase
      .from("app_settings")
      .upsert({ id: 1, config: nextCfg });
    if (mirroredSaveError) throw mirroredSaveError;

    // Preferred persistence path: dedicated classes table.
    const { error: clearError } = await supabase
      .from("classes")
      .delete()
      .gt("id", 0);
    if (clearError) {
      if (isMissingTableError(clearError, "classes")) {
        const { error: saveFallbackError } = await supabase
          .from("app_settings")
          .upsert({ id: 1, config: nextCfg });
        if (saveFallbackError) throw saveFallbackError;
        return;
      }
      throw clearError;
    }

    if (nextClassOptions.length) {
      const rows = nextClassOptions.map((name) => ({ name, active: true }));
      const { error: insertError } = await supabase.from("classes").insert(rows);
      if (insertError) throw insertError;
    }

    const { data: classRows, error: fetchClassesError } = await supabase
      .from("classes")
      .select("name")
      .eq("active", true)
      .order("id", { ascending: true });
    if (fetchClassesError) throw fetchClassesError;
    if (Array.isArray(classRows)) {
      const names = classRows
        .map((row) => String(row?.name || "").trim())
        .filter(Boolean);
      const merged = { ...nextCfg, classOptions: names };
      setCfg(merged);
      updateCfg(merged);
    }
  };

  const addClassOption = async () => {
    const candidate = String(newClassOption || "").trim();
    if (!candidate) return;
    if (
      classOptions.some(
        (existing) => existing.toLowerCase() === candidate.toLowerCase(),
      )
    ) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Class Exists",
        message: "That class already exists in the list.",
      });
      return;
    }
    try {
      await persistClassOptions([...classOptions, candidate]);
      setNewClassOption("");
      setStatusModal({
        open: true,
        type: "success",
        title: "Class Saved",
        message: "Class was saved to Supabase classes table.",
      });
    } catch (error) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Class Save Failed",
        message: error?.message || "Could not save class to Supabase classes table.",
      });
    }
  };
  const removeClassOption = async (className) => {
    const next = classOptions.filter((row) => row !== className);
    try {
      await persistClassOptions(next);
      setStatusModal({
        open: true,
        type: "success",
        title: "Class Removed",
        message: "Class removal was saved to Supabase classes table.",
      });
    } catch (error) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Class Remove Failed",
        message: error?.message || "Could not remove class from Supabase classes table.",
      });
    }
  };
  const runConfigCheck = () => {
    const issues = [];
    if (!String(cfg.systemName || "").trim())
      issues.push("System Name is required.");
    if (!String(cfg.academicYear || "").trim())
      issues.push("Academic Year is required.");
    if (Number(cfg.maxChoices || 0) < 1 || Number(cfg.maxChoices || 0) > 10)
      issues.push("Max School Choices must be between 1 and 10.");
    if (
      Number(cfg.sessionTimeoutMins || 0) < 5 ||
      Number(cfg.sessionTimeoutMins || 0) > 480
    )
      issues.push("Session Timeout must be between 5 and 480 minutes.");
    if (
      Number(cfg.passwordMinLength || 0) < 6 ||
      Number(cfg.passwordMinLength || 0) > 32
    )
      issues.push("Password Minimum Length must be between 6 and 32.");
    if (
      Number(cfg.lockoutAttempts || 0) < 1 ||
      Number(cfg.lockoutAttempts || 0) > 20
    )
      issues.push("Lockout Attempts must be between 1 and 20.");
    if (
      Number(cfg.auditRetentionDays || 0) < 30 ||
      Number(cfg.auditRetentionDays || 0) > 3650
    )
      issues.push("Audit Retention must be between 30 and 3650 days.");
    if (
      Number(cfg.apiRateLimitPerMin || 0) < 10 ||
      Number(cfg.apiRateLimitPerMin || 0) > 5000
    )
      issues.push("API Rate Limit must be between 10 and 5000 requests/min.");

    if (issues.length) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Configuration Check Failed",
        message: issues[0],
      });
      return false;
    }

    setStatusModal({
      open: true,
      type: "success",
      title: "Configuration Looks Good",
      message: "All key settings passed validation checks.",
    });
    return true;
  };

  const resetToDefaults = () => {
    setCfg(DEFAULT_SETTINGS);
    setStatusModal({
      open: true,
      type: "success",
      title: "Defaults Restored",
      message: "Settings were reset to default values. Click Save to apply.",
    });
  };

  const saveSettings = async () => {
    try {
      if (!runConfigCheck()) return;

      // Check if non-super-admins are trying to change portal visibility settings
      if (!isSuperAdmin) {
        const portalVisibilityKeys = [
          'adminFeesPortalEnabled',
          'studentFeesPortalEnabled',
          'studentFeesSummaryVisible',
          'studentSelectionDeadlineVisible',
          'studentDashboardEnabled',
          'studentProfileEnabled',
          'studentResultsEnabled',
          'studentAnalyticsEnabled',
          'studentReportCardEnabled',
          'studentStudyPlannerEnabled',
          'studentExamScheduleEnabled',
          'studentLiveTestsEnabled',
          'studentGoalsEnabled',
          'studentSelectSchoolsEnabled',
          'studentMySelectionEnabled',
          'studentSelectionPortalEnabled',
          'studentAttendanceEnabled',
          'studentAttendanceCorrectionsEnabled',
          'studentAnnouncementsEnabled',
          'studentSupportTicketsEnabled',
          'studentChatEnabled',
          'studentDocsEnabled',
          'studentUploadDocsEnabled',
          'studentResourcesEnabled',
          'studentAssignmentsEnabled',
          "studentCalendarSyncEnabled",
          "studentNavVisibility",
        ];

        for (const key of portalVisibilityKeys) {
          const changed =
            key === "studentNavVisibility"
              ? JSON.stringify(getStudentNavVisibility(cfg)) !==
                JSON.stringify(getStudentNavVisibility(globalCfg))
              : cfg[key] !== globalCfg[key];
          if (changed) {
            setStatusModal({
              open: true,
              type: "failure",
              title: "Permission Denied",
              message: "Only super admins can change portal visibility settings.",
            });
            return;
          }
        }
      }

      updateCfg(cfg);
      if (supabase) {
        const { error } = await supabase
          .from("app_settings")
          .upsert({ id: 1, config: cfg });
        if (error) throw error;
      }
      setStatusModal({
        open: true,
        type: "success",
        title: "Settings Updated",
        message: "All settings were saved and applied across the app.",
      });
    } catch (error) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Settings Update Failed",
        message: error?.message || "Could not save settings. Please try again.",
      });
    }
  };

  const SectionTitle = ({ title, sub }) => (
    <div
      style={{
        marginBottom: 16,
        paddingBottom: 8,
        borderBottom: "2px solid #e8f1ff",
      }}
    >
      <div style={{ fontWeight: 800, fontSize: "1rem", color: "#1e3a8a" }}>
        {title}
      </div>
      {sub && (
        <div style={{ fontSize: ".8rem", color: "#64748b", marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );

  const Toggle = ({ k, label, sub, danger }) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "13px 0",
        borderBottom: "1px solid #f1f5f9",
      }}
    >
      <div>
        <div
          style={{
            fontWeight: 600,
            fontSize: ".9rem",
            color: danger && cfg[k] ? "#dc2626" : "inherit",
          }}
        >
          {label}
        </div>
        {sub && (
          <div style={{ fontSize: ".75rem", color: "#94a3b8", marginTop: 1 }}>
            {sub}
          </div>
        )}
      </div>
      <button
        onClick={() => {
          const enabled = !cfg[k];
          set(k, enabled);
          if (k === "showResultsToStudents") {
            setStudentNavVisibility("results", enabled);
          }
        }}
        style={{
          width: 48,
          height: 26,
          borderRadius: 13,
          background: cfg[k] ? (danger ? "#dc2626" : "#1a56db") : "#e2e8f0",
          border: "none",
          cursor: "pointer",
          position: "relative",
          transition: "background .2s",
          flexShrink: 0,
          marginLeft: 16,
        }}
      >
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: "#fff",
            position: "absolute",
            top: 3,
            left: cfg[k] ? 25 : 3,
            transition: "left .2s",
            boxShadow: "0 1px 4px rgba(0,0,0,.2)",
          }}
        />
      </button>
    </div>
  );
  const isSuperAdmin =
    normalizeRoleKey(session?.user?.role || "") === "admin";

  return (
    <div className="fade-in" ref={scrollRef}>
      <div className="page-header">
        <div className="page-title">Settings</div>
        <div className="page-sub">
          Configure system-wide options   changes apply instantly across the app
        </div>
      </div>
      <ActionStatusModal
        state={statusModal}
        onClose={() => setStatusModal((s) => ({ ...s, open: false }))}
      />

      {/* General */}
      <div className="card card-padded" style={{ marginBottom: 16 }}>
        <SectionTitle
          title="General"
          sub="Basic system identity and academic period"
        />
        <div className="form-grid" style={{ marginBottom: 8 }}>
          <div className="form-group">
            <label className="form-label">System Name</label>
            <input
              className="form-control"
              value={cfg.systemName || ""}
              onChange={(e) => set("systemName", e.target.value)}
              placeholder="e.g. Campus Ghana"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Academic Year</label>
            <input
              className="form-control"
              value={cfg.academicYear || ""}
              onChange={(e) => set("academicYear", e.target.value)}
              placeholder="e.g. 2024/2025"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Current Term</label>
            <select
              className="form-control"
              value={cfg.currentTerm || "First Term"}
              onChange={(e) => set("currentTerm", e.target.value)}
            >
              <option>First Term</option>
              <option>Second Term</option>
              <option>Third Term</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">School Region (Filter)</label>
            <select
              className="form-control"
              value={cfg.schoolRegion || "All Regions"}
              onChange={(e) => set("schoolRegion", e.target.value)}
            >
              <option>All Regions</option>
              {GHANA_REGIONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Locale</label>
            <select
              className="form-control"
              value={cfg.locale || "en-GH"}
              onChange={(e) => set("locale", e.target.value)}
            >
              <option value="en-GH">English (Ghana)</option>
              <option value="en-US">English (US)</option>
              <option value="en-GB">English (UK)</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Timezone</label>
            <select
              className="form-control"
              value={cfg.timezone || "Africa/Accra"}
              onChange={(e) => set("timezone", e.target.value)}
            >
              <option value="Africa/Accra">Africa/Accra (GMT)</option>
              <option value="Africa/Lagos">Africa/Lagos</option>
              <option value="Europe/London">Europe/London</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Currency</label>
            <select
              className="form-control"
              value={cfg.currency || "GHS"}
              onChange={(e) => set("currency", e.target.value)}
            >
              <option value="GHS">GHS</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Support Email</label>
            <input
              type="email"
              className="form-control"
              value={cfg.supportEmail || ""}
              onChange={(e) => set("supportEmail", e.target.value)}
              placeholder="support@campusghana.edu.gh"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Support Phone</label>
            <input
              className="form-control"
              value={cfg.supportPhone || ""}
              onChange={(e) => set("supportPhone", e.target.value)}
              placeholder="0240000000"
            />
          </div>
        </div>
      </div>

      {/* Admissions */}
      <div className="card card-padded" style={{ marginBottom: 16 }}>
        <SectionTitle
          title="Admissions & Mock Placement"
          sub="School selection and application window controls"
        />
        <div className="form-grid" style={{ marginBottom: 8 }}>
          <div className="form-group">
            <label className="form-label">Max School Choices</label>
            <input
              type="number"
              className="form-control"
              value={cfg.maxChoices || 7}
              onChange={(e) => set("maxChoices", +e.target.value)}
              min={1}
              max={10}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Selection Deadline</label>
            <input
              type="date"
              className="form-control"
              value={cfg.selectionDeadline || ""}
              onChange={(e) => set("selectionDeadline", e.target.value)}
            />
          </div>
          <div className="form-group" style={{ gridColumn: "1 / -1" }}>
            <label className="form-label">Manage Classes</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                className="form-control"
                value={newClassOption}
                onChange={(e) => setNewClassOption(e.target.value)}
                placeholder="e.g. Form 2"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addClassOption();
                  }
                }}
              />
              <button
                className="btn btn-outline"
                type="button"
                onClick={addClassOption}
              >
                Add Class
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <select
                className="form-control"
                value={selectedClassOption}
                onChange={(e) => setSelectedClassOption(e.target.value)}
              >
                {!classOptions.length && (
                  <option value="">No classes configured in Settings</option>
                )}
                {classOptions.map((className) => (
                  <option key={className} value={className}>
                    {className}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-outline"
                type="button"
                disabled={!selectedClassOption}
                onClick={() =>
                  selectedClassOption && removeClassOption(selectedClassOption)
                }
              >
                Remove Selected
              </button>
            </div>
            <div style={{ fontSize: ".82rem", color: "#64748b" }}>
              {classOptions.length
                ? `${classOptions.length} class option${classOptions.length === 1 ? "" : "s"} configured`
                : "No classes configured yet"}
            </div>
          </div>
        </div>
        <Toggle
          k="allowChanges"
          label="Allow Selection Changes"
          sub="Students can edit their school choices"
        />
        <Toggle
          k="studentPortalOpen"
          label="Student Portal Open"
          sub="Allow students to log in and access their portal"
        />
        <Toggle
          k="autoApproveSelections"
          label="Auto-approve Selections"
          sub="Submitted selections are confirmed without admin review"
        />
        <Toggle
          k="showResultsToStudents"
          label="Show Results to Students"
          sub="Controls Results navigation and the dashboard score card"
        />
      </div>

      {/* Notifications */}
      <div className="card card-padded" style={{ marginBottom: 16 }}>
        <SectionTitle
          title="Notifications"
          sub="Alert and messaging preferences"
        />
        <Toggle
          k="emailNotifs"
          label="Email Notifications"
          sub="Send email alerts for submissions, approvals and updates"
        />
        <Toggle
          k="smsNotifs"
          label="SMS Notifications"
          sub="Send SMS alerts to registered phone numbers"
        />
      </div>

      <div className="card card-padded" style={{ marginBottom: 16 }}>
        <SectionTitle
          title="Portal Feature Access"
          sub="Super admins can enable or hide portal pages and modules for students and admins."
        />
        {isSuperAdmin ? (
            <>
              <Toggle
                k="adminFeesPortalEnabled"
                label="Enable Fees in Admin Portals"
                sub="Show fees pages in both admin and school-admin workspaces."
              />
              <div style={{ marginTop: 16, fontWeight: 800 }}>
                Student dashboard information
              </div>
              <Toggle
                k="studentSelectionDeadlineVisible"
                label="Show Selection Deadline"
                sub="Show or hide the selection deadline on the student dashboard."
              />
              <Toggle
                k="studentFeesSummaryVisible"
                label="Show Fees Status"
                sub="Show or hide the fees summary card on the student dashboard."
              />
              <div style={{ marginTop: 16, fontWeight: 800 }}>
                Student portal navigation
              </div>
              <div style={{ color: "#64748b", fontSize: ".8rem", marginBottom: 8 }}>
                Turn each student navigation button on or off independently.
              </div>
              {(() => {
                const visibility = getStudentNavVisibility(cfg);
                return STUDENT_NAV.map((item, index) =>
                  item.section ? (
                    <div
                      key={`${item.section}-${index}`}
                      style={{
                        padding: "14px 0 6px",
                        color: "#475569",
                        fontWeight: 800,
                        borderBottom: "1px solid #e2e8f0",
                      }}
                    >
                      {item.section}
                    </div>
                  ) : (
                    <div
                      key={item.key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "9px 0",
                        borderBottom: "1px solid #f1f5f9",
                      }}
                    >
                      <span style={{ fontSize: ".9rem" }}>{item.label}</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={visibility[item.key] !== false}
                        aria-label={`Show ${item.label} in student portal`}
                        onClick={() =>
                          setStudentNavVisibility(
                            item.key,
                            visibility[item.key] === false,
                          )
                        }
                        style={{
                          width: 48,
                          height: 26,
                          borderRadius: 13,
                          background:
                            visibility[item.key] !== false ? "#1a56db" : "#e2e8f0",
                          border: "none",
                          cursor: "pointer",
                          position: "relative",
                          flexShrink: 0,
                        }}
                      >
                        <span
                          style={{
                            display: "block",
                            width: 20,
                            height: 20,
                            borderRadius: "50%",
                            background: "#fff",
                            position: "absolute",
                            top: 3,
                            left: visibility[item.key] !== false ? 25 : 3,
                          }}
                        />
                      </button>
                    </div>
                  ),
                );
              })()}
            </>
          ) : (
            <div className="alert alert-info">
              Only super admins can change portal visibility settings.
            </div>
          )}
        </div>

      {/* Security & Access */}
      <div className="card card-padded" style={{ marginBottom: 16 }}>
        <SectionTitle
          title="Security & Access"
          sub="Session policy, password strength and admin hardening"
        />
        <div className="form-grid" style={{ marginBottom: 8 }}>
          <div className="form-group">
            <label className="form-label">Session Timeout (minutes)</label>
            <input
              type="number"
              min={5}
              max={480}
              className="form-control"
              value={cfg.sessionTimeoutMins || 30}
              onChange={(e) => set("sessionTimeoutMins", +e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Password Minimum Length</label>
            <input
              type="number"
              min={6}
              max={32}
              className="form-control"
              value={cfg.passwordMinLength || 8}
              onChange={(e) => set("passwordMinLength", +e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Account Lockout Attempts</label>
            <input
              type="number"
              min={1}
              max={20}
              className="form-control"
              value={cfg.lockoutAttempts || 5}
              onChange={(e) => set("lockoutAttempts", +e.target.value)}
            />
          </div>
        </div>
        <Toggle
          k="twoFactorAdmins"
          label="Require 2FA For Admins"
          sub="Stronger login security for administrative users"
        />
        <Toggle
          k="enforcePasswordRotation"
          label="Enforce Password Rotation"
          sub="Require password updates every 90 days"
        />
      </div>

      {/* Platform Operations */}
      <div className="card card-padded" style={{ marginBottom: 16 }}>
        <SectionTitle
          title="Platform Operations"
          sub="Backups, audit logging and API safeguards"
        />
        <div className="form-grid" style={{ marginBottom: 8 }}>
          <div className="form-group">
            <label className="form-label">Backup Frequency</label>
            <select
              className="form-control"
              value={cfg.backupFrequency || "daily"}
              onChange={(e) => set("backupFrequency", e.target.value)}
            >
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Backup Time</label>
            <input
              type="time"
              className="form-control"
              value={cfg.backupTime || "02:00"}
              onChange={(e) => set("backupTime", e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Audit Retention (days)</label>
            <input
              type="number"
              min={30}
              max={3650}
              className="form-control"
              value={cfg.auditRetentionDays || 180}
              onChange={(e) => set("auditRetentionDays", +e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">API Rate Limit (req/min)</label>
            <input
              type="number"
              min={10}
              max={5000}
              className="form-control"
              value={cfg.apiRateLimitPerMin || 120}
              onChange={(e) => set("apiRateLimitPerMin", +e.target.value)}
            />
          </div>
        </div>
        <Toggle
          k="auditLogsEnabled"
          label="Enable Audit Logs"
          sub="Track critical settings, admissions and result actions"
        />
      </div>

      {/* System */}
      <div className="card card-padded" style={{ marginBottom: 16 }}>
        <SectionTitle title="System" sub="Advanced system controls" />
        <Toggle
          k="maintenanceMode"
          label="Maintenance Mode"
          sub="Temporarily restrict access while performing updates"
          danger={true}
        />
        <div
          style={{
            marginTop: 8,
            padding: "10px 12px",
            background: "#fef9c3",
            borderRadius: 8,
            fontSize: ".82rem",
            color: "#92400e",
            display: cfg.maintenanceMode ? "flex" : "none",
            alignItems: "center",
            gap: 8,
          }}
        >
            Maintenance mode is <strong>ON</strong>. Students will see a
          maintenance banner. Disable when done.
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button className="btn btn-blue" onClick={saveSettings}>
          Save All Settings
        </button>
        <button className="btn btn-outline" onClick={runConfigCheck}>
          Run Configuration Check
        </button>
        <button className="btn btn-outline" onClick={() => setCfg(globalCfg)}>
          Discard Changes
        </button>
        <button className="btn btn-outline" onClick={resetToDefaults}>
          Reset Defaults
        </button>
      </div>
    </div>
  );
}

function PermissionsMatrixPage({ currentUser }) {
  const { cfg: globalCfg, updateCfg } = useContext(SettingsContext);
  const defaultBaseRoles = [
    {
      key: "admin",
      label: "Admin",
      color: "#1d4ed8",
      note: "Full platform control",
    },
    {
      key: "school_admin",
      label: "School Admin",
      color: "#7c3aed",
      note: "School-scoped operations",
    },
    {
      key: "teacher",
      label: "Teacher",
      color: "#d97706",
      note: "Academic records and attendance",
    },
    {
      key: "staff",
      label: "Staff",
      color: "#475569",
      note: "Support and office workflows",
    },
    {
      key: "student",
      label: "Student",
      color: "#dc2626",
      note: "Self-service access only",
    },
  ];
  const permissionGroups = [
    {
      title: "Admissions",
      sub: "Student onboarding, placements, and school registry actions.",
      permissions: [
        { key: "students.view", label: "View Students" },
        { key: "students.edit", label: "Create and Edit Students" },
        { key: "schools.view", label: "View Schools" },
        { key: "placements.review", label: "Approve Placements" },
      ],
    },
    {
      title: "Academics",
      sub: "Score entry, results, grading, and teacher records.",
      permissions: [
        { key: "teachers.manage", label: "Manage Teachers" },
        { key: "scores.manage", label: "Manage Scores" },
        { key: "results.publish", label: "Publish Results" },
        { key: "attendance.manage", label: "Manage Attendance" },
      ],
    },
    {
      title: "Finance",
      sub: "Fees, payments, and finance reporting.",
      permissions: [
        { key: "fees.manage", label: "Manage Fees" },
        { key: "payments.manage", label: "Manage Payments" },
        { key: "finance.view", label: "View Finance Reports" },
      ],
    },
    {
      title: "Platform Control",
      sub: "Platform governance, roles, and system configuration.",
      permissions: [
        { key: "roles.manage", label: "Assign Role Privileges" },
        { key: "settings.manage", label: "Manage Settings" },
        { key: "audit.view", label: "View Audit Trail" },
        {
          key: "registered_schools.manage",
          label: "Manage Registered Schools",
        },
      ],
    },
  ];
  const defaultPrivileges = {
    admin: {
      "students.view": true,
      "students.edit": true,
      "schools.view": true,
      "placements.review": true,
      "teachers.manage": true,
      "scores.manage": true,
      "results.publish": true,
      "attendance.manage": true,
      "fees.manage": true,
      "payments.manage": true,
      "finance.view": true,
      "roles.manage": true,
      "settings.manage": true,
      "audit.view": true,
      "registered_schools.manage": true,
    },
    school_admin: {
      "students.view": true,
      "students.edit": true,
      "schools.view": true,
      "placements.review": true,
      "teachers.manage": true,
      "scores.manage": true,
      "results.publish": true,
      "attendance.manage": true,
      "fees.manage": true,
      "payments.manage": false,
      "finance.view": true,
      "roles.manage": false,
      "settings.manage": false,
      "audit.view": false,
      "registered_schools.manage": false,
    },
    teacher: {
      "students.view": true,
      "students.edit": false,
      "schools.view": false,
      "placements.review": false,
      "teachers.manage": false,
      "scores.manage": true,
      "results.publish": false,
      "attendance.manage": true,
      "fees.manage": false,
      "payments.manage": false,
      "finance.view": false,
      "roles.manage": false,
      "settings.manage": false,
      "audit.view": false,
      "registered_schools.manage": false,
    },
    staff: {
      "students.view": true,
      "students.edit": false,
      "schools.view": true,
      "placements.review": false,
      "teachers.manage": false,
      "scores.manage": false,
      "results.publish": false,
      "attendance.manage": false,
      "fees.manage": true,
      "payments.manage": true,
      "finance.view": true,
      "roles.manage": false,
      "settings.manage": false,
      "audit.view": false,
      "registered_schools.manage": false,
    },
    student: {
      "students.view": false,
      "students.edit": false,
      "schools.view": true,
      "placements.review": false,
      "teachers.manage": false,
      "scores.manage": false,
      "results.publish": false,
      "attendance.manage": false,
      "fees.manage": false,
      "payments.manage": false,
      "finance.view": false,
      "roles.manage": false,
      "settings.manage": false,
      "audit.view": false,
      "registered_schools.manage": false,
    },
  };

  const baseRoleKeys = defaultBaseRoles.map((role) => role.key);
  const [roleMetaOverrides, setRoleMetaOverrides] = useState(
    () => globalCfg?.roleMetaOverrides || {},
  );
  const [customRoles, setCustomRoles] = useState(() =>
    Array.isArray(globalCfg?.roleDefinitions) ? globalCfg.roleDefinitions : [],
  );
  const [roleFormMode, setRoleFormMode] = useState("create");
  const [roleForm, setRoleForm] = useState({
    key: "",
    label: "",
    note: "",
    color: "#2563eb",
  });

  const baseRoles = defaultBaseRoles.map((role) => ({
    ...role,
    ...(roleMetaOverrides?.[role.key] || {}),
  }));

  const mergeRolePrivileges = (incoming = {}) => {
    const merged = {};
    [...baseRoles, ...customRoles].forEach((role) => {
      const roleKey = role.key;
      merged[roleKey] = {
        ...defaultPrivileges[roleKey],
        ...(incoming?.[roleKey] || {}),
      };
    });
    return merged;
  };

  const roles = [...baseRoles, ...customRoles];

  const [selectedRole, setSelectedRole] = useState("admin");
  const [matrix, setMatrix] = useState(() =>
    mergeRolePrivileges(globalCfg?.rolePrivileges),
  );
  const [statusModal, setStatusModal] = useState({
    open: false,
    type: "success",
    title: "",
    message: "",
  });
  const [saving, setSaving] = useState(false);
  const [promotionAccounts, setPromotionAccounts] = useState([]);
  const [promotionSearch, setPromotionSearch] = useState("");
  const [selectedPromotionAccountKey, setSelectedPromotionAccountKey] =
    useState("");
  const [promotionRole, setPromotionRole] = useState("admin");
  const [loadingPromotionAccounts, setLoadingPromotionAccounts] =
    useState(false);
  const [promotingAccount, setPromotingAccount] = useState(false);

  useEffect(() => {
    setRoleMetaOverrides(globalCfg?.roleMetaOverrides || {});
    setCustomRoles(
      Array.isArray(globalCfg?.roleDefinitions)
        ? globalCfg.roleDefinitions
        : [],
    );
    setMatrix(mergeRolePrivileges(globalCfg?.rolePrivileges));
  }, [
    globalCfg?.roleDefinitions,
    globalCfg?.roleMetaOverrides,
    globalCfg?.rolePrivileges,
  ]);

  const selectedRoleMeta =
    roles.find((role) => role.key === selectedRole) || roles[1];
  const enabledCount = Object.values(matrix[selectedRole] || {}).filter(
    Boolean,
  ).length;
  const totalPrivilegeCount = permissionGroups.reduce(
    (sum, group) => sum + group.permissions.length,
    0,
  );
  const coverage = totalPrivilegeCount
    ? Math.round((enabledCount / totalPrivilegeCount) * 100)
    : 0;
  const actorRoleKey = normalizeRoleKey(currentUser?.role);
  const canAssignSuperAdmin = actorRoleKey === "admin";
  const canPromoteAdmins =
    actorRoleKey === "admin";
  const adminPromotionRoles = roles.filter((role) => {
    if (role.key === "admin") return true;
    if (["school_admin", "teacher", "staff", "student"].includes(role.key))
      return false;
    return [
      "roles.manage",
      "settings.manage",
      "registered_schools.manage",
      "audit.view",
    ].some((permissionKey) => !!matrix[role.key]?.[permissionKey]);
  });
  const selectedPrivilegeLabels = permissionGroups.flatMap((group) =>
    group.permissions
      .filter((permission) => !!matrix[selectedRole]?.[permission.key])
      .map((permission) => ({ ...permission, group: group.title })),
  );
  const filteredPromotionAccounts = useMemo(() => {
    const query = String(promotionSearch || "")
      .trim()
      .toLowerCase();
    const sorted = [...promotionAccounts].sort((left, right) => {
      const leftName = String(left.full_name || left.email || "").toLowerCase();
      const rightName = String(
        right.full_name || right.email || "",
      ).toLowerCase();
      return leftName.localeCompare(rightName);
    });
    if (!query) return sorted;
    return sorted.filter((account) =>
      [account.full_name, account.email, account.role]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [promotionAccounts, promotionSearch]);
  const selectedPromotionAccount =
    promotionAccounts.find(
      (account) => account.accountKey === selectedPromotionAccountKey,
    ) || null;

  useEffect(() => {
    if (!adminPromotionRoles.some((role) => role.key === promotionRole)) {
      setPromotionRole(adminPromotionRoles[0]?.key || "");
    }
  }, [adminPromotionRoles, promotionRole]);

  const loadPromotionAccounts = useCallback(async () => {
    if (!supabase) {
      setPromotionAccounts([]);
      return;
    }

    setLoadingPromotionAccounts(true);
    try {
      const profileRequest = profilesTableAvailable
        ? supabase
            .from("profiles")
            .select(
              "id, email, full_name, role, registered_school_id, managed_school_name",
            )
            .order("full_name", { ascending: true })
        : Promise.resolve({ data: [], error: null });
      const [
        { data: tableUsers, error: usersError },
        { data: profileRows, error: profilesError },
      ] = await Promise.all([
        supabase
          .from("users")
          .select(
            "id, email, full_name, role, registered_school_id, managed_school_name",
          )
          .order("full_name", { ascending: true }),
        profileRequest,
      ]);

      if (usersError && !isMissingTableError(usersError)) throw usersError;
      if (profilesError) {
        if (
          isProfilesTableMissingError(profilesError) ||
          isMissingTableError(profilesError)
        ) {
          markProfilesTableUnavailable();
        } else {
          throw profilesError;
        }
      }

      const mergedAccounts = new Map();
      const upsertPromotionAccount = (row, source) => {
        if (!row) return;
        const email = String(row.email || "")
          .trim()
          .toLowerCase();
        const fallbackId = row.id != null ? String(row.id) : "";
        const accountKey = email || `${source}:${fallbackId}`;
        if (!accountKey) return;

        const current = mergedAccounts.get(accountKey) || {
          accountKey,
          email,
          full_name: "",
          role: "student",
          registered_school_id: null,
          managed_school_name: "",
          profileId: null,
          tableUserId: null,
          hasProfile: false,
          hasTableUser: false,
        };

        mergedAccounts.set(accountKey, {
          ...current,
          email: email || current.email,
          full_name: String(
            row.full_name || current.full_name || row.email || "User",
          ).trim(),
          role:
            normalizeRoleKey(row.role || current.role || "student") ||
            "student",
          registered_school_id:
            row.registered_school_id ?? current.registered_school_id ?? null,
          managed_school_name:
            row.managed_school_name || current.managed_school_name || "",
          profileId:
            source === "profile"
              ? (row.id ?? current.profileId)
              : current.profileId,
          tableUserId:
            source === "user"
              ? (row.id ?? current.tableUserId)
              : current.tableUserId,
          hasProfile: current.hasProfile || source === "profile",
          hasTableUser: current.hasTableUser || source === "user",
        });
      };

      (Array.isArray(tableUsers) ? tableUsers : []).forEach((row) =>
        upsertPromotionAccount(row, "user"),
      );
      (Array.isArray(profileRows) ? profileRows : []).forEach((row) =>
        upsertPromotionAccount(row, "profile"),
      );

      const nextAccounts = Array.from(mergedAccounts.values());
      setPromotionAccounts(nextAccounts);
      setSelectedPromotionAccountKey((current) =>
        current &&
        nextAccounts.some((account) => account.accountKey === current)
          ? current
          : nextAccounts[0]?.accountKey || "",
      );
    } catch (error) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Accounts Not Loaded",
        message: error?.message || "Could not load promotable accounts.",
      });
    } finally {
      setLoadingPromotionAccounts(false);
    }
  }, []);

  useEffect(() => {
    loadPromotionAccounts();
  }, [loadPromotionAccounts]);

  const toggle = (roleKey, permissionKey) => {
    setMatrix((current) => ({
      ...current,
      [roleKey]: {
        ...(current[roleKey] || {}),
        [permissionKey]: !(current[roleKey] || {})[permissionKey],
      },
    }));
  };

  const applyPreset = (roleKey, preset) => {
    const next = {};
    permissionGroups.forEach((group) => {
      group.permissions.forEach((permission) => {
        next[permission.key] =
          preset === "full"
            ? true
            : preset === "none"
              ? false
              : ["students.view", "schools.view", "finance.view"].includes(
                  permission.key,
                );
      });
    });
    setMatrix((current) => ({ ...current, [roleKey]: next }));
  };

  const setGroupPrivileges = (roleKey, permissionKeys, enabled) => {
    setMatrix((current) => ({
      ...current,
      [roleKey]: {
        ...(current[roleKey] || {}),
        ...Object.fromEntries(permissionKeys.map((key) => [key, enabled])),
      },
    }));
  };

  const resetRoleForm = () => {
    setRoleFormMode("create");
    setRoleForm({ key: "", label: "", note: "", color: "#2563eb" });
  };

  const startEditingRole = (role) => {
    if (!role) return;
    setRoleFormMode("edit");
    setRoleForm({
      key: role.key,
      label: role.label || "",
      note: role.note || "",
      color: role.color || "#2563eb",
    });
  };

  const createRole = () => {
    const label = String(roleForm.label || "").trim();
    if (!label) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Role Not Created",
        message: "Role name is required.",
      });
      return;
    }

    const key = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!key) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Role Not Created",
        message: "Use a role name with letters or numbers.",
      });
      return;
    }
    if (roles.some((role) => role.key === key)) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Role Not Created",
        message: "A role with that name already exists.",
      });
      return;
    }

    const newRole = {
      key,
      label,
      note: String(roleForm.note || "").trim() || "Custom role",
      color: roleForm.color || "#2563eb",
    };

    setCustomRoles((current) => [...current, newRole]);
    setMatrix((current) => ({
      ...current,
      [key]: Object.fromEntries(
        permissionGroups.flatMap((group) =>
          group.permissions.map((permission) => [permission.key, false]),
        ),
      ),
    }));
    setSelectedRole(key);
    resetRoleForm();
    setStatusModal({
      open: true,
      type: "success",
      title: "Role Created",
      message: `${label} is ready for privilege assignment.`,
    });
  };

  const updateRole = () => {
    const key = String(roleForm.key || "").trim();
    const label = String(roleForm.label || "").trim();
    if (!key) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Role Not Updated",
        message: "Select a role to edit first.",
      });
      return;
    }
    if (!label) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Role Not Updated",
        message: "Role name is required.",
      });
      return;
    }

    const nextMeta = {
      label,
      note:
        String(roleForm.note || "").trim() ||
        (baseRoleKeys.includes(key) ? "System role" : "Custom role"),
      color: roleForm.color || "#2563eb",
    };

    if (baseRoleKeys.includes(key)) {
      setRoleMetaOverrides((current) => ({ ...current, [key]: nextMeta }));
    } else {
      setCustomRoles((current) =>
        current.map((role) =>
          role.key === key ? { ...role, ...nextMeta } : role,
        ),
      );
    }

    setStatusModal({
      open: true,
      type: "success",
      title: "Role Updated",
      message: `${label} role details were updated.`,
    });
    resetRoleForm();
  };

  const save = async () => {
    const mergedConfig = {
      ...globalCfg,
      roleDefinitions: customRoles,
      roleMetaOverrides,
      rolePrivileges: matrix,
    };
    setSaving(true);
    try {
      if (supabase) {
        const { error } = await supabase
          .from("app_settings")
          .upsert({ id: 1, config: mergedConfig });
        if (error) throw error;
      }
      updateCfg((current) => ({
        ...current,
        roleDefinitions: customRoles,
        roleMetaOverrides,
        rolePrivileges: matrix,
      }));
      setStatusModal({
        open: true,
        type: "success",
        title: "Privileges Updated",
        message: `${selectedRoleMeta.label} privileges were saved to Supabase.`,
      });
    } catch (error) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Save Failed",
        message:
          error?.message || "Could not save role privileges to Supabase.",
      });
    } finally {
      setSaving(false);
    }
  };

  const promoteSelectedAccount = async () => {
    if (!canPromoteAdmins) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Promotion Locked",
        message: "Only super admins can promote global admin accounts.",
      });
      return;
    }
    if (!supabase) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Promotion Unavailable",
        message: "Supabase is required to promote accounts.",
      });
      return;
    }
    if (!selectedPromotionAccount) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "No Account Selected",
        message: "Choose an account to promote first.",
      });
      return;
    }

    const normalizedPromotionRole = normalizeRoleKey(promotionRole);
    if (!normalizedPromotionRole) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "No Role Selected",
        message: "Select an admin role before continuing.",
      });
      return;
    }

    const targetRoleMeta = getRoleMeta(
      {
        roleDefinitions: customRoles,
        roleMetaOverrides,
        rolePrivileges: matrix,
      },
      normalizedPromotionRole,
    );
    const payloads = [
      {
        role: normalizedPromotionRole,
        registered_school_id: null,
        managed_school_name: "",
      },
      { role: normalizedPromotionRole },
    ];
    const updateRoleInTable = async (tableName, matchColumn, matchValue) => {
      if (!matchValue) return false;
      for (const payload of payloads) {
        const response = await supabase
          .from(tableName)
          .update(payload)
          .eq(matchColumn, matchValue)
          .select(matchColumn);
        if (!response.error)
          return Array.isArray(response.data) && response.data.length > 0;
        if (!isMissingColumnError(response.error)) throw response.error;
      }
      return false;
    };

    setPromotingAccount(true);
    try {
      const updatedUsers = selectedPromotionAccount.hasTableUser
        ? await updateRoleInTable(
            "users",
            selectedPromotionAccount.email ? "email" : "id",
            selectedPromotionAccount.email ||
              selectedPromotionAccount.tableUserId,
          )
        : false;

      let updatedProfiles = false;
      if (selectedPromotionAccount.hasProfile && profilesTableAvailable) {
        try {
          updatedProfiles = await updateRoleInTable(
            "profiles",
            selectedPromotionAccount.profileId ? "id" : "email",
            selectedPromotionAccount.profileId ||
              selectedPromotionAccount.email,
          );
        } catch (error) {
          if (
            isProfilesTableMissingError(error) ||
            isMissingTableError(error)
          ) {
            markProfilesTableUnavailable();
          } else {
            throw error;
          }
        }
      }

      if (!updatedUsers && !updatedProfiles) {
        throw new Error(
          "No matching account record was updated. Confirm the user exists in the users or profiles table.",
        );
      }

      setPromotionAccounts((current) =>
        current.map((account) =>
          account.accountKey === selectedPromotionAccount.accountKey
            ? {
                ...account,
                role: normalizedPromotionRole,
                registered_school_id: null,
                managed_school_name: "",
              }
            : account,
        ),
      );

      const storedSession = readAppSession();
      const sameStoredUser =
        storedSession &&
        ((selectedPromotionAccount.email &&
          String(storedSession.user?.email || "")
            .trim()
            .toLowerCase() === selectedPromotionAccount.email) ||
          (selectedPromotionAccount.profileId &&
            String(storedSession.user?.id || "") ===
              String(selectedPromotionAccount.profileId)));
      if (sameStoredUser) {
        const nextUser = {
          ...storedSession.user,
          role: normalizedPromotionRole,
          registered_school_id: null,
          managed_school_name: "",
        };
        writeAppSession({
          ...storedSession,
          portal: resolvePortalFromAccount(nextUser, normalizedPromotionRole),
          user: nextUser,
        });
      }

      await loadPromotionAccounts();
      setStatusModal({
        open: true,
        type: "success",
        title: "Admin Promotion Applied",
        message: `${selectedPromotionAccount.full_name || selectedPromotionAccount.email || "Account"} is now assigned to ${targetRoleMeta.label}.`,
      });
    } catch (error) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Promotion Failed",
        message:
          error?.message || "Could not update the selected account role.",
      });
    } finally {
      setPromotingAccount(false);
    }
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Role Privileges</div>
        <div className="page-sub">
          Assign what each role can view, manage, approve, or control across the
          platform.
        </div>
      </div>
      <ActionStatusModal
        state={statusModal}
        onClose={() => setStatusModal((s) => ({ ...s, open: false }))}
      />
      <div className="role-priv-shell">
        <div className="role-priv-overview">
          <div className="role-priv-stat">
            <div className="role-priv-stat-label">Roles</div>
            <div className="role-priv-stat-value">{roles.length}</div>
            <div className="role-priv-stat-sub">
              System roles available for assignment across the platform.
            </div>
          </div>
          <div className="role-priv-stat">
            <div className="role-priv-stat-label">Selected Role</div>
            <div
              className="role-priv-stat-value"
              style={{ color: selectedRoleMeta.color }}
            >
              {selectedRoleMeta.label}
            </div>
            <div className="role-priv-stat-sub">{selectedRoleMeta.note}</div>
          </div>
          <div className="role-priv-stat">
            <div className="role-priv-stat-label">Coverage</div>
            <div className="role-priv-stat-value">{coverage}%</div>
            <div className="role-priv-stat-sub">
              {enabledCount} of {totalPrivilegeCount} privileges enabled for
              this role.
            </div>
          </div>
        </div>

        <div className="role-priv-layout">
          <aside className="role-priv-sidebar">
            <div className="role-priv-sidebar-head">
              <div className="role-priv-sidebar-title">Roles</div>
              <div className="role-priv-sidebar-sub">
                Select a role, review its access level, then assign the exact
                privileges it should carry.
              </div>
            </div>
            <div className="role-priv-create-card">
              <div className="role-priv-create-head">
                <div>
                  <div className="role-priv-create-title">
                    {roleFormMode === "edit" ? "Edit Role" : "Create New Role"}
                  </div>
                  <div className="role-priv-create-sub">
                    {roleFormMode === "edit"
                      ? "Update the selected role name, note, or accent color. Role keys stay fixed for reliable access mapping."
                      : "Add a custom role, then assign its privileges from this same page."}
                  </div>
                </div>
                <div className="role-priv-create-actions">
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => startEditingRole(selectedRoleMeta)}
                  >
                    Edit Selected
                  </button>
                  {roleFormMode === "edit" && (
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={resetRoleForm}
                    >
                      New Role
                    </button>
                  )}
                </div>
              </div>
              {roleFormMode === "edit" && (
                <div className="role-priv-create-key">
                  Role Key: {roleForm.key}
                </div>
              )}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Role Name</label>
                <input
                  className="form-control"
                  value={roleForm.label}
                  onChange={(e) =>
                    setRoleForm((current) => ({
                      ...current,
                      label: e.target.value,
                    }))
                  }
                  placeholder="e.g. Registrar"
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Role Note</label>
                <input
                  className="form-control"
                  value={roleForm.note}
                  onChange={(e) =>
                    setRoleForm((current) => ({
                      ...current,
                      note: e.target.value,
                    }))
                  }
                  placeholder="What this role is for"
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Accent Color</label>
                <input
                  type="color"
                  className="form-control"
                  value={roleForm.color}
                  onChange={(e) =>
                    setRoleForm((current) => ({
                      ...current,
                      color: e.target.value,
                    }))
                  }
                />
              </div>
              {roleFormMode === "edit" ? (
                <>
                  <div className="role-priv-create-help">
                    Changes to built-in roles update their display details only.
                    Their internal keys remain unchanged so privilege and portal
                    routing stays stable.
                  </div>
                  <button className="btn btn-blue" onClick={updateRole}>
                    Update Role
                  </button>
                </>
              ) : (
                <button className="btn btn-blue" onClick={createRole}>
                  Create Role
                </button>
              )}
            </div>
            <div className="role-priv-role-list">
              {roles.map((role) => {
                const count = Object.values(matrix[role.key] || {}).filter(
                  Boolean,
                ).length;
                const active = selectedRole === role.key;
                const isCustomRole = !baseRoleKeys.includes(role.key);
                return (
                  <button
                    key={role.key}
                    className={`role-priv-role-card ${active ? "active" : ""}`}
                    onClick={() => setSelectedRole(role.key)}
                    style={{
                      borderColor: active ? role.color : "#e2e8f0",
                      background: active ? `${role.color}12` : "#fff",
                    }}
                  >
                    <div className="role-priv-role-head">
                      <div>
                        <div
                          className="role-priv-role-name"
                          style={{ color: role.color }}
                        >
                          {role.label}
                        </div>
                        <div className="role-priv-role-note">{role.note}</div>
                      </div>
                      {active && (
                        <span className="badge badge-blue">Active</span>
                      )}
                    </div>
                    <div className="role-priv-role-count">
                      {count} enabled privileges
                    </div>
                    <div className="role-priv-role-footer">
                      <span
                        className={`role-priv-role-meta ${isCustomRole ? "custom" : "system"}`}
                      >
                        {isCustomRole ? "Custom role" : "System role"}
                      </span>
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          startEditingRole(role);
                        }}
                      >
                        Edit
                      </button>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="role-priv-main">
            <div className="role-priv-toolbar">
              <div className="role-priv-toolbar-copy">
                <div className="role-priv-toolbar-kicker">
                  Privileges Workspace
                </div>
                <div
                  className="role-priv-toolbar-title"
                  style={{ color: selectedRoleMeta.color }}
                >
                  {selectedRoleMeta.label} privileges
                </div>
                <div className="role-priv-toolbar-sub">
                  {selectedRoleMeta.note}. Use presets for a fast baseline, then
                  fine-tune access by privilege group.
                </div>
              </div>
              <div className="role-priv-toolbar-actions">
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => applyPreset(selectedRole, "minimum")}
                >
                  Minimum Access
                </button>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => applyPreset(selectedRole, "full")}
                >
                  Full Access
                </button>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => applyPreset(selectedRole, "none")}
                >
                  Clear All
                </button>
              </div>
            </div>

            <div className="role-priv-content">
              <div className="role-priv-groups">
                {permissionGroups.map((group) => (
                  <div key={group.title} className="role-priv-group-card">
                    <div className="role-priv-group-head">
                      <div>
                        <div className="role-priv-group-title">
                          {group.title}
                        </div>
                        <div className="role-priv-group-sub">{group.sub}</div>
                      </div>
                      <div className="role-priv-group-actions">
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() =>
                            setGroupPrivileges(
                              selectedRole,
                              group.permissions.map(
                                (permission) => permission.key,
                              ),
                              true,
                            )
                          }
                        >
                          Select Group
                        </button>
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() =>
                            setGroupPrivileges(
                              selectedRole,
                              group.permissions.map(
                                (permission) => permission.key,
                              ),
                              false,
                            )
                          }
                        >
                          Clear Group
                        </button>
                      </div>
                    </div>
                    <div className="role-priv-items">
                      {group.permissions.map((permission) => (
                        <div
                          key={permission.key}
                          className={`role-priv-item ${matrix[selectedRole]?.[permission.key] ? "active" : ""}`}
                          onClick={() => toggle(selectedRole, permission.key)}
                          style={{
                            "--role-accent": selectedRoleMeta.color,
                            "--role-soft": `${selectedRoleMeta.color}10`,
                          }}
                        >
                          <div className="role-priv-item-copy">
                            <div className="role-priv-item-title">
                              {permission.label}
                            </div>
                            <div className="role-priv-item-meta">
                              {group.title}
                            </div>
                          </div>
                          <input
                            className="role-priv-item-toggle"
                            type="checkbox"
                            checked={!!matrix[selectedRole]?.[permission.key]}
                            onChange={() =>
                              toggle(selectedRole, permission.key)
                            }
                            onClick={(event) => event.stopPropagation()}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="role-priv-summary-column">
                <div className="role-priv-summary-card">
                  <div className="role-priv-summary-title">
                    Selected Privileges
                  </div>
                  <div className="role-priv-summary-sub">
                    Enabled access currently assigned to{" "}
                    {selectedRoleMeta.label}.
                  </div>
                  <div className="role-priv-chip-list">
                    {selectedPrivilegeLabels.length ? (
                      selectedPrivilegeLabels.map((permission) => (
                        <span key={permission.key} className="role-priv-chip">
                          {permission.label}
                          <span className="role-priv-chip-group">
                            {permission.group}
                          </span>
                        </span>
                      ))
                    ) : (
                      <div className="role-priv-empty">
                        No privileges selected for this role yet.
                      </div>
                    )}
                  </div>
                </div>

                <div className="role-priv-summary-card">
                  <div className="role-priv-summary-title">
                    Privilege Summary
                  </div>
                  <div className="role-priv-summary-sub">
                    Quick overview of how much access each role currently has.
                  </div>
                  <div className="role-priv-summary-list">
                    {roles.map((role) => (
                      <div key={role.key} className="role-priv-summary-row">
                        <span
                          className="role-priv-summary-name"
                          style={{ color: role.color }}
                        >
                          {role.label}
                        </span>
                        <span className="role-priv-summary-count">
                          {
                            Object.values(matrix[role.key] || {}).filter(
                              Boolean,
                            ).length
                          }{" "}
                          enabled
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="role-priv-save-card">
                  <div className="role-priv-save-title">Save Changes</div>
                  <div className="role-priv-save-sub">
                    Commit the current privilege selections so this role keeps
                    the updated access pattern across the platform.
                  </div>
                  <button
                    className="btn btn-blue"
                    onClick={save}
                    disabled={saving}
                  >
                    {saving ? "Saving..." : "Save Role Privileges"}
                  </button>
                </div>

                <div className="role-priv-promo-card">
                  <div className="role-priv-promo-head">
                    <div>
                      <div className="role-priv-promo-title">
                        Admin Promotion
                      </div>
                      <div className="role-priv-promo-sub">
                        Promote an existing account into a global admin role
                        from this page. Promotion clears any school scope so the
                        account lands in the main admin portal on its next
                        session refresh.
                      </div>
                    </div>
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={loadPromotionAccounts}
                      disabled={loadingPromotionAccounts}
                    >
                      {loadingPromotionAccounts
                        ? "Refreshing..."
                        : "Refresh Accounts"}
                    </button>
                  </div>
                  {!canPromoteAdmins && (
                    <div className="role-priv-promo-note">
                      Only admin-level accounts can apply global admin
                      promotions.
                    </div>
                  )}
                  {!supabase && (
                    <div className="role-priv-promo-note">
                      Supabase must be connected before account promotion can be
                      used.
                    </div>
                  )}
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Find Account</label>
                    <input
                      className="form-control"
                      value={promotionSearch}
                      onChange={(event) =>
                        setPromotionSearch(event.target.value)
                      }
                      placeholder="Search by name, email, or current role"
                      disabled={!canPromoteAdmins || !supabase}
                    />
                  </div>
                  <div className="role-priv-promo-list">
                    {filteredPromotionAccounts.length ? (
                      filteredPromotionAccounts.slice(0, 8).map((account) => {
                        const accountRoleMeta = getRoleMeta(
                          {
                            roleDefinitions: customRoles,
                            roleMetaOverrides,
                            rolePrivileges: matrix,
                          },
                          account.role,
                        );
                        const active =
                          selectedPromotionAccountKey === account.accountKey;
                        return (
                          <button
                            key={account.accountKey}
                            className={`role-priv-promo-item ${active ? "active" : ""}`}
                            onClick={() =>
                              setSelectedPromotionAccountKey(account.accountKey)
                            }
                            disabled={!canPromoteAdmins || !supabase}
                          >
                            <div className="role-priv-promo-item-head">
                              <div>
                                <div className="role-priv-promo-item-name">
                                  {account.full_name || "Unnamed User"}
                                </div>
                                <div className="role-priv-promo-item-email">
                                  {account.email || "No email recorded"}
                                </div>
                              </div>
                              <span
                                className="role-priv-promo-badge"
                                style={{
                                  color: accountRoleMeta.color,
                                  borderColor: `${accountRoleMeta.color}55`,
                                }}
                              >
                                {accountRoleMeta.label}
                              </span>
                            </div>
                            <div className="role-priv-promo-item-meta">
                              {account.hasProfile && (
                                <span className="role-priv-promo-badge">
                                  Profiles
                                </span>
                              )}
                              {account.hasTableUser && (
                                <span className="role-priv-promo-badge">
                                  Users
                                </span>
                              )}
                              {(account.registered_school_id != null ||
                                account.managed_school_name) && (
                                <span className="role-priv-promo-badge">
                                  School scoped
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="role-priv-empty">
                        {loadingPromotionAccounts
                          ? "Loading accounts..."
                          : "No matching accounts found."}
                      </div>
                    )}
                  </div>
                  {selectedPromotionAccount && (
                    <div className="role-priv-promo-selected">
                      <div className="role-priv-promo-selected-head">
                        <div>
                          <div className="role-priv-promo-selected-name">
                            {selectedPromotionAccount.full_name ||
                              "Unnamed User"}
                          </div>
                          <div className="role-priv-promo-selected-meta">
                            {selectedPromotionAccount.email ||
                              "No email recorded"}
                          </div>
                        </div>
                        <div className="role-priv-promo-badges">
                          <span className="role-priv-promo-badge">
                            Current role:{" "}
                            {
                              getRoleMeta(
                                {
                                  roleDefinitions: customRoles,
                                  roleMetaOverrides,
                                  rolePrivileges: matrix,
                                },
                                selectedPromotionAccount.role,
                              ).label
                            }
                          </span>
                        </div>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Promote To</label>
                        <select
                          className="form-control"
                          value={promotionRole}
                          onChange={(event) =>
                            setPromotionRole(event.target.value)
                          }
                          disabled={
                            !canPromoteAdmins ||
                            !supabase ||
                            !adminPromotionRoles.length
                          }
                        >
                          {adminPromotionRoles.map((role) => (
                            <option key={role.key} value={role.key}>
                              {role.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="role-priv-promo-note">
                        Admins can assign admin-capable roles here. Only super
                        admins can assign the Super Admin role.
                      </div>
                      <button
                        className="btn btn-blue"
                        onClick={promoteSelectedAccount}
                        disabled={
                          !canPromoteAdmins ||
                          !supabase ||
                          !selectedPromotionAccount ||
                          !promotionRole ||
                          promotingAccount
                        }
                      >
                        {promotingAccount
                          ? "Applying Promotion..."
                          : "Apply Promotion"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AuditTrailPage() {
  const [logs, setLogs] = useState([
    {
      id: 1,
      actor: "Admin",
      action: "Updated settings",
      target: "System",
      at: new Date().toISOString(),
    },
    {
      id: 2,
      actor: "Admissions",
      action: "Approved selection",
      target: "Student #2024001",
      at: new Date(Date.now() - 3600000).toISOString(),
    },
  ]);
  const [filter, setFilter] = useState("");
  const rows = logs.filter((l) =>
    [l.actor, l.action, l.target]
      .join(" ")
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Audit Trail</div>
        <div className="page-sub">
          Feature 2: Immutable log of critical actions.
        </div>
      </div>
      <input
        className="form-control search-input-compact"
        placeholder="Filter logs..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id}>
                <td>{new Date(l.at).toLocaleString()}</td>
                <td>{l.actor}</td>
                <td>{l.action}</td>
                <td>{l.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NotificationCenterPage() {
  const [template, setTemplate] = useState({
    title: "",
    body: "",
    channel: "in-app",
  });
  const [history, setHistory] = useState([]);
  const [statusModal, setStatusModal] = useState({
    open: false,
    type: "success",
    title: "",
    message: "",
  });
  const send = () => {
    if (!template.title || !template.body) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Message Not Sent",
        message: "Title and message body are required.",
      });
      return;
    }
    setHistory((h) => [
      { id: Date.now(), ...template, at: new Date().toISOString() },
      ...h,
    ]);
    setTemplate({ title: "", body: "", channel: "in-app" });
    setStatusModal({
      open: true,
      type: "success",
      title: "Notification Sent",
      message: "Message dispatched successfully.",
    });
  };
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Notification Center</div>
        <div className="page-sub">
          Feature 3: In-app/email/SMS notifications with templates.
        </div>
      </div>
      <ActionStatusModal
        state={statusModal}
        onClose={() => setStatusModal((s) => ({ ...s, open: false }))}
      />
      <div className="card card-padded" style={{ marginBottom: 12 }}>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Title</label>
            <input
              className="form-control"
              value={template.title}
              onChange={(e) =>
                setTemplate((t) => ({ ...t, title: e.target.value }))
              }
            />
          </div>
          <div className="form-group">
            <label className="form-label">Channel</label>
            <select
              className="form-control"
              value={template.channel}
              onChange={(e) =>
                setTemplate((t) => ({ ...t, channel: e.target.value }))
              }
            >
              <option value="in-app">In-app</option>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
            </select>
          </div>
          <div className="form-group" style={{ gridColumn: "1 / -1" }}>
            <label className="form-label">Message</label>
            <textarea
              className="form-control"
              rows={3}
              value={template.body}
              onChange={(e) =>
                setTemplate((t) => ({ ...t, body: e.target.value }))
              }
            />
          </div>
        </div>
        <button
          className="btn btn-blue"
          style={{ marginTop: 10 }}
          onClick={send}
        >
          Send Notification
        </button>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Channel</th>
              <th>Title</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id}>
                <td>{new Date(h.at).toLocaleString()}</td>
                <td>{h.channel}</td>
                <td>{h.title}</td>
                <td>{h.body}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PaymentsReceiptsPage() {
  const [form, setForm] = useState({
    payer: "",
    amount: "",
    method: "mobile-money",
  });
  const [receipts, setReceipts] = useState([]);
  const add = () => {
    if (!form.payer || !form.amount) return;
    const receiptNo = `RCPT-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    setReceipts((r) => [
      { id: Date.now(), receiptNo, ...form, at: new Date().toISOString() },
      ...r,
    ]);
    setForm({ payer: "", amount: "", method: "mobile-money" });
  };
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Payments & Receipts</div>
        <div className="page-sub">
          Feature 5: Record payments and generate receipts.
        </div>
      </div>
      <div className="card card-padded" style={{ marginBottom: 12 }}>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Payer</label>
            <input
              className="form-control"
              value={form.payer}
              onChange={(e) =>
                setForm((f) => ({ ...f, payer: e.target.value }))
              }
            />
          </div>
          <div className="form-group">
            <label className="form-label">Amount (GHS)</label>
            <input
              className="form-control"
              type="number"
              value={form.amount}
              onChange={(e) =>
                setForm((f) => ({ ...f, amount: e.target.value }))
              }
            />
          </div>
          <div className="form-group">
            <label className="form-label">Method</label>
            <select
              className="form-control"
              value={form.method}
              onChange={(e) =>
                setForm((f) => ({ ...f, method: e.target.value }))
              }
            >
              <option value="mobile-money">Mobile Money</option>
              <option value="card">Card</option>
              <option value="cash">Cash</option>
            </select>
          </div>
        </div>
        <button
          className="btn btn-blue"
          style={{ marginTop: 10 }}
          onClick={add}
        >
          Create Receipt
        </button>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Receipt</th>
              <th>Payer</th>
              <th>Amount</th>
              <th>Method</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {receipts.map((r) => (
              <tr key={r.id}>
                <td>{r.receiptNo}</td>
                <td>{r.payer}</td>
                <td>GHS {r.amount}</td>
                <td>{r.method}</td>
                <td>{new Date(r.at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DocumentWorkflowPage() {
  const [docs, setDocs] = useState([
    {
      id: 1,
      student: "Kwame Asante",
      type: "Birth Certificate",
      status: "pending",
    },
  ]);
  const update = (id, status) =>
    setDocs((d) => d.map((x) => (x.id === id ? { ...x, status } : x)));
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Document Workflow</div>
        <div className="page-sub">
          Feature 6: Verify and track student documents.
        </div>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Document</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td>{d.student}</td>
                <td>{d.type}</td>
                <td>
                  <span
                    className={`badge ${d.status === "approved" ? "badge-success" : d.status === "rejected" ? "badge-danger" : "badge-warning"}`}
                  >
                    {d.status}
                  </span>
                </td>
                <td>
                  <button
                    className="btn btn-sm btn-green"
                    onClick={() => update(d.id, "approved")}
                  >
                    Approve
                  </button>{" "}
                  <button
                    className="btn btn-sm btn-red"
                    onClick={() => update(d.id, "rejected")}
                  >
                    Reject
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReportsExportsPage() {
  const [statusModal, setStatusModal] = useState({
    open: false,
    type: "success",
    title: "",
    message: "",
  });
  const trigger = (type) =>
    setStatusModal({
      open: true,
      type: "success",
      title: `${type} Report Ready`,
      message: `Feature 7: ${type} export generated.`,
    });
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Reports & Exports</div>
        <div className="page-sub">
          Feature 7: Generate CSV/PDF report packs.
        </div>
      </div>
      <ActionStatusModal
        state={statusModal}
        onClose={() => setStatusModal((s) => ({ ...s, open: false }))}
      />
      <div className="grid3">
        {["Admissions", "Attendance", "Finance", "Results"].map((name) => (
          <div key={name} className="card card-padded">
            <div style={{ fontWeight: 700, marginBottom: 10 }}>
              {name} Report
            </div>
            <button
              className="btn btn-blue btn-sm"
              onClick={() => trigger(name)}
            >
              Export CSV
            </button>{" "}
            <button
              className="btn btn-outline btn-sm"
              onClick={() => trigger(name)}
            >
              Export PDF
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdvancedAnalyticsPage() {
  const cards = [
    { label: "Enrollment Trend", value: "+12%", color: "#16a34a" },
    { label: "Attendance Risk", value: "8%", color: "#d97706" },
    { label: "Fee Default Risk", value: "11%", color: "#dc2626" },
    { label: "Mock Placement Success", value: "84%", color: "#1e40af" },
  ];
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Advanced Analytics</div>
        <div className="page-sub">Feature 8: Trends, risks and forecasts.</div>
      </div>
      <div className="stats-grid">
        {cards.map((c) => (
          <div key={c.label} className="stat-card">
            <div className="stat-label">{c.label}</div>
            <div className="stat-value" style={{ color: c.color }}>
              {c.value}
            </div>
            <div className="stat-sub">Updated just now</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BulkOperationsPage() {
  const [rows, setRows] = useState("");
  const [statusModal, setStatusModal] = useState({
    open: false,
    type: "success",
    title: "",
    message: "",
  });
  const run = (action) => {
    const count = rows
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean).length;
    setStatusModal({
      open: true,
      type: count ? "success" : "failure",
      title: count ? "Bulk Operation Complete" : "No Rows Provided",
      message: count
        ? `${action} executed for ${count} rows.`
        : "Paste one record per line to continue.",
    });
  };
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Bulk Operations</div>
        <div className="page-sub">Feature 9: Bulk import/update actions.</div>
      </div>
      <ActionStatusModal
        state={statusModal}
        onClose={() => setStatusModal((s) => ({ ...s, open: false }))}
      />
      <div className="card card-padded">
        <label className="form-label">Paste rows (one per line)</label>
        <textarea
          className="form-control"
          rows={8}
          value={rows}
          onChange={(e) => setRows(e.target.value)}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button className="btn btn-blue" onClick={() => run("Import")}>
            Bulk Import
          </button>
          <button className="btn btn-outline" onClick={() => run("Update")}>
            Bulk Update
          </button>
        </div>
      </div>
    </div>
  );
}

function OfflineSyncPage() {
  const [online, setOnline] = useState(globalThis.navigator?.onLine ?? true);
  const [queue, setQueue] = useState([
    { id: 1, item: "Attendance sync", status: "queued" },
  ]);
  const isMobile = useIsMobileLayout();
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  const retry = () =>
    setQueue((q) =>
      q.map((x) => ({ ...x, status: online ? "synced" : "queued" })),
    );
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Offline Sync</div>
        <div className="page-sub">
          Feature 10: Offline queue and sync recovery.
        </div>
      </div>
      <div className="alert alert-info">
        Network: <strong>{online ? "Online" : "Offline"}</strong>
      </div>
      {isMobile ? (
        <div className="mobile-record-list">
          {queue.map((q) => (
            <div key={q.id} className="mobile-record-card">
              <div className="mobile-record-head">
                <div>
                  <div className="mobile-record-title">{q.item}</div>
                </div>
                <span
                  className={`badge ${q.status === "synced" ? "badge-success" : "badge-warning"}`}
                >
                  {q.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Queue Item</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((q) => (
                <tr key={q.id}>
                  <td>{q.item}</td>
                  <td>{q.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button
        className="btn btn-blue"
        style={{ marginTop: 10 }}
        onClick={retry}
      >
        Retry Sync
      </button>
    </div>
  );
}

function AcademicCalendarPage() {
  const [items, setItems] = useState([
    { id: 1, title: "Midterm Exams", date: "2026-05-10", type: "exam" },
  ]);
  const [form, setForm] = useState({ title: "", date: "", type: "event" });
  const isMobile = useIsMobileLayout();
  const add = () => {
    if (!form.title || !form.date) return;
    setItems((i) => [{ id: Date.now(), ...form }, ...i]);
    setForm({ title: "", date: "", type: "event" });
  };
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Academic Calendar</div>
        <div className="page-sub">
          Feature 11: Term calendar and key academic milestones.
        </div>
      </div>
      <div className="card card-padded" style={{ marginBottom: 12 }}>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Title</label>
            <input
              className="form-control"
              value={form.title}
              onChange={(e) =>
                setForm((f) => ({ ...f, title: e.target.value }))
              }
            />
          </div>
          <div className="form-group">
            <label className="form-label">Date</label>
            <input
              type="date"
              className="form-control"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Type</label>
            <select
              className="form-control"
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
            >
              <option value="event">Event</option>
              <option value="exam">Exam</option>
              <option value="deadline">Deadline</option>
            </select>
          </div>
        </div>
        <button
          className="btn btn-blue"
          style={{ marginTop: 10 }}
          onClick={add}
        >
          Add Calendar Item
        </button>
      </div>
      {isMobile ? (
        <div className="mobile-record-list">
          {items.map((i) => (
            <div key={i.id} className="mobile-record-card">
              <div className="mobile-record-head">
                <div>
                  <div className="mobile-record-title">{i.title}</div>
                  <div className="mobile-record-sub">{i.date}</div>
                </div>
                <span className="badge badge-blue">{i.type}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Title</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>{i.date}</td>
                  <td>{i.title}</td>
                  <td>{i.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function HelpdeskPage() {
  const [tickets, setTickets] = useState([]);
  const [responseDrafts, setResponseDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingTicketKey, setSavingTicketKey] = useState("");
  const isMobile = useIsMobileLayout();
  const { notify } = useContext(NotificationContext) || {};
  const loadTickets = useCallback(async () => {
    if (!supabase) {
      setError("Supabase is not configured; saved support tickets are unavailable.");
      setTickets([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    const { data, error: loadError } = await supabase
      .from("student_portal_records")
      .select("student_id, record_key, payload, created_at, updated_at")
      .eq("record_type", "support_ticket")
      .order("created_at", { ascending: false });
    if (loadError) {
      setTickets([]);
      setError(`Could not load student support tickets: ${loadError.message}`);
      setLoading(false);
      return;
    }

    const studentIds = [...new Set((data || []).map((row) => row.student_id))];
    let studentsById = new Map();
    if (studentIds.length) {
      const { data: students, error: studentsError } = await supabase
        .from("students")
        .select("id, full_name, index_number, index, class, region, district")
        .in("id", studentIds);
      if (studentsError) {
        setError(`Tickets loaded, but student details could not be loaded: ${studentsError.message}`);
      } else {
        studentsById = new Map((students || []).map((student) => [student.id, student]));
      }
    }
    setTickets((data || []).map((row) => {
      const student = studentsById.get(row.student_id);
      return {
        ...(row.payload || {}),
        payload: row.payload || {},
        id: `${row.student_id}:${row.record_key}`,
        student_id: row.student_id,
        record_key: row.record_key,
        created_at: row.created_at,
        status: row.payload?.status || "open",
        student,
      };
    }));
    setLoading(false);
  }, []);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  const updateTicket = async (ticket, { response = "", status = ticket.status } = {}) => {
    const trimmedResponse = response.trim();
    if (!supabase || (status === ticket.status && !trimmedResponse)) return;
    setSavingTicketKey(ticket.id);
    setError("");
    const { error: updateError } = await supabase.rpc(
      "respond_to_student_support_ticket",
      {
        p_student_id: ticket.student_id,
        p_record_key: ticket.record_key,
        p_response: trimmedResponse || null,
        p_status: status,
      },
    );
    if (updateError) {
      setError(`Could not send the ticket update: ${updateError.message}`);
    } else {
      setTickets((current) =>
        current.map((item) => item.id === ticket.id
          ? {
              ...item,
              status,
              admin_response: trimmedResponse || item.admin_response,
              responded_at: trimmedResponse ? new Date().toISOString() : item.responded_at,
              payload: {
                ...item.payload,
                status,
                ...(trimmedResponse
                  ? { admin_response: trimmedResponse, responded_at: new Date().toISOString() }
                  : {}),
              },
            }
          : item),
      );
      setResponseDrafts((current) => ({ ...current, [ticket.id]: "" }));
      notify?.(
        trimmedResponse ? "Response sent to the student." : "Ticket status updated and the student was notified.",
        "success",
      );
    }
    setSavingTicketKey("");
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Student Support Tickets</div>
        <div className="page-sub">
          Review and manage support requests submitted from student accounts.
        </div>
      </div>
      {error && <div className="alert alert-warning" role="alert">{error}</div>}
      <div className="card card-padded" style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <span>{tickets.length} saved ticket{tickets.length === 1 ? "" : "s"}</span>
        <button className="btn btn-outline" type="button" onClick={loadTickets} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>
      {isMobile ? (
        <div className="mobile-record-list">
          {loading && <div className="mobile-record-card">Loading support tickets...</div>}
          {tickets.map((t) => (
            <div key={t.id} className="mobile-record-card">
              <div className="mobile-record-head">
                <div>
                  <div className="mobile-record-title">{t.subject || "No subject"}</div>
                  <div className="mobile-record-sub">
                    {t.student?.full_name || `Student record ${t.student_id}`}
                    {t.student?.index_number || t.student?.index ? `   ${t.student.index_number || t.student.index}` : ""}
                  </div>
                </div>
              </div>
              <div className="mobile-record-item">
                <label>Submitted</label>
                <span>{t.submitted_at ? new Date(t.submitted_at).toLocaleString() : new Date(t.created_at).toLocaleString()}</span>
              </div>
              <div className="mobile-record-item"><label>Message</label><span>{t.message || "-"}</span></div>
              {t.admin_response && <div className="mobile-record-item"><label>Last response</label><span>{t.admin_response}</span></div>}
              <label className="form-label" htmlFor={`ticket-response-${t.id}`}>Response to student</label>
              <textarea id={`ticket-response-${t.id}`} className="form-control" rows={3} maxLength={5000} value={responseDrafts[t.id] || ""} onChange={(event) => setResponseDrafts((current) => ({ ...current, [t.id]: event.target.value }))} placeholder="Write a response for the student" />
              <label className="form-label" htmlFor={`ticket-status-${t.id}`}>Status</label>
              <select id={`ticket-status-${t.id}`} className="form-control" value={t.status} disabled={savingTicketKey === t.id} onChange={(event) => updateTicket(t, { status: event.target.value })}>
                <option value="open">Open</option>
                <option value="in_progress">In progress</option>
                <option value="resolved">Resolved</option>
              </select>
              <button className="btn btn-blue" type="button" disabled={savingTicketKey === t.id || !(responseDrafts[t.id] || "").trim()} onClick={() => updateTicket(t, { response: responseDrafts[t.id] || "" })}>
                {savingTicketKey === t.id ? "Sending..." : "Send response"}
              </button>
            </div>
          ))}
          {!loading && !tickets.length && <div className="mobile-record-card">No student support tickets have been submitted.</div>}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Subject</th>
                <th>Student</th>
                <th>Message / Response</th>
                <th>Submitted</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan="5">Loading support tickets...</td></tr>}
              {tickets.map((t) => (
                <tr key={t.id}>
                  <td><strong>{t.subject || "No subject"}</strong></td>
                  <td>
                    {t.student?.full_name || "Student details unavailable"}
                    <div className="students-table-sub">
                      ID: {t.student?.index_number || t.student?.index || t.student_id}
                      {t.student?.class ? `   ${t.student.class}` : ""}
                    </div>
                  </td>
                  <td style={{ maxWidth: 360 }}>
                    <div style={{ whiteSpace: "pre-wrap" }}>{t.message || " "}</div>
                    {t.admin_response && <div style={{ whiteSpace: "pre-wrap", marginTop: 8, paddingTop: 8, borderTop: "1px solid #e2e8f0" }}><strong>Last response:</strong> {t.admin_response}</div>}
                    <textarea className="form-control" rows={2} maxLength={5000} aria-label={`Response to ${t.subject || "support ticket"}`} value={responseDrafts[t.id] || ""} onChange={(event) => setResponseDrafts((current) => ({ ...current, [t.id]: event.target.value }))} placeholder="Write a response for the student" style={{ marginTop: 8 }} />
                    <button className="btn btn-blue btn-sm" type="button" disabled={savingTicketKey === t.id || !(responseDrafts[t.id] || "").trim()} onClick={() => updateTicket(t, { response: responseDrafts[t.id] || "" })} style={{ marginTop: 6 }}>
                      {savingTicketKey === t.id ? "Sending..." : "Send response"}
                    </button>
                  </td>
                  <td>{t.submitted_at ? new Date(t.submitted_at).toLocaleString() : new Date(t.created_at).toLocaleString()}</td>
                  <td>
                    <select className="form-control" aria-label={`Status for ${t.subject || "support ticket"}`} value={t.status} disabled={savingTicketKey === t.id} onChange={(event) => updateTicket(t, { status: event.target.value })}>
                      <option value="open">Open</option>
                      <option value="in_progress">In progress</option>
                      <option value="resolved">Resolved</option>
                    </select>
                  </td>
                </tr>
              ))}
              {!loading && !tickets.length && <tr><td colSpan="5" style={{ textAlign: "center", padding: 18 }}>No student support tickets have been submitted.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PrivacyCompliancePage() {
  const [cfg, setCfg] = useState({
    consentRequired: true,
    dataExportEnabled: true,
    rightToDeleteEnabled: true,
  });
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Privacy & Compliance</div>
        <div className="page-sub">
          Feature 13: Consent, retention and data rights controls.
        </div>
      </div>
      <div className="card card-padded">
        {[
          ["consentRequired", "Require consent capture"],
          ["dataExportEnabled", "Allow data export requests"],
          ["rightToDeleteEnabled", "Allow right-to-delete requests"],
        ].map(([k, l]) => (
          <div key={k} className="toggle-row">
            <span>{l}</span>
            <input
              type="checkbox"
              checked={!!cfg[k]}
              onChange={() => setCfg((c) => ({ ...c, [k]: !c[k] }))}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function DisasterRecoveryPage() {
  const [points, setPoints] = useState([
    {
      id: 1,
      name: "Nightly Backup",
      at: new Date().toISOString(),
      status: "verified",
    },
  ]);
  const isMobile = useIsMobileLayout();
  const createPoint = () =>
    setPoints((p) => [
      {
        id: Date.now(),
        name: "Manual Restore Point",
        at: new Date().toISOString(),
        status: "pending",
      },
      ...p,
    ]);
  const verify = (id) =>
    setPoints((p) =>
      p.map((x) => (x.id === id ? { ...x, status: "verified" } : x)),
    );
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Disaster Recovery</div>
        <div className="page-sub">
          Feature 14: Restore points and recovery validation.
        </div>
      </div>
      <button
        className="btn btn-blue"
        style={{ marginBottom: 10 }}
        onClick={createPoint}
      >
        Create Restore Point
      </button>
      {isMobile ? (
        <div className="mobile-record-list">
          {points.map((p) => (
            <div key={p.id} className="mobile-record-card">
              <div className="mobile-record-head">
                <div>
                  <div className="mobile-record-title">{p.name}</div>
                  <div className="mobile-record-sub">
                    {new Date(p.at).toLocaleString()}
                  </div>
                </div>
                <span
                  className={`badge ${p.status === "verified" ? "badge-success" : "badge-warning"}`}
                >
                  {p.status}
                </span>
              </div>
              <div className="mobile-record-actions">
                <button
                  className="btn btn-sm btn-outline"
                  onClick={() => verify(p.id)}
                >
                  Test Restore
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Created</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{new Date(p.at).toLocaleString()}</td>
                  <td>{p.status}</td>
                  <td>
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={() => verify(p.id)}
                    >
                      Test Restore
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MobilePwaPage() {
  const [cfg, setCfg] = useState({
    pushEnabled: true,
    biometricPreferred: false,
    compactMode: true,
  });
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Mobile & PWA</div>
        <div className="page-sub">
          Feature 15: Mobile optimization and installable app controls.
        </div>
      </div>
      <div className="card card-padded">
        <div style={{ marginBottom: 10, color: "#475569" }}>
          Install status:{" "}
          {window.matchMedia &&
          window.matchMedia("(display-mode: standalone)").matches
            ? "Installed"
            : "Browser mode"}
        </div>
        {[
          ["pushEnabled", "Enable push notifications"],
          ["biometricPreferred", "Prefer biometric unlock"],
          ["compactMode", "Compact mobile layout"],
        ].map(([k, l]) => (
          <div key={k} className="toggle-row">
            <span>{l}</span>
            <input
              type="checkbox"
              checked={!!cfg[k]}
              onChange={() => setCfg((c) => ({ ...c, [k]: !c[k] }))}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

//   CHAT
function ChatPage({ chatUsers, onChatUsersChange }) {
  const [selectedUserId, setSelectedUserId] = useState(1);
  const [msgs, setMsgs] = useState([
    {
      id: 1,
      text: "Hello! How can I help you today?",
      mine: false,
      time: "10:00",
    },
    {
      id: 2,
      text: "I have a question about school selection",
      mine: true,
      time: "10:01",
    },
    {
      id: 3,
      text: "Sure! You can select up to 6 schools before May 15.",
      mine: false,
      time: "10:02",
    },
  ]);
  const [input, setInput] = useState("");
  const userEmail = getSessionUserEmail();
  const selectedUser = chatUsers.find((u) => u.id === selectedUserId);

  const refreshUnreadCounts = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("chat_messages")
      .select("peer_id, is_read, mine")
      .eq("user_email", userEmail)
      .eq("mine", false);

    if (error) {
      if (isMissingColumnError(error)) {
        onChatUsersChange((users) => users.map((u) => ({ ...u, unread: 0 })));
      }
      return;
    }

    const unreadByPeer = new Map();
    (data || []).forEach((row) => {
      if (!row?.is_read) {
        const key = Number(row.peer_id);
        unreadByPeer.set(key, (unreadByPeer.get(key) || 0) + 1);
      }
    });

    onChatUsersChange((users) =>
      users.map((u) => ({ ...u, unread: unreadByPeer.get(u.id) || 0 })),
    );
  }, [onChatUsersChange, userEmail]);

  const markConversationRead = useCallback(
    async (peerId) => {
      if (!supabase) return;
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("chat_messages")
        .update({ is_read: true, read_at: nowIso })
        .eq("user_email", userEmail)
        .eq("peer_id", peerId)
        .eq("mine", false)
        .eq("is_read", false);

      if (error && !isMissingColumnError(error)) {
        await supabase
          .from("chat_messages")
          .update({ is_read: true })
          .eq("user_email", userEmail)
          .eq("peer_id", peerId)
          .eq("mine", false);
      }
    },
    [userEmail],
  );

  useEffect(() => {
    const loadMessages = async () => {
      if (!supabase) return;
      let data = null;
      let error = null;
      ({ data, error } = await supabase
        .from("chat_messages")
        .select("id, text, mine, time, peer_id, is_read")
        .eq("user_email", userEmail)
        .eq("peer_id", selectedUserId)
        .order("id", { ascending: true }));

      if (error && isMissingColumnError(error)) {
        ({ data } = await supabase
          .from("chat_messages")
          .select("id, text, mine, time, peer_id")
          .eq("user_email", userEmail)
          .eq("peer_id", selectedUserId)
          .order("id", { ascending: true }));
      }

      if (Array.isArray(data) && data.length > 0) {
        setMsgs(
          data.map((m) => ({
            id: m.id,
            text: m.text,
            mine: !!m.mine,
            time: m.time || "",
          })),
        );
      }

      await markConversationRead(selectedUserId);
      await refreshUnreadCounts();
    };
    loadMessages();
  }, [markConversationRead, refreshUnreadCounts, selectedUserId, userEmail]);

  useEffect(() => {
    refreshUnreadCounts();
  }, [refreshUnreadCounts]);

  const handleSelectUser = async (userId) => {
    setSelectedUserId(userId);
    onChatUsersChange((u) =>
      u.map((user) => (user.id === userId ? { ...user, unread: 0 } : user)),
    );
    await markConversationRead(userId);
    await refreshUnreadCounts();
  };

  const send = async () => {
    if (!input.trim()) return;
    const t = new Date().toTimeString().slice(0, 5);
    const newMsg = { id: Date.now(), text: input, mine: true, time: t };
    setMsgs((m) => [...m, newMsg]);
    if (supabase) {
      const { error } = await supabase.from("chat_messages").insert({
        user_email: userEmail,
        peer_id: selectedUserId,
        text: newMsg.text,
        mine: true,
        time: t,
        is_read: true,
        read_at: new Date().toISOString(),
      });
      if (error && isMissingColumnError(error)) {
        await supabase.from("chat_messages").insert({
          user_email: userEmail,
          peer_id: selectedUserId,
          text: newMsg.text,
          mine: true,
          time: t,
        });
      }
    }
    setInput("");
    setTimeout(async () => {
      const reply = {
        id: Date.now() + 1,
        text: "Thanks for your message! I'll get back to you shortly.",
        mine: false,
        time: t,
      };
      setMsgs((m) => [...m, reply]);
      if (supabase) {
        const { error } = await supabase.from("chat_messages").insert({
          user_email: userEmail,
          peer_id: selectedUserId,
          text: reply.text,
          mine: false,
          time: t,
          is_read: false,
        });
        if (error && isMissingColumnError(error)) {
          await supabase.from("chat_messages").insert({
            user_email: userEmail,
            peer_id: selectedUserId,
            text: reply.text,
            mine: false,
            time: t,
          });
        }
      }
      await refreshUnreadCounts();
    }, 1000);
  };

  return (
    <div className="fade-in messages-page">
      <div className="page-header" style={{ flexShrink: 0 }}>
        <div className="page-title">Messages</div>
      </div>
      <div className="messages-layout">
        <div
          style={{
            background: "#fff",
            borderRight: "1px solid #e2e8f0",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: 16,
              borderBottom: "1px solid #e2e8f0",
              flexShrink: 0,
            }}
          >
            <div
              style={{ fontSize: ".875rem", fontWeight: 700, color: "#64748b" }}
            >
              CONVERSATIONS
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {chatUsers.map((u) => (
              <button
                key={u.id}
                onClick={() => handleSelectUser(u.id)}
                style={{
                  width: "100%",
                  padding: 12,
                  border: "none",
                  cursor: "pointer",
                  borderBottom: "1px solid #f1f5f9",
                  textAlign: "left",
                  transition: "background .15s",
                  background:
                    selectedUserId === u.id ? "#f0f9ff" : "transparent",
                  ":hover": { background: "#f9fafb" },
                }}
                onMouseEnter={(e) =>
                  (e.target.style.background =
                    selectedUserId !== u.id ? "#f9fafb" : "#f0f9ff")
                }
                onMouseLeave={(e) =>
                  (e.target.style.background =
                    selectedUserId === u.id ? "#f0f9ff" : "transparent")
                }
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div
                    style={{
                      position: "relative",
                      width: 40,
                      height: 40,
                      borderRadius: 50,
                      background: "#dbeafe",
                      color: "#1e40af",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      fontSize: ".95rem",
                      flexShrink: 0,
                    }}
                  >
                    {u.avatar}
                    {u.status === "active" && (
                      <div
                        style={{
                          position: "absolute",
                          bottom: 0,
                          right: 0,
                          width: 10,
                          height: 10,
                          borderRadius: 50,
                          background: "#10b981",
                          border: "2px solid #fff",
                        }}
                      />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: ".9rem",
                        color: "#0f172a",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {u.name}
                    </div>
                    <div style={{ fontSize: ".75rem", color: "#94a3b8" }}>
                      {u.status}
                    </div>
                  </div>
                  {u.unread > 0 && (
                    <div
                      style={{
                        background: "#ef4444",
                        color: "#fff",
                        fontWeight: 700,
                        fontSize: ".65rem",
                        width: 20,
                        height: 20,
                        borderRadius: 50,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      {u.unread}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            background: "#f8fafc",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: 16,
              borderBottom: "1px solid #e2e8f0",
              background: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  position: "relative",
                  width: 40,
                  height: 40,
                  borderRadius: 50,
                  background: "#dbeafe",
                  color: "#1e40af",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                }}
              >
                {selectedUser?.avatar}
                {selectedUser?.status === "active" && (
                  <div
                    style={{
                      position: "absolute",
                      bottom: 0,
                      right: 0,
                      width: 10,
                      height: 10,
                      borderRadius: 50,
                      background: "#10b981",
                      border: "2px solid #fff",
                    }}
                  />
                )}
              </div>
              <div>
                <div style={{ fontWeight: 700, color: "#0f172a" }}>
                  {selectedUser?.name}
                </div>
                <div style={{ fontSize: ".75rem", color: "#94a3b8" }}>
                  {selectedUser?.status}
                </div>
              </div>
            </div>
            <div
              style={{
                fontSize: ".75rem",
                color: "#94a3b8",
                background: "#f1f5f9",
                padding: "4px 8px",
                borderRadius: 4,
              }}
            >
              #{selectedUser?.id}
            </div>
          </div>
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {msgs.map((m) => (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  justifyContent: m.mine ? "flex-end" : "flex-start",
                }}
              >
                <div
                  className="messages-bubble"
                  style={{
                    background: m.mine ? "#1a56db" : "#fff",
                    color: m.mine ? "#fff" : "#0f172a",
                    padding: "10px 14px",
                    borderRadius: 8,
                    boxShadow: "0 1px 2px rgba(0,0,0,.05)",
                    borderTopLeftRadius: m.mine ? 8 : 4,
                    borderTopRightRadius: m.mine ? 4 : 8,
                  }}
                >
                  <div style={{ fontSize: ".9rem", lineHeight: 1.4 }}>
                    {m.text}
                  </div>
                  <div
                    style={{
                      fontSize: ".7rem",
                      opacity: m.mine ? 0.7 : 0.5,
                      marginTop: 4,
                    }}
                  >
                    {m.time}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div
            className="messages-composer"
            style={{
              padding: 16,
              borderTop: "1px solid #e2e8f0",
              background: "#fff",
            }}
          >
            <input
              className="form-control"
              style={{
                flex: 1,
                padding: "10px 12px",
                fontSize: ".9rem",
                border: "1px solid #d1d5db",
                borderRadius: 6,
              }}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message..."
              onKeyDown={(e) => e.key === "Enter" && send()}
            />
            <button
              style={{
                background: "#1a56db",
                color: "#fff",
                border: "none",
                padding: "10px 20px",
                borderRadius: 6,
                fontWeight: 600,
                cursor: "pointer",
                transition: "background .2s",
                fontSize: ".9rem",
              }}
              onClick={send}
              onMouseEnter={(e) => (e.target.style.background = "#1e40af")}
              onMouseLeave={(e) => (e.target.style.background = "#1a56db")}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

//   GRADING
function GradingPage() {
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Grade Report</div>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Student</th>
              {SUBJECTS.map((s) => (
                <th key={s} style={{ fontSize: ".7rem" }}>
                  {s.substring(0, 8)}
                </th>
              ))}
              <th>Avg</th>
              <th>Grade</th>
            </tr>
          </thead>
          <tbody>
            {SCORES_DATA.map((s) => {
              const vals = Object.values(s.scores);
              const avg = Math.round(
                vals.reduce((a, b) => a + b, 0) / vals.length,
              );
              const g = getGrade(avg);
              const dashboardGrade = Number(g.grade);
              const dashboardGradeColors =
                dashboardGrade <= 2
                  ? { icon: "#00b86b", start: "#ecfff5", end: "#92f0c2", text: "#007a46" }
                  : dashboardGrade <= 4
                    ? { icon: "#0059ff", start: "#eff5ff", end: "#9cc2ff", text: "#0039a6" }
                    : dashboardGrade <= 7
                      ? { icon: "#ff7a00", start: "#fff4e8", end: "#ffc47a", text: "#a54800" }
                      : { icon: "#dc2626", start: "#fff1f2", end: "#fecdd3", text: "#991b1b" };
              return (
                <tr key={s.student_id}>
                  <td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                    {s.name.split(" ")[0]}
                  </td>
                  {SUBJECTS.map((sub) => {
                    const sc = s.scores[sub];
                    const gg = getGrade(sc);
                    return (
                      <td
                        key={sub}
                        style={{
                          background: gg.bg,
                          color: gg.color,
                          fontWeight: 700,
                          textAlign: "center",
                        }}
                      >
                        {sc}
                      </td>
                    );
                  })}
                  <td style={{ fontWeight: 800 }}>{avg}</td>
                  <td>
                    <span
                      className="grade-chip"
                      style={{ background: g.bg, color: g.color }}
                    >
                      {g.grade}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

//   STUDENT DASHBOARD
function StudentVerifiedBadge() {
  return (
    <svg
      className="student-verified-badge"
      viewBox="0 0 20 20"
      role="img"
      aria-label="Verified student"
      focusable="false"
    >
      <title>Verified student</title>
      <circle cx="10" cy="10" r="9" fill="#1877f2" />
      <path
        d="m5.8 10.1 2.7 2.6 5.8-5.7"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StudentDashboard({
  user,
  studentData,
  attendanceData,
  feesData,
  selectionInfo,
  scoreValues,
  courseProgressSummary,
  onOpenLearningLibrary,
  onOpenCourses,
}) {
  const { cfg } = useContext(SettingsContext);
  const student = studentData || {
    full_name: user?.name || "Student",
    index: "-",
    class: "-",
    region: "-",
  };
  const studentVerified = String(student?.status || "").toLowerCase() === "confirmed";
  const avatarInitials = (student?.display_name || user?.name || student?.full_name || "K")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  const money = new Intl.NumberFormat(cfg.locale || "en-GH", {
    style: "currency",
    currency: cfg.currency || "GHS",
    maximumFractionDigits: 0,
  });
  const baseScores = Array.isArray(scoreValues) ? scoreValues : [];
  const avg = baseScores.length
    ? Math.round(
        baseScores.reduce((total, score) => total + score, 0) /
          baseScores.length,
      )
    : null;
  const g = getGrade(avg ?? 0);
  const dashboardGrade = Number(g.grade);
  const dashboardGradeColors =
    dashboardGrade <= 2
      ? { icon: "#00b86b", start: "#ecfff5", end: "#92f0c2", text: "#007a46" }
      : dashboardGrade <= 4
        ? { icon: "#0059ff", start: "#eff5ff", end: "#9cc2ff", text: "#0039a6" }
        : dashboardGrade <= 7
          ? { icon: "#ff7a00", start: "#fff4e8", end: "#ffc47a", text: "#a54800" }
          : { icon: "#dc2626", start: "#fff1f2", end: "#fecdd3", text: "#991b1b" };
  const attendanceRows = Array.isArray(attendanceData) ? attendanceData : [];
  const feeRows = Array.isArray(feesData) ? feesData : [];
  const present = attendanceRows.filter(
    (a) => String(a.status).toLowerCase() === "present",
  ).length;
  const outstanding = feeRows.reduce(
    (sum, f) =>
      sum + Math.max((Number(f.amount) || 0) - (Number(f.paid) || 0), 0),
    0,
  );
  const attendanceMonths = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(new Date().getFullYear(), new Date().getMonth() - 5 + index, 1);
    return {
      date,
      label: date.toLocaleDateString(cfg.locale || "en-GH", { month: "short" }),
      total: 0,
      present: 0,
    };
  });
  const attendanceMonthIndexes = new Map(
    attendanceMonths.map((month, index) => [
      `${month.date.getFullYear()}-${month.date.getMonth()}`,
      index,
    ]),
  );
  attendanceRows.forEach((row) => {
    if (!row.date) return;
    const date = new Date(row.date);
    if (Number.isNaN(date.getTime())) return;
    const monthIndex = attendanceMonthIndexes.get(
      `${date.getFullYear()}-${date.getMonth()}`,
    );
    if (monthIndex === undefined) return;
    attendanceMonths[monthIndex].total += 1;
    if (String(row.status).toLowerCase() === "present") {
      attendanceMonths[monthIndex].present += 1;
    }
  });
  const attendanceChartPoints = attendanceMonths.map((month, index) => {
    const rate = month.total
      ? Math.round((month.present / month.total) * 100)
      : null;
    return {
      ...month,
      rate,
      x: 32 + (index * 536) / (attendanceMonths.length - 1),
      y: 166 - ((rate ?? 0) / 100) * 112,
    };
  });
  const recordedAttendancePoints = attendanceChartPoints.filter(
    (point) => point.rate !== null,
  );
  const attendanceLinePath = recordedAttendancePoints
    .map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`)
    .join(" ");
  const attendanceAreaPath = recordedAttendancePoints.length
    ? `${attendanceLinePath} L ${recordedAttendancePoints[recordedAttendancePoints.length - 1].x} 178 L ${recordedAttendancePoints[0].x} 178 Z`
    : "";
  const hasAttendanceTrend = attendanceMonths.some((month) => month.total > 0);
  const navVisibility = getStudentNavVisibility(cfg);
  const feesEnabled =
    navVisibility.fees &&
    cfg.studentFeesPortalEnabled !== false &&
    cfg.studentFeesSummaryVisible !== false;
  const selectionEnabled =
    navVisibility.selection && cfg.studentSelectSchoolsEnabled !== false;
  const selectionCount = Number(selectionInfo?.count || 0);
  const selectionStatus = String(
    selectionInfo?.status || "not-submitted",
  ).toLowerCase();
  const selectionLabel =
    selectionStatus === "confirmed"
      ? "Confirmed"
      : selectionStatus === "submitted" || selectionStatus === "pending"
        ? "Submitted"
        : "Not Submitted";
  const resultsEnabled = navVisibility.results;
  const attendanceEnabled = navVisibility.attendance;
  const showCourses = navVisibility.courses;
  const showStudyContent = navVisibility["study-content"];
  const showAnnouncements = navVisibility.announcements;
  const courseSummary = courseProgressSummary || {
    enrolledCount: 0,
    completedCount: 0,
    averageCompletion: 0,
    progressItems: [],
  };
  const courseAverage = Math.min(100, Math.max(0, Number(courseSummary.averageCompletion) || 0));
  const progressItems = Array.isArray(courseSummary.progressItems) && courseSummary.progressItems.length
    ? courseSummary.progressItems.slice(0, 3)
    : [
        { title: "No enrolled courses", percent: 0 },
        { title: "Start a course", percent: 0 },
        { title: "Track progress here", percent: 0 },
      ];
  const dailyProgressValue = Math.min(
    100,
    Math.max(0, Math.round(((avg ?? courseAverage) * 0.6) + (courseAverage * 0.4))),
  );
  const courseCompletionValue = Math.min(
    100,
    Math.max(0, courseAverage || (avg ?? 0)),
  );
  const studyStreakText = courseSummary.enrolledCount
    ? `${Math.max(3, Math.min(14, Math.round(courseCompletionValue / 10) + 2))} days`
    : "0 days";
  const dashboardMetrics = [
    ...(resultsEnabled
      ? [{
          label: "Current Average",
          value: avg === null ? "N/A" : `${avg}%`,
          sub: baseScores.length ? g.grade : "No score records",
          ic: dashboardGradeColors.icon,
          bgStart: dashboardGradeColors.start,
          bgEnd: dashboardGradeColors.end,
          text: dashboardGradeColors.text,
          icon: "results",
        }]
      : []),
    ...(attendanceEnabled
      ? [{
          label: "Attendance Rate",
          value: `${Math.round((present / Math.max(attendanceRows.length, 1)) * 100)}%`,
          sub: `${present}/${attendanceRows.length} days`,
          ic: "#00b86b",
          bgStart: "#ecfff5",
          bgEnd: "#92f0c2",
          text: "#007a46",
          icon: "attendance",
        }]
      : []),
    ...(feesEnabled
      ? [{
          label: "Fees Status",
          value: outstanding > 0 ? "Outstanding" : "Cleared",
          sub: `${money.format(outstanding)} outstanding`,
          ic: outstanding > 0 ? "#ff7a00" : "#00b86b",
          bgStart: outstanding > 0 ? "#fff4e8" : "#ecfff5",
          bgEnd: outstanding > 0 ? "#ffc47a" : "#92f0c2",
          text: outstanding > 0 ? "#a54800" : "#007a46",
          icon: "fees",
        }]
      : []),
  ];
  const focusCards = [
    {
      label: "Today's focus",
      value: showStudyContent ? "Continue your study plan" : "Review your coursework",
      meta: showStudyContent ? "Complete one lesson and one recap task" : "Keep pace with your learning goals",
      tone: "primary",
    },
    {
      label: "Study streak",
      value: "7-day momentum",
      meta: "A strong routine keeps your progress moving.",
      tone: "success",
    },
    {
      label: "Next action",
      value: selectionEnabled ? `Selection ${selectionLabel}` : "Open the course library",
      meta: selectionEnabled
        ? `${selectionCount} ${selectionCount === 1 ? "saved entry" : "saved entries"}`
        : "Browse the latest lessons and resources",
      tone: "warning",
    },
  ];
  const quickLinks = [
    showStudyContent ? { label: "Study library", action: onOpenLearningLibrary, tone: "primary" } : null,
    showCourses ? { label: "Browse courses", action: onOpenCourses, tone: "secondary" } : null,
    showAnnouncements ? { label: "Announcements", action: () => {}, tone: "neutral" } : null,
  ].filter(Boolean);
  return (
    <div className="fade-in admin-dashboard student-dashboard">
      <div className="student-dashboard-shell">
        <aside className="student-dashboard-profile-card">
          <div className="student-dashboard-profile-header">
            <div className="student-dashboard-avatar">
              {student?.photo_url ? (
                <img src={student.photo_url} alt="" />
              ) : (
                avatarInitials
              )}
            </div>
          </div>

          <div className="student-dashboard-profile-name">
            Welcome back, {student.display_name || user?.name || student.full_name}
            {studentVerified && <StudentVerifiedBadge />}
          </div>

          <div className="student-dashboard-profile-meta">
            Student ID: {student.index || "-"}   {student.class || "-"}   {student.region || "-"} Region
          </div>

          {selectionEnabled && cfg.studentSelectionDeadlineVisible !== false && cfg.selectionDeadline && (
            <div className="student-dashboard-profile-deadline">
              Selection Deadline: {cfg.selectionDeadline}
            </div>
          )}

          <div className="student-dashboard-mini-grid">
            {resultsEnabled && (
              <div className="student-dashboard-mini-item">
                <span>Current average</span>
                <strong>{avg === null ? "N/A" : `${avg}%`}</strong>
              </div>
            )}
            {attendanceEnabled && (
              <div className="student-dashboard-mini-item">
                <span>Attendance</span>
                <strong>{present}/{attendanceRows.length || 0}</strong>
              </div>
            )}
            {feesEnabled && (
              <div className="student-dashboard-mini-item">
                <span>Fees</span>
                <strong>{money.format(outstanding)}</strong>
              </div>
            )}
          </div>

          {quickLinks.length > 0 && (
            <div className="student-dashboard-quick-links" aria-label="Student quick actions">
              {quickLinks.map((link) => (
                <button
                  key={link.label}
                  type="button"
                  className={`student-dashboard-quick-link ${link.tone}`}
                  onClick={link.action}
                >
                  {link.label}
                </button>
              ))}
            </div>
          )}
        </aside>

        <div className="student-dashboard-main-column">
          <div className="student-dashboard-progress-row" aria-label="Daily progress overview">
            <div className="student-dashboard-progress-card accent">
              <span className="student-dashboard-card-kicker">DP</span>
              <strong>Daily Progress</strong>
              <div className="student-dashboard-progress-value">{dailyProgressValue}%</div>
              <small>{courseSummary.enrolledCount ? "Updated from enrolled courses" : "No enrolled courses yet"}</small>
            </div>
            <div className="student-dashboard-progress-card">
              <span className="student-dashboard-card-kicker">Progress</span>
              <strong>Course completion</strong>
              <div className="student-dashboard-progress-value">{courseCompletionValue}%</div>
              <small>{courseSummary.enrolledCount ? `${courseSummary.enrolledCount} active course${courseSummary.enrolledCount === 1 ? "" : "s"}` : "Start a course"}</small>
            </div>
            <div className="student-dashboard-progress-card warm">
              <span className="student-dashboard-card-kicker">Focus</span>
              <strong>Study streak</strong>
              <div className="student-dashboard-progress-value">{studyStreakText}</div>
              <small>{courseSummary.enrolledCount ? "Consistent effort" : "Set your study rhythm"}</small>
            </div>
          </div>
          <div className="student-dashboard-hero-card">
            <div className="student-dashboard-header-meta">
              <DashboardDateTime />
              <div className="admin-dashboard-period">Academic Year {cfg.academicYear}   {cfg.currentTerm}</div>
            </div>

            {dashboardMetrics.length > 0 && (
              <div className="student-dashboard-metric-row">
                {dashboardMetrics.map((s) => (
                  <div
                    key={s.label}
                    className="student-dashboard-metric-tile"
                    style={{
                      "--dash-bg-start": s.bgStart,
                      "--dash-bg-end": s.bgEnd,
                      "--dash-accent": s.ic,
                      "--dash-text": s.text,
                    }}
                  >
                    <div className="stat-icon">
                      <Ico name={s.icon} size={18} color={s.ic} />
                    </div>
                    <div className="stat-label">{s.label}</div>
                    <div className="stat-value">{s.value}</div>
                    <div className="stat-sub">{s.sub}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="student-dashboard-progress-panel">
            <div className="student-dashboard-panel-heading">
              <span className="admin-dashboard-panel-eyebrow">Progress</span>
              <h3>Learning momentum</h3>
            </div>
            <div className="student-dashboard-progress-list">
              {progressItems.map((item, index) => (
                <div className="student-dashboard-progress-item" key={`${item.title}-${index}`}>
                  <div className="student-dashboard-progress-copy">
                    <span>{item.title}</span>
                    <strong>{Math.min(100, Math.max(0, Number(item.percent) || 0))}%</strong>
                  </div>
                  <div className="student-dashboard-progress-bar"><i style={{ width: `${Math.min(100, Math.max(0, Number(item.percent) || 0))}%` }} /></div>
                </div>
              ))}
            </div>
          </div>

          <div className="student-dashboard-lower-grid">
            <section className="student-dashboard-summary-panel">
              <div className="admin-dashboard-panel-heading">
                <div>
                  <span className="admin-dashboard-panel-eyebrow">YOUR PORTAL</span>
                  <h3>At a glance</h3>
                </div>
              </div>
              <div className="student-dashboard-snapshot-list">
                {resultsEnabled && (
                  <div className="student-dashboard-snapshot-row">
                    <span>Current average</span>
                    <strong>{avg === null ? "No scores" : `${avg}%`}</strong>
                  </div>
                )}
                {attendanceEnabled && (
                  <div className="student-dashboard-snapshot-row">
                    <span>Attendance</span>
                    <strong>{present} of {attendanceRows.length} days</strong>
                  </div>
                )}
                {selectionEnabled && (
                  <div className="student-dashboard-snapshot-row">
                    <span>School selection</span>
                    <strong>{selectionLabel}   {selectionCount}</strong>
                  </div>
                )}
                {feesEnabled && (
                  <div className="student-dashboard-snapshot-row">
                    <span>Fees outstanding</span>
                    <strong>{money.format(outstanding)}</strong>
                  </div>
                )}
              </div>
              {(showCourses || showStudyContent) && (
                <div className="student-dashboard-actions">
                  {showCourses && (
                    <button className="btn btn-blue" type="button" onClick={onOpenCourses}>
                      Browse courses
                    </button>
                  )}
                  {showStudyContent && (
                    <button className="btn btn-outline" type="button" onClick={onOpenLearningLibrary}>
                      Study library
                    </button>
                  )}
                </div>
              )}
            </section>

            {showAnnouncements && (
              <section className="student-dashboard-news-panel">
                <div className="admin-dashboard-panel-heading">
                  <div>
                    <span className="admin-dashboard-panel-eyebrow">UPDATES</span>
                    <h3>Latest notice</h3>
                  </div>
                </div>
                <div className="student-dashboard-news-box">
                  <strong>{ANNOUNCEMENTS[0]?.title}</strong>
                  <p>{ANNOUNCEMENTS[0]?.body}</p>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

//   STUDENT PROFILE
const StudentProfile = lazy(() =>
  import("./src/components/StudentProfilePage.jsx").then((module) => ({
    default: module.StudentProfile,
  })),
);

//   STUDENT ATTENDANCE
function StudentAttendance({ attendanceData }) {
  const { cfg } = useContext(SettingsContext);
  const rows = Array.isArray(attendanceData) ? attendanceData : [];
  const formatDate = (value) => {
    if (!value) return "-";
    const dt = new Date(value);
    return Number.isNaN(dt.getTime())
      ? String(value)
      : new Intl.DateTimeFormat(cfg.locale || "en-GH", {
          timeZone: cfg.timezone || "Africa/Accra",
          dateStyle: "medium",
        }).format(dt);
  };
  const present = rows.filter(
    (a) => String(a.status).toLowerCase() === "present",
  ).length;
  const absent = rows.length - present;
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">My Attendance</div>
      </div>
      <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
        <div
          className="att-circle"
          style={{ background: "#dcfce7", color: "#16a34a" }}
        >
          {Math.round((present / Math.max(rows.length, 1)) * 100)}%
          <div style={{ fontSize: ".75rem", fontWeight: 400 }}>Present</div>
        </div>
        <div
          className="att-circle"
          style={{ background: "#fee2e2", color: "#dc2626" }}
        >
          {Math.round((absent / Math.max(rows.length, 1)) * 100)}%
          <div style={{ fontSize: ".75rem", fontWeight: 400 }}>Absent</div>
        </div>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td>{formatDate(a.date)}</td>
                <td>
                  <span
                    className={`badge ${a.status === "Present" ? "badge-success" : "badge-danger"}`}
                  >
                    {a.status}
                  </span>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td
                  colSpan="2"
                  style={{ textAlign: "center", padding: 20, color: "#64748b" }}
                >
                  No live attendance records found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

//   STUDENT FEES
function StudentFees({ feesData }) {
  const { cfg } = useContext(SettingsContext);
  const feesEnabled = cfg.studentFeesPortalEnabled !== false;
  const rows = Array.isArray(feesData) ? feesData : [];
  const money = new Intl.NumberFormat(cfg.locale || "en-GH", {
    style: "currency",
    currency: cfg.currency || "GHS",
    maximumFractionDigits: 0,
  });
  if (!feesEnabled) {
    return (
      <div className="fade-in">
        <div className="page-header">
          <div className="page-title">My Fees</div>
        </div>
        <div className="card card-padded alert alert-info">
          Fees are currently disabled for this portal.
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">My Fees</div>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Term</th>
              <th>Amount</th>
              <th>Paid</th>
              <th>Balance</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id}>
                <td>
                  <strong>{f.term}</strong>
                </td>
                <td>{money.format(Number(f.amount || 0))}</td>
                <td>{money.format(Number(f.paid || 0))}</td>
                <td
                  style={{
                    color: f.amount - f.paid > 0 ? "#dc2626" : "#16a34a",
                    fontWeight: 700,
                  }}
                >
                  {money.format(Number((f.amount || 0) - (f.paid || 0)))}{" "}
                </td>
                <td>
                  <span
                    className={`badge ${f.status === "paid" ? "badge-success" : f.status === "partial" ? "badge-warning" : "badge-danger"}`}
                  >
                    {f.status}
                  </span>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td
                  colSpan="5"
                  style={{ textAlign: "center", padding: 20, color: "#64748b" }}
                >
                  No live fee records found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="alert alert-info" style={{ marginTop: 12 }}>
        Need billing help? Contact {cfg.supportEmail || "support"}{" "}
        {cfg.supportPhone ? `or ${cfg.supportPhone}` : ""}.
      </div>
    </div>
  );
}

//   STUDENT SCHOOL SELECTION
function SchoolSelection({ schoolsData, studentData }) {
  const { cfg } = useContext(SettingsContext);
  const maxChoices = cfg.maxChoices || 7;
  const [selected, setSelected] = useState([]);
  const [submitted, setSubmitted] = useState(false);
  const [selectionError, setSelectionError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loadingSelection, setLoadingSelection] = useState(false);
  const [ruleWarning, setRuleWarning] = useState("");
  const [showReviewModal, setShowReviewModal] = useState(false);
  const userEmail = getSessionUserEmail();
  const schools = sortSchoolsByCategory(
    schoolsData?.length ? schoolsData : SCHOOLS_DATA,
  );
  const counts = schools.reduce(
    (acc, school) => {
      const key = String(school.category || "").toUpperCase();
      if (key === "A" || key === "B" || key === "C") acc[key] += 1;
      return acc;
    },
    { A: 0, B: 0, C: 0 },
  );
  const validPatterns = [
    { A: 1, B: 2, C: 4 },
    { A: 1, B: 0, C: 6 },
    { A: 0, B: 2, C: 5 },
    { A: 0, B: 0, C: 7 },
  ];

  const getSelectionCounts = (items) =>
    items.reduce(
      (acc, item) => {
        const key = String(item.category || "").toUpperCase();
        if (key === "A" || key === "B" || key === "C") acc[key] += 1;
        return acc;
      },
      { A: 0, B: 0, C: 0 },
    );

  const canStillFitAValidPattern = (items) => {
    const picked = getSelectionCounts(items);
    return validPatterns.some(
      (pattern) =>
        picked.A <= pattern.A &&
        picked.B <= pattern.B &&
        picked.C <= pattern.C &&
        items.length <= pattern.A + pattern.B + pattern.C,
    );
  };
  const showRuleWarning = (message) => {
    setRuleWarning(message);
    window.alert(message);
  };

  useEffect(() => {
    const loadRemote = async () => {
      if (!supabase) return;
      setLoadingSelection(true);
      const data = await fetchStudentSelection({
        supabase,
        userEmail,
        studentData,
      });
      if (data) {
        const picks = normalizeSelectionList(data);
        if (picks.length) setSelected(picks);
        setSubmitted(
          !!data.submitted ||
            String(data.status || "").toLowerCase() !== "draft",
        );
      }
      setLoadingSelection(false);
    };
    loadRemote();
  }, [userEmail, studentData]);

  useEffect(() => {
    if (submitted) {
      setShowReviewModal(false);
      return;
    }
    if (selected.length === maxChoices && !validate()) {
      setShowReviewModal(true);
    } else {
      setShowReviewModal(false);
    }
  }, [selected, submitted]);

  const toggle = (school) => {
    if (!cfg.allowChanges) return;
    if (selected.find((s) => s.id === school.id)) {
      setRuleWarning("");
      setSelected((s) => s.filter((x) => x.id !== school.id));
      return;
    }
    if (selected.length >= maxChoices) {
      showRuleWarning(`You can select a maximum of ${maxChoices} schools.`);
      return;
    }
    const nextSelected = [...selected, school];
    if (!canStillFitAValidPattern(nextSelected)) {
      showRuleWarning(
        "This selection breaks the allowed combinations: 1A + 2B + 4C, 1A + 6C, 2B + 5C, or 7C.",
      );
      return;
    }
    setRuleWarning("");
    setSelected(nextSelected);
  };
  const validate = () => {
    const catA = selected.filter((s) => s.category === "A").length;
    const catB = selected.filter((s) => s.category === "B").length;
    const catC = selected.filter((s) => s.category === "C").length;
    if (selected.length === 0) return "Select at least one school.";
    if (selected.length > maxChoices)
      return `You can select a maximum of ${maxChoices} schools.`;
    const matchesValidPattern = validPatterns.some(
      (pattern) =>
        catA === pattern.A && catB === pattern.B && catC === pattern.C,
    );
    if (selected.length === maxChoices && !matchesValidPattern) {
      return "Allowed combinations are: 1A + 2B + 4C, 1A + 6C, 2B + 5C, or 7C.";
    }
    return null;
  };
  const err = validate();
  const submitSelection = async () => {
    if (!supabase || !studentData?.id) {
      setSelectionError("Your school selection cannot be saved without a linked Supabase student account.");
      return;
    }
    setSubmitting(true);
    setSelectionError("");
    try {
      const { error } = await supabase.from("school_selections").insert({
        student_id: studentData.id,
        index_number: studentData.index_number || studentData.index || null,
        status: "submitted",
        selections: selected.map((school, index) => ({
          rank: index + 1,
          school_id: school.id,
          school_name: school.name,
          region: school.region,
          category: school.category,
        })),
      });
      if (error) throw error;
      setSubmitted(true);
    } catch (error) {
      setSelectionError(
        `Your school selection was not saved: ${error.message || "Supabase request failed."}`,
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Select Schools</div>
        <div className="page-sub">{`Choose ${maxChoices} secondary schools in an approved pattern (${schools.length} schools available: A ${counts.A}, B ${counts.B}, C ${counts.C})${cfg.selectionDeadline ? "   Deadline: " + cfg.selectionDeadline : ""}`}</div>
      </div>
      {selectionError && <div className="alert alert-warning">{selectionError}</div>}
      {loadingSelection && (
        <div className="alert alert-info">Loading your saved selection...</div>
      )}
      {!cfg.allowChanges && !submitted && (
        <div className="alert alert-warning" style={{ fontWeight: 600 }}>
          School selection is currently locked by the administrator. Changes are
          not allowed at this time.
        </div>
      )}
      {submitted ? (
        <div className="alert alert-success">
          Your school selection has been submitted successfully!
        </div>
      ) : (
        <>
          <div className="alert alert-info">
            Selection Rules: 1A + 2B + 4C, 1A + 6C, 2B + 5C, or 7C.
          </div>
          {ruleWarning && (
            <div className="alert alert-warning">{ruleWarning}</div>
          )}
          {err && selected.length > 0 && (
            <div className="alert alert-warning">{err}</div>
          )}
          <div
            className="card-grid-auto"
            style={{
              marginBottom: 20,
              opacity: cfg.allowChanges ? 1 : 0.5,
              pointerEvents: cfg.allowChanges ? "auto" : "none",
            }}
          >
            {schools.map((s) => (
              <button
                key={s.id}
                className={`selection-card ${selected.find((x) => x.id === s.id) ? "selected" : ""}`}
                onClick={() => toggle(s)}
              >
                <div className={`cat-badge cat-${s.category}`}>
                  {s.category}
                </div>
                <div style={{ flex: 1, textAlign: "left" }}>
                  <div style={{ fontWeight: 700, fontSize: ".9rem" }}>
                    {s.name}
                  </div>
                  <div style={{ fontSize: ".78rem", color: "#64748b" }}>
                    {s.region} - Cutoff: {s.cutoff}
                  </div>
                </div>
                {selected.find((x) => x.id === s.id) && (
                  <Ico name="confirmed" size={16} color="#1a56db" />
                )}
              </button>
            ))}
          </div>
          <div className="card card-padded" style={{ marginBottom: 16 }}>
            <strong>
              Selected ({selected.length}/{maxChoices}):
            </strong>
            {selected.length === 0 ? (
              <span style={{ color: "#94a3b8", marginLeft: 8 }}>None yet</span>
            ) : (
              <ol style={{ marginTop: 8, paddingLeft: 20 }}>
                {selected.map((s, i) => (
                  <li key={s.id} style={{ marginBottom: 4, fontSize: ".9rem" }}>
                    {s.name}{" "}
                    <span
                      className={`badge cat-${s.category}`}
                      style={{
                        marginLeft: 6,
                        padding: "2px 8px",
                        borderRadius: 6,
                        fontSize: ".7rem",
                      }}
                    >
                      Cat {s.category}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <button
            className="btn btn-blue"
            disabled={!!err || selected.length !== maxChoices}
            onClick={() => setShowReviewModal(true)}
          >
            Review Selection
          </button>
        </>
      )}
      {showReviewModal && !submitted && (
        <div
          className="modal-backdrop"
          onClick={() => setShowReviewModal(false)}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <div className="modal-title">Review Selected Schools</div>
                <div className="modal-sub">
                  Confirm your 7-school selection before final submission.
                </div>
              </div>
              <button
                className="modal-close"
                onClick={() => setShowReviewModal(false)}
              >
                <Ico
                  name="logout"
                  size={16}
                  color="#1e3a8a"
                  style={{ transform: "rotate(45deg)" }}
                />
              </button>
            </div>
            <div className="card card-padded" style={{ marginBottom: 0 }}>
              <ol
                style={{
                  paddingLeft: 20,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {selected.map((s, i) => (
                  <li key={s.id} style={{ fontSize: ".92rem" }}>
                    <strong>{s.name}</strong>
                    <span
                      className={`badge cat-${s.category}`}
                      style={{
                        marginLeft: 8,
                        padding: "2px 8px",
                        borderRadius: 6,
                        fontSize: ".72rem",
                      }}
                    >
                      Cat {s.category}
                    </span>
                    <div
                      style={{
                        fontSize: ".78rem",
                        color: "#64748b",
                        marginTop: 4,
                      }}
                    >
                      {s.region} - Cutoff: {s.cutoff}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-outline"
                onClick={() => setShowReviewModal(false)}
              >
                Edit
              </button>
              <button className="btn btn-blue" onClick={submitSelection} disabled={submitting}>
                {submitting ? "Saving..." : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

//   MY SELECTION
function MySelection({ selectionRow, approvalInfo }) {
  const rows = normalizeSelectionList(selectionRow);
  const status = String(selectionRow?.status || "not-submitted").toLowerCase();
  const statusText =
    status === "confirmed"
      ? "Your selection has been confirmed."
      : status === "submitted" || status === "pending"
        ? "Your selection is under review."
        : "You have not submitted a selection yet.";
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">My Selection</div>
      </div>
      {approvalInfo?.isApproved && (
        <div className="alert alert-success" style={{ fontWeight: 700 }}>
          Approval update: Your school selection has been approved by the admin
          {approvalInfo.approvedAtLabel
            ? ` on ${approvalInfo.approvedAtLabel}`
            : ""}
          .
        </div>
      )}
      <div className="alert alert-info">{statusText}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((s, i) => (
          <div
            key={s.id}
            className="card card-padded"
            style={{ display: "flex", alignItems: "center", gap: 14 }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "#eef2ff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 800,
                color: "#1a56db",
                flexShrink: 0,
              }}
            >
              #{i + 1}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{s.name}</div>
              <div style={{ fontSize: ".8rem", color: "#64748b" }}>
                {s.region}
              </div>
            </div>
            <span
              className={`badge ${s.category === "A" ? "badge-warning" : "badge-blue"}`}
            >
              Cat {s.category}
            </span>
          </div>
        ))}
        {!rows.length && (
          <div
            className="card card-padded"
            style={{ textAlign: "center", color: "#64748b" }}
          >
            No live selection records found.
          </div>
        )}
      </div>
    </div>
  );
}

//   STUDENT DOCS
function DocumentsPage() {
  const { records: documents, loading, error } =
    useStudentPortalRecords("student_document");
  const [downloadError, setDownloadError] = useState("");
  const downloadDocument = async (document) => {
    const { data, error: downloadLinkError } = await supabase.storage
      .from("student-documents")
      .createSignedUrl(document.storagePath, 60);
    if (downloadLinkError) {
      setDownloadError(`Could not open document: ${downloadLinkError.message}`);
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    setDownloadError("");
  };
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Documents</div>
      </div>
      {(error || downloadError) && (
        <div className="alert alert-warning">{downloadError || error}</div>
      )}
      {loading ? (
        <div className="card card-padded">Loading saved documents...</div>
      ) : documents.length ? (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr><th>Document</th><th>Type</th><th>Uploaded</th><th>Action</th></tr>
            </thead>
            <tbody>
              {documents.map((document) => (
                <tr key={document.id}>
                  <td>{document.fileName}</td>
                  <td>{document.docType}</td>
                  <td>{new Date(document.at).toLocaleString()}</td>
                  <td>
                    <button className="btn btn-sm btn-outline" onClick={() => downloadDocument(document)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card card-padded" style={{ textAlign: "center" }}>
          No documents have been uploaded.
        </div>
      )}
    </div>
  );
}

// PLACEMENT PREDICTOR
function PlacementPredictor({ schoolsData }) {
  const [agg, setAgg] = useState("");
  const [school, setSchool] = useState("");
  const [result, setResult] = useState(null);
  const schools = sortSchoolsByCategory(
    schoolsData?.length ? schoolsData : SCHOOLS_DATA,
  );
  const predict = () => {
    const s = schools.find((x) => String(x.id) === String(school));
    if (!s || !agg) return;
    const likely = parseInt(agg) <= s.cutoff;
    setResult({ likely, school: s.name, cutoff: s.cutoff, agg: parseInt(agg) });
  };
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Mock Placement Predictor</div>
        <div className="page-sub">
          Estimate your likely secondary school mock placement
        </div>
      </div>
      <div
        className="card card-padded"
        style={{ maxWidth: 500, marginBottom: 16 }}
      >
        <div className="form-group" style={{ marginBottom: 14 }}>
          <label className="form-label">Select School</label>
          <select
            className="form-control"
            value={school}
            onChange={(e) => setSchool(e.target.value)}
          >
            <option value="">-- Choose a school --</option>
            {schools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} (Cutoff: {s.cutoff})
              </option>
            ))}
          </select>
        </div>
        <div className="form-group" style={{ marginBottom: 14 }}>
          <label className="form-label">Your Aggregate (1=best)</label>
          <input
            type="number"
            className="form-control"
            value={agg}
            onChange={(e) => setAgg(e.target.value)}
            min={1}
            max={40}
            placeholder="e.g. 8"
          />
        </div>
        <button className="btn btn-blue" onClick={predict}>
          Predict Mock Placement
        </button>
      </div>
      {result && (
        <div
          className={`alert ${result.likely ? "alert-success" : "alert-warning"}`}
        >
          {result.likely
            ? `Success: Your aggregate of ${result.agg} meets the cutoff (${result.cutoff}) for ${result.school}. You are likely to be placed here.`
            : `Warning: Your aggregate of ${result.agg} is above the cutoff of ${result.cutoff} for ${result.school}. Consider lower-cutoff schools.`}
        </div>
      )}
    </div>
  );
}

function AssignmentTrackerPage() {
  const {
    records: taskStatuses,
    loading,
    error,
    saveRecord,
  } = useStudentPortalRecords("assignment_status");
  const assignmentList = [
    {
      id: 1,
      subject: "Mathematics",
      title: "Algebra Worksheet",
      due: "2026-04-20",
      status: "pending",
    },
    {
      id: 2,
      subject: "English",
      title: "Essay Draft",
      due: "2026-04-18",
      status: "submitted",
    },
  ];
  const tasks = assignmentList.map((task) => ({
    ...task,
    status:
      taskStatuses.find(
        (status) => String(status.assignment_id) === String(task.id),
      )?.status || task.status,
  }));
  const isMobile = useIsMobileLayout();
  const update = (id, status) =>
    saveRecord(
      { assignment_id: id, status, updated_at: new Date().toISOString() },
      String(id),
    );
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Assignments</div>
        <div className="page-sub">
          Track homework, due dates and submission status.
        </div>
      </div>
      {error && <div className="alert alert-warning">{error}</div>}
      {isMobile ? (
        <div className="mobile-record-list">
          {loading && <div className="mobile-record-card">Loading saved assignment statuses...</div>}
          {tasks.map((t) => (
            <div key={t.id} className="mobile-record-card">
              <div className="mobile-record-head">
                <div>
                  <div className="mobile-record-title">{t.title}</div>
                  <div className="mobile-record-sub">
                    {t.subject}   Due {t.due}
                  </div>
                </div>
                <span
                  className={`badge ${t.status === "submitted" ? "badge-success" : t.status === "late" ? "badge-danger" : "badge-warning"}`}
                >
                  {t.status}
                </span>
              </div>
              <div className="mobile-record-actions">
                <button
                  className="btn btn-sm btn-outline"
                  onClick={() => update(t.id, "submitted")}
                >
                  Mark Submitted
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Subject</th>
                <th>Task</th>
                <th>Due</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan="5">Loading saved assignment statuses...</td></tr>}
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td>{t.subject}</td>
                  <td>{t.title}</td>
                  <td>{t.due}</td>
                  <td>
                    <span
                      className={`badge ${t.status === "submitted" ? "badge-success" : t.status === "late" ? "badge-danger" : "badge-warning"}`}
                    >
                      {t.status}
                    </span>
                  </td>
                  <td>
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={() => update(t.id, "submitted")}
                    >
                      Mark Submitted
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ExamSchedulePage() {
  const rows = [
    {
      id: 1,
      subject: "Mathematics",
      date: "2026-05-03",
      time: "09:00",
      venue: "Hall A",
      seat: "A-14",
    },
    {
      id: 2,
      subject: "English",
      date: "2026-05-05",
      time: "11:00",
      venue: "Hall B",
      seat: "B-22",
    },
  ];
  const isMobile = useIsMobileLayout();
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Exam Timetable & Seat Plan</div>
        <div className="page-sub">
          See your exam schedule, venue, and seat allocation.
        </div>
      </div>
      {isMobile ? (
        <div className="mobile-record-list">
          {rows.map((r) => (
            <div key={r.id} className="mobile-record-card">
              <div className="mobile-record-head">
                <div>
                  <div className="mobile-record-title">{r.subject}</div>
                  <div className="mobile-record-sub">
                    {r.date}   {r.time}
                  </div>
                </div>
                <strong>{r.seat}</strong>
              </div>
              <div className="mobile-record-item">
                <label>Venue</label>
                <span>{r.venue}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Subject</th>
                <th>Date</th>
                <th>Time</th>
                <th>Venue</th>
                <th>Seat</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.subject}</td>
                  <td>{r.date}</td>
                  <td>{r.time}</td>
                  <td>{r.venue}</td>
                  <td>
                    <strong>{r.seat}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ReportCardPage({ studentData, attendanceData, feesData }) {
  const { cfg } = useContext(SettingsContext);
  const navVisibility = getStudentNavVisibility(cfg);
  const feesEnabled =
    navVisibility.fees && cfg.studentFeesPortalEnabled !== false;
  const attendanceEnabled = navVisibility.attendance;
  const student = studentData || {
    full_name: "Student",
    index: "-",
    class: "-",
  };
  const attendanceRate = Math.round(
    ((attendanceData || []).filter(
      (x) => String(x.status).toLowerCase() === "present",
    ).length /
      Math.max((attendanceData || []).length, 1)) *
      100,
  );
  const totalOutstanding = (feesData || []).reduce(
    (s, f) => s + Math.max(Number(f.amount || 0) - Number(f.paid || 0), 0),
    0,
  );
  const generate = async () => {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const left = 52;
    let y = 62;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Campus Ghana - Student Report Card", left, y);

    y += 30;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    const lines = [
      `Name: ${student.full_name}`,
      `Student ID: ${student.index}`,
      `Class: ${student.class}`,
      ...(attendanceEnabled ? [`Attendance Rate: ${attendanceRate}%`] : []),
      ...(feesEnabled
        ? [`Outstanding Fees: GHS ${totalOutstanding}`]
        : []),
      `Generated: ${new Date().toLocaleString()}`,
    ];
    lines.forEach((line) => {
      doc.text(line, left, y);
      y += 22;
    });

    doc.save(`report-card-${student.index || "student"}.pdf`);
  };
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Term Report Card</div>
        <div className="page-sub">
          Generate and download your report summary.
        </div>
      </div>
      <div className="card card-padded">
        <div style={{ display: "grid", gap: 8 }}>
          <div>
            <strong>Name:</strong> {student.full_name}
          </div>
          <div>
            <strong>Student ID:</strong> {student.index}
          </div>
          <div>
            <strong>Class:</strong> {student.class}
          </div>
          {attendanceEnabled && (
            <div>
              <strong>Attendance Rate:</strong> {attendanceRate}%
            </div>
          )}
          {feesEnabled && (
            <div>
              <strong>Outstanding Fees:</strong> GHS {totalOutstanding}
            </div>
          )}
        </div>
        <button
          className="btn btn-blue"
          style={{ marginTop: 12 }}
          onClick={generate}
        >
          Download Report
        </button>
      </div>
    </div>
  );
}

function StudentAcademicResultsPage({ scoreRecords }) {
  const records = Array.isArray(scoreRecords)
    ? scoreRecords
        .filter(
          (record) =>
            record?.subject &&
            Number.isFinite(Number(record.score)) &&
            Number(record.score) >= 0,
        )
        .map((record) => ({
          ...record,
          score: Number(record.score),
          academicYear: record.academic_year || "Unspecified Academic Year",
          term: record.term || "Unspecified Term",
        }))
    : [];
  const years = new Map();
  records.forEach((record) => {
    if (!years.has(record.academicYear)) years.set(record.academicYear, new Map());
    const terms = years.get(record.academicYear);
    if (!terms.has(record.term)) terms.set(record.term, []);
    terms.get(record.term).push(record);
  });
  const termOrder = ["first term", "second term", "third term"];
  const compareTerms = (termA, termB) => {
    const indexA = termOrder.indexOf(termA.toLowerCase());
    const indexB = termOrder.indexOf(termB.toLowerCase());
    if (indexA < 0 && indexB < 0) return termA.localeCompare(termB);
    if (indexA < 0) return 1;
    if (indexB < 0) return -1;
    return indexA - indexB;
  };
  const sortedYears = [...years.entries()].sort(([yearA], [yearB]) => {
    if (yearA === "Unspecified Academic Year") return 1;
    if (yearB === "Unspecified Academic Year") return -1;
    return yearB.localeCompare(yearA, undefined, { numeric: true });
  });
  const latestYear = sortedYears[0];
  const latestTerm = latestYear
    ? [...latestYear[1].entries()].sort(([termA], [termB]) =>
        compareTerms(termA, termB),
      )[0]
    : null;
  const latestTermRecords = latestTerm?.[1] || [];
  const subjectAggregate = calculateSubjectAggregate(latestTermRecords);
  const strongestSubject = [...latestTermRecords].sort(
    (a, b) => b.score - a.score,
  )[0];
  const focusSubject = [...latestTermRecords].sort(
    (a, b) => a.score - b.score,
  )[0];
  const averageOf = (items) =>
    items.length
      ? Math.round(
          items.reduce((total, item) => total + item.score, 0) / items.length,
        )
      : 0;

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Results & Analytics</div>
        <div className="page-sub">
          Review your performance and subject results across academic years.
        </div>
      </div>
      {!!latestTermRecords.length && (
        <section className="card card-padded" style={{ marginBottom: 16 }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 8,
              marginBottom: 14,
            }}
          >
            <h2 style={{ margin: 0, color: "#1e3a8a", fontSize: "1.1rem" }}>
              Results Analytics
            </h2>
            <span style={{ color: "#64748b", fontSize: ".82rem" }}>
              {latestTerm[0]}   {latestYear[0]}
            </span>
          </div>
          <div className="stats-grid stats-grid-3">
            <div className="stat-card" style={{ background: "#eef2ff" }}>
              <div className="stat-label" style={{ color: "#1e3a8a" }}>
                Term Average
              </div>
              <div className="stat-value" style={{ color: "#1e3a8a" }}>
                {averageOf(latestTermRecords)}%
              </div>
              <div className="stat-sub" style={{ color: "#1e3a8a" }}>
                Across {latestTermRecords.length} recorded subject
                {latestTermRecords.length === 1 ? "" : "s"}
              </div>
            </div>
            <div className="stat-card" style={{ background: "#dcfce7" }}>
              <div className="stat-label" style={{ color: "#166534" }}>
                Strongest Subject
              </div>
              <div
                className="stat-value"
                style={{ color: "#166534", fontSize: "1.1rem" }}
              >
                {strongestSubject?.subject || "N/A"}
              </div>
              <div className="stat-sub" style={{ color: "#166534" }}>
                {strongestSubject ? `${strongestSubject.score}%` : "No score"}
              </div>
            </div>
            <div className="stat-card" style={{ background: "#fff7ed" }}>
              <div className="stat-label" style={{ color: "#9a3412" }}>
                Focus Subject
              </div>
              <div
                className="stat-value"
                style={{ color: "#9a3412", fontSize: "1.1rem" }}
              >
                {focusSubject?.subject || "N/A"}
              </div>
              <div className="stat-sub" style={{ color: "#9a3412" }}>
                {focusSubject ? `${focusSubject.score}%` : "No score"}
              </div>
            </div>
          </div>
          <div
            style={{
              marginTop: 14,
              padding: 16,
              border: "1px solid #dbe6f6",
              borderRadius: 12,
              background: "linear-gradient(145deg, #f8fbff, #eef5ff)",
            }}
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <div>
                <h3 style={{ margin: 0, color: "#1e3a8a", fontSize: ".95rem" }}>
                  Six-Subject Aggregate
                </h3>
                <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: ".76rem" }}>
                  Four core grades plus your two best other subjects. Lower is
                  stronger.
                </p>
              </div>
              <strong
                style={{
                  color: subjectAggregate.aggregate == null ? "#64748b" : "#1e3a8a",
                  fontSize: "1.6rem",
                }}
              >
                {subjectAggregate.aggregate ?? "Pending"}
              </strong>
            </div>
            {subjectAggregate.aggregate != null && (
              <div
                style={{
                  marginTop: 4,
                  color: "#64748b",
                  fontSize: ".74rem",
                  textAlign: "right",
                }}
              >
                {subjectAggregate.aggregate >= 6 &&
                subjectAggregate.aggregate <= 15
                  ? "Very strong aggregate range"
                  : "Lower aggregate totals indicate stronger performance"}
              </div>
            )}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                gap: 8,
                marginTop: 12,
              }}
            >
              {[
                ...subjectAggregate.coreSubjects.map((subject) => ({
                  ...subject,
                  group: "Core",
                })),
                ...subjectAggregate.bestElectives.map((subject) => ({
                  ...subject,
                  group: "Best other",
                })),
              ].map((subject) => (
                <div
                  key={`${subject.group}-${subject.subject}`}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: "#fff",
                    color: "#334155",
                    fontSize: ".76rem",
                  }}
                >
                  <span>{subject.subject}</span>
                  <strong>
                    Grade {subject.grade}{" "}
                    <span style={{ color: "#94a3b8", fontWeight: 500 }}>
                      ({subject.group})
                    </span>
                  </strong>
                </div>
              ))}
            </div>
            {subjectAggregate.aggregate == null && (
              <p
                style={{
                  margin: "10px 0 0",
                  color: "#92400e",
                  fontSize: ".76rem",
                }}
              >
                {subjectAggregate.missingCoreSubjects.length > 0
                  ? `Awaiting core results: ${subjectAggregate.missingCoreSubjects.join(", ")}.`
                  : `Add ${subjectAggregate.missingElectives} more non-core subject result${subjectAggregate.missingElectives === 1 ? "" : "s"} to calculate the aggregate.`}
              </p>
            )}
          </div>
          <div style={{ marginTop: 18 }}>
            <h3 style={{ margin: "0 0 10px", fontSize: ".92rem" }}>
              Subject Performance
            </h3>
            {[...latestTermRecords]
              .sort((a, b) => a.subject.localeCompare(b.subject))
              .map((record) => {
                const grade = getGrade(record.score);
                return (
                  <div
                    key={`${record.subject}-${record.exam_type}`}
                    className="subject-progress-row"
                  >
                    <span className="subject-progress-label">
                      {record.subject}
                    </span>
                    <div className="progress" style={{ flex: 1 }}>
                      <div
                        className="progress-bar"
                        style={{
                          width: `${Math.max(0, Math.min(100, record.score))}%`,
                          background: grade.color,
                        }}
                      />
                    </div>
                    <span className="subject-progress-value">
                      {record.score}%
                    </span>
                  </div>
                );
              })}
          </div>
        </section>
      )}
      {!records.length ? (
        <div className="card card-padded" style={{ color: "#64748b" }}>
          No academic results have been recorded yet.
        </div>
      ) : (
        sortedYears.map(([year, terms]) => (
          <section
            key={year}
            className="card card-padded"
            style={{ marginBottom: 16 }}
          >
            <h2 style={{ margin: "0 0 14px", color: "#1e3a8a" }}>
              Academic Year {year}
            </h2>
            {[...terms.entries()]
              .sort(([termA], [termB]) => compareTerms(termA, termB))
              .map(([term, termRecords]) => {
                const sortedRecords = [...termRecords].sort((a, b) =>
                  a.subject.localeCompare(b.subject),
                );
                return (
                  <section
                    key={`${year}-${term}`}
                    style={{
                      marginTop: 12,
                      overflow: "hidden",
                      border: "1px solid #e2e8f0",
                      borderRadius: 12,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        padding: "12px 16px",
                        background: "#f8fafc",
                      }}
                    >
                      <h3 style={{ margin: 0, fontSize: "1rem" }}>{term}</h3>
                      <span style={{ color: "#64748b", fontSize: ".82rem" }}>
                        Average: {averageOf(termRecords)}%   {termRecords.length}{" "}
                        result{termRecords.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Subject</th>
                            <th>Assessment</th>
                            <th>Score</th>
                            <th>Grade</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedRecords.map((record, index) => {
                            const grade = getGrade(record.score);
                            return (
                              <tr
                                key={
                                  record.id ||
                                  `${record.subject}-${record.exam_type}-${index}`
                                }
                              >
                                <td>{record.subject}</td>
                                <td>{record.exam_type || "Assessment"}</td>
                                <td>{record.score}%</td>
                                <td>
                                  <span
                                    className="grade-chip"
                                    style={{
                                      background: grade.bg,
                                      color: grade.color,
                                    }}
                                  >
                                    {grade.grade}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                );
              })}
          </section>
        ))
      )}
    </div>
  );
}

function StudentResultsPage({ scoreValues, attendanceData, feesData }) {
  const rows = (scoreValues || []).map((score, i) => {
    const gradeInfo = getGrade(Number(score || 0));
    return {
      id: i + 1,
      subject: SUBJECTS[i] || `Subject ${i + 1}`,
      score: Number(score || 0),
      grade: gradeInfo.grade,
      color: gradeInfo.color,
      bg: gradeInfo.bg,
    };
  });
  const averageScore = rows.length
    ? Math.round(rows.reduce((sum, row) => sum + row.score, 0) / rows.length)
    : 0;
  const bestSubject = rows.length
    ? [...rows].sort((a, b) => b.score - a.score)[0]
    : null;
  const weakSubject = rows.length
    ? [...rows].sort((a, b) => a.score - b.score)[0]
    : null;
  const gradeCounts = rows.reduce(
    (acc, row) => {
      const key = row.grade || "9";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    },
    Object.fromEntries(Array.from({ length: 9 }, (_, index) => [String(index + 1), 0])),
  );
  const values = rows.map((row) => Number(row.score || 0)).filter((v) => Number.isFinite(v));
  const avg = values.length
    ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
    : 0;
  const attendanceRows = attendanceData || [];
  const present = attendanceRows.filter(
    (a) => String(a.status).toLowerCase() === "present",
  ).length;
  const attendanceRate = Math.round(
    (present / Math.max(attendanceRows.length, 1)) * 100,
  );
  const feeRows = feesData || [];
  const outstanding = feeRows.reduce(
    (sum, f) => sum + Math.max(Number(f.amount || 0) - Number(f.paid || 0), 0),
    0,
  );
  const { cfg } = useContext(SettingsContext);
  const feesEnabled = cfg.studentFeesPortalEnabled !== false;
  const total = Math.max(rows.length, 1);
  const summarySegments = Array.from({ length: 9 }, (_, index) => {
    const grade = String(index + 1);
    const representativeScores = [95, 82, 77, 72, 67, 62, 57, 52, 25];
    return {
      grade,
      color: getGrade(representativeScores[index]).color,
    };
  });
  let studentProgress = 0;
  const studentDonut = summarySegments
    .map((segment) => {
      const start = Math.round(studentProgress * 360);
      studentProgress += (gradeCounts[segment.grade] || 0) / total;
      const end = Math.round(studentProgress * 360);
      return `${segment.color} ${start}deg ${end}deg`;
    })
    .join(", ");

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Results & Analytics</div>
        <div className="page-sub">
          Your academic results and performance insights in one view.
        </div>
      </div>
      <div className="stats-grid stats-grid-3">
        <div className="stat-card" style={{ background: "#eef2ff" }}>
          <div className="stat-label" style={{ color: "#1e3a8a" }}>
            Average Score
          </div>
          <div className="stat-value" style={{ color: "#1e3a8a" }}>
            {rows.length ? `${averageScore}%` : "N/A"}
          </div>
          <div className="stat-sub" style={{ color: "#1e3a8a" }}>
            Across all recorded subjects
          </div>
        </div>
        <div className="stat-card" style={{ background: "#dcfce7" }}>
          <div className="stat-label" style={{ color: "#166534" }}>
            Best Subject
          </div>
          <div
            className="stat-value"
            style={{ color: "#166534", fontSize: "1.1rem" }}
          >
            {bestSubject?.subject || "N/A"}
          </div>
          <div className="stat-sub" style={{ color: "#166534" }}>
            {bestSubject ? `${bestSubject.score}%` : "No subject score yet"}
          </div>
        </div>
        <div className="stat-card" style={{ background: "#fee2e2" }}>
          <div className="stat-label" style={{ color: "#991b1b" }}>
            Focus Subject
          </div>
          <div
            className="stat-value"
            style={{ color: "#991b1b", fontSize: "1.1rem" }}
          >
            {weakSubject?.subject || "N/A"}
          </div>
          <div className="stat-sub" style={{ color: "#991b1b" }}>
            {weakSubject
              ? `${weakSubject.score}% - prioritize revision`
              : "No subject score yet"}
          </div>
        </div>
      </div>
      <div className="stats-grid" style={{ marginTop: 12 }}>
        {[
          {
            label: "Average Score",
            value: values.length ? `${avg}%` : "N/A",
            sub: values.length ? "From your current results" : "No score data yet",
            bg: "#dbeafe",
            c: "#1e40af",
          },
          {
            label: "Attendance",
            value: `${attendanceRate}%`,
            sub: `${present}/${attendanceRows.length} present`,
            bg: "#dcfce7",
            c: "#16a34a",
          },
          ...(feesEnabled
            ? [
                {
                  label: "Outstanding Fees",
                  value: `GHS ${outstanding}`,
                  sub: outstanding > 0 ? "Pending payment" : "Cleared",
                  bg: outstanding > 0 ? "#fee2e2" : "#dcfce7",
                  c: outstanding > 0 ? "#dc2626" : "#16a34a",
                },
              ]
            : []),
        ].map((s) => (
          <div key={s.label} className="stat-card" style={{ background: s.bg }}>
            <div className="stat-label" style={{ color: s.c }}>
              {s.label}
            </div>
            <div className="stat-value" style={{ color: s.c }}>
              {s.value}
            </div>
            <div className="stat-sub" style={{ color: s.c }}>
              {s.sub}
            </div>
          </div>
        ))}
      </div>
      <div className="card card-padded" style={{ marginTop: 14 }}>
        <h3 style={{ fontWeight: 700, marginBottom: 10 }}>
          Subject Strength Snapshot
        </h3>
        {values.length ? (
          values.map((v, i) => (
            <div key={`${i}-${v}`} className="subject-progress-row">
              <span className="subject-progress-label">
                {SUBJECTS[i] || `Subject ${i + 1}`}
              </span>
              <div className="progress" style={{ flex: 1 }}>
                <div
                  className="progress-bar"
                  style={{
                    width: `${Math.max(0, Math.min(100, v))}%`,
                    background:
                      v >= 70 ? "#16a34a" : v >= 55 ? "#d97706" : "#dc2626",
                  }}
                />
              </div>
              <span className="subject-progress-value">{v}%</span>
            </div>
          ))
        ) : (
          <div style={{ color: "#64748b" }}>No score data to analyze yet.</div>
        )}
      </div>
      <div className="results-visual-grid results-visual-grid-wide">
        <div className="results-panel">
          <h3>Subject Performance Bars</h3>
          <div className="results-bars">
            {rows.map((row) => (
              <div className="results-bar-row" key={`student-score-${row.id}`}>
                <span>{row.subject}</span>
                <div className="results-bar-track">
                  <div
                    className="results-bar-fill"
                    style={{
                      width: `${Math.max(0, Math.min(100, row.score))}%`,
                      background:
                        row.score >= 75
                          ? "#16a34a"
                          : row.score >= 60
                            ? "#d97706"
                            : "#dc2626",
                    }}
                  />
                </div>
                <strong>{row.score}%</strong>
              </div>
            ))}
            {!rows.length && (
              <div style={{ color: "#64748b", fontSize: ".82rem" }}>
                No subjects with recorded scores yet.
              </div>
            )}
          </div>
        </div>
        <div className="results-panel">
          <h3>Grade Mix</h3>
          <div
            className="results-donut"
            style={{
              background: `conic-gradient(${studentDonut || "#e2e8f0 0deg 360deg"})`,
            }}
          >
            <div className="results-donut-center">
              <strong>{rows.length}</strong>
              <span>Subjects</span>
            </div>
          </div>
          <div className="results-legend">
            {summarySegments.map((segment) => (
              <div key={segment.grade} className="results-legend-item">
                <span style={{ display: "inline-flex", alignItems: "center" }}>
                  <span
                    className="results-dot"
                    style={{ background: segment.color }}
                  />
                  Grade {segment.grade}
                </span>
                <b>{gradeCounts[segment.grade] || 0}</b>
              </div>
            ))}
          </div>
        </div>
        <div className="results-panel">
          <h3>Readiness Gauge</h3>
          <div style={{ padding: "10px 6px" }}>
            <div
              className="progress"
              style={{ height: 14, background: "#e2e8f0" }}
            >
              <div
                className="progress-bar"
                style={{
                  width: `${Math.max(0, Math.min(100, averageScore))}%`,
                  background:
                    averageScore >= 75
                      ? "#16a34a"
                      : averageScore >= 60
                        ? "#d97706"
                        : "#dc2626",
                }}
              />
            </div>
            <div className="progress-scale">
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
            <div
              style={{
                marginTop: 12,
                fontWeight: 700,
                color: "#0f172a",
                fontSize: ".95rem",
              }}
            >
              Exam Readiness: {rows.length ? `${averageScore}%` : "N/A"}
            </div>
            <div style={{ marginTop: 6, color: "#64748b", fontSize: ".8rem" }}>
              {averageScore >= 75
                ? "Strong performance profile"
                : averageScore >= 60
                  ? "Stable progress with room to improve"
                  : "Focused intervention recommended"}
            </div>
          </div>
        </div>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Subject</th>
              <th>Score</th>
              <th>Grade</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.subject}</td>
                <td>{r.score}</td>
                <td>
                  <span
                    className="grade-chip"
                    style={{ background: r.bg, color: r.color }}
                  >
                    {r.grade}
                  </span>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td
                  colSpan="3"
                  style={{ textAlign: "center", padding: 22, color: "#64748b" }}
                >
                  No live result rows available yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StudentAnalyticsPage({ scoreValues, attendanceData, feesData }) {
  const values = Array.isArray(scoreValues)
    ? scoreValues.map((v) => Number(v || 0)).filter((v) => Number.isFinite(v))
    : [];
  const avg = values.length
    ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
    : 0;
  const attendanceRows = attendanceData || [];
  const present = attendanceRows.filter(
    (a) => String(a.status).toLowerCase() === "present",
  ).length;
  const attendanceRate = Math.round(
    (present / Math.max(attendanceRows.length, 1)) * 100,
  );
  const feeRows = feesData || [];
  const outstanding = feeRows.reduce(
    (sum, f) => sum + Math.max(Number(f.amount || 0) - Number(f.paid || 0), 0),
    0,
  );

  const { cfg } = useContext(SettingsContext);
  const feesEnabled = cfg.studentFeesPortalEnabled !== false;
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Analytics</div>
        <div className="page-sub">
          Performance insights from your live academic and finance records.
        </div>
      </div>
      <div className="stats-grid">
        {[
          {
            label: "Average Score",
            value: values.length ? `${avg}%` : "N/A",
            sub: values.length ? "From live scores" : "No score data",
            bg: "#dbeafe",
            c: "#1e40af",
          },
          {
            label: "Attendance",
            value: `${attendanceRate}%`,
            sub: `${present}/${attendanceRows.length} present`,
            bg: "#dcfce7",
            c: "#16a34a",
          },
          ...(feesEnabled
            ? [
                {
                  label: "Outstanding Fees",
                  value: `GHS ${outstanding}`,
                  sub: outstanding > 0 ? "Pending payment" : "Cleared",
                  bg: outstanding > 0 ? "#fee2e2" : "#dcfce7",
                  c: outstanding > 0 ? "#dc2626" : "#16a34a",
                },
              ]
            : []),
        ].map((s) => (
          <div key={s.label} className="stat-card" style={{ background: s.bg }}>
            <div className="stat-label" style={{ color: s.c }}>
              {s.label}
            </div>
            <div
              className="stat-value"
              style={{ color: s.c, fontSize: "1.5rem" }}
            >
              {s.value}
            </div>
            <div className="stat-sub" style={{ color: s.c }}>
              {s.sub}
            </div>
          </div>
        ))}
      </div>
      <div className="card card-padded">
        <h3 style={{ fontWeight: 700, marginBottom: 10 }}>
          Subject Strength Snapshot
        </h3>
        {values.length ? (
          values.map((v, i) => (
            <div key={`${i}-${v}`} className="subject-progress-row">
              <span className="subject-progress-label">
                {SUBJECTS[i] || `Subject ${i + 1}`}
              </span>
              <div className="progress" style={{ flex: 1 }}>
                <div
                  className="progress-bar"
                  style={{
                    width: `${Math.max(0, Math.min(100, v))}%`,
                    background:
                      v >= 70 ? "#16a34a" : v >= 55 ? "#d97706" : "#dc2626",
                  }}
                />
              </div>
              <span className="subject-progress-value">{v}%</span>
            </div>
          ))
        ) : (
          <div style={{ color: "#64748b" }}>No score data to analyze yet.</div>
        )}
      </div>
    </div>
  );
}

function StudyPlannerPage() {
  const { records: plan, loading, error, saveRecord } =
    useStudentPortalRecords("study_plan");
  const [form, setForm] = useState({
    day: "Monday",
    focus: "",
    duration: "1h",
  });
  const isMobile = useIsMobileLayout();
  const add = async () => {
    if (!form.focus) return;
    const saved = await saveRecord({
      ...form,
      created_at: new Date().toISOString(),
    });
    if (saved) setForm({ day: "Monday", focus: "", duration: "1h" });
  };
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Study Planner</div>
        <div className="page-sub">Build a weekly revision plan.</div>
      </div>
      {error && <div className="alert alert-warning">{error}</div>}
      <div className="card card-padded" style={{ marginBottom: 12 }}>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Day</label>
            <select
              className="form-control"
              value={form.day}
              onChange={(e) => setForm((f) => ({ ...f, day: e.target.value }))}
            >
              {[
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
                "Sunday",
              ].map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Focus Area</label>
            <input
              className="form-control"
              value={form.focus}
              onChange={(e) =>
                setForm((f) => ({ ...f, focus: e.target.value }))
              }
            />
          </div>
          <div className="form-group">
            <label className="form-label">Duration</label>
            <input
              className="form-control"
              value={form.duration}
              onChange={(e) =>
                setForm((f) => ({ ...f, duration: e.target.value }))
              }
            />
          </div>
        </div>
        <button
          className="btn btn-blue"
          style={{ marginTop: 10 }}
          onClick={add}
        >
          Add Session
        </button>
      </div>
      {isMobile ? (
        <div className="mobile-record-list">
          {loading && <div className="mobile-record-card">Loading saved sessions...</div>}
          {plan.map((p) => (
            <div key={p.id} className="mobile-record-card">
              <div className="mobile-record-head">
                <div>
                  <div className="mobile-record-title">{p.focus}</div>
                  <div className="mobile-record-sub">{p.day}</div>
                </div>
                <strong>{p.duration}</strong>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Focus</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan="3">Loading saved sessions...</td></tr>}
              {plan.map((p) => (
                <tr key={p.id}>
                  <td>{p.day}</td>
                  <td>{p.focus}</td>
                  <td>{p.duration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AttendanceCorrectionPage({ attendanceData }) {
  const isMobile = useIsMobileLayout();
  const {
    records: requests,
    loading,
    error,
    saveRecord,
  } = useStudentPortalRecords("attendance_correction");
  const [note, setNote] = useState("");
  const rows = (attendanceData || []).filter(
    (x) => String(x.status).toLowerCase() !== "present",
  );
  const submit = async (row) => {
    if (!note.trim()) return;
    const saved = await saveRecord({
      date: row.date,
      attendance_id: row.id,
      status: row.status,
      note,
      state: "pending",
      submitted_at: new Date().toISOString(),
    });
    if (saved) setNote("");
  };
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Attendance Correction Requests</div>
        <div className="page-sub">Request review for absent/late records.</div>
      </div>
      {error && <div className="alert alert-warning">{error}</div>}
      <div className="card card-padded" style={{ marginBottom: 12 }}>
        <label className="form-label">Evidence/Reason</label>
        <textarea
          className="form-control"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Explain why this record should be corrected"
        />
      </div>
      {isMobile ? (
        <>
          <div className="mobile-record-list" style={{ marginBottom: 12 }}>
            {loading && <div className="mobile-record-card">Loading saved requests...</div>}
            {rows.map((r) => (
              <div key={r.id} className="mobile-record-card">
                <div className="mobile-record-head">
                  <div>
                    <div className="mobile-record-title">{r.date}</div>
                    <div className="mobile-record-sub">
                      Current status: {r.status}
                    </div>
                  </div>
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={() => submit(r)}
                  >
                    Request
                  </button>
                </div>
              </div>
            ))}
            {!rows.length && (
              <div
                className="mobile-record-card"
                style={{ textAlign: "center", color: "#64748b" }}
              >
                No absent/late records to dispute.
              </div>
            )}
          </div>
          <div className="mobile-record-list">
            {requests.map((r) => (
              <div key={r.id} className="mobile-record-card">
                <div className="mobile-record-head">
                  <div>
                    <div className="mobile-record-title">{r.date}</div>
                    <div className="mobile-record-sub">
                      Original: {r.status}
                    </div>
                  </div>
                  <span className="badge badge-warning">{r.state}</span>
                </div>
                <div className="mobile-record-item">
                  <label>Reason</label>
                  <span>{r.note}</span>
                </div>
              </div>
            ))}
            {!requests.length && (
              <div
                className="mobile-record-card"
                style={{ textAlign: "center", color: "#64748b" }}
              >
                No correction requests submitted yet.
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="card table-wrap" style={{ marginBottom: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.date}</td>
                    <td>{r.status}</td>
                    <td>
                      <button
                        className="btn btn-sm btn-outline"
                        onClick={() => submit(r)}
                      >
                        Request Correction
                      </button>
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td
                      colSpan="3"
                      style={{
                        textAlign: "center",
                        padding: 18,
                        color: "#64748b",
                      }}
                    >
                      No absent/late records to dispute.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Original Status</th>
                  <th>Reason</th>
                  <th>Request Status</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan="4">Loading saved requests...</td></tr>}
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td>{r.date}</td>
                    <td>{r.status}</td>
                    <td>{r.note}</td>
                    <td>
                      <span className="badge badge-warning">{r.state}</span>
                    </td>
                  </tr>
                ))}
                {!requests.length && (
                  <tr>
                    <td
                      colSpan="4"
                      style={{
                        textAlign: "center",
                        padding: 18,
                        color: "#64748b",
                      }}
                    >
                      No correction requests submitted yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function StudentPaymentsPage({ feesData }) {
  const { cfg } = useContext(SettingsContext);
  const feesEnabled = cfg.studentFeesPortalEnabled !== false;
  const isMobile = useIsMobileLayout();
  const {
    records: payments,
    loading,
    error,
    saveRecord,
  } = useStudentPortalRecords("payment_notice");
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState({
    term: feesData?.[0]?.term || "First Term",
    amount: "",
    method: "mobile-money",
  });
  if (!feesEnabled) {
    return (
      <div className="fade-in">
        <div className="page-header">
          <div className="page-title">Pay Fees</div>
          <div className="page-sub">
            Fee payment is disabled in your portal settings.
          </div>
        </div>
        <div className="card card-padded alert alert-info">
          Fees are currently disabled, so payment options are unavailable.
        </div>
      </div>
    );
  }

  const pay = async () => {
    const amount = Number(form.amount);
    const selectedFee = (feesData || []).find((fee) => fee.term === form.term);
    const balance = selectedFee
      ? Math.max(Number(selectedFee.amount || 0) - Number(selectedFee.paid || 0), 0)
      : 0;
    if (!Number.isFinite(amount) || amount <= 0 || amount > balance) {
      setFormError("Enter an amount greater than zero and no more than the outstanding balance for that term.");
      return;
    }
    setFormError("");
    const saved = await saveRecord({
      term: form.term,
      fee_id: selectedFee?.id || null,
      amount,
      method: form.method,
      status: "pending_verification",
      submitted_at: new Date().toISOString(),
    });
    if (saved) setForm((current) => ({ ...current, amount: "" }));
  };
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Pay Fees</div>
        <div className="page-sub">
          Submit a payment notice for the school to verify. This does not process a payment.
        </div>
      </div>
      {(error || formError) && (
        <div className="alert alert-warning">{formError || error}</div>
      )}
      <div className="card card-padded" style={{ marginBottom: 12 }}>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Term</label>
            <select
              className="form-control"
              value={form.term}
              onChange={(e) => setForm((f) => ({ ...f, term: e.target.value }))}
            >
              {Array.from(new Set((feesData || []).map((fee) => fee.term))).map((term) => (
                <option key={term}>{term}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Amount (GHS)</label>
            <input
              type="number"
              className="form-control"
              value={form.amount}
              onChange={(e) =>
                setForm((f) => ({ ...f, amount: e.target.value }))
              }
            />
          </div>
          <div className="form-group">
            <label className="form-label">Method</label>
            <select
              className="form-control"
              value={form.method}
              onChange={(e) =>
                setForm((f) => ({ ...f, method: e.target.value }))
              }
            >
              <option value="mobile-money">Mobile Money</option>
              <option value="card">Card</option>
              <option value="bank">Bank Transfer</option>
            </select>
          </div>
        </div>
        <button
          className="btn btn-blue"
          style={{ marginTop: 10 }}
          onClick={pay}
        >
          Submit Payment Notice
        </button>
      </div>
      {isMobile ? (
        <div className="mobile-record-list">
          {loading && <div className="mobile-record-card">Loading saved payment notices...</div>}
          {payments.map((p) => (
            <div key={p.id} className="mobile-record-card">
              <div className="mobile-record-head">
                <div>
                  <div className="mobile-record-title">{p.term}</div>
                  <div className="mobile-record-sub">
                    {new Date(p.submitted_at).toLocaleString()}
                  </div>
                </div>
                <strong>GHS {p.amount}</strong>
              </div>
              <div className="mobile-record-grid">
                <div className="mobile-record-item">
                  <label>Method</label>
                  <span>{p.method}</span>
                </div>
                <div className="mobile-record-item">
                  <label>Status</label>
                  <strong>{String(p.status || "").replaceAll("_", " ")}</strong>
                </div>
              </div>
            </div>
          ))}
          {!payments.length && (
            <div
              className="mobile-record-card"
              style={{ textAlign: "center", color: "#64748b" }}
            >
              No payment attempts yet.
            </div>
          )}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Term</th>
                <th>Amount</th>
                <th>Method</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan="5">Loading saved payment notices...</td></tr>}
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>{new Date(p.submitted_at).toLocaleString()}</td>
                  <td>{p.term}</td>
                  <td>GHS {p.amount}</td>
                  <td>{p.method}</td>
                  <td>
                    <strong>{String(p.status || "").replaceAll("_", " ")}</strong>
                  </td>
                </tr>
              ))}
              {!payments.length && (
                <tr>
                  <td
                    colSpan="5"
                    style={{
                      textAlign: "center",
                      padding: 18,
                      color: "#64748b",
                    }}
                  >
                    No payment attempts yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StudentPaymentPlansPage({ feesData }) {
  const { cfg } = useContext(SettingsContext);
  const feesEnabled = cfg.studentFeesPortalEnabled !== false;
  const {
    records: plans,
    loading,
    error,
    saveRecord,
  } = useStudentPortalRecords("payment_plan");
  const outstanding = (feesData || []).reduce(
    (s, f) => s + Math.max(Number(f.amount || 0) - Number(f.paid || 0), 0),
    0,
  );
  const [months, setMonths] = useState(3);
  if (!feesEnabled) {
    return (
      <div className="fade-in">
        <div className="page-header">
          <div className="page-title">Payment Plan Request</div>
          <div className="page-sub">Fee installment options are disabled.</div>
        </div>
        <div className="card card-padded alert alert-info">
          Fee portal features are disabled in this portal configuration.
        </div>
      </div>
    );
  }

  const requestPlan = async () => {
    if (!outstanding) return;
    await saveRecord({
      total: outstanding,
      months,
      installment: Math.ceil(outstanding / months),
      status: "requested",
      submitted_at: new Date().toISOString(),
    });
  };
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Payment Plan Request</div>
        <div className="page-sub">Apply for fee installment support.</div>
      </div>
      {error && <div className="alert alert-warning">{error}</div>}
      <div className="card card-padded">
        <div style={{ marginBottom: 10 }}>
          Outstanding Balance: <strong>GHS {outstanding}</strong>
        </div>
        <div className="form-group form-group-slim">
          <label className="form-label">Installment Months</label>
          <input
            type="number"
            className="form-control"
            min={2}
            max={12}
            value={months}
            onChange={(e) =>
              setMonths(Math.max(2, Math.min(12, Number(e.target.value || 2))))
            }
          />
        </div>
        <button
          className="btn btn-blue"
          style={{ marginTop: 10 }}
          onClick={requestPlan}
        >
          Request Plan
        </button>
        {loading && <div className="alert alert-info" style={{ marginTop: 12 }}>Loading saved requests...</div>}
        {plans.map((plan) => (
          <div className="alert alert-info" style={{ marginTop: 12 }} key={plan.id}>
            Plan requested: {plan.months} months at GHS {plan.installment}/month ({plan.status}).
          </div>
        ))}
      </div>
    </div>
  );
}

function StudentUploadDocsPage() {
  const isMobile = useIsMobileLayout();
  const {
    records: uploads,
    loading,
    error,
    studentId,
    saveRecord,
  } = useStudentPortalRecords("student_document");
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [docType, setDocType] = useState("ID Document");
  const onPick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type) || file.size > 10 * 1024 * 1024) {
      setUploadError("Choose a PDF, JPEG, PNG, or WebP file no larger than 10 MB.");
      e.target.value = "";
      return;
    }
    if (!studentId || !supabase) {
      setUploadError("Sign in with a linked student account before uploading documents.");
      e.target.value = "";
      return;
    }

    setUploading(true);
    setUploadError("");
    const fileName = file.name.replace(/[^\w.-]+/g, "_");
    const storagePath = `${studentId}/${globalThis.crypto.randomUUID()}-${fileName}`;
    try {
      const { error: storageError } = await supabase.storage
        .from("student-documents")
        .upload(storagePath, file, { contentType: file.type, upsert: false });
      if (storageError) throw storageError;

      const saved = await saveRecord({
        docType,
        fileName: file.name,
        size: file.size,
        status: "submitted",
        storagePath,
        at: new Date().toISOString(),
      });
      if (!saved) {
        const { error: cleanupError } = await supabase.storage
          .from("student-documents")
          .remove([storagePath]);
        if (cleanupError) {
          setUploadError(`Document metadata was not saved and uploaded file cleanup failed: ${cleanupError.message}`);
        }
      }
    } catch (uploadError) {
      setUploadError(`Document was not uploaded: ${uploadError.message || "Supabase request failed."}`);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Upload Documents</div>
        <div className="page-sub">
          Submit required files and track verification status.
        </div>
        {(error || uploadError) && <div className="alert alert-warning">{uploadError || error}</div>}
      </div>
      <div className="card card-padded" style={{ marginBottom: 12 }}>
        <div className="form-group form-group-narrow">
          <label className="form-label">Document Type</label>
          <select
            className="form-control"
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
          >
            <option>ID Document</option>
            <option>Birth Certificate</option>
            <option>Result Slip</option>
            <option>Payment Proof</option>
          </select>
        </div>
        <input
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp"
          onChange={onPick}
          disabled={uploading}
        />
        {uploading && <div className="alert alert-info">Uploading document to Supabase...</div>}
      </div>
      {isMobile ? (
        <div className="mobile-record-list">
          {loading && <div className="mobile-record-card">Loading saved uploads...</div>}
          {uploads.map((u) => (
            <div key={u.id} className="mobile-record-card">
              <div className="mobile-record-head">
                <div>
                  <div className="mobile-record-title">{u.docType}</div>
                  <div className="mobile-record-sub">
                    {new Date(u.at).toLocaleString()}
                  </div>
                </div>
                <span className="badge badge-warning">{u.status}</span>
              </div>
              <div className="mobile-record-grid">
                <div className="mobile-record-item">
                  <label>File</label>
                  <span>{u.fileName}</span>
                </div>
              </div>
            </div>
          ))}
          {!uploads.length && (
            <div
              className="mobile-record-card"
              style={{ textAlign: "center", color: "#64748b" }}
            >
              No documents uploaded yet.
            </div>
          )}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th>File</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan="4">Loading saved uploads...</td></tr>}
              {uploads.map((u) => (
                <tr key={u.id}>
                  <td>{new Date(u.at).toLocaleString()}</td>
                  <td>{u.docType}</td>
                  <td>{u.fileName}</td>
                  <td>
                    <span className="badge badge-warning">{u.status}</span>
                  </td>
                </tr>
              ))}
              {!uploads.length && (
                <tr>
                  <td
                    colSpan="4"
                    style={{
                      textAlign: "center",
                      padding: 18,
                      color: "#64748b",
                    }}
                  >
                    No documents uploaded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CalendarSyncPage() {
  const events = EVENTS_DATA.map((e) => ({ title: e.title, date: e.date }));
  const downloadIcs = () => {
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Campus Ghana//Student Calendar//EN",
    ];
    events.forEach((ev) => {
      const dt = String(ev.date || "").replaceAll("-", "") || "20260501";
      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${dt}-${ev.title.replace(/\s+/g, "-")}@campusghana`);
      lines.push(
        `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z`,
      );
      lines.push(`DTSTART;VALUE=DATE:${dt}`);
      lines.push(`SUMMARY:${ev.title}`);
      lines.push("END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    const blob = new Blob([lines.join("\r\n")], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "student-calendar.ics";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Calendar Sync</div>
        <div className="page-sub">
          Download ICS and sync deadlines to your phone calendar.
        </div>
      </div>
      <div className="card card-padded">
        <button className="btn btn-blue" onClick={downloadIcs}>
          Download Calendar (.ics)
        </button>
        <div style={{ marginTop: 12, fontSize: ".84rem", color: "#64748b" }}>
          Import the .ics file into Google Calendar, Apple Calendar, or Outlook.
        </div>
      </div>
    </div>
  );
}

function StudentTicketsPage() {
  const {
    records: tickets,
    loading,
    error,
    saveRecord,
  } = useStudentPortalRecords("support_ticket");
  const [form, setForm] = useState({ subject: "", message: "" });
  const isMobile = useIsMobileLayout();
  const submit = async () => {
    if (!form.subject || !form.message) return;
    const saved = await saveRecord({
      ...form,
      status: "open",
      submitted_at: new Date().toISOString(),
    });
    if (saved) setForm({ subject: "", message: "" });
  };
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Support Tickets</div>
        <div className="page-sub">Create and track your support requests.</div>
      </div>
      {error && <div className="alert alert-warning">{error}</div>}
      <div className="card card-padded" style={{ marginBottom: 12 }}>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Subject</label>
            <input
              className="form-control"
              value={form.subject}
              onChange={(e) =>
                setForm((f) => ({ ...f, subject: e.target.value }))
              }
            />
          </div>
          <div className="form-group">
            <label className="form-label">Message</label>
            <input
              className="form-control"
              value={form.message}
              onChange={(e) =>
                setForm((f) => ({ ...f, message: e.target.value }))
              }
            />
          </div>
        </div>
        <button
          className="btn btn-blue"
          style={{ marginTop: 10 }}
          onClick={submit}
        >
          Submit Ticket
        </button>
      </div>
      {isMobile ? (
        <div className="mobile-record-list">
          {loading && <div className="mobile-record-card">Loading saved tickets...</div>}
          {tickets.map((t) => (
            <div key={t.id} className="mobile-record-card">
              <div className="mobile-record-head">
                <div>
                  <div className="mobile-record-title">{t.subject}</div>
                  <div className="mobile-record-sub">
                    {new Date(t.submitted_at).toLocaleString()}
                  </div>
                </div>
                <span className="badge badge-warning">{t.status}</span>
              </div>
              <div className="mobile-record-item">
                <label>Message</label>
                <span>{t.message}</span>
              </div>
              {t.admin_response && (
                <div className="mobile-record-item">
                  <label>Admin response</label>
                  <span>{t.admin_response}</span>
                  {t.responded_at && <small>{new Date(t.responded_at).toLocaleString()}</small>}
                </div>
              )}
            </div>
          ))}
          {!tickets.length && (
            <div
              className="mobile-record-card"
              style={{ textAlign: "center", color: "#64748b" }}
            >
              No support tickets submitted.
            </div>
          )}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Subject</th>
                <th>Status</th>
                <th>Admin response</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan="4">Loading saved tickets...</td></tr>}
              {tickets.map((t) => (
                <tr key={t.id}>
                  <td>{new Date(t.submitted_at).toLocaleString()}</td>
                  <td>{t.subject}</td>
                  <td>
                    <span className="badge badge-warning">{t.status}</span>
                  </td>
                  <td>
                    {t.admin_response || "No response yet"}
                    {t.responded_at && <div className="students-table-sub">{new Date(t.responded_at).toLocaleString()}</div>}
                  </td>
                </tr>
              ))}
              {!tickets.length && (
                <tr>
                  <td
                    colSpan="4"
                    style={{
                      textAlign: "center",
                      padding: 18,
                      color: "#64748b",
                    }}
                  >
                    No support tickets submitted.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StudentGoalsPage() {
  const {
    records: goals,
    loading,
    error,
    saveRecord,
  } = useStudentPortalRecords("student_goal");
  const savedGoal = goals[0];
  const [goal, setGoal] = useState({
    aggregateTarget: 8,
    attendanceTarget: 95,
  });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (savedGoal) {
      setGoal({
        aggregateTarget: Number(savedGoal.aggregateTarget ?? 8),
        attendanceTarget: Number(savedGoal.attendanceTarget ?? 95),
      });
    }
  }, [savedGoal?.id]);
  const saveGoal = async () => {
    setSaving(true);
    try {
      await saveRecord(goal, "goal");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Goals & Targets</div>
        <div className="page-sub">Set academic and attendance targets.</div>
      </div>
      {error && <div className="alert alert-warning">{error}</div>}
      <div className="card card-padded">
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Target Aggregate</label>
            <input
              type="number"
              className="form-control"
              value={goal.aggregateTarget}
              onChange={(e) =>
                setGoal((g) => ({
                  ...g,
                  aggregateTarget: Number(e.target.value || 0),
                }))
              }
            />
          </div>
          <div className="form-group">
            <label className="form-label">Target Attendance (%)</label>
            <input
              type="number"
              className="form-control"
              value={goal.attendanceTarget}
              onChange={(e) =>
                setGoal((g) => ({
                  ...g,
                  attendanceTarget: Number(e.target.value || 0),
                }))
              }
            />
          </div>
        </div>
        <button className="btn btn-blue" style={{ marginTop: 12 }} onClick={saveGoal} disabled={saving || loading}>
          {saving ? "Saving..." : "Save Goals"}
        </button>
        {loading && <div className="alert alert-info" style={{ marginTop: 12 }}>Loading saved goals...</div>}
      </div>
    </div>
  );
}

function ScholarshipBoardPage() {
  const rows = [
    {
      id: 1,
      title: "STEM Excellence Scholarship",
      deadline: "2026-06-01",
      eligibility: "Aggregate <= 10",
    },
    {
      id: 2,
      title: "Girls in Science Fund",
      deadline: "2026-05-25",
      eligibility: "Female students in STEM",
    },
  ];
  const isMobile = useIsMobileLayout();
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Scholarship Board</div>
        <div className="page-sub">
          Discover opportunities and eligibility criteria.
        </div>
      </div>
      {isMobile ? (
        <div className="mobile-record-list">
          {rows.map((r) => (
            <div key={r.id} className="mobile-record-card">
              <div className="mobile-record-head">
                <div>
                  <div className="mobile-record-title">{r.title}</div>
                  <div className="mobile-record-sub">
                    Deadline: {r.deadline}
                  </div>
                </div>
              </div>
              <div className="mobile-record-item">
                <label>Eligibility</label>
                <span>{r.eligibility}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Opportunity</th>
                <th>Deadline</th>
                <th>Eligibility</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.title}</td>
                  <td>{r.deadline}</td>
                  <td>{r.eligibility}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LearningResourcesPage() {
  const [activeTab, setActiveTab] = useState("browse");
  const [resources] = useState([
    {
      id: 1,
      subject: "Mathematics",
      title: "Past Questions Pack",
      type: "PDF",
      downloads: 342,
      rating: 4.8,
    },
    {
      id: 2,
      subject: "Integrated Science",
      title: "Revision Video Playlist",
      type: "Video",
      downloads: 567,
      rating: 4.9,
    },
    { id: 3, subject: "English", title: "Essay Writing Guide", type: "Guide", downloads: 213, rating: 4.5 },
  ]);
  const [courses] = useState([
    { id: 1, title: "AP Calculus I", instructor: "Dr. Sarah Johnson", price: "Free", students: 1240, rating: 4.7 },
    { id: 2, title: "IGCSE Physics", instructor: "Mr. Ahmed Hassan", price: "GHS 50", students: 856, rating: 4.6 },
    { id: 3, title: "German Language Basics", instructor: "Frau Marta Schmidt", price: "Free", students: 342, rating: 4.4 },
  ]);
  const [discussions] = useState([
    { id: 1, title: "How to solve logarithmic equations?", replies: 12, views: 245, author: "Ama K." },
    { id: 2, title: "Best study methods for Biology", replies: 28, views: 512, author: "Kwesi M." },
    { id: 3, title: "Essay writing tips for literature", replies: 8, views: 156, author: "Janet S." },
  ]);
  const isMobile = useIsMobileLayout();

  const renderBrowseCourses = () => (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Open Learning Courses</div>
        <div className="page-sub">
          Explore free and paid courses from global educators and institutions.
        </div>
      </div>
      {isMobile ? (
        <div className="mobile-record-list">
          {courses.map((c) => (
            <div key={c.id} className="mobile-record-card">
              <div className="mobile-record-head">
                <div>
                  <div className="mobile-record-title">{c.title}</div>
                  <div className="mobile-record-sub">{c.instructor}</div>
                </div>
                <span className="badge badge-blue">{c.price}</span>
              </div>
              <div className="mobile-record-grid">
                <div className="mobile-record-item">
                  <label>Students</label>
                  <span>{c.students}</span>
                </div>
                <div className="mobile-record-item">
                  <label>Rating</label>
                  <span>  {c.rating}</span>
                </div>
              </div>
              <div className="mobile-record-actions">
                <button className="btn btn-sm btn-blue">Enroll</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Course Title</th>
                <th>Instructor</th>
                <th>Price</th>
                <th>Students</th>
                <th>Rating</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {courses.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.title}</strong></td>
                  <td>{c.instructor}</td>
                  <td>{c.price}</td>
                  <td>{c.students}</td>
                  <td>  {c.rating}</td>
                  <td><button className="btn btn-sm btn-blue">Enroll</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const renderQuizzes = () => (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Practice Quizzes</div>
        <div className="page-sub">
          Test your knowledge with interactive quizzes and get instant feedback.
        </div>
      </div>
      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <div className="stat-card" style={{ background: "#dbeafe" }}>
          <div className="stat-label" style={{ color: "#1e40af" }}>Quizzes Attempted</div>
          <div className="stat-value" style={{ color: "#1e40af", fontSize: "1.5rem" }}>12</div>
          <div className="stat-sub" style={{ color: "#1e40af" }}>Average score: 82%</div>
        </div>
        <div className="stat-card" style={{ background: "#dcfce7" }}>
          <div className="stat-label" style={{ color: "#16a34a" }}>Badges Earned</div>
          <div className="stat-value" style={{ color: "#16a34a", fontSize: "1.5rem" }}>8</div>
          <div className="stat-sub" style={{ color: "#16a34a" }}>Science Master, Math Expert</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
        {["Algebra Fundamentals", "Chemistry Reactions", "Biology Cells", "Physics Forces", "Literature Analysis"].map((quiz, i) => (
          <div key={i} className="card card-padded" style={{ marginBottom: 0 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{quiz}</div>
            <div style={{ color: "#64748b", fontSize: ".9rem", marginBottom: 12 }}>10 questions   5 minutes</div>
            <button className="btn btn-sm btn-blue" style={{ width: "100%" }}>Start Quiz</button>
          </div>
        ))}
      </div>
    </div>
  );

  const renderCommunity = () => (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Learning Community</div>
        <div className="page-sub">
          Discuss topics, ask questions, and learn from peers worldwide.
        </div>
      </div>
      <div className="card card-padded" style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Start a Discussion</div>
        <input
          className="form-control"
          placeholder="What would you like to ask?"
          style={{ marginBottom: 8 }}
        />
        <button className="btn btn-blue" style={{ width: "100%" }}>Post Discussion</button>
      </div>
      {isMobile ? (
        <div className="mobile-record-list">
          {discussions.map((d) => (
            <div key={d.id} className="mobile-record-card">
              <div className="mobile-record-head">
                <div>
                  <div className="mobile-record-title">{d.title}</div>
                  <div className="mobile-record-sub">By {d.author}</div>
                </div>
              </div>
              <div className="mobile-record-grid">
                <div className="mobile-record-item">
                  <label>Replies</label>
                  <span>{d.replies}</span>
                </div>
                <div className="mobile-record-item">
                  <label>Views</label>
                  <span>{d.views}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Discussion</th>
                <th>Author</th>
                <th>Replies</th>
                <th>Views</th>
              </tr>
            </thead>
            <tbody>
              {discussions.map((d) => (
                <tr key={d.id}>
                  <td><strong>{d.title}</strong></td>
                  <td>{d.author}</td>
                  <td>{d.replies}</td>
                  <td>{d.views}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const renderResources = () => (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Study Materials</div>
        <div className="page-sub">
          Access notes, past questions, and study guides from the community.
        </div>
      </div>
      {isMobile ? (
        <div className="mobile-record-list">
          {resources.map((r) => (
            <div key={r.id} className="mobile-record-card">
              <div className="mobile-record-head">
                <div>
                  <div className="mobile-record-title">{r.title}</div>
                  <div className="mobile-record-sub">{r.subject}</div>
                </div>
                <span className="badge badge-blue">{r.type}</span>
              </div>
              <div className="mobile-record-grid">
                <div className="mobile-record-item">
                  <label>Downloads</label>
                  <span>{r.downloads}</span>
                </div>
                <div className="mobile-record-item">
                  <label>Rating</label>
                  <span>  {r.rating}</span>
                </div>
              </div>
              <div className="mobile-record-actions">
                <button className="btn btn-sm btn-outline">Download</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Subject</th>
                <th>Resource</th>
                <th>Type</th>
                <th>Downloads</th>
                <th>Rating</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {resources.map((r) => (
                <tr key={r.id}>
                  <td>{r.subject}</td>
                  <td>{r.title}</td>
                  <td>{r.type}</td>
                  <td>{r.downloads}</td>
                  <td>  {r.rating}</td>
                  <td><button className="btn btn-sm btn-outline">Download</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div className="fade-in">
      <div style={{ display: "flex", gap: 8, marginBottom: 16, borderBottom: "1px solid #e2e8f0", paddingBottom: 12, flexWrap: "wrap" }}>
        {[
          { key: "browse", label: "  Courses" },
          { key: "quiz", label: "  Quizzes" },
          { key: "resources", label: "  Materials" },
          { key: "community", label: "  Community" },
        ].map((tab) => (
          <button
            key={tab.key}
            className={`btn ${activeTab === tab.key ? "btn-blue" : "btn-outline"}`}
            onClick={() => setActiveTab(tab.key)}
            style={{ fontSize: ".9rem" }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {activeTab === "browse" && renderBrowseCourses()}
      {activeTab === "quiz" && renderQuizzes()}
      {activeTab === "resources" && renderResources()}
      {activeTab === "community" && renderCommunity()}
    </div>
  );
}

function AutomationRulesPage() {
  const [rules, setRules] = useState([
    { id: 1, trigger: "Fees overdue 30 days", action: "Send reminder + flag" },
  ]);
  const [form, setForm] = useState({ trigger: "", action: "" });
  const isMobile = useIsMobileLayout();
  const add = () => {
    if (!form.trigger || !form.action) return;
    setRules((r) => [{ id: Date.now(), ...form }, ...r]);
    setForm({ trigger: "", action: "" });
  };
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Automation Rules</div>
        <div className="page-sub">
          1. If-this-then-that workflow automation.
        </div>
      </div>
      <div className="card card-padded" style={{ marginBottom: 12 }}>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Trigger</label>
            <input
              className="form-control"
              value={form.trigger}
              onChange={(e) =>
                setForm((f) => ({ ...f, trigger: e.target.value }))
              }
            />
          </div>
          <div className="form-group">
            <label className="form-label">Action</label>
            <input
              className="form-control"
              value={form.action}
              onChange={(e) =>
                setForm((f) => ({ ...f, action: e.target.value }))
              }
            />
          </div>
        </div>
        <button
          className="btn btn-blue"
          style={{ marginTop: 10 }}
          onClick={add}
        >
          Add Rule
        </button>
      </div>
      {isMobile ? (
        <div className="mobile-record-list">
          {rules.map((r) => (
            <div key={r.id} className="mobile-record-card">
              <div className="mobile-record-item">
                <label>Trigger</label>
                <span>{r.trigger}</span>
              </div>
              <div className="mobile-record-item">
                <label>Action</label>
                <span>{r.action}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Trigger</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>{r.trigger}</td>
                  <td>{r.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AiAssistantPage() {
  const [q, setQ] = useState("");
  const [a, setA] = useState(
    "Ask an admin query to get a quick operational answer.",
  );
  const ask = () => {
    if (!q.trim()) return;
    const query = q.toLowerCase();
    if (query.includes("pending"))
      setA(
        "Pending selections can be found in Admissions > Pending Selections.",
      );
    else if (query.includes("fees"))
      setA(
        "Fee status can be reviewed in Student Services > Fees and Payments module.",
      );
    else if (query.includes("attendance"))
      setA(
        "Attendance sync and reports are under Student Services > Attendance.",
      );
    else
      setA(
        "No exact match found. Try including keywords like pending, fees, attendance, analytics, or reports.",
      );
  };
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">AI Assistant</div>
        <div className="page-sub">
          2. Natural-language assistant for admin operations.
        </div>
      </div>
      <div className="card card-padded">
        <div className="form-group">
          <label className="form-label">Ask</label>
          <input
            className="form-control"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. Show pending selections from Ashanti"
          />
        </div>
        <button
          className="btn btn-blue"
          style={{ marginTop: 10 }}
          onClick={ask}
        >
          Run Query
        </button>
        <div className="alert alert-info" style={{ marginTop: 12 }}>
          {a}
        </div>
      </div>
    </div>
  );
}

function StudentRiskPage() {
  const rows = STUDENTS_DATA.map((s) => ({
    ...s,
    risk: Math.min(
      100,
      Math.max(
        5,
        Math.round(
          Number(s.aggregate || 0) * 4 + (s.status === "pending" ? 20 : 5),
        ),
      ),
    ),
  }));
  const isMobile = useIsMobileLayout();
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Student Risk Scoring</div>
        <div className="page-sub">
          3. Early warning scoring based on academics and status.
        </div>
      </div>
      {isMobile ? (
        <div className="mobile-record-list">
          {rows.map((r) => (
            <div key={r.id} className="mobile-record-card">
              <div className="mobile-record-head">
                <div>
                  <div className="mobile-record-title">{r.full_name}</div>
                  <div className="mobile-record-sub">{r.index}</div>
                </div>
                <span
                  className={`badge ${r.risk >= 60 ? "badge-danger" : r.risk >= 35 ? "badge-warning" : "badge-success"}`}
                >
                  {r.risk}%
                </span>
              </div>
              <div className="mobile-record-grid">
                <div className="mobile-record-item">
                  <label>Aggregate</label>
                  <span>{r.aggregate}</span>
                </div>
                <div className="mobile-record-item">
                  <label>Status</label>
                  <span>{r.status}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Student ID</th>
                <th>Aggregate</th>
                <th>Status</th>
                <th>Risk Score</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.full_name}</td>
                  <td>{r.index}</td>
                  <td>{r.aggregate}</td>
                  <td>{r.status}</td>
                  <td>
                    <span
                      className={`badge ${r.risk >= 60 ? "badge-danger" : r.risk >= 35 ? "badge-warning" : "badge-success"}`}
                    >
                      {r.risk}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TimetablePage() {
  const [rows, setRows] = useState([
    {
      id: 1,
      day: "Monday",
      period: "08:00",
      className: "",
      subject: "Math",
      teacher: "Mr. Kwesi",
    },
  ]);
  const isMobile = useIsMobileLayout();
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Timetable & Scheduling</div>
        <div className="page-sub">
          4. Class schedule planning and conflict visibility.
        </div>
      </div>
      {isMobile ? (
        <div className="mobile-record-list">
          {rows.map((r) => (
            <div key={r.id} className="mobile-record-card">
              <div className="mobile-record-head">
                <div>
                  <div className="mobile-record-title">{r.className}</div>
                  <div className="mobile-record-sub">
                    {r.day}   {r.period}
                  </div>
                </div>
                <strong>{r.subject}</strong>
              </div>
              <div className="mobile-record-item">
                <label>Teacher</label>
                <span>{r.teacher}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Time</th>
                <th>Class</th>
                <th>Subject</th>
                <th>Teacher</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.day}</td>
                  <td>{r.period}</td>
                  <td>{r.className}</td>
                  <td>{r.subject}</td>
                  <td>{r.teacher}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ExamBuilderPage() {
  const { cfg } = useContext(SettingsContext);
  const classOptions = resolveClassOptions(cfg);
  const [exam, setExam] = useState({
    title: "",
    className: classOptions[0] || "",
    total: 100,
  });
  const [items, setItems] = useState([]);
  const isMobile = useIsMobileLayout();
  useEffect(() => {
    const nextClass = classOptions[0] || "";
    if (!classOptions.includes(exam.className) && exam.className !== nextClass) {
      setExam((current) => ({ ...current, className: nextClass }));
    }
  }, [classOptions.join("||"), exam.className]);
  const create = () => {
    if (!exam.title) return;
    setItems((x) => [{ id: Date.now(), ...exam }, ...x]);
    setExam({ title: "", className: classOptions[0] || "", total: 100 });
  };
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Exam Builder</div>
        <div className="page-sub">
          5. Assessment creation and marking workflows.
        </div>
      </div>
      <div className="card card-padded" style={{ marginBottom: 12 }}>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Exam Title</label>
            <input
              className="form-control"
              value={exam.title}
              onChange={(e) =>
                setExam((v) => ({ ...v, title: e.target.value }))
              }
            />
          </div>
          <div className="form-group">
            <label className="form-label">Class</label>
            <select
              className="form-control"
              value={exam.className}
              onChange={(e) =>
                setExam((v) => ({ ...v, className: e.target.value }))
              }
            >
              {!classOptions.length && (
                <option value="">No classes configured in Settings</option>
              )}
              {classOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Total Score</label>
            <input
              type="number"
              className="form-control"
              value={exam.total}
              onChange={(e) =>
                setExam((v) => ({ ...v, total: +e.target.value }))
              }
            />
          </div>
        </div>
        <button
          className="btn btn-blue"
          style={{ marginTop: 10 }}
          onClick={create}
        >
          Create Exam
        </button>
      </div>
      {isMobile ? (
        <div className="mobile-record-list">
          {items.map((i) => (
            <div key={i.id} className="mobile-record-card">
              <div className="mobile-record-head">
                <div>
                  <div className="mobile-record-title">{i.title}</div>
                  <div className="mobile-record-sub">{i.className}</div>
                </div>
                <strong>{i.total}</strong>
              </div>
            </div>
          ))}
          {!items.length && (
            <div
              className="mobile-record-card"
              style={{ textAlign: "center", color: "#64748b" }}
            >
              No exams created yet.
            </div>
          )}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Class</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>{i.title}</td>
                  <td>{i.className}</td>
                  <td>{i.total}</td>
                </tr>
              ))}
              {!items.length && (
                <tr>
                  <td
                    colSpan="3"
                    style={{
                      textAlign: "center",
                      padding: 18,
                      color: "#64748b",
                    }}
                  >
                    No exams created yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function InstallmentPlansPage() {
  const [plans, setPlans] = useState([
    {
      id: 1,
      student: "Kwame Asante",
      amount: 350,
      installments: 3,
      nextDue: "2026-05-05",
    },
  ]);
  const isMobile = useIsMobileLayout();
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Fee Installment Plans</div>
        <div className="page-sub">6. Structured fee payment planning.</div>
      </div>
      {isMobile ? (
        <div className="mobile-record-list">
          {plans.map((p) => (
            <div key={p.id} className="mobile-record-card">
              <div className="mobile-record-head">
                <div>
                  <div className="mobile-record-title">{p.student}</div>
                  <div className="mobile-record-sub">Next due: {p.nextDue}</div>
                </div>
                <strong>GHS {p.amount}</strong>
              </div>
              <div className="mobile-record-item">
                <label>Installments</label>
                <span>{p.installments}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Total (GHS)</th>
                <th>Installments</th>
                <th>Next Due</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id}>
                  <td>{p.student}</td>
                  <td>{p.amount}</td>
                  <td>{p.installments}</td>
                  <td>{p.nextDue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MessagingCampaignsPage() {
  const [audience, setAudience] = useState("all-students");
  const [text, setText] = useState("");
  const [history, setHistory] = useState([]);
  const isMobile = useIsMobileLayout();
  const send = () => {
    if (!text.trim()) return;
    setHistory((h) => [
      { id: Date.now(), audience, text, at: new Date().toISOString() },
      ...h,
    ]);
    setText("");
  };
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Messaging Campaigns</div>
        <div className="page-sub">7. Segmented broadcast communication.</div>
      </div>
      <div className="card card-padded" style={{ marginBottom: 12 }}>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Audience</label>
            <select
              className="form-control"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
            >
              <option value="all-students">All Students</option>
              <option value="pending-selection">Pending Selection</option>
              <option value="fees-overdue">Fees Overdue</option>
              <option value="high-risk">High Risk Students</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Message</label>
            <input
              className="form-control"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
        </div>
        <button
          className="btn btn-blue"
          style={{ marginTop: 10 }}
          onClick={send}
        >
          Launch Campaign
        </button>
      </div>
      {isMobile ? (
        <div className="mobile-record-list">
          {history.map((h) => (
            <div key={h.id} className="mobile-record-card">
              <div className="mobile-record-head">
                <div>
                  <div className="mobile-record-title">{h.audience}</div>
                  <div className="mobile-record-sub">
                    {new Date(h.at).toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="mobile-record-item">
                <label>Message</label>
                <span>{h.text}</span>
              </div>
            </div>
          ))}
          {!history.length && (
            <div
              className="mobile-record-card"
              style={{ textAlign: "center", color: "#64748b" }}
            >
              No campaigns launched yet.
            </div>
          )}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Audience</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>{new Date(h.at).toLocaleString()}</td>
                  <td>{h.audience}</td>
                  <td>{h.text}</td>
                </tr>
              ))}
              {!history.length && (
                <tr>
                  <td
                    colSpan="3"
                    style={{
                      textAlign: "center",
                      padding: 18,
                      color: "#64748b",
                    }}
                  >
                    No campaigns launched yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RecommendationEnginePage() {
  const [agg, setAgg] = useState("");
  const [region, setRegion] = useState("All Regions");
  const [list, setList] = useState([]);
  const isMobile = useIsMobileLayout();
  const run = () => {
    const score = Number(agg || 99);
    const filtered = SCHOOLS_DATA.filter(
      (s) => region === "All Regions" || s.region === region,
    ).sort((a, b) => a.cutoff - b.cutoff);
    setList(filtered.filter((s) => score <= s.cutoff + 4).slice(0, 6));
  };
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">School Recommendation Engine</div>
        <div className="page-sub">
          8. Suggest schools from aggregate and region preference.
        </div>
      </div>
      <div className="card card-padded" style={{ marginBottom: 12 }}>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Aggregate</label>
            <input
              type="number"
              className="form-control"
              value={agg}
              onChange={(e) => setAgg(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Preferred Region</label>
            <select
              className="form-control"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
            >
              <option>All Regions</option>
              {GHANA_REGIONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </div>
        </div>
        <button
          className="btn btn-blue"
          style={{ marginTop: 10 }}
          onClick={run}
        >
          Recommend
        </button>
      </div>
      {isMobile ? (
        <div className="mobile-record-list">
          {list.map((s) => (
            <div key={s.id} className="mobile-record-card">
              <div className="mobile-record-head">
                <div>
                  <div className="mobile-record-title">{s.name}</div>
                  <div className="mobile-record-sub">{s.region}</div>
                </div>
                <span className="badge badge-blue">{s.category}</span>
              </div>
              <div className="mobile-record-item">
                <label>Cutoff</label>
                <span>{s.cutoff}</span>
              </div>
            </div>
          ))}
          {!list.length && (
            <div
              className="mobile-record-card"
              style={{ textAlign: "center", color: "#64748b" }}
            >
              No recommendations yet.
            </div>
          )}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>School</th>
                <th>Region</th>
                <th>Category</th>
                <th>Cutoff</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.region}</td>
                  <td>{s.category}</td>
                  <td>{s.cutoff}</td>
                </tr>
              ))}
              {!list.length && (
                <tr>
                  <td
                    colSpan="4"
                    style={{
                      textAlign: "center",
                      padding: 18,
                      color: "#64748b",
                    }}
                  >
                    No recommendations yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DigitalIdPage() {
  const [query, setQuery] = useState("");
  const students = STUDENTS_DATA.filter(
    (s) =>
      s.full_name.toLowerCase().includes(query.toLowerCase()) ||
      String(s.index).includes(query),
  );
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Digital ID & QR Profiles</div>
        <div className="page-sub">
          9. Quick profile retrieval for check-in and verification.
        </div>
      </div>
      <input
        className="form-control search-input-compact"
        placeholder="Search by name or index"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="card-grid-auto">
        {students.map((s) => (
          <div key={s.id} className="card card-padded">
            <div style={{ fontWeight: 800, marginBottom: 4 }}>
              {s.full_name}
            </div>
            <div
              style={{ fontSize: ".82rem", color: "#64748b", marginBottom: 8 }}
            >
              Index: {s.index}
            </div>
            <div
              style={{
                height: 92,
                borderRadius: 10,
                background:
                  "repeating-linear-gradient(45deg,#1e3a8a,#1e3a8a 4px,#dbeafe 4px,#dbeafe 8px)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontWeight: 700,
              }}
            >
              QR-{s.index}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PublicStatusPage() {
  const [items, setItems] = useState([
    {
      id: 1,
      title: "Admission Update",
      status: "published",
      at: new Date().toISOString(),
    },
    {
      id: 2,
      title: "Term Reopening Notice",
      status: "draft",
      at: new Date(Date.now() - 86400000).toISOString(),
    },
  ]);
  const isMobile = useIsMobileLayout();
  const toggle = (id) =>
    setItems((x) =>
      x.map((i) =>
        i.id === id
          ? { ...i, status: i.status === "published" ? "draft" : "published" }
          : i,
      ),
    );
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Public Status Portal</div>
        <div className="page-sub">
          10. Publish read-only public notices and status updates.
        </div>
      </div>
      {isMobile ? (
        <div className="mobile-record-list">
          {items.map((i) => (
            <div key={i.id} className="mobile-record-card">
              <div className="mobile-record-head">
                <div>
                  <div className="mobile-record-title">{i.title}</div>
                  <div className="mobile-record-sub">
                    {new Date(i.at).toLocaleString()}
                  </div>
                </div>
                <span
                  className={`badge ${i.status === "published" ? "badge-success" : "badge-gray"}`}
                >
                  {i.status}
                </span>
              </div>
              <div className="mobile-record-actions">
                <button
                  className="btn btn-sm btn-outline"
                  onClick={() => toggle(i.id)}
                >
                  {i.status === "published" ? "Unpublish" : "Publish"}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Post</th>
                <th>Status</th>
                <th>Updated</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>{i.title}</td>
                  <td>
                    <span
                      className={`badge ${i.status === "published" ? "badge-success" : "badge-gray"}`}
                    >
                      {i.status}
                    </span>
                  </td>
                  <td>{new Date(i.at).toLocaleString()}</td>
                  <td>
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={() => toggle(i.id)}
                    >
                      {i.status === "published" ? "Unpublish" : "Publish"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function IntegrationsPage() {
  const [hooks, setHooks] = useState([
    {
      id: 1,
      name: "Payment Webhook",
      url: "https://example.com/payment",
      enabled: true,
    },
  ]);
  const isMobile = useIsMobileLayout();
  const toggle = (id) =>
    setHooks((h) =>
      h.map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x)),
    );
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">API & Webhook Integrations</div>
        <div className="page-sub">
          11. Connect external services and webhooks.
        </div>
      </div>
      {isMobile ? (
        <div className="mobile-record-list">
          {hooks.map((h) => (
            <div key={h.id} className="mobile-record-card">
              <div className="mobile-record-head">
                <div>
                  <div className="mobile-record-title">{h.name}</div>
                  <div className="mobile-record-sub">{h.url}</div>
                </div>
                <input
                  type="checkbox"
                  checked={h.enabled}
                  onChange={() => toggle(h.id)}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Endpoint</th>
                <th>Enabled</th>
              </tr>
            </thead>
            <tbody>
              {hooks.map((h) => (
                <tr key={h.id}>
                  <td>{h.name}</td>
                  <td>{h.url}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={h.enabled}
                      onChange={() => toggle(h.id)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MultiTenantPage() {
  const [schools, setSchools] = useState([
    { id: 1, name: "Campus Ghana - Main", tenant: "main", activeUsers: 92 },
  ]);
  const isMobile = useIsMobileLayout();
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Multi-School Tenants</div>
        <div className="page-sub">
          12. Manage separate school tenants at scale.
        </div>
      </div>
      {isMobile ? (
        <div className="mobile-record-list">
          {schools.map((s) => (
            <div key={s.id} className="mobile-record-card">
              <div className="mobile-record-head">
                <div>
                  <div className="mobile-record-title">{s.name}</div>
                  <div className="mobile-record-sub">Tenant: {s.tenant}</div>
                </div>
                <strong>{s.activeUsers}</strong>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>School</th>
                <th>Tenant Key</th>
                <th>Active Users</th>
              </tr>
            </thead>
            <tbody>
              {schools.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.tenant}</td>
                  <td>{s.activeUsers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DataQualityPage() {
  const missingIndex = STUDENTS_DATA.filter(
    (s) => !String(s.index || "").trim(),
  ).length;
  const duplicateIndexes =
    new Set(STUDENTS_DATA.map((s) => s.index)).size !== STUDENTS_DATA.length;
  const issues = [
    {
      name: "Missing Index Numbers",
      value: missingIndex,
      status: missingIndex ? "warning" : "ok",
    },
    {
      name: "Duplicate Index Numbers",
      value: duplicateIndexes ? 1 : 0,
      status: duplicateIndexes ? "warning" : "ok",
    },
    {
      name: "Incomplete Regions",
      value: STUDENTS_DATA.filter((s) => !s.region).length,
      status: "ok",
    },
  ];
  const isMobile = useIsMobileLayout();
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Data Quality Monitor</div>
        <div className="page-sub">
          13. Detect missing/duplicate/inconsistent records.
        </div>
      </div>
      {isMobile ? (
        <div className="mobile-record-list">
          {issues.map((i) => (
            <div key={i.name} className="mobile-record-card">
              <div className="mobile-record-head">
                <div>
                  <div className="mobile-record-title">{i.name}</div>
                </div>
                <span
                  className={`badge ${i.status === "warning" ? "badge-warning" : "badge-success"}`}
                >
                  {i.status}
                </span>
              </div>
              <div className="mobile-record-item">
                <label>Count</label>
                <span>{i.value}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Check</th>
                <th>Count</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((i) => (
                <tr key={i.name}>
                  <td>{i.name}</td>
                  <td>{i.value}</td>
                  <td>
                    <span
                      className={`badge ${i.status === "warning" ? "badge-warning" : "badge-success"}`}
                    >
                      {i.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ApprovalSlaPage() {
  const [rows, setRows] = useState([
    { id: 1, queue: "Pending Selections", under24: 8, under72: 4, over72: 2 },
    { id: 2, queue: "Document Review", under24: 12, under72: 5, over72: 1 },
  ]);
  const isMobile = useIsMobileLayout();
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Approval SLA Dashboard</div>
        <div className="page-sub">
          14. Aging and turnaround performance tracking.
        </div>
      </div>
      {isMobile ? (
        <div className="mobile-record-list">
          {rows.map((r) => (
            <div key={r.id} className="mobile-record-card">
              <div className="mobile-record-title">{r.queue}</div>
              <div className="mobile-record-grid">
                <div className="mobile-record-item">
                  <label>&lt;24h</label>
                  <span>{r.under24}</span>
                </div>
                <div className="mobile-record-item">
                  <label>24-72h</label>
                  <span>{r.under72}</span>
                </div>
                <div className="mobile-record-item">
                  <label>&gt;72h</label>
                  <span>{r.over72}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Queue</th>
                <th>&lt;24h</th>
                <th>24-72h</th>
                <th>&gt;72h</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.queue}</td>
                  <td>{r.under24}</td>
                  <td>{r.under72}</td>
                  <td>{r.over72}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FeatureFlagsPage() {
  const [flags, setFlags] = useState([
    { id: 1, key: "new-recommendation-engine", stage: "pilot", enabled: true },
    { id: 2, key: "advanced-risk-model", stage: "beta", enabled: false },
  ]);
  const isMobile = useIsMobileLayout();
  const toggle = (id) =>
    setFlags((f) =>
      f.map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x)),
    );
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Feature Flags & Rollout</div>
        <div className="page-sub">
          15. Controlled release by stage and audience.
        </div>
      </div>
      {isMobile ? (
        <div className="mobile-record-list">
          {flags.map((x) => (
            <div key={x.id} className="mobile-record-card">
              <div className="mobile-record-head">
                <div>
                  <div className="mobile-record-title">{x.key}</div>
                  <div className="mobile-record-sub">{x.stage}</div>
                </div>
                <input
                  type="checkbox"
                  checked={x.enabled}
                  onChange={() => toggle(x.id)}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Flag</th>
                <th>Stage</th>
                <th>Enabled</th>
              </tr>
            </thead>
            <tbody>
              {flags.map((x) => (
                <tr key={x.id}>
                  <td>{x.key}</td>
                  <td>{x.stage}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={x.enabled}
                      onChange={() => toggle(x.id)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PeerTutoringPage() {
  const [tutors, setTutors] = useState([
    { id: 1, name: "Kwasi Mensah", subject: "Mathematics", rating: 4.8, sessions: 12, students: 5 },
    { id: 2, name: "Ama Owusu", subject: "English", rating: 4.9, sessions: 18, students: 7 },
  ]);
  const isMobile = useIsMobileLayout();
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">  Peer Tutoring Platform</div>
        <div className="page-sub">Connect students for one-on-one tutoring sessions</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16, marginBottom: 24 }}>
        <div className="card" style={{ padding: 16, background: "#f0f9ff" }}>
          <div style={{ fontSize: ".9em", color: "#64748b", marginBottom: 4 }}>Active Tutors</div>
          <div style={{ fontSize: "2em", fontWeight: 700, color: "#0369a1" }}>{tutors.length}</div>
        </div>
        <div className="card" style={{ padding: 16, background: "#ecfdf5" }}>
          <div style={{ fontSize: ".9em", color: "#64748b", marginBottom: 4 }}>Total Sessions</div>
          <div style={{ fontSize: "2em", fontWeight: 700, color: "#059669" }}>{tutors.reduce((s, t) => s + t.sessions, 0)}</div>
        </div>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tutor</th>
              <th>Subject</th>
              <th>Rating</th>
              <th>Sessions</th>
              <th>Students</th>
            </tr>
          </thead>
          <tbody>
            {tutors.map((t) => (
              <tr key={t.id}>
                <td style={{ fontWeight: 600 }}>{t.name}</td>
                <td>{t.subject}</td>
                <td>  {t.rating}</td>
                <td>{t.sessions}</td>
                <td>{t.students}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MentalHealthPortal({ currentUser = {} }) {
  const [counselors, setCounselors] = useState([
    { id: 1, name: "Dr. Yaw Mensah", specialization: "Academic Stress", available: true },
    { id: 2, name: "Ms. Ada Ama", specialization: "Social Issues", available: true },
  ]);
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">  Mental Health & Counseling</div>
        <div className="page-sub">Support and resources for student wellbeing</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        {counselors.map((c) => (
          <div key={c.id} className="card" style={{ padding: 16, border: "1px solid #e2e8f0" }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{c.name}</div>
            <div style={{ fontSize: ".9em", color: "#64748b", marginBottom: 12 }}>  {c.specialization}</div>
            <button className="btn btn-blue" style={{ width: "100%" }}>
              {c.available ? "Book Session" : "Coming Soon"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function LibraryManagementPage() {
  const [books, setBooks] = useState([
    { id: 1, title: "Advanced Mathematics", author: "Prof. A. Mensah", available: 12, total: 15, isbn: "978-123-456" },
    { id: 2, title: "English Literature", author: "Dr. K. Owusu", available: 8, total: 10, isbn: "978-789-012" },
  ]);
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">  Library Management</div>
        <div className="page-sub">Book catalog and borrowing system</div>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Author</th>
              <th>Available</th>
              <th>Total</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {books.map((b) => (
              <tr key={b.id}>
                <td style={{ fontWeight: 600 }}>{b.title}</td>
                <td>{b.author}</td>
                <td><span style={{ background: "#ecfdf5", padding: "4px 8px", borderRadius: 4 }}>{b.available}</span></td>
                <td>{b.total}</td>
                <td><button className="btn btn-sm btn-blue">{b.available > 0 ? "Borrow" : "Reserve"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AlumniPortalPage() {
  const [alumni, setAlumni] = useState([
    { id: 1, name: "Kwame Asante", graduationYear: 2020, profession: "Software Engineer", company: "Tech Innovations Ltd" },
    { id: 2, name: "Abena Kofi", graduationYear: 2019, profession: "Medical Doctor", company: "Central Hospital" },
  ]);
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">  Alumni Portal & Networking</div>
        <div className="page-sub">Connect with graduates and track their success</div>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Graduation Year</th>
              <th>Profession</th>
              <th>Organization</th>
            </tr>
          </thead>
          <tbody>
            {alumni.map((a) => (
              <tr key={a.id}>
                <td style={{ fontWeight: 600 }}>{a.name}</td>
                <td>{a.graduationYear}</td>
                <td>{a.profession}</td>
                <td>{a.company}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ScholarshipManagementPage() {
  const [scholarships, setScholarships] = useState([
    { id: 1, name: "Merit Excellence Award", amount: "GHS 5,000", deadline: "2026-06-30", recipients: 15 },
    { id: 2, name: "Need-Based Assistance", amount: "GHS 3,000", deadline: "2026-07-15", recipients: 25 },
  ]);
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">  Scholarship Management</div>
        <div className="page-sub">Track scholarships and eligibility</div>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Scholarship</th>
              <th>Amount</th>
              <th>Deadline</th>
              <th>Recipients</th>
            </tr>
          </thead>
          <tbody>
            {scholarships.map((s) => (
              <tr key={s.id}>
                <td style={{ fontWeight: 600 }}>{s.name}</td>
                <td>{s.amount}</td>
                <td>{s.deadline}</td>
                <td><span style={{ background: "#dbeafe", padding: "4px 8px", borderRadius: 4 }}>{s.recipients}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ParentTeacherConferencePage() {
  const [conferences, setConferences] = useState([
    { id: 1, student: "Ama Mensah", date: "2026-05-15", time: "14:00", teacher: "Mr. Kwame", status: "Scheduled" },
    { id: 2, student: "Kwasi Owusu", date: "2026-05-16", time: "15:30", teacher: "Ms. Abena", status: "Pending" },
  ]);
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">  Parent-Teacher Conferences</div>
        <div className="page-sub">Schedule and manage meetings with parents</div>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Date</th>
              <th>Time</th>
              <th>Teacher</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {conferences.map((c) => (
              <tr key={c.id}>
                <td style={{ fontWeight: 600 }}>{c.student}</td>
                <td>{c.date}</td>
                <td>{c.time}</td>
                <td>{c.teacher}</td>
                <td><span style={{ background: c.status === "Scheduled" ? "#ecfdf5" : "#fef3c7", padding: "4px 8px", borderRadius: 4 }}>{c.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MedicalRecordsPage() {
  const [records, setRecords] = useState([
    { id: 1, student: "Ama Mensah", bloodType: "O+", allergies: "Peanuts", lastCheckup: "2026-03-15" },
    { id: 2, student: "Kwasi Owusu", bloodType: "A+", allergies: "None", lastCheckup: "2026-02-28" },
  ]);
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">  Medical Records</div>
        <div className="page-sub">Health information and emergency contacts</div>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Blood Type</th>
              <th>Allergies</th>
              <th>Last Checkup</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id}>
                <td style={{ fontWeight: 600 }}>{r.student}</td>
                <td>{r.bloodType}</td>
                <td>{r.allergies}</td>
                <td>{r.lastCheckup}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TransportHostelPage() {
  const [buses, setBuses] = useState([
    { id: 1, route: "Accra - School", driver: "Mr. Agyeman", capacity: 50, occupied: 38, status: "Active" },
    { id: 2, route: "Kumasi - School", driver: "Mr. Kofi", capacity: 45, occupied: 32, status: "Active" },
  ]);
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">  Transport & Hostel Management</div>
        <div className="page-sub">Bus tracking and boarding student management</div>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Route</th>
              <th>Driver</th>
              <th>Capacity</th>
              <th>Occupied</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {buses.map((b) => (
              <tr key={b.id}>
                <td style={{ fontWeight: 600 }}>{b.route}</td>
                <td>{b.driver}</td>
                <td>{b.capacity}</td>
                <td><span style={{ background: "#e0e7ff", padding: "4px 8px", borderRadius: 4 }}>{b.occupied}/{b.capacity}</span></td>
                <td><span style={{ background: "#ecfdf5", padding: "4px 8px", borderRadius: 4, color: "#059669", fontWeight: 600 }}>  {b.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VirtualClassroomPage() {
  const [classes, setClasses] = useState([
    { id: 1, name: "Advanced Mathematics", instructor: "Prof. Mensah", students: 45, status: "Live", duration: "90 min" },
    { id: 2, name: "English Literature", instructor: "Dr. Owusu", students: 32, status: "Scheduled", duration: "60 min" },
  ]);
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">  Virtual Classroom</div>
        <div className="page-sub">Interactive online learning environment</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, marginBottom: 24 }}>
        {classes.map((c) => (
          <div key={c.id} className="card" style={{ padding: 16, border: "1px solid #e2e8f0" }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{c.name}</div>
            <div style={{ fontSize: ".9em", color: "#64748b", marginBottom: 4 }}>  {c.instructor}</div>
            <div style={{ fontSize: ".9em", color: "#64748b", marginBottom: 12 }}>  {c.students} students     {c.duration}</div>
            <button className="btn btn-blue" style={{ width: "100%" }}>
              {c.status === "Live" ? "Join Class" : "View Details"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function CourseMarketplacePage() {
  const [courses, setCourses] = useState([
    { id: 1, title: "Data Science Fundamentals", instructor: "Dr. Tech", price: "GHS 250", rating: 4.8, students: 1250, category: "Technology" },
    { id: 2, title: "Creative Writing", instructor: "Prof. Arts", price: "Free", rating: 4.9, students: 890, category: "Arts" },
  ]);
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">  Course Marketplace</div>
        <div className="page-sub">Browse and enroll in courses from global educators</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        {courses.map((c) => (
          <div key={c.id} className="card" style={{ padding: 16, border: "1px solid #e2e8f0" }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{c.title}</div>
            <div style={{ fontSize: ".9em", color: "#64748b", marginBottom: 4 }}>  {c.instructor}</div>
            <div style={{ fontSize: ".9em", color: "#64748b", marginBottom: 8 }}>  {c.category}     {c.rating}     {c.students}</div>
            <div style={{ fontSize: "1.2em", fontWeight: 700, color: "#059669", marginBottom: 12 }}>{c.price}</div>
            <button className="btn btn-blue" style={{ width: "100%" }}>Enroll Now</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function LiveStreamingPage() {
  const [streams, setStreams] = useState([
    { id: 1, title: "Physics Lecture: Quantum Mechanics", instructor: "Dr. Physics", viewers: 156, status: "Live", duration: "45 min" },
    { id: 2, title: "Chemistry Lab Demo", instructor: "Prof. Chem", viewers: 89, status: "Scheduled", duration: "30 min" },
  ]);
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">  Live Streaming</div>
        <div className="page-sub">Real-time educational broadcasts</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        {streams.map((s) => (
          <div key={s.id} className="card" style={{ padding: 16, border: "1px solid #e2e8f0" }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{s.title}</div>
            <div style={{ fontSize: ".9em", color: "#64748b", marginBottom: 4 }}>  {s.instructor}</div>
            <div style={{ fontSize: ".9em", color: "#64748b", marginBottom: 12 }}>  {s.viewers} viewers     {s.duration}</div>
            <button className="btn btn-blue" style={{ width: "100%" }}>
              {s.status === "Live" ? "Watch Live" : "Set Reminder"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function InteractiveWhiteboardPage() {
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">  Interactive Whiteboard</div>
        <div className="page-sub">Collaborative digital drawing and annotation tools</div>
      </div>
      <div className="card" style={{ padding: 24, textAlign: "center" }}>
        <div style={{ fontSize: "4em", marginBottom: 16 }}> </div>
        <div style={{ fontSize: "1.2em", fontWeight: 700, marginBottom: 8 }}>Interactive Whiteboard</div>
        <div style={{ color: "#64748b", marginBottom: 24 }}>Digital drawing tools, annotations, and collaborative workspace</div>
        <button className="btn btn-blue">Launch Whiteboard</button>
      </div>
    </div>
  );
}

function VideoConferencingPage() {
  const [meetings, setMeetings] = useState([
    { id: 1, title: "Math Study Group", participants: 8, time: "14:00", status: "Active" },
    { id: 2, title: "Science Project Discussion", participants: 5, time: "16:30", status: "Scheduled" },
  ]);
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">  Video Conferencing</div>
        <div className="page-sub">HD video meetings and collaboration</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        {meetings.map((m) => (
          <div key={m.id} className="card" style={{ padding: 16, border: "1px solid #e2e8f0" }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{m.title}</div>
            <div style={{ fontSize: ".9em", color: "#64748b", marginBottom: 12 }}>  {m.participants} participants     {m.time}</div>
            <button className="btn btn-blue" style={{ width: "100%" }}>
              {m.status === "Active" ? "Join Meeting" : "Schedule Meeting"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function LearningAnalyticsPage() {
  const [analytics, setAnalytics] = useState({
    totalStudents: 1250,
    activeCourses: 45,
    completionRate: 78,
    averageScore: 82
  });
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">  Learning Analytics</div>
        <div className="page-sub">Advanced insights into learning patterns and performance</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16, marginBottom: 24 }}>
        <div className="card" style={{ padding: 16, background: "#f0f9ff" }}>
          <div style={{ fontSize: ".9em", color: "#64748b", marginBottom: 4 }}>Total Students</div>
          <div style={{ fontSize: "2em", fontWeight: 700, color: "#0369a1" }}>{analytics.totalStudents}</div>
        </div>
        <div className="card" style={{ padding: 16, background: "#ecfdf5" }}>
          <div style={{ fontSize: ".9em", color: "#64748b", marginBottom: 4 }}>Active Courses</div>
          <div style={{ fontSize: "2em", fontWeight: 700, color: "#059669" }}>{analytics.activeCourses}</div>
        </div>
        <div className="card" style={{ padding: 16, background: "#fef3c7" }}>
          <div style={{ fontSize: ".9em", color: "#64748b", marginBottom: 4 }}>Completion Rate</div>
          <div style={{ fontSize: "2em", fontWeight: 700, color: "#d97706" }}>{analytics.completionRate}%</div>
        </div>
        <div className="card" style={{ padding: 16, background: "#fce7f3" }}>
          <div style={{ fontSize: ".9em", color: "#64748b", marginBottom: 4 }}>Average Score</div>
          <div style={{ fontSize: "2em", fontWeight: 700, color: "#be185d" }}>{analytics.averageScore}%</div>
        </div>
      </div>
    </div>
  );
}

function GamificationPage() {
  const [achievements, setAchievements] = useState([
    { id: 1, name: "First Quiz Master", description: "Complete your first quiz", unlocked: true, points: 100 },
    { id: 2, name: "Study Streak", description: "Study for 7 consecutive days", unlocked: false, points: 500 },
  ]);
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">  Gamification</div>
        <div className="page-sub">Earn badges, points, and achievements</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        {achievements.map((a) => (
          <div key={a.id} className="card" style={{ padding: 16, border: "1px solid #e2e8f0", opacity: a.unlocked ? 1 : 0.6 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{a.name}</div>
            <div style={{ fontSize: ".9em", color: "#64748b", marginBottom: 8 }}>{a.description}</div>
            <div style={{ fontSize: "1.1em", fontWeight: 600, color: "#059669" }}>  {a.points} points</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdaptiveLearningPage() {
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">  Adaptive Learning</div>
        <div className="page-sub">Personalized learning paths based on performance</div>
      </div>
      <div className="card" style={{ padding: 24, textAlign: "center" }}>
        <div style={{ fontSize: "4em", marginBottom: 16 }}> </div>
        <div style={{ fontSize: "1.2em", fontWeight: 700, marginBottom: 8 }}>Adaptive Learning Engine</div>
        <div style={{ color: "#64748b", marginBottom: 24 }}>AI-powered personalized learning recommendations</div>
        <button className="btn btn-blue">Start Adaptive Learning</button>
      </div>
    </div>
  );
}

function CollaborativeProjectsPage() {
  const [projects, setProjects] = useState([
    { id: 1, name: "Climate Change Research", team: 6, deadline: "2026-06-15", status: "Active" },
    { id: 2, name: "Digital Art Exhibition", team: 4, deadline: "2026-07-01", status: "Planning" },
  ]);
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">  Collaborative Projects</div>
        <div className="page-sub">Team-based learning and project management</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        {projects.map((p) => (
          <div key={p.id} className="card" style={{ padding: 16, border: "1px solid #e2e8f0" }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{p.name}</div>
            <div style={{ fontSize: ".9em", color: "#64748b", marginBottom: 4 }}>  {p.team} members</div>
            <div style={{ fontSize: ".9em", color: "#64748b", marginBottom: 12 }}>  Due: {p.deadline}</div>
            <button className="btn btn-blue" style={{ width: "100%" }}>Join Project</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function MobileLearningPage() {
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">  Mobile Learning</div>
        <div className="page-sub">Learn anywhere with mobile-optimized content</div>
      </div>
      <div className="card" style={{ padding: 24, textAlign: "center" }}>
        <div style={{ fontSize: "4em", marginBottom: 16 }}> </div>
        <div style={{ fontSize: "1.2em", fontWeight: 700, marginBottom: 8 }}>Mobile Learning Platform</div>
        <div style={{ color: "#64748b", marginBottom: 24 }}>Access courses, quizzes, and resources on any device</div>
        <button className="btn btn-blue">Download Mobile App</button>
      </div>
    </div>
  );
}

function AITutorPage() {
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">  AI Tutor</div>
        <div className="page-sub">24/7 intelligent tutoring and support</div>
      </div>
      <div className="card" style={{ padding: 24, textAlign: "center" }}>
        <div style={{ fontSize: "4em", marginBottom: 16 }}> </div>
        <div style={{ fontSize: "1.2em", fontWeight: 700, marginBottom: 8 }}>AI-Powered Tutor</div>
        <div style={{ color: "#64748b", marginBottom: 24 }}>Get instant help with homework, explanations, and personalized guidance</div>
        <button className="btn btn-blue">Start AI Tutoring</button>
      </div>
    </div>
  );
}

// STUDY CONTENT PAGE (Admin)
const StudyContentPage = lazy(() => import("./src/components/AdminStudyContentPage.jsx"));

// ADMIN NAV
const ADMIN_NAV = [
  { section: "Overview" },
  { key: "dashboard", icon: "dashboard", label: "Dashboard", color: "#6366f1" },
  { key: "super-admin-control", icon: "settings", label: "Super Admin Control", color: "#dc2626", superAdminOnly: true },
  { section: "Admissions & Mock Placement" },
  { key: "students", icon: "students", label: "Students", color: "#3b82f6" },
  { key: "enroll", icon: "enroll", label: "Enroll Student", color: "#0ea5e9" },
  { key: "schools", icon: "schools", label: "Schools", color: "#06b6d4" },
  {
    key: "pending",
    icon: "pending",
    label: "Pending Selections",
    badge: true,
    color: "#ef4444",
  },
  { key: "confirmed", icon: "confirmed", label: "Confirmed", color: "#16a34a" },
  { section: "Academic Management" },
  { key: "scores", icon: "scores", label: "Test Scores", color: "#f43f5e" },
  { key: "academic-scores", icon: "grading", label: "Academic Scores", color: "#0ea5e9" },
  { key: "results", icon: "results", label: "Results", color: "#f97316" },
  { key: "grading", icon: "grading", label: "Grade Report", color: "#ec4899" },
  { key: "study-content", icon: "docs", label: "Learning Library", color: "#10b981" },
  { key: "courses", icon: "docs", label: "Courses", color: "#0891b2" },
  { key: "analytics", icon: "analytics", label: "Analytics", color: "#7c3aed" },
  { section: "Fees & Finance" },
  { key: "fees", icon: "fees", label: "Fees", color: "#22c55e" },
  { section: "Communication" },
  { key: "study-teams", icon: "chat", label: "Study Teams", color: "#7c3aed" },
  { key: "helpdesk", icon: "support", label: "Student Support", color: "#0f766e" },
  { key: "chat", icon: "chat", label: "Chat", color: "#10b981" },
  { key: "documents", icon: "docs", label: "Documents", color: "#7c2d12" },
  { section: "Administration" },
  { key: "finance", icon: "finance", label: "Finance", color: "#d97706" },
  { key: "settings", icon: "settings", label: "Settings", color: "#64748b" },
  { key: "registered-schools", icon: "schools", label: "Registered Schools", color: "#0f766e" },
  { key: "permissions", icon: "lock", label: "Permissions", color: "#1d4ed8" },
  { key: "audit", icon: "docs", label: "Audit Trail", color: "#0f766e" },
  { key: "payments", icon: "fees", label: "Payments", color: "#15803d" },
  { key: "reports", icon: "results", label: "Reports", color: "#7c3aed" },
];

const ADMIN_SUBPAGE_MAP = {
  schools: ["registered-schools"],
  settings: ["permissions", "audit"],
  analytics: ["reports"],
  fees: ["payments"],
};

const dedupeNavEntries = (items) => {
  const seen = new Set();
  return items.filter((entry) => {
    if (entry.section) return true;
    if (!entry.key || seen.has(entry.key)) return false;
    seen.add(entry.key);
    return true;
  });
};

const removeEmptyNavSections = (items) => {
  const result = [];
  let pendingSection = null;
  items.forEach((item) => {
    if (item.section) {
      pendingSection = item;
      return;
    }
    if (pendingSection) result.push(pendingSection);
    pendingSection = null;
    result.push(item);
  });
  return result;
};

const dedupeSubpageKeys = (keys) => {
  const seen = new Set();
  return keys.filter((key) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const readAvailableTab = (storageKey, navItems) => {
  const storedTab = readStoredTab(storageKey, "dashboard");
  return navItems.some((item) => item.key === storedTab)
    ? storedTab
    : "dashboard";
};

const getPriorityBottomKeys = (priorityKeys, navItems, blockedKeys = new Set(), limit = 5) => {
  const selected = [];
  const seen = new Set();
  const availableKeys = new Set(navItems.map((item) => item.key).filter(Boolean));

  const addKey = (key) => {
    if (
      !key ||
      seen.has(key) ||
      blockedKeys.has(key) ||
      !availableKeys.has(key)
    ) {
      return;
    }
    selected.push(key);
    seen.add(key);
  };

  priorityKeys.forEach(addKey);
  navItems.forEach((item) => addKey(item.key));
  return selected.slice(0, limit);
};

const SCHOOL_ADMIN_EXCLUDED_KEYS = new Set([
  "super-admin-control",
  "helpdesk",
  "settings",
  "registered-schools",
  "permissions",
  "audit",
]);
const SCHOOL_ADMIN_SUBPAGE_MAP = Object.fromEntries(
  Object.entries(ADMIN_SUBPAGE_MAP)
    .filter(([parent]) => !SCHOOL_ADMIN_EXCLUDED_KEYS.has(parent))
    .map(([parent, children]) => [
      parent,
      dedupeSubpageKeys(
        children.filter((child) => !SCHOOL_ADMIN_EXCLUDED_KEYS.has(child)),
      ),
    ])
    .filter(([, children]) => children.length > 0),
);
const SCHOOL_ADMIN_NAV = (() => {
  const items = [];
  let pendingSection = null;
  ADMIN_NAV.forEach((entry) => {
    if (entry.section) {
      pendingSection = entry.section;
      return;
    }
    if (SCHOOL_ADMIN_EXCLUDED_KEYS.has(entry.key)) return;
    if (pendingSection) {
      items.push({ section: pendingSection });
      pendingSection = null;
    }
    items.push(entry);
    if (entry.key === "finance") {
      items.push({
        key: "school-profile",
        icon: "schools",
        label: "Managed School",
        color: "#0f766e",
      });
    }
  });
  return dedupeNavEntries(items);
})();

// STUDENT STUDY CONTENT PAGE
const StudentStudyContentPage = lazy(() =>
  import("./src/components/StudentStudyContentPage.jsx"),
);
const CoursesPage = lazy(() => import("./src/components/CoursesPage.jsx"));
const StudyTeamsPage = lazy(() => import("./src/components/StudyTeamsPage.jsx"));
function StudentStudyGroupsPage({ user, studentData }) {
  const [groups, setGroups] = useState([]);
  const [myGroups, setMyGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupMessages, setGroupMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [groupForm, setGroupForm] = useState({
    name: '',
    description: '',
    subject: '',
    class_level: '',
    max_members: 10,
    is_private: false
  });
  const [joinCode, setJoinCode] = useState('');

  useEffect(() => {
    loadGroups();
    loadMyGroups();
  }, []);

  const loadGroups = async () => {
    if (!supabase) {
      setGroups([]);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('study_groups')
        .select(`
          *,
          study_group_members(count)
        `)
        .eq('is_private', false)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setGroups(data || []);
    } catch (error) {
      console.error('Error loading groups:', error);
      setGroups([]);
    }
  };

  const loadMyGroups = async () => {
    if (!supabase || !studentData?.id) {
      setMyGroups([]);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('study_group_members')
        .select(`
          *,
          study_groups(*)
        `)
        .eq('student_id', studentData.id);

      if (error) throw error;
      setMyGroups(data?.map(item => item.study_groups).filter(Boolean) || []);
    } catch (error) {
      console.error('Error loading my groups:', error);
      setMyGroups([]);
    } finally {
      setLoading(false);
    }
  };

  const createGroup = async () => {
    if (!supabase || !studentData?.id || !groupForm.name.trim()) return;

    try {
      const { data, error } = await supabase
        .from('study_groups')
        .insert([{
          ...groupForm,
          created_by: studentData.id
        }])
        .select()
        .single();

      if (error) throw error;

      // Add creator as admin member
      const { error: memberError } = await supabase
        .from('study_group_members')
        .insert([{
          group_id: data.id,
          student_id: studentData.id,
          role: 'admin'
        }]);

      if (memberError) throw memberError;

      setGroups([data, ...groups]);
      setMyGroups([data, ...myGroups]);
      setShowCreateModal(false);
      resetGroupForm();
    } catch (error) {
      console.error('Error creating group:', error);
      alert(`Failed to create group: ${error.message}`);
    }
  };

  const joinGroup = async (groupId) => {
    if (!supabase || !studentData?.id) return;

    try {
      const { error } = await supabase
        .from('study_group_members')
        .insert([{
          group_id: groupId,
          student_id: studentData.id,
          role: 'member'
        }]);

      if (error) throw error;

      // Reload groups
      await loadGroups();
      await loadMyGroups();
      alert('Successfully joined the group!');
    } catch (error) {
      console.error('Error joining group:', error);
      alert(`Failed to join group: ${error.message}`);
    }
  };

  const joinGroupByCode = async () => {
    if (!supabase || !studentData?.id || !joinCode.trim()) return;

    try {
      const { data, error } = await supabase
        .from('study_groups')
        .select('*')
        .eq('group_code', joinCode.toUpperCase())
        .eq('is_private', true)
        .single();

      if (error) throw error;

      await joinGroup(data.id);
      setShowJoinModal(false);
      setJoinCode('');
    } catch (error) {
      console.error('Error joining group by code:', error);
      alert('Invalid group code or group not found');
    }
  };

  const leaveGroup = async (groupId) => {
    if (!supabase || !studentData?.id) return;
    if (!confirm('Are you sure you want to leave this group?')) return;

    try {
      const { error } = await supabase
        .from('study_group_members')
        .delete()
        .eq('group_id', groupId)
        .eq('student_id', studentData.id);

      if (error) throw error;

      setMyGroups(myGroups.filter(g => g.id !== groupId));
      await loadGroups();
    } catch (error) {
      console.error('Error leaving group:', error);
      alert(`Failed to leave group: ${error.message}`);
    }
  };

  const loadGroupMessages = async (groupId) => {
    if (!supabase) return;

    try {
      const { data, error } = await supabase
        .from('study_group_messages')
        .select(`
          *,
          students(full_name)
        `)
        .eq('group_id', groupId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setGroupMessages(data || []);
    } catch (error) {
      console.error('Error loading messages:', error);
      setGroupMessages([]);
    }
  };

  const sendMessage = async () => {
    if (!supabase || !studentData?.id || !selectedGroup || !newMessage.trim()) return;

    try {
      const { error } = await supabase
        .from('study_group_messages')
        .insert([{
          group_id: selectedGroup.id,
          student_id: studentData.id,
          message_type: 'text',
          content: newMessage.trim()
        }]);

      if (error) throw error;

      setNewMessage('');
      await loadGroupMessages(selectedGroup.id);
    } catch (error) {
      console.error('Error sending message:', error);
      alert(`Failed to send message: ${error.message}`);
    }
  };

  const resetGroupForm = () => {
    setGroupForm({
      name: '',
      description: '',
      subject: '',
      class_level: '',
      max_members: 10,
      is_private: false
    });
  };

  const openGroupChat = (group) => {
    setSelectedGroup(group);
    setShowGroupModal(true);
    loadGroupMessages(group.id);
  };

  if (loading) {
    return (
      <div className="fade-in">
        <div className="page-header">
          <div className="page-title">  Study Groups</div>
          <div className="page-sub">Loading study groups...</div>
        </div>
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <div className="spinner"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">  Study Groups</div>
        <div className="page-sub">Collaborate with fellow students in study groups</div>
      </div>

      <div className="page-actions-row">
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button
            className="btn btn-blue"
            onClick={() => setShowCreateModal(true)}
          >
            + Create Group
          </button>
          <button
            className="btn btn-outline"
            onClick={() => setShowJoinModal(true)}
          >
              Join Private Group
          </button>
        </div>
      </div>

      {/* My Groups Section */}
      {myGroups.length > 0 && (
        <div className="activity-panel" style={{ marginBottom: '28px' }}>
          <div className="activity-header">
            <div>
              <h3>My Study Groups</h3>
              <p style={{ margin: 0, color: '#64748b' }}>
                Groups you're currently a member of
              </p>
            </div>
          </div>

          <div className="tests-grid">
            {myGroups.map((group) => (
              <div key={group.id} className="test-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                  <div>
                    <h4 style={{ margin: '0 0 8px 0', color: '#1e293b' }}>{group.name}</h4>
                    <p style={{ margin: 0, color: '#64748b', fontSize: '0.9em' }}>{group.description}</p>
                  </div>
                  {group.is_private && (
                    <span style={{
                      background: '#fef3c7',
                      color: '#92400e',
                      padding: '4px 8px',
                      borderRadius: '12px',
                      fontSize: '0.75em',
                      fontWeight: '600'
                    }}>
                      Private
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', fontSize: '0.9em', color: '#64748b' }}>
                  <span>  {group.subject || 'General'}</span>
                  <span>  {group.class_level || 'All Levels'}</span>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    className="btn btn-sm btn-blue"
                    onClick={() => openGroupChat(group)}
                  >
                      Chat
                  </button>
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={() => leaveGroup(group.id)}
                  >
                    Leave Group
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Public Groups Section */}
      <div className="activity-panel">
        <div className="activity-header">
          <div>
            <h3>Public Study Groups</h3>
            <p style={{ margin: 0, color: '#64748b' }}>
              Join public groups to study with other students
            </p>
          </div>
        </div>

        {groups.length === 0 ? (
          <div className="empty-state">
            <div className="empty-title">No Public Groups Yet</div>
            <div className="empty-subtitle">Be the first to create a study group!</div>
          </div>
        ) : (
          <div className="tests-grid">
            {groups.map((group) => {
              const isMember = myGroups.some(g => g.id === group.id);
              return (
                <div key={group.id} className="test-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                    <div>
                      <h4 style={{ margin: '0 0 8px 0', color: '#1e293b' }}>{group.name}</h4>
                      <p style={{ margin: 0, color: '#64748b', fontSize: '0.9em' }}>{group.description}</p>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', fontSize: '0.9em', color: '#64748b' }}>
                    <span>  {group.subject || 'General'}</span>
                    <span>  {group.class_level || 'All Levels'}</span>
                    <span>  {group.max_members} max</span>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    {isMember ? (
                      <button
                        className="btn btn-sm btn-blue"
                        onClick={() => openGroupChat(group)}
                      >
                          Open Chat
                      </button>
                    ) : (
                      <button
                        className="btn btn-sm btn-green"
                        onClick={() => joinGroup(group.id)}
                      >
                          Join Group
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Group Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create Study Group</h3>
              <button className="modal-close" aria-label="Close dialog" onClick={() => setShowCreateModal(false)}>X</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Group Name *</label>
                <input
                  type="text"
                  className="form-control"
                  value={groupForm.name}
                  onChange={(e) => setGroupForm({...groupForm, name: e.target.value})}
                  placeholder="Enter group name"
                />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  className="form-control"
                  value={groupForm.description}
                  onChange={(e) => setGroupForm({...groupForm, description: e.target.value})}
                  placeholder="Describe your study group"
                  rows={3}
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Subject</label>
                  <input
                    type="text"
                    className="form-control"
                    value={groupForm.subject}
                    onChange={(e) => setGroupForm({...groupForm, subject: e.target.value})}
                    placeholder="e.g., Mathematics, Science"
                  />
                </div>
                <div className="form-group">
                  <label>Class Level</label>
                  <input
                    type="text"
                    className="form-control"
                    value={groupForm.class_level}
                    onChange={(e) => setGroupForm({...groupForm, class_level: e.target.value})}
                    placeholder="e.g., JHS 1, SHS 2"
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Max Members</label>
                  <input
                    type="number"
                    className="form-control"
                    value={groupForm.max_members}
                    onChange={(e) => setGroupForm({...groupForm, max_members: parseInt(e.target.value) || 10})}
                    min={2}
                    max={50}
                  />
                </div>
                <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <label style={{ margin: 0 }}>Private Group</label>
                  <input
                    type="checkbox"
                    checked={groupForm.is_private}
                    onChange={(e) => setGroupForm({...groupForm, is_private: e.target.checked})}
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => { setShowCreateModal(false); resetGroupForm(); }}
              >
                Cancel
              </button>
              <button
                className="btn btn-blue"
                onClick={createGroup}
              >
                Create Group
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Join Private Group Modal */}
      {showJoinModal && (
        <div className="modal-overlay" onClick={() => setShowJoinModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Join Private Group</h3>
              <button className="modal-close" aria-label="Close dialog" onClick={() => setShowJoinModal(false)}>X</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Group Code *</label>
                <input
                  type="text"
                  className="form-control"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="Enter group code"
                  style={{ textTransform: 'uppercase' }}
                />
                <small style={{ color: '#64748b', marginTop: '8px', display: 'block' }}>
                  Ask the group admin for the invitation code
                </small>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => { setShowJoinModal(false); setJoinCode(''); }}
              >
                Cancel
              </button>
              <button
                className="btn btn-blue"
                onClick={joinGroupByCode}
              >
                Join Group
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Group Chat Modal */}
      {showGroupModal && selectedGroup && (
        <div className="modal-overlay" onClick={() => setShowGroupModal(false)}>
          <div className="modal-content large-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{selectedGroup.name} - Group Chat</h3>
              <button className="modal-close" aria-label="Close dialog" onClick={() => setShowGroupModal(false)}>X</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', height: '60vh' }}>
              <div style={{
                flex: 1,
                overflowY: 'auto',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '16px',
                marginBottom: '16px',
                background: '#f8fafc'
              }}>
                {groupMessages.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#64748b', padding: '40px' }}>
                    No messages yet. Start the conversation!
                  </div>
                ) : (
                  groupMessages.map((message) => (
                    <div key={message.id} style={{
                      marginBottom: '12px',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      background: message.student_id === studentData?.id ? '#dbeafe' : '#ffffff',
                      border: '1px solid #e2e8f0'
                    }}>
                      <div style={{ fontWeight: '600', fontSize: '0.9em', color: '#475569', marginBottom: '4px' }}>
                        {message.students?.full_name || 'Unknown User'}
                      </div>
                      <div style={{ color: '#1e293b' }}>{message.content}</div>
                      <div style={{ fontSize: '0.8em', color: '#64748b', marginTop: '4px' }}>
                        {new Date(message.created_at).toLocaleString()}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  className="form-control"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Type your message..."
                  onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn btn-blue"
                  onClick={sendMessage}
                  disabled={!newMessage.trim()}
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const STUDENT_NAV = [
  { section: "Overview" },
  { key: "dashboard", icon: "dashboard", label: "Dashboard", color: "#6366f1" },
  { key: "profile", icon: "profile", label: "Profile", color: "#3b82f6" },
  { section: "Academics" },
  { key: "results", icon: "analytics", label: "Results", color: "#f97316" },
  { key: "report-card", icon: "results", label: "Report Card", color: "#7c3aed" },
  { key: "exam-schedule", icon: "events", label: "Exam Schedule", color: "#0369a1" },
  { key: "live-tests", icon: "quiz", label: "Quizzes & Tests", color: "#f59e0b" },
  { key: "study-content", icon: "docs", label: "Study Materials", color: "#10b981" },
  { key: "courses", icon: "docs", label: "Courses", color: "#0891b2" },
  { key: "study-teams", icon: "chat", label: "Study Teams", color: "#7c3aed" },
  { section: "Mock Placement" },
  { key: "selection", icon: "selection", label: "Select Schools", color: "#06b6d4" },
  { key: "my-selection", icon: "confirmed", label: "My Selection", color: "#16a34a" },
  { section: "Student Services" },
  { key: "attendance", icon: "attendance", label: "Attendance", color: "#14b8a6" },
  { key: "fees", icon: "fees", label: "Fees", color: "#22c55e" },
  { key: "pay-fees", icon: "fees", label: "Pay Fees", color: "#15803d" },
  { section: "Communication & Resources" },
  { key: "announcements", icon: "bell", label: "Announcements", color: "#ef4444" },
  { key: "support-tickets", icon: "support", label: "Support", color: "#0f766e" },
  { key: "chat", icon: "chat", label: "Chat", color: "#10b981" },
  { key: "docs", icon: "docs", label: "Documents", color: "#f97316" },
  { key: "upload-docs", icon: "enroll", label: "Upload Documents", color: "#7c2d12" },
  { key: "assignments", icon: "docs", label: "Assignments", color: "#1d4ed8" },
  { key: "resources", icon: "docs", label: "Resources", color: "#475569" },
];

const STUDENT_SUBPAGE_MAP = {
  results: ["report-card", "exam-schedule"],
  selection: ["my-selection"],
  fees: ["pay-fees"],
  announcements: ["support-tickets", "chat"],
  docs: ["upload-docs"],
  "study-content": ["assignments", "resources"],
};

// ADMIN PORTAL
function AdminPortal({ user, onLogout, darkMode, onToggleDark }) {
  const { cfg: appCfg } = useContext(SettingsContext);
  const { notify } = useContext(NotificationContext) || {};
  const adminFeesPortalEnabled = appCfg.adminFeesPortalEnabled !== false;
  const childToParent = useMemo(() => {
    const map = {};
    Object.entries(ADMIN_SUBPAGE_MAP).forEach(([parent, children]) => {
      children.forEach((key) => {
        map[key] = parent;
      });
    });
    return map;
  }, []);
  const [expandedGroups, setExpandedGroups] = useState(() =>
    Object.fromEntries(Object.keys(ADMIN_SUBPAGE_MAP).map((k) => [k, false])),
  );
  const [tab, setTab] = useState(() =>
    readAvailableTab(ADMIN_TAB_KEY, ADMIN_NAV),
  );
  const mainContentRef = useRef(null);
  useEffect(() => {
    mainContentRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [tab]);
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= 768,
  );
  const [notificationCount, setNotificationCount] = useState(0);
  const [adminSupportNotifications, setAdminSupportNotifications] = useState([]);
  const [adminStudents, setAdminStudents] = useState(() =>
    supabase ? [] : sortStudentsByIndex(STUDENTS_DATA),
  );
  const [adminSchools, setAdminSchools] = useState(() =>
    supabase ? [] : SCHOOLS_DATA,
  );
  const [registeredSchools, setRegisteredSchools] = useState([]);
  const [schoolAdmins, setSchoolAdmins] = useState([]);
  const [registrySetupError, setRegistrySetupError] = useState("");
  const [pendingSelections, setPendingSelections] = useState([]);
  const [confirmedSelections, setConfirmedSelections] = useState([]);
  const [feesData, setFeesData] = useState([]);
  const [teachersData, setTeachersData] = useState(TEACHERS_DATA);
  const [loadingAdminData, setLoadingAdminData] = useState(!!supabase);
  const [databaseTables, setDatabaseTables] = useState({
    users: { rows: [], error: "" },
    students: { rows: [], error: "" },
    schools: { rows: [], error: "" },
    school_selections: { rows: [], error: "" },
    events: { rows: [], error: "" },
    attendance: { rows: [], error: "Not loaded yet" },
    fees: { rows: [], error: "Not loaded yet" },
    teachers: { rows: [], error: "Not loaded yet" },
    app_settings: { rows: [], error: "Not loaded yet" },
    chat_messages: { rows: [], error: "Not loaded yet" },
    scores: { rows: [], error: "Not loaded yet" },
    results: { rows: [], error: "Not loaded yet" },
  });
  const [loadingPlacements, setLoadingPlacements] = useState(false);
  const [chatUsers, setChatUsers] = useState([
    { id: 1, name: "Support Team", avatar: "S", unread: 0, status: "active" },
    { id: 2, name: "Ms. Ama Owusu", avatar: "A", unread: 0, status: "online" },
    { id: 3, name: "Mr. Kwesi Adjei", avatar: "K", unread: 0, status: "away" },
    {
      id: 4,
      name: "Admissions Office",
      avatar: "O",
      unread: 0,
      status: "active",
    },
    { id: 5, name: "Dr. Yaw Mensah", avatar: "Y", unread: 0, status: "online" },
    { id: 6, name: "Accra Campus", avatar: "C", unread: 0, status: "active" },
    { id: 7, name: "Kumasi Branch", avatar: "B", unread: 0, status: "away" },
    { id: 8, name: "Finance Dept", avatar: "F", unread: 0, status: "online" },
    { id: 9, name: "IT Support", avatar: "I", unread: 0, status: "active" },
    {
      id: 10,
      name: "Student Affairs",
      avatar: "E",
      unread: 0,
      status: "online",
    },
  ]);
  const unreadAdminSupportNotifications = adminSupportNotifications.filter(
    (notification) => !notification.is_read,
  ).length;
  const markAdminSupportNotificationsRead = useCallback(async () => {
    const unreadIds = adminSupportNotifications
      .filter((notification) => !notification.is_read)
      .map((notification) => notification.id);
    if (!supabase || !unreadIds.length) return;
    const { error } = await supabase
      .from("admin_notifications")
      .update({ is_read: true })
      .in("id", unreadIds);
    if (error) {
      notify?.(`Could not mark support notifications as read: ${error.message}`, "error");
      return;
    }
    setAdminSupportNotifications((current) =>
      current.map((notification) =>
        unreadIds.includes(notification.id)
          ? { ...notification, is_read: true }
          : notification,
      ),
    );
  }, [adminSupportNotifications, notify]);

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    const loadNotifications = async () => {
      const { data, error } = await supabase
        .from("admin_notifications")
        .select("id, notification_type, title, message, student_id, ticket_record_key, is_read, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (!active) return;
      if (error) {
        notify?.(`Support notifications could not be loaded: ${error.message}`, "error");
        return;
      }
      setAdminSupportNotifications(data || []);
    };
    void loadNotifications().catch((error) => {
      if (active) {
        notify?.(`Support notifications could not be loaded: ${error?.message || "Supabase request failed."}`, "error");
      }
    });

    const channel = supabase
      .channel(`admin-support-notifications-${user?.id || "current"}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "admin_notifications",
        },
        (payload) => {
          const notification = payload.new;
          setAdminSupportNotifications((current) =>
            current.some((item) => item.id === notification.id)
              ? current
              : [notification, ...current].slice(0, 50),
          );
          notify?.(
            `${notification.title}: ${notification.message}`,
            "info",
            8000,
          );
        },
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          notify?.("Live support ticket alerts are unavailable. Refresh to check for new tickets.", "error");
        }
      });

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [notify, user?.id]);

  useEffect(() => {
    if (tab === "helpdesk") {
      void markAdminSupportNotificationsRead();
    }
  }, [markAdminSupportNotificationsRead, tab]);
  const totalChatUnread = chatUsers.reduce((sum, u) => sum + u.unread, 0);
  // Determine if user is super admin
  const isSuperAdminUser = useMemo(() =>
    normalizeRoleKey(user?.role || "") === "admin",
    [user?.role]
  );

  // Features restricted to super admins only
  const SUPER_ADMIN_ONLY_KEYS = useMemo(() =>
    new Set([
      "registered-schools",
      "permissions",
      "audit",
    ]),
    []
  );

  const blockedAdminFeeKeys = useMemo(
    () => (adminFeesPortalEnabled ? [] : ["fees", "payments", "installments"]),
    [adminFeesPortalEnabled],
  );

  const filteredAdminNav = useMemo(
    () => removeEmptyNavSections(
      ADMIN_NAV.filter((item) => {
        if (item.section) return true;
        // Block if fees disabled
        if (blockedAdminFeeKeys.includes(item.key)) return false;
        // Block if super admin only feature and user is not super admin
        if (item.superAdminOnly && !isSuperAdminUser) return false;
        if (!isSuperAdminUser && SUPER_ADMIN_ONLY_KEYS.has(item.key)) return false;
        return true;
      }),
    ),
    [blockedAdminFeeKeys, isSuperAdminUser, SUPER_ADMIN_ONLY_KEYS],
  );
  const BOTTOM = useMemo(
    () =>
      getPriorityBottomKeys(
        ["dashboard", "students", "schools", "pending", "settings"],
        filteredAdminNav,
        new Set([...blockedAdminFeeKeys, ...(isSuperAdminUser ? [] : Array.from(SUPER_ADMIN_ONLY_KEYS))]),
      ),
    [filteredAdminNav, blockedAdminFeeKeys, isSuperAdminUser, SUPER_ADMIN_ONLY_KEYS],
  );

  const goTab = (key, closeSidebar = true) => {
    setTab(key);
    writeStoredTab(ADMIN_TAB_KEY, key);
    if (closeSidebar) setSidebarOpen(false);
  };
  const reloadApp = () => window.location.reload();
  const financeSummary = {
    income: feesData.reduce((sum, fee) => sum + Number(fee.paid || 0), 0),
    expenses: FINANCE_DATA.expenses,
    fees_collected: feesData.reduce(
      (sum, fee) => sum + Number(fee.paid || 0),
      0,
    ),
    outstanding: feesData.reduce(
      (sum, fee) =>
        sum + Math.max(Number(fee.amount || 0) - Number(fee.paid || 0), 0),
      0,
    ),
  };

  const registerSchool = async (schoolForm) => {
    const payload = {
      name: schoolForm.name,
      location: schoolForm.location,
      region: schoolForm.region,
      category: schoolForm.category,
      type: schoolForm.type,
      active: !!schoolForm.active,
      tenant_key: `${
        String(schoolForm.name || "school")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "school"
      }-${Date.now().toString().slice(-5)}`,
    };

    let insertedRow = { id: Date.now(), ...payload };

    if (supabase) {
      const { data, error } = await supabase
        .from("registered_schools")
        .insert(payload)
        .select("*")
        .single();
      if (error) {
        if (isMissingTableError(error, "registered_schools")) {
          throw new Error(
            "Registered school setup is not available yet. Run backend/supabase/migrations/003_registered_schools_and_school_admins.sql in Supabase, then refresh.",
          );
        }
        throw error;
      }
      insertedRow = data || insertedRow;
    }

    const normalized = normalizeSchoolRow(insertedRow);
    setRegisteredSchools((current) =>
      sortSchoolsByCategory([...(current || []), normalized]),
    );
    return normalized;
  };

  const updateSchool = async (schoolId, schoolForm) => {
    const payload = {
      name: schoolForm.name,
      location: schoolForm.location,
      region: schoolForm.region,
      category: schoolForm.category,
      type: schoolForm.type,
      active: !!schoolForm.active,
    };

    let updatedRow = { id: schoolId, ...payload };

    if (supabase) {
      const { data, error } = await supabase
        .from("registered_schools")
        .update(payload)
        .eq("id", schoolId)
        .select("*")
        .single();
      if (error) {
        if (isMissingTableError(error, "registered_schools")) {
          throw new Error(
            "Registered school setup is not available yet. Run backend/supabase/migrations/003_registered_schools_and_school_admins.sql in Supabase, then refresh.",
          );
        }
        throw error;
      }
      updatedRow = data || updatedRow;
    }

    const normalized = normalizeSchoolRow(updatedRow);
    setRegisteredSchools((current) =>
      sortSchoolsByCategory(
        (current || []).map((school) =>
          school.id === schoolId ? normalized : school,
        ),
      ),
    );
    return normalized;
  };

  const createSchoolAdmin = async (school, adminForm) => {
    const assignedRole =
      normalizeRoleKey(adminForm.role || "school_admin") || "school_admin";
    const payload = {
      registered_school_id: school.id,
      full_name: adminForm.full_name.trim(),
      email: adminForm.email.trim(),
      phone: adminForm.phone.trim(),
      password: adminForm.password,
      role: assignedRole,
      status: "active",
    };

    let insertedAdmin = { id: `local-${Date.now()}`, ...payload };

    if (supabase) {
      let adminResponse = await supabase
        .from("school_admins")
        .insert(payload)
        .select("*")
        .single();
      if (
        adminResponse.error &&
        isMissingColumnError(adminResponse.error) &&
        Object.prototype.hasOwnProperty.call(payload, "role")
      ) {
        const { role, ...fallbackPayload } = payload;
        adminResponse = await supabase
          .from("school_admins")
          .insert(fallbackPayload)
          .select("*")
          .single();
      }
      if (adminResponse.error) {
        if (isMissingTableError(adminResponse.error, "school_admins")) {
          throw new Error(
            "School admin setup is not available yet. Run backend/supabase/migrations/003_registered_schools_and_school_admins.sql in Supabase, then refresh.",
          );
        }
        throw adminResponse.error;
      }
      insertedAdmin = {
        ...(adminResponse.data || insertedAdmin),
        role: adminResponse.data?.role || assignedRole,
      };

      const { error: userError } = await supabase.from("users").insert({
        email: payload.email,
        password: payload.password,
        role: assignedRole,
        full_name: payload.full_name,
        registered_school_id: school.id,
        managed_school_name: school.name,
      });
      if (userError) throw userError;
    }

    setSchoolAdmins((current) => [insertedAdmin, ...current]);
    return insertedAdmin;
  };

  const saveAdminStudent = async (existingStudent, draft) => {
    const normalizedRegisteredSchoolId =
      draft.registered_school_id == null ||
      String(draft.registered_school_id).trim() === ""
        ? null
        : Number(draft.registered_school_id);
    const hasValidRegisteredSchoolId =
      normalizedRegisteredSchoolId == null ||
      Number.isFinite(normalizedRegisteredSchoolId);
    if (!hasValidRegisteredSchoolId) {
      throw new Error(
        "Invalid registered school selected. Please choose a valid school and try again.",
      );
    }

    const selectedSchool = registeredSchools.find(
      (s) => s.id === normalizedRegisteredSchoolId,
    );
    const payload = {
      full_name: draft.full_name.trim(),
      gender: draft.gender || null,
      index: draft.index.trim(),
      class: draft.class,
      region: selectedSchool?.region || draft.region,
      parent_contact: draft.parent_contact?.trim() || null,
      registered_school_id: normalizedRegisteredSchoolId,
      aggregate: Number(draft.aggregate || 0),
      status: draft.status || "pending",
      photo_url: draft.photo_url?.trim() || null,
      date_of_birth: draft.date_of_birth || null,
    };

    let savedRow = normalizeStudentRecord({
      id: existingStudent?.id || Date.now(),
      ...payload,
    });

    if (supabase) {
      const updateStudentRow = async (nextPayload) => {
        if (!existingStudent) {
          return supabase
            .from("students")
            .insert(nextPayload)
            .select("*")
            .maybeSingle();
        }

        if (
          existingStudent.id != null &&
          !String(existingStudent.id).startsWith("local-")
        ) {
          const byId = await supabase
            .from("students")
            .update(nextPayload)
            .eq("id", existingStudent.id)
            .select("*")
            .maybeSingle();
          if (!byId.error && byId.data) return byId;
        }

        const studentIndex = String(existingStudent.index || "").trim();
        if (studentIndex) {
          const byIndex = await supabase
            .from("students")
            .update(nextPayload)
            .eq("index", studentIndex)
            .select("*")
            .maybeSingle();
          if (!byIndex.error && byIndex.data) return byIndex;
          const byIndexNumber = await supabase
            .from("students")
            .update(nextPayload)
            .eq("index_number", studentIndex)
            .select("*")
            .maybeSingle();
          if (!byIndexNumber.error && byIndexNumber.data) return byIndexNumber;
        }

        const lookupChecks = [];
        if (
          existingStudent.id != null &&
          !String(existingStudent.id).startsWith("local-")
        ) {
          lookupChecks.push(
            supabase
              .from("students")
              .select("id")
              .eq("id", existingStudent.id)
              .limit(1),
          );
        }
        const lookupStudentIndex = String(existingStudent.index || "").trim();
        if (lookupStudentIndex) {
          lookupChecks.push(
            supabase
              .from("students")
              .select("id")
              .eq("index", lookupStudentIndex)
              .limit(1),
          );
          lookupChecks.push(
            supabase
              .from("students")
              .select("id")
              .eq("index_number", lookupStudentIndex)
              .limit(1),
          );
        }
        const lookupResults = await Promise.all(lookupChecks);
        const visibleRowExists = lookupResults.some(
          (result) => Array.isArray(result.data) && result.data.length > 0,
        );

        if (visibleRowExists) {
          return {
            data: null,
            error: new Error(
              "Student exists but update is blocked by Supabase permissions (RLS). Add/adjust an UPDATE policy for public.students.",
            ),
          };
        }

        return {
          data: null,
          error: new Error(
            "Could not find this student in Supabase to update. The row key may have changed (id/index/index_number).",
          ),
        };
      };

      let response = await updateStudentRow(payload);

      if (
        response.error &&
        isMissingColumnError(response.error) &&
        Object.prototype.hasOwnProperty.call(payload, "registered_school_id")
      ) {
        if (payload.registered_school_id != null) {
          throw new Error(
            "School assignment requires backend/supabase/migrations/004_add_registered_school_scope.sql. Run the migration, then refresh.",
          );
        }
        const { registered_school_id, ...fallbackPayload } = payload;
        response = await updateStudentRow(fallbackPayload);
      }

      if (
        response.error &&
        isMissingColumnError(response.error) &&
        Object.prototype.hasOwnProperty.call(payload, "photo_url")
      ) {
        const { photo_url, ...fallbackPayload } = payload;
        response = await updateStudentRow(fallbackPayload);
      }

      if (response.error) throw response.error;
      savedRow = normalizeStudentRecord(
        response.data || { id: existingStudent?.id || Date.now(), ...payload },
      );
    }

    setAdminStudents((current) =>
      sortStudentsByIndex(
        existingStudent
          ? current.map((student) =>
              String(student.id) === String(existingStudent.id)
                ? { ...student, ...savedRow }
                : student,
            )
          : [...current, savedRow],
      ),
    );

    return savedRow;
  };

  const saveAdminTeacher = async (existingTeacher, draft) => {
    const scopedSchoolId = user?.registered_school_id || null;
    const payload = {
      name: draft.name.trim(),
      employee_id: draft.employee_id.trim() || null,
      role: normalizeRoleKey(draft.role || "teacher") || "teacher",
      gender: draft.gender.trim() || null,
      subject: draft.subject.trim(),
      class: draft.class.trim(),
      phone: draft.phone.trim(),
      email: draft.email.trim() || null,
      qualification: draft.qualification.trim() || null,
      date_of_birth: draft.date_of_birth || null,
      hire_date: draft.hire_date || null,
      address: draft.address.trim() || null,
      ...(scopedSchoolId != null
        ? { registered_school_id: scopedSchoolId }
        : {}),
    };

    let savedRow = normalizeTeacherRow({
      id: existingTeacher?.id || Date.now(),
      ...payload,
    });

    if (supabase) {
      let response = existingTeacher?.id
        ? await supabase
            .from("teachers")
            .update(payload)
            .eq("id", existingTeacher.id)
            .select("*")
            .single()
        : await supabase.from("teachers").insert(payload).select("*").single();

      if (response.error && isMissingColumnError(response.error)) {
        const fallbackPayload = { ...payload };
        TEACHER_PROFILE_FIELD_KEYS.forEach((key) => {
          delete fallbackPayload[key];
        });
        response = existingTeacher?.id
          ? await supabase
              .from("teachers")
              .update(fallbackPayload)
              .eq("id", existingTeacher.id)
              .select("*")
              .single()
          : await supabase
              .from("teachers")
              .insert(fallbackPayload)
              .select("*")
              .single();
      }

      if (
        response.error &&
        isMissingColumnError(response.error) &&
        scopedSchoolId != null
      ) {
        throw new Error(
          "School-scoped teacher updates require backend/supabase/migrations/004_add_registered_school_scope.sql. Run the migration, then refresh.",
        );
      }

      if (
        response.error &&
        isMissingColumnError(response.error) &&
        Object.prototype.hasOwnProperty.call(payload, "role")
      ) {
        const { role, ...fallbackPayload } = payload;
        response = existingTeacher?.id
          ? await supabase
              .from("teachers")
              .update(fallbackPayload)
              .eq("id", existingTeacher.id)
              .select("*")
              .single()
          : await supabase
              .from("teachers")
              .insert(fallbackPayload)
              .select("*")
              .single();
      }

      if (response.error) throw response.error;
      savedRow = normalizeTeacherRow(
        response.data || { id: existingTeacher?.id || Date.now(), ...payload },
      );
    }

    setTeachersData((current) => {
      const nextRows = existingTeacher
        ? current.map((teacher) =>
            String(teacher.id) === String(existingTeacher.id)
              ? { ...teacher, ...savedRow }
              : teacher,
          )
        : [savedRow, ...current];
      return nextRows
        .slice()
        .sort((a, b) =>
          String(a.name || "").localeCompare(String(b.name || "")),
        );
    });

    return savedRow;
  };
  useEffect(() => {
    const parent = childToParent[tab];
    if (parent) {
      setExpandedGroups((prev) => ({ ...prev, [parent]: true }));
    }
  }, [tab, childToParent]);
  useEffect(() => {
    if (blockedAdminFeeKeys.includes(tab)) {
      setTab("dashboard");
      writeStoredTab(ADMIN_TAB_KEY, "dashboard");
    }
  }, [blockedAdminFeeKeys, tab]);

  const loadAdminPortalData = useCallback(async () => {
    if (!supabase) {
      setLoadingAdminData(false);
      return;
    }

    const { data: students } = await supabase
      .from("students")
      .select("*")
      .order("id", { ascending: true });
    const normalizedStudents =
      Array.isArray(students) && students.length
        ? students.map((s, i) => normalizeStudentRecord(s, i))
        : [];
    setAdminStudents(sortStudentsByIndex(normalizedStudents));

    const { data: schools } = await supabase
      .from("schools")
      .select("*")
      .order("name", { ascending: true });
    const normalizedSchools =
      Array.isArray(schools) && schools.length
        ? sortSchoolsByCategory(schools.map(normalizeSchoolRow))
        : SCHOOLS_DATA;
    setAdminSchools(normalizedSchools);

    const { data: regSchools, error: regSchoolsError } = await supabase
      .from("registered_schools")
      .select("*")
      .order("name", { ascending: true });
    if (isMissingTableError(regSchoolsError, "registered_schools")) {
      setRegistrySetupError(
        "Registered school tables are not installed in Supabase yet. Run backend/supabase/migrations/003_registered_schools_and_school_admins.sql, then refresh.",
      );
      setRegisteredSchools([]);
    } else if (!regSchoolsError && Array.isArray(regSchools)) {
      setRegisteredSchools(
        sortSchoolsByCategory(regSchools.map(normalizeSchoolRow)),
      );
    }

    const { data: regAdmins, error: regAdminsError } = await supabase
      .from("school_admins")
      .select("*")
      .order("created_at", { ascending: false });
    if (isMissingTableError(regAdminsError, "school_admins")) {
      setRegistrySetupError(
        "Registered school tables are not installed in Supabase yet. Run backend/supabase/migrations/003_registered_schools_and_school_admins.sql, then refresh.",
      );
      setSchoolAdmins([]);
    } else if (!regAdminsError && Array.isArray(regAdmins)) {
      setSchoolAdmins(regAdmins);
    }

    const tableEntries = await Promise.all(
      [
        "users",
        "students",
        "schools",
        "school_selections",
        "events",
        "attendance",
        "fees",
        "teachers",
        "app_settings",
        "chat_messages",
        "scores",
        "results",
      ].map(async (tableName) => {
        const { data, error } = await supabase
          .from(tableName)
          .select("*")
          .limit(25);
        return [
          tableName,
          {
            rows: Array.isArray(data) ? data : [],
            error: error?.message || "",
          },
        ];
      }),
    );
    setDatabaseTables(Object.fromEntries(tableEntries));

    const { data: fees } = await supabase
      .from("fees")
      .select("*")
      .order("id", { ascending: false });
    setFeesData(Array.isArray(fees) ? fees.map(normalizeFeeRow) : []);

    const { data: teachers } = await supabase
      .from("teachers")
      .select("*")
      .order("name", { ascending: true });
    if (Array.isArray(teachers) && teachers.length) {
      setTeachersData(teachers.map(normalizeTeacherRow));
    }

    setLoadingPlacements(true);
    const loadSelectionRows = async () => {
      const attempts = [
        () =>
          supabase
            .from("school_selections")
            .select("*")
            .order("created_at", { ascending: false }),
        () =>
          supabase
            .from("school_selections")
            .select("*")
            .order("updated_at", { ascending: false }),
        () =>
          supabase
            .from("school_selections")
            .select("*")
            .order("id", { ascending: false }),
        () => supabase.from("school_selections").select("*"),
      ];
      for (const run of attempts) {
        const { data, error } = await run();
        if (!error && Array.isArray(data)) return data;
      }
      return [];
    };
    const selectionRows = await loadSelectionRows();
    const studentsMap = new Map();
    normalizedStudents.forEach((student) => {
      studentsMap.set(String(student.id), student);
      studentsMap.set(String(student.index), student);
    });
    if (Array.isArray(selectionRows) && selectionRows.length) {
      const summarized = selectionRows.map((row) =>
        summarizeSelectionRecord(row, studentsMap),
      );
      setPendingSelections(
        sortRecordsByStudentIndex(
          summarized.filter(
            (row) => !row.approved && row.status !== "confirmed",
          ),
        ),
      );
      setConfirmedSelections(
        sortRecordsByStudentIndex(
          summarized.filter(
            (row) => row.approved || row.status === "confirmed",
          ),
        ),
      );
    } else {
      setPendingSelections([]);
      setConfirmedSelections([]);
    }
    setLoadingPlacements(false);
    setLoadingAdminData(false);
  }, [supabase]);

  useEffect(() => {
    loadAdminPortalData();
  }, [loadAdminPortalData]);

  const approveSelection = async (id) => {
    const target = pendingSelections.find(
      (item) => String(item.id) === String(id),
    );
    if (!target) return;

    if (supabase) {
      const reviewedAt = new Date().toISOString();
      const reviewedBy = user?.name || "Admin";
      const payloads = [
        {
          status: "confirmed",
          approved: true,
          reviewed_at: reviewedAt,
          reviewed_by: reviewedBy,
        },
        { status: "confirmed", approved: true, reviewed_at: reviewedAt },
        { status: "confirmed", approved: true },
        { status: "confirmed" },
        { approved: true },
      ];

      let persisted = false;
      for (const payload of payloads) {
        const { error } = await supabase
          .from("school_selections")
          .update(payload)
          .eq("id", id);
        if (!error) {
          persisted = true;
          break;
        }

        const msg = String(error.message || "").toLowerCase();
        const isColumnIssue =
          error.code === "PGRST204" ||
          error.code === "42703" ||
          msg.includes("column");
        if (!isColumnIssue) {
          alert(error.message || "Failed to approve selection.");
          return;
        }
      }

      if (!persisted) {
        alert(
          "Could not persist approval to Supabase. Please check the school_selections table columns.",
        );
        return;
      }
    }

    const approvedRow = {
      ...target,
      approved: true,
      status: "confirmed",
      reviewedAt: new Date().toISOString(),
    };
    setPendingSelections((items) =>
      sortRecordsByStudentIndex(
        items.filter((item) => String(item.id) !== String(id)),
      ),
    );
    setConfirmedSelections((items) =>
      sortRecordsByStudentIndex([approvedRow, ...items]),
    );
  };

  useEffect(() => {
    if (tab === "events") {
      setNotificationCount(0);
    }
  }, [tab]);

  const openNotifications = () => {
    setNotificationCount(0);
    void markAdminSupportNotificationsRead();
    goTab("helpdesk");
  };
  const recentActivity = useMemo(
    () =>
      buildRecentActivity({
        students: adminStudents,
        selections: [...pendingSelections, ...confirmedSelections],
        fees: feesData,
        events: databaseTables.events?.rows,
      }),
    [
      adminStudents,
      pendingSelections,
      confirmedSelections,
      feesData,
      databaseTables.events?.rows,
    ],
  );
  const handleMainBlankClick = (event) => {
    if (!sidebarOpen) return;
    if (event.target === event.currentTarget) {
      setSidebarOpen(false);
    }
  };

  const renderPage = () => {
    const isSuperAdminUser = normalizeRoleKey(user?.role || "") === "admin";

    // Check if current page is restricted to super admin
    if (SUPER_ADMIN_ONLY_KEYS.has(tab) && !isSuperAdminUser) {
      return (
        <div
          className="card card-padded"
          style={{ textAlign: "center", padding: 48 }}
        >
          <div style={{ fontWeight: 700, fontSize: "1.2em", marginBottom: 16, color: "#dc2626" }}>
              Super Admin Only
          </div>
          <div style={{ fontSize: ".95em", color: "#64748b", marginBottom: 24 }}>
            This feature is restricted to Super Administrators. Contact your system administrator for access.
          </div>
          <button className="btn btn-blue" onClick={() => goTab("dashboard")}>
            Return to Dashboard
          </button>
        </div>
      );
    }

    if (tab === "enroll")
      return (
        <EnrollPage
          onEnrolled={loadAdminPortalData}
          onBack={() => {
            goTab("students");
            loadAdminPortalData();
          }}
          registeredSchools={registeredSchools}
          isSuperAdmin={isSuperAdminUser}
        />
      );
    const pages = {
      dashboard: (
        <AdminDashboard
          userName={user?.name}
          studentsData={adminStudents}
          registeredSchools={registeredSchools}
          financeSummary={financeSummary}
          recentActivity={recentActivity}
          isLoading={loadingAdminData}
        />
      ),
      students: (
        <Suspense fallback={<div className="portal-loading" role="status">Loading students...</div>}>
          <StudentsPage
            onEnroll={() => goTab("enroll")}
            onEditStudent={saveAdminStudent}
            studentsData={adminStudents}
            onReloadStudents={loadAdminPortalData}
            registeredSchools={registeredSchools}
            canAssignRegisteredSchool={
              normalizeRoleKey(user?.role || "") === "super_admin"
            }
            isSuperAdmin={
              normalizeRoleKey(user?.role || "") === "super_admin"
            }
          />
        </Suspense>
      ),
      scores: (
        <ScoresPage
          studentsData={adminStudents}
          tableInfo={databaseTables.scores}
        />
      ),
      "academic-scores": (
        <Suspense fallback={<div className="portal-loading" role="status">Loading academic scores...</div>}>
          <AcademicScores />
        </Suspense>
      ),
      analytics: (
        <AnalyticsPage
          studentsData={adminStudents}
          schoolsData={adminSchools}
          selectionsData={[...pendingSelections, ...confirmedSelections]}
          scoreTableInfo={databaseTables.scores}
        />
      ),
      results: (
        <ResultsPage
          studentsData={adminStudents}
          tableInfo={databaseTables.results}
        />
      ),
      "study-content": <StudyContentPage currentUser={user} />,
      courses: (
        <Suspense fallback={<div className="portal-loading" role="status">Loading courses...</div>}>
          <CoursesPage mode="admin" />
        </Suspense>
      ),
      "study-teams": (
        <Suspense fallback={<div className="portal-loading" role="status">Loading study teams...</div>}>
          <StudyTeamsPage user={user} />
        </Suspense>
      ),
      grading: <GradingPage />,
      fees: (
        <FeesAdmin
          studentsData={adminStudents}
          feesData={feesData}
          tableInfo={databaseTables.fees}
        />
      ),
      schools: <SchoolsPage schoolsData={adminSchools} />,
      "registered-schools": (
        <RegisteredSchoolsPage
          schools={registeredSchools}
          admins={schoolAdmins}
          onRegisterNew={() => goTab("school-register")}
          onCreateSchoolAdmin={createSchoolAdmin}
          onUpdateSchool={updateSchool}
          setupError={registrySetupError}
          currentUser={user}
        />
      ),
      "school-register": (
        <SchoolRegistrationPage
          onBack={() => goTab("registered-schools")}
          onRegisterSchool={registerSchool}
          setupError={registrySetupError}
        />
      ),
      pending: (
        <PendingSelections
          rows={pendingSelections}
          loading={loadingPlacements}
          onApprove={approveSelection}
        />
      ),
      confirmed: (
        <ConfirmedPlacements
          rows={confirmedSelections}
          loading={loadingPlacements}
        />
      ),
      finance: (
        <FinancePage
          financeSummary={financeSummary}
          tableInfo={databaseTables.fees}
        />
      ),
      helpdesk: <HelpdeskPage />,
      chat: <ChatPage chatUsers={chatUsers} onChatUsersChange={setChatUsers} />,
      documents: <DocumentWorkflowPage />,
      settings: <SettingsPage />,
      permissions: <PermissionsMatrixPage currentUser={user} />,
      audit: <AuditTrailPage />,
      payments: <PaymentsReceiptsPage />,
      reports: <ReportsExportsPage />,
      "super-admin-control": (
        <div className="card card-padded">
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: "1.5em", marginBottom: 8 }}>Super Admin</h2>
            <p style={{ color: "#64748b" }}>Manage administrator access and registered schools.</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
            <button className="btn btn-blue" onClick={() => goTab("permissions")}>Manage Permissions</button>
            <button className="btn btn-blue" onClick={() => goTab("registered-schools")}>Registered Schools</button>
            <button className="btn btn-blue" onClick={() => goTab("audit")}>View Audit Trail</button>
          </div>
        </div>
      ),
    };
    return (
      pages[tab] || (
        <div
          className="card card-padded"
          style={{ textAlign: "center", padding: 48 }}
        >
          <div style={{ fontWeight: 700 }}>Coming Soon</div>
        </div>
      )
    );
  };

  return (
    <div className="app admin-app">
      <Topbar
        user={user}
        onLogout={onLogout}
        onMenuClick={() => setSidebarOpen((o) => !o)}
        darkMode={darkMode}
        onToggleDark={onToggleDark}
        onOpenNotifications={openNotifications}
        onOpenProfile={() => goTab("settings")}
        onReloadApp={reloadApp}
        notificationCount={notificationCount + unreadAdminSupportNotifications}
        chatUnread={totalChatUnread}
        onOpenChat={() => goTab("chat")}
        systemName={appCfg.systemName}
      />
      <div className="shell">
        {sidebarOpen && (
          <div
            className="sidebar-overlay"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <nav className={`sidebar ${sidebarOpen ? "" : "closed"}`}>
          <button
            className="sidebar-brand brand-btn"
            onClick={reloadApp}
            title="Reload app"
          >
            <img
              src="https://image2url.com/r2/default/images/1773576400522-25d9d22b-3e79-4a9a-adc2-eae0031fbfe1.png"
              alt="Campus Ghana"
            />
            <span className="admin-sidebar-brand-copy">
              <strong>Campus Ghana</strong>
              <small>ADMIN PORTAL</small>
            </span>
          </button>
          {/* Pending Selections Sidebar Preview */}
          {pendingSelections.length > 0 && (
            <div className="sidebar-section" style={{ marginBottom: 12 }}>
              <div
                style={{ fontWeight: 700, color: "#1d4ed8", marginBottom: 4 }}
              >
                Pending Selections
              </div>
              <div
                style={{
                  fontSize: ".82rem",
                  color: "#64748b",
                  marginBottom: 6,
                }}
              >
                Awaiting review:
              </div>
              <div style={{ display: "grid", gap: 6, marginBottom: 6 }}>
                {pendingSelections.slice(0, 3).map((s) => {
                  const picks = normalizeSelectionList(s.rawRow || s);
                  return (
                    <div
                      key={s.id}
                      style={{
                        background: "#eef2ff",
                        borderRadius: 8,
                        padding: "6px 8px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 700,
                          color: "#0f172a",
                          fontSize: ".93em",
                        }}
                      >
                        {String(s.user_email).split("@")[0].replace(/\./g, " ")}
                      </span>
                      <span style={{ fontSize: ".75em", color: "#64748b" }}>
                        {s.user_email}
                      </span>
                      <span
                        style={{
                          fontSize: ".78em",
                          color: "#334155",
                          marginTop: 2,
                        }}
                      >
                        {picks.length > 0 ? (
                          picks.map((pick, idx) => (
                            <span
                              key={pick.id || idx}
                              style={{ marginRight: 4 }}
                            >
                              {pick.rank
                                ? `${pick.rank}${pick.rank === 1 ? "st" : pick.rank === 2 ? "nd" : pick.rank === 3 ? "rd" : "th"}: `
                                : ""}
                              {pick.name}
                            </span>
                          ))
                        ) : (
                          <span>No selections</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
              <button
                className="btn btn-sm btn-blue"
                style={{ width: "100%", marginTop: 2 }}
                onClick={() => goTab("pending")}
              >
                View All ({pendingSelections.length})
              </button>
            </div>
          )}
          {filteredAdminNav.map((item, i) => {
            if (item.section)
              return (
                <div
                  key={i}
                  className="sidebar-section"
                  style={
                    item.section === "Admissions & Mock Placement"
                      ? { textAlign: "center" }
                      : undefined
                  }
                >
                  {item.section}
                </div>
              );
            if (childToParent[item.key]) return null;

            const childrenKeys = (ADMIN_SUBPAGE_MAP[item.key] || []).filter(
              (key) => filteredAdminNav.some((navItem) => navItem.key === key),
            );
            const hasChildren = childrenKeys.length > 0;
            const activeParent = tab === item.key || childrenKeys.includes(tab);

            return (
              <div key={item.key}>
                <button
                  className={`nav-item ${activeParent ? "active" : ""}`}
                  onClick={() => {
                    goTab(item.key, !hasChildren);
                    if (hasChildren) {
                      setExpandedGroups((prev) => ({
                        ...prev,
                        [item.key]: !prev[item.key],
                      }));
                    }
                  }}
                >
                  <Ico
                    name={item.icon}
                    size={26}
                    color={item.color}
                    className="nav-item-icon"
                    style={{
                      strokeWidth: 2.6,
                      filter: "saturate(1.08) contrast(1.05)",
                    }}
                  />
                  <span
                    className="nav-item-label"
                    style={{ color: item.color, fontWeight: 700 }}
                  >
                    {item.label}
                  </span>
                  {item.badge && pendingSelections.length > 0 && (
                    <span className="nav-item-badge">
                      {pendingSelections.length}
                    </span>
                  )}
                  {hasChildren && (
                    <span
                      style={{
                        marginLeft: "auto",
                        fontWeight: 700,
                        color: "#64748b",
                      }}
                    >
                      {expandedGroups[item.key] ? " " : " "}
                    </span>
                  )}
                </button>

                {hasChildren &&
                  expandedGroups[item.key] &&
                  childrenKeys.map((childKey) => {
                    const child = filteredAdminNav.find((n) => n.key === childKey);
                    if (!child) return null;
                    return (
                      <button
                        key={child.key}
                        className={`nav-item ${tab === child.key ? "active" : ""}`}
                        onClick={() => goTab(child.key)}
                        style={{
                          paddingLeft: 36,
                          marginTop: 2,
                          marginBottom: 2,
                        }}
                      >
                        <Ico
                          name={child.icon}
                          size={20}
                          color={child.color}
                          className="nav-item-icon"
                        />
                        <span
                          className="nav-item-label"
                          style={{
                            color: child.color,
                            fontWeight: 600,
                            fontSize: ".84rem",
                          }}
                        >
                          {child.label}
                        </span>
                      </button>
                    );
                  })}
              </div>
            );
          })}
        </nav>
        <main
          ref={mainContentRef}
          className={`main ${sidebarOpen ? "" : "full"}`}
          onClick={handleMainBlankClick}
        >
          {appCfg.maintenanceMode && (
            <div
              className="alert alert-warning"
              style={{
                margin: "16px 16px 0",
                fontWeight: 700,
                borderRadius: 8,
              }}
            >
                Maintenance Mode is ON   the system is currently in
              maintenance. Student access may be restricted.
            </div>
          )}
          {renderPage()}
        </main>
        <div className="bottom-nav">
          <div
            className="bottom-nav-grid"
            style={{ gridTemplateColumns: `repeat(${BOTTOM.length},1fr)` }}
          >
            {BOTTOM.map((k) => {
              const item = ADMIN_NAV.find((n) => n.key === k);
              return (
                <button
                  key={k}
                  className={`bottom-nav-item ${tab === k ? "active" : ""}`}
                  onClick={() => goTab(k)}
                >
                  <Ico name={item.icon} size={30} color={item.color} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function SchoolAdminPortal({ user, onLogout, darkMode, onToggleDark }) {
  const { cfg: appCfg } = useContext(SettingsContext);
  const adminFeesPortalEnabled = appCfg.adminFeesPortalEnabled !== false;
  const childToParent = useMemo(() => {
    const map = {};
    Object.entries(SCHOOL_ADMIN_SUBPAGE_MAP).forEach(([parent, children]) => {
      children.forEach((key) => {
        map[key] = parent;
      });
    });
    return map;
  }, []);
  const [expandedGroups, setExpandedGroups] = useState(() =>
    Object.fromEntries(
      Object.keys(SCHOOL_ADMIN_SUBPAGE_MAP).map((key) => [key, false]),
    ),
  );
  const [tab, setTab] = useState(() =>
    readAvailableTab(SCHOOL_ADMIN_TAB_KEY, SCHOOL_ADMIN_NAV),
  );
  const mainContentRef = useRef(null);
  useEffect(() => {
    mainContentRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [tab]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);
  const [school, setSchool] = useState(null);
  const [schoolAdmins, setSchoolAdmins] = useState([]);
  const [schoolStudents, setSchoolStudents] = useState([]);
  const [schoolTeachers, setSchoolTeachers] = useState([]);
  const [schoolFeesData, setSchoolFeesData] = useState([]);
  const [schoolChoiceSchools, setSchoolChoiceSchools] = useState(SCHOOLS_DATA);
  const [schoolScoresInfo, setSchoolScoresInfo] = useState({
    rows: [],
    error: "",
  });
  const [schoolEventsInfo, setSchoolEventsInfo] = useState({
    rows: [],
    error: "",
  });
  const [schoolResultsInfo, setSchoolResultsInfo] = useState({
    rows: [],
    error: "",
  });
  const [schoolTableInfo, setSchoolTableInfo] = useState({
    attendance: { rows: [], error: "" },
    fees: { rows: [], error: "" },
    teachers: { rows: [], error: "" },
    events: { rows: [], error: "" },
    results: { rows: [], error: "" },
  });
  const [pendingSelections, setPendingSelections] = useState([]);
  const [confirmedSelections, setConfirmedSelections] = useState([]);
  const [loadingSchoolData, setLoadingSchoolData] = useState(!!supabase);
  const [schoolRegistryError, setSchoolRegistryError] = useState("");
  const [schoolScopeError, setSchoolScopeError] = useState("");
  const [reloadCounter, setReloadCounter] = useState(0);
  const [chatUsers, setChatUsers] = useState([
    {
      id: 1,
      name: "Admissions Desk",
      avatar: "A",
      unread: 0,
      status: "active",
    },
    { id: 2, name: "Registrar", avatar: "R", unread: 0, status: "online" },
    { id: 3, name: "Support Team", avatar: "S", unread: 0, status: "away" },
  ]);
  const totalChatUnread = chatUsers.reduce((sum, item) => sum + item.unread, 0);
  const blockedAdminFeeKeys = useMemo(
    () => (adminFeesPortalEnabled ? [] : ["fees", "payments", "installments"]),
    [adminFeesPortalEnabled],
  );
  const filteredSchoolAdminNav = useMemo(
    () => removeEmptyNavSections(
      SCHOOL_ADMIN_NAV.filter((item) =>
        item.section ? true : !blockedAdminFeeKeys.includes(item.key),
      ),
    ),
    [blockedAdminFeeKeys],
  );
  const BOTTOM = useMemo(
    () =>
      getPriorityBottomKeys(
        ["dashboard", "students", "analytics", "pending", "school-profile"],
        filteredSchoolAdminNav,
        new Set(blockedAdminFeeKeys),
      ),
    [filteredSchoolAdminNav, blockedAdminFeeKeys],
  );

  const goTab = (key, closeSidebar = true) => {
    setTab(key);
    writeStoredTab(SCHOOL_ADMIN_TAB_KEY, key);
    if (closeSidebar) setSidebarOpen(false);
  };

  const reloadApp = () => window.location.reload();
  const schoolFinanceSummary = {
    income: schoolFeesData.reduce((sum, fee) => sum + Number(fee.paid || 0), 0),
    expenses: Math.round(
      schoolFeesData.reduce((sum, fee) => sum + Number(fee.paid || 0), 0) *
        0.42,
    ),
    fees_collected: schoolFeesData.reduce(
      (sum, fee) => sum + Number(fee.paid || 0),
      0,
    ),
    outstanding: schoolFeesData.reduce(
      (sum, fee) =>
        sum + Math.max(Number(fee.amount || 0) - Number(fee.paid || 0), 0),
      0,
    ),
  };

  useEffect(() => {
    const parent = childToParent[tab];
    if (parent) {
      setExpandedGroups((prev) => ({ ...prev, [parent]: true }));
    }
  }, [tab, childToParent]);
  useEffect(() => {
    if (blockedAdminFeeKeys.includes(tab)) {
      setTab("dashboard");
      writeStoredTab(SCHOOL_ADMIN_TAB_KEY, "dashboard");
    }
  }, [blockedAdminFeeKeys, tab]);

  const saveManagedSchoolProfile = async () => {
    throw new Error(
      "School registry profile cannot be updated from the school admin portal. Contact a platform administrator.",
    );
  };

  const saveSchoolStudent = async (existingStudent, draft) => {
    const scopedSchoolId = school?.id || user?.registered_school_id || null;
    const payload = {
      full_name: draft.full_name.trim(),
      gender: draft.gender || null,
      index: draft.index.trim(),
      class: draft.class,
      region: draft.region,
      parent_contact: draft.parent_contact?.trim() || null,
      date_of_birth: draft.date_of_birth || null,
      aggregate: Number(draft.aggregate || 0),
      status: draft.status || "pending",
      photo_url: draft.photo_url?.trim() || null,
      ...(scopedSchoolId != null
        ? { registered_school_id: scopedSchoolId }
        : {}),
    };

    if (supabase && !existingStudent?.id && scopedSchoolId == null) {
      throw new Error(
        "This admin account is not linked to a registered school yet, so new students cannot be created.",
      );
    }

    let savedRow = normalizeStudentRecord({
      id: existingStudent?.id || Date.now(),
      ...payload,
    });

    if (supabase) {
      const updateStudentRow = async (nextPayload) => {
        if (!existingStudent) {
          return supabase
            .from("students")
            .insert(nextPayload)
            .select("*")
            .maybeSingle();
        }

        if (
          existingStudent.id != null &&
          !String(existingStudent.id).startsWith("local-")
        ) {
          const byId = await supabase
            .from("students")
            .update(nextPayload)
            .eq("id", existingStudent.id)
            .select("*")
            .maybeSingle();
          if (!byId.error && byId.data) return byId;
        }

        const studentIndex = String(existingStudent.index || "").trim();
        if (studentIndex) {
          const byIndex = await supabase
            .from("students")
            .update(nextPayload)
            .eq("index", studentIndex)
            .select("*")
            .maybeSingle();
          if (!byIndex.error && byIndex.data) return byIndex;
          const byIndexNumber = await supabase
            .from("students")
            .update(nextPayload)
            .eq("index_number", studentIndex)
            .select("*")
            .maybeSingle();
          if (!byIndexNumber.error && byIndexNumber.data) return byIndexNumber;
        }

        const lookupChecks = [];
        if (
          existingStudent.id != null &&
          !String(existingStudent.id).startsWith("local-")
        ) {
          lookupChecks.push(
            supabase
              .from("students")
              .select("id")
              .eq("id", existingStudent.id)
              .limit(1),
          );
        }
        const lookupStudentIndex = String(existingStudent.index || "").trim();
        if (lookupStudentIndex) {
          lookupChecks.push(
            supabase
              .from("students")
              .select("id")
              .eq("index", lookupStudentIndex)
              .limit(1),
          );
          lookupChecks.push(
            supabase
              .from("students")
              .select("id")
              .eq("index_number", lookupStudentIndex)
              .limit(1),
          );
        }
        const lookupResults = await Promise.all(lookupChecks);
        const visibleRowExists = lookupResults.some(
          (result) => Array.isArray(result.data) && result.data.length > 0,
        );

        if (visibleRowExists) {
          return {
            data: null,
            error: new Error(
              "Student exists but update is blocked by Supabase permissions (RLS). Add/adjust an UPDATE policy for public.students.",
            ),
          };
        }

        return {
          data: null,
          error: new Error(
            "Could not find this student in Supabase to update. The row key may have changed (id/index/index_number).",
          ),
        };
      };

      let response = await updateStudentRow(payload);

      if (
        response.error &&
        isMissingColumnError(response.error) &&
        scopedSchoolId != null
      ) {
        throw new Error(
          "School-scoped student updates require backend/supabase/migrations/004_add_registered_school_scope.sql. Run the migration, then refresh.",
        );
      }

      if (
        response.error &&
        isMissingColumnError(response.error) &&
        Object.prototype.hasOwnProperty.call(payload, "photo_url")
      ) {
        const { photo_url, ...fallbackPayload } = payload;
        response = await updateStudentRow(fallbackPayload);
      }

      if (response.error) throw response.error;
      savedRow = normalizeStudentRecord(
        response.data || { id: existingStudent?.id || Date.now(), ...payload },
      );
    }

    setSchoolStudents((current) =>
      sortStudentsByIndex(
        existingStudent
          ? current.map((student) =>
              String(student.id) === String(existingStudent.id)
                ? { ...student, ...savedRow }
                : student,
            )
          : [...current, savedRow],
      ),
    );

    return savedRow;
  };

  const saveSchoolTeacher = async (existingTeacher, draft) => {
    const scopedSchoolId = school?.id || user?.registered_school_id || null;
    const payload = {
      name: draft.name.trim(),
      employee_id: draft.employee_id.trim() || null,
      role: normalizeRoleKey(draft.role || "teacher") || "teacher",
      gender: draft.gender.trim() || null,
      subject: draft.subject.trim(),
      class: draft.class.trim(),
      phone: draft.phone.trim(),
      email: draft.email.trim() || null,
      qualification: draft.qualification.trim() || null,
      date_of_birth: draft.date_of_birth || null,
      hire_date: draft.hire_date || null,
      address: draft.address.trim() || null,
      ...(scopedSchoolId != null
        ? { registered_school_id: scopedSchoolId }
        : {}),
    };

    if (supabase && !existingTeacher?.id && scopedSchoolId == null) {
      throw new Error(
        "This admin account is not linked to a registered school yet, so new teachers cannot be created.",
      );
    }

    let savedRow = normalizeTeacherRow({
      id: existingTeacher?.id || Date.now(),
      ...payload,
    });

    if (supabase) {
      let response = existingTeacher?.id
        ? await supabase
            .from("teachers")
            .update(payload)
            .eq("id", existingTeacher.id)
            .select("*")
            .single()
        : await supabase.from("teachers").insert(payload).select("*").single();

      if (response.error && isMissingColumnError(response.error)) {
        const fallbackPayload = { ...payload };
        TEACHER_PROFILE_FIELD_KEYS.forEach((key) => {
          delete fallbackPayload[key];
        });
        response = existingTeacher?.id
          ? await supabase
              .from("teachers")
              .update(fallbackPayload)
              .eq("id", existingTeacher.id)
              .select("*")
              .single()
          : await supabase
              .from("teachers")
              .insert(fallbackPayload)
              .select("*")
              .single();
      }

      if (
        response.error &&
        isMissingColumnError(response.error) &&
        scopedSchoolId != null
      ) {
        throw new Error(
          "School-scoped teacher updates require backend/supabase/migrations/004_add_registered_school_scope.sql. Run the migration, then refresh.",
        );
      }

      if (
        response.error &&
        isMissingColumnError(response.error) &&
        Object.prototype.hasOwnProperty.call(payload, "role")
      ) {
        const { role, ...fallbackPayload } = payload;
        response = existingTeacher?.id
          ? await supabase
              .from("teachers")
              .update(fallbackPayload)
              .eq("id", existingTeacher.id)
              .select("*")
              .single()
          : await supabase
              .from("teachers")
              .insert(fallbackPayload)
              .select("*")
              .single();
      }

      if (response.error) throw response.error;
      savedRow = normalizeTeacherRow(
        response.data || { id: existingTeacher?.id || Date.now(), ...payload },
      );
    }

    setSchoolTeachers((current) => {
      const nextRows = existingTeacher
        ? current.map((teacher) =>
            String(teacher.id) === String(existingTeacher.id)
              ? { ...teacher, ...savedRow }
              : teacher,
          )
        : [savedRow, ...current];
      return nextRows
        .slice()
        .sort((a, b) =>
          String(a.name || "").localeCompare(String(b.name || "")),
        );
    });

    return savedRow;
  };

  useEffect(() => {
    const loadSchoolAdminData = async () => {
      const scopedSchoolName = user?.managed_school_name || "";
      const scopedSchoolId = user?.registered_school_id;
      const scopeColumnMessage =
        "School-scoped data columns are not installed in Supabase yet. Run backend/supabase/migrations/004_add_registered_school_scope.sql, then refresh.";
      setSchoolScopeError("");

      if (!supabase) {
        setSchool(
          scopedSchoolName
            ? normalizeSchoolRow({
                name: scopedSchoolName,
                region: "Unknown",
                category: "C",
              })
            : null,
        );
        setLoadingSchoolData(false);
        return;
      }

      let schoolRow = null;
      if (scopedSchoolId != null) {
        const { data, error } = await supabase
          .from("registered_schools")
          .select("*")
          .eq("id", scopedSchoolId)
          .maybeSingle();
        if (isMissingTableError(error, "registered_schools")) {
          setSchoolRegistryError(
            "Registered school tables are not installed in Supabase yet. Run backend/supabase/migrations/003_registered_schools_and_school_admins.sql, then refresh.",
          );
        }
        schoolRow = data || null;
      }

      if (!schoolRow && scopedSchoolName) {
        const { data, error } = await supabase
          .from("registered_schools")
          .select("*")
          .eq("name", scopedSchoolName)
          .maybeSingle();
        if (isMissingTableError(error, "registered_schools")) {
          setSchoolRegistryError(
            "Registered school tables are not installed in Supabase yet. Run backend/supabase/migrations/003_registered_schools_and_school_admins.sql, then refresh.",
          );
        }
        schoolRow = data || null;
      }

      const normalizedSchool = schoolRow
        ? {
            ...normalizeSchoolRow(schoolRow),
            tenant_key: schoolRow.tenant_key || "",
          }
        : scopedSchoolName
          ? normalizeSchoolRow({
              name: scopedSchoolName,
              region: "Unknown",
              category: "C",
            })
          : null;
      setSchool(normalizedSchool);

      if (!schoolRow?.id) {
        setSchoolScopeError(
          "This school admin account is not linked to a registered school record yet, so teacher rows cannot be loaded. Link the account to a row in registered_schools, then refresh.",
        );
      }

      if (schoolRow?.id != null) {
        const { data: admins, error: adminsError } = await supabase
          .from("school_admins")
          .select("*")
          .eq("registered_school_id", schoolRow.id)
          .order("created_at", { ascending: false });
        if (isMissingTableError(adminsError, "school_admins")) {
          setSchoolRegistryError(
            "Registered school tables are not installed in Supabase yet. Run backend/supabase/migrations/003_registered_schools_and_school_admins.sql, then refresh.",
          );
        }
        if (Array.isArray(admins)) setSchoolAdmins(admins);
      } else {
        setSchoolAdmins([
          {
            id: user?.id || "self",
            full_name: user?.name || "School Admin",
            email: user?.email || "",
            phone: "",
            status: "active",
          },
        ]);
      }

      let normalizedScopedStudents = [];
      if (schoolRow?.id != null) {
        const { data: scopedStudentsData, error: studentsError } =
          await supabase
            .from("students")
            .select("*")
            .eq("registered_school_id", schoolRow.id)
            .order("id", { ascending: true });
        if (isMissingColumnError(studentsError)) {
          setSchoolScopeError(scopeColumnMessage);
          setSchoolTableInfo((current) => ({
            ...current,
            attendance: { ...current.attendance, error: scopeColumnMessage },
            fees: { ...current.fees, error: scopeColumnMessage },
            teachers: { ...current.teachers, error: scopeColumnMessage },
            results: { ...current.results, error: scopeColumnMessage },
          }));
        } else if (Array.isArray(scopedStudentsData)) {
          normalizedScopedStudents = scopedStudentsData.map((s, i) =>
            normalizeStudentRecord(s, i),
          );
        }
      }
      setSchoolStudents(sortStudentsByIndex(normalizedScopedStudents));

      if (schoolRow?.id != null) {
        const [
          teachersResponse,
          feesResponse,
          resultsResponse,
          scoresResponse,
          eventsResponse,
          schoolsResponse,
        ] = await Promise.all([
          supabase
            .from("teachers")
            .select("*")
            .eq("registered_school_id", schoolRow.id)
            .order("name", { ascending: true }),
          supabase
            .from("fees")
            .select("*")
            .eq("registered_school_id", schoolRow.id)
            .order("id", { ascending: false }),
          supabase
            .from("results")
            .select("*")
            .eq("registered_school_id", schoolRow.id)
            .order("created_at", { ascending: false }),
          supabase
            .from("scores")
            .select("*")
            .eq("registered_school_id", schoolRow.id)
            .order("created_at", { ascending: false }),
          supabase
            .from("events")
            .select("*")
            .eq("registered_school_id", schoolRow.id)
            .order("event_date", { ascending: true }),
          supabase
            .from("schools")
            .select("*")
            .order("name", { ascending: true }),
        ]);

        if (
          isMissingColumnError(teachersResponse.error) ||
          isMissingColumnError(feesResponse.error) ||
          isMissingColumnError(resultsResponse.error) ||
          isMissingColumnError(scoresResponse.error) ||
          isMissingColumnError(eventsResponse.error)
        ) {
          setSchoolScopeError(scopeColumnMessage);
        }

        setSchoolTeachers(
          Array.isArray(teachersResponse.data)
            ? teachersResponse.data.map(normalizeTeacherRow)
            : [],
        );
        setSchoolFeesData(
          Array.isArray(feesResponse.data)
            ? feesResponse.data.map(normalizeFeeRow)
            : [],
        );
        setSchoolScoresInfo({
          rows: Array.isArray(scoresResponse.data) ? scoresResponse.data : [],
          error: scoresResponse.error?.message || "",
        });
        setSchoolEventsInfo({
          rows: Array.isArray(eventsResponse.data) ? eventsResponse.data : [],
          error: eventsResponse.error?.message || "",
        });
        setSchoolResultsInfo({
          rows: Array.isArray(resultsResponse.data) ? resultsResponse.data : [],
          error: resultsResponse.error?.message || "",
        });
        setSchoolChoiceSchools(
          Array.isArray(schoolsResponse.data) && schoolsResponse.data.length
            ? sortSchoolsByCategory(
                schoolsResponse.data.map(normalizeSchoolRow),
              )
            : SCHOOLS_DATA,
        );

        if (
          !teachersResponse.error &&
          Array.isArray(teachersResponse.data) &&
          !teachersResponse.data.length
        ) {
          const { data: legacyTeacherRows, error: legacyTeacherError } =
            await supabase
              .from("teachers")
              .select("id")
              .is("registered_school_id", null)
              .limit(1);

          if (
            !legacyTeacherError &&
            Array.isArray(legacyTeacherRows) &&
            legacyTeacherRows.length
          ) {
            setSchoolScopeError(
              "Teacher records exist in Supabase, but they are not linked to this school with registered_school_id, so they will not appear here. Re-save the teachers from this school workspace or backfill registered_school_id in Supabase.",
            );
          }
        }

        setSchoolTableInfo({
          attendance: {
            rows: [],
            error:
              isMissingColumnError(teachersResponse.error) ||
              isMissingColumnError(feesResponse.error) ||
              isMissingColumnError(resultsResponse.error) ||
              isMissingColumnError(scoresResponse.error) ||
              isMissingColumnError(eventsResponse.error)
                ? scopeColumnMessage
                : "",
          },
          fees: {
            rows: Array.isArray(feesResponse.data) ? feesResponse.data : [],
            error: feesResponse.error?.message || "",
          },
          teachers: {
            rows: Array.isArray(teachersResponse.data)
              ? teachersResponse.data
              : [],
            error: teachersResponse.error?.message || "",
          },
          events: {
            rows: Array.isArray(eventsResponse.data) ? eventsResponse.data : [],
            error: eventsResponse.error?.message || "",
          },
          results: {
            rows: Array.isArray(resultsResponse.data)
              ? resultsResponse.data
              : [],
            error: resultsResponse.error?.message || "",
          },
        });
      }

      const { data: students } = await supabase
        .from("students")
        .select("*")
        .order("id", { ascending: true });
      const normalizedStudents =
        Array.isArray(students) && students.length
          ? students.map((s, i) => normalizeStudentRecord(s, i))
          : [];
      const studentsMap = new Map();
      normalizedStudents.forEach((student) => {
        studentsMap.set(String(student.id), student);
        studentsMap.set(String(student.index), student);
      });

      const loadSelectionRows = async () => {
        const attempts = [
          () =>
            supabase
              .from("school_selections")
              .select("*")
              .order("created_at", { ascending: false }),
          () =>
            supabase
              .from("school_selections")
              .select("*")
              .order("updated_at", { ascending: false }),
          () =>
            supabase
              .from("school_selections")
              .select("*")
              .order("id", { ascending: false }),
          () => supabase.from("school_selections").select("*"),
        ];
        for (const run of attempts) {
          const { data, error } = await run();
          if (!error && Array.isArray(data)) return data;
        }
        return [];
      };
      const selectionRows = await loadSelectionRows();
      const matchingRows = (selectionRows || []).filter((row) =>
        normalizeSelectionList(row).some(
          (pick) =>
            normalizeSchoolIdentity(pick.name) ===
            normalizeSchoolIdentity(normalizedSchool?.name || scopedSchoolName),
        ),
      );
      const summarized = matchingRows.map((row) =>
        summarizeSelectionRecord(row, studentsMap),
      );
      setPendingSelections(
        sortRecordsByStudentIndex(
          summarized.filter(
            (row) => !row.approved && row.status !== "confirmed",
          ),
        ),
      );
      setConfirmedSelections(
        sortRecordsByStudentIndex(
          summarized.filter(
            (row) => row.approved || row.status === "confirmed",
          ),
        ),
      );
      setLoadingSchoolData(false);
    };

    loadSchoolAdminData();
  }, [user, reloadCounter]);

  const handleMainBlankClick = (event) => {
    if (!sidebarOpen) return;
    if (event.target === event.currentTarget) setSidebarOpen(false);
  };

  const renderPage = () => {
    const pages = {
      dashboard: (
        <SchoolAdminDashboardPage
          user={user}
          school={school}
          admins={schoolAdmins}
          pendingRows={pendingSelections}
          confirmedRows={confirmedSelections}
          studentsData={schoolStudents}
          teachersData={schoolTeachers}
          feesData={schoolFeesData}
          loading={loadingSchoolData}
        />
      ),
      students: (
        <Suspense fallback={<div className="portal-loading" role="status">Loading students...</div>}>
          <StudentsPage
            onEnroll={() => goTab("enroll")}
            onEditStudent={saveSchoolStudent}
            studentsData={schoolStudents}
            showEnrollAction={true}
            heroKicker="School Registry"
            heroTitle="Students linked to this school"
            heroSub="Review only the student records currently assigned to this school workspace."
            heroNote="Search, review, and manage the student list that belongs to this school."
            directoryTitle="School student registry"
            directorySub="Search by student name or ID within this school only."
            emptyRemoteMessage="No students are currently linked to this school."
          />
        </Suspense>
      ),
      enroll: (
        <EnrollPage
          onEnrolled={() => setReloadCounter((c) => c + 1)}
          onBack={() => {
            goTab("students");
            setReloadCounter((c) => c + 1);
          }}
          registeredSchoolId={school?.id || user?.registered_school_id || null}
        />
      ),
      scores: (
        <ScoresPage
          studentsData={schoolStudents}
          tableInfo={schoolScoresInfo}
        />
      ),
      analytics: (
        <AnalyticsPage
          studentsData={schoolStudents}
          schoolsData={schoolChoiceSchools}
          selectionsData={[...pendingSelections, ...confirmedSelections]}
          scoreTableInfo={schoolScoresInfo}
        />
      ),
      fees: (
        <FeesAdmin
          studentsData={schoolStudents}
          feesData={schoolFeesData}
          tableInfo={schoolTableInfo.fees}
          registeredSchoolId={school?.id ?? null}
        />
      ),
      schools: <SchoolsPage schoolsData={schoolChoiceSchools} />,
      results: (
        <ResultsPage
          studentsData={schoolStudents}
          tableInfo={schoolResultsInfo}
        />
      ),
      courses: (
        <Suspense fallback={<div className="portal-loading" role="status">Loading courses...</div>}>
          <CoursesPage mode="admin" />
        </Suspense>
      ),
      "study-teams": (
        <Suspense fallback={<div className="portal-loading" role="status">Loading study teams...</div>}>
          <StudyTeamsPage user={user} />
        </Suspense>
      ),
      grading: <GradingPage />,
      finance: (
        <FinancePage
          financeSummary={schoolFinanceSummary}
          tableInfo={schoolTableInfo.fees}
        />
      ),
      "school-profile": (
        <ManagedSchoolPage
          school={school}
          admins={schoolAdmins}
          user={user}
          onSaveProfile={saveManagedSchoolProfile}
          allowProfileEdit={false}
        />
      ),
      pending: (
        <PendingSelections
          rows={pendingSelections}
          loading={loadingSchoolData}
          readOnly
          pageTitle="Candidate Reviews"
          pageSub="Selections that currently mention this school."
          emptyMessage="No candidate reviews are currently in scope for this school."
        />
      ),
      confirmed: (
        <ConfirmedPlacements
          rows={confirmedSelections}
          loading={loadingSchoolData}
        />
      ),
      chat: <ChatPage chatUsers={chatUsers} onChatUsersChange={setChatUsers} />,
      payments: <PaymentsReceiptsPage />,
      documents: <DocumentWorkflowPage />,
      reports: <ReportsExportsPage />,
    };
    return pages[tab] || pages.dashboard;
  };

  return (
    <div className="app">
      <Topbar
        user={user}
        onLogout={onLogout}
        onMenuClick={() => setSidebarOpen((o) => !o)}
        darkMode={darkMode}
        onToggleDark={onToggleDark}
        onOpenNotifications={() => setNotificationCount(0)}
        onOpenProfile={() => goTab("school-profile")}
        onReloadApp={reloadApp}
        notificationCount={notificationCount}
        chatUnread={totalChatUnread}
        onOpenChat={() => goTab("chat")}
        systemName={school?.name || appCfg.systemName}
      />
      <div className="shell">
        {sidebarOpen && (
          <div
            className="sidebar-overlay"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <nav className={`sidebar ${sidebarOpen ? "" : "closed"}`}>
          <button
            className="sidebar-brand brand-btn"
            onClick={reloadApp}
            title="Reload app"
          >
            <img
              src="https://image2url.com/r2/default/images/1773576400522-25d9d22b-3e79-4a9a-adc2-eae0031fbfe1.png"
              alt="Campus Ghana"
            />
          </button>
          {filteredSchoolAdminNav.map((item, i) => {
            if (item.section)
              return (
                <div
                  key={i}
                  className="sidebar-section"
                  style={
                    item.section === "Admissions & Mock Placement"
                      ? { textAlign: "center" }
                      : undefined
                  }
                >
                  {item.section}
                </div>
              );
            if (childToParent[item.key]) return null;

            const childrenKeys = (SCHOOL_ADMIN_SUBPAGE_MAP[item.key] || []).filter(
              (key) => filteredSchoolAdminNav.some((navItem) => navItem.key === key),
            );
            const hasChildren = childrenKeys.length > 0;
            const activeParent = tab === item.key || childrenKeys.includes(tab);

            return (
              <div key={item.key}>
                <button
                  className={`nav-item ${activeParent ? "active" : ""}`}
                  onClick={() => {
                    goTab(item.key, !hasChildren);
                    if (hasChildren) {
                      setExpandedGroups((prev) => ({
                        ...prev,
                        [item.key]: !prev[item.key],
                      }));
                    }
                  }}
                >
                  <Ico
                    name={item.icon}
                    size={26}
                    color={item.color}
                    className="nav-item-icon"
                    style={{
                      strokeWidth: 2.6,
                      filter: "saturate(1.08) contrast(1.05)",
                    }}
                  />
                  <span
                    className="nav-item-label"
                    style={{ color: item.color, fontWeight: 700 }}
                  >
                    {item.label}
                  </span>
                  {item.key === "pending" && pendingSelections.length > 0 && (
                    <span className="nav-item-badge">
                      {pendingSelections.length}
                    </span>
                  )}
                  {hasChildren && (
                    <span
                      style={{
                        marginLeft: "auto",
                        fontWeight: 700,
                        color: "#64748b",
                      }}
                    >
                      {expandedGroups[item.key] ? " " : " "}
                    </span>
                  )}
                </button>

                {hasChildren &&
                  expandedGroups[item.key] &&
                  childrenKeys.map((childKey) => {
                    const child = filteredSchoolAdminNav.find(
                      (entry) => entry.key === childKey,
                    );
                    if (!child) return null;
                    return (
                      <button
                        key={child.key}
                        className={`nav-item ${tab === child.key ? "active" : ""}`}
                        onClick={() => goTab(child.key)}
                        style={{
                          paddingLeft: 36,
                          marginTop: 2,
                          marginBottom: 2,
                        }}
                      >
                        <Ico
                          name={child.icon}
                          size={20}
                          color={child.color}
                          className="nav-item-icon"
                        />
                        <span
                          className="nav-item-label"
                          style={{
                            color: child.color,
                            fontWeight: 600,
                            fontSize: ".84rem",
                          }}
                        >
                          {child.label}
                        </span>
                      </button>
                    );
                  })}
              </div>
            );
          })}
        </nav>
        <main
          ref={mainContentRef}
          className={`main ${sidebarOpen ? "" : "full"}`}
          onClick={handleMainBlankClick}
        >
          {appCfg.maintenanceMode && (
            <div
              className="alert alert-warning"
              style={{
                margin: "16px 16px 0",
                fontWeight: 700,
                borderRadius: 8,
              }}
            >
                Maintenance Mode is ON   some workflows may be unavailable.
            </div>
          )}
          {schoolRegistryError && (
            <div
              className="alert alert-warning"
              style={{ margin: "16px 16px 0", borderRadius: 8 }}
            >
              {schoolRegistryError}
            </div>
          )}
          {schoolScopeError && (
            <div
              className="alert alert-warning"
              style={{ margin: "16px 16px 0", borderRadius: 8 }}
            >
              {schoolScopeError}
            </div>
          )}
          {renderPage()}
        </main>
        <div className="bottom-nav">
          <div
            className="bottom-nav-grid"
            style={{ gridTemplateColumns: `repeat(${BOTTOM.length},1fr)` }}
          >
            {BOTTOM.map((key) => {
              const item = SCHOOL_ADMIN_NAV.find((entry) => entry.key === key);
              return (
                <button
                  key={key}
                  className={`bottom-nav-item ${tab === key ? "active" : ""}`}
                  onClick={() => goTab(key)}
                >
                  <Ico name={item.icon} size={30} color={item.color} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// STUDENT LIVE TESTS PAGE
function StudentLiveTestsPage({ user, studentData }) {
  const [availableTests, setAvailableTests] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [takingTest, setTakingTest] = useState(false);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [testData, setTestData] = useState(null);

  useEffect(() => {
    if (studentData?.id) {
      loadAvailableTests();
    }
  }, [studentData]);

  useEffect(() => {
    let timer;
    if (takingTest && timeRemaining > 0) {
      timer = setInterval(() => {
        setTimeRemaining(prev => {
          if (prev <= 1) {
            handleSubmitTest();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [takingTest, timeRemaining]);

  const loadAvailableTests = async () => {
    if (!supabase || !studentData?.id) {
      setAvailableTests([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      // Get active tests
      const { data: tests, error: testsError } = await supabase
        .from('live_tests')
        .select('*')
        .eq('is_active', true);

      if (testsError) throw testsError;

      // Get student's existing sessions
      const { data: sessions, error: sessionsError } = await supabase
        .from('student_test_sessions')
        .select('test_id, is_completed, score, max_score')
        .eq('student_id', studentData?.id);

      if (sessionsError) throw sessionsError;

      const sessionMap = new Map();
      sessions?.forEach(session => {
        sessionMap.set(session.test_id, session);
      });

      // Combine test data with session status
      const testsWithStatus = tests?.map(test => ({
        ...test,
        session: sessionMap.get(test.id) || null
      })) || [];

      setAvailableTests(testsWithStatus);
    } catch (error) {
      console.error('Error loading tests:', error);
      setAvailableTests([]);
    } finally {
      setLoading(false);
    }
  };

  const startTest = async (test) => {
    if (!supabase || !studentData?.id) return;

    try {
      // Create test session
      const { data: session, error: sessionError } = await supabase
        .from('student_test_sessions')
        .insert([{
          test_id: test.id,
          student_id: studentData.id,
          time_remaining_seconds: test.duration_minutes * 60
        }])
        .select()
        .single();

      if (sessionError) throw sessionError;

      // Load test questions and answers
      const { data: questions, error: questionsError } = await supabase
        .from('test_questions')
        .select(`
          *,
          test_answers (*)
        `)
        .eq('test_id', test.id)
        .order('order_index');

      if (questionsError) throw questionsError;

      setTestData({
        ...test,
        questions: questions || []
      });
      setActiveSession(session);
      setTimeRemaining(test.duration_minutes * 60);
      setTakingTest(true);
      setCurrentQuestionIndex(0);
      setAnswers({});
    } catch (error) {
      console.error('Error starting test:', error);
      alert('Failed to start test. Please try again.');
    }
  };

  const handleAnswerChange = (questionId, answer) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: answer
    }));
  };

  const handleNextQuestion = () => {
    if (currentQuestionIndex < testData.questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
    }
  };

  const handlePrevQuestion = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
    }
  };

  const handleSubmitTest = async () => {
    if (!supabase || !activeSession || !testData) return;

    try {
      // Calculate score
      let totalScore = 0;
      let maxScore = 0;

      const answerInserts = testData.questions.map(question => {
        maxScore += question.points;
        const studentAnswer = answers[question.id];
        let isCorrect = false;
        let pointsEarned = 0;

        if (question.question_type === 'multiple_choice') {
          // Find the correct answer
          const correctAnswer = question.test_answers?.find(ans => ans.is_correct);
          isCorrect = studentAnswer === correctAnswer?.id;
        } else if (question.question_type === 'true_false') {
          isCorrect = studentAnswer === question.correct_answer;
        } else if (question.question_type === 'short_answer') {
          isCorrect = studentAnswer?.toLowerCase().trim() === question.correct_answer?.toLowerCase().trim();
        } else if (question.question_type === 'fill_in') {
          // Allow multiple acceptable answers separated by |
          const acceptableAnswers = question.correct_answer?.split('|').map(ans => ans.toLowerCase().trim()) || [];
          isCorrect = acceptableAnswers.includes(studentAnswer?.toLowerCase().trim());
        } else if (question.question_type === 'long_text') {
          // Long text questions are typically manually graded
          isCorrect = false; // Will be graded manually later
        }

        if (isCorrect) {
          pointsEarned = question.points;
          totalScore += pointsEarned;
        }

        return {
          session_id: activeSession.id,
          question_id: question.id,
          answer_text: studentAnswer || '',
          is_correct: isCorrect,
          points_earned: pointsEarned
        };
      });

      // Insert answers
      const { error: answersError } = await supabase
        .from('student_answers')
        .insert(answerInserts);

      if (answersError) throw answersError;

      // Update session
      const { error: sessionError } = await supabase
        .from('student_test_sessions')
        .update({
          submitted_at: new Date().toISOString(),
          time_remaining_seconds: timeRemaining,
          score: totalScore,
          max_score: maxScore,
          is_completed: true
        })
        .eq('id', activeSession.id);

      if (sessionError) throw sessionError;

      setTakingTest(false);
      setActiveSession(null);
      setTestData(null);
      loadAvailableTests();
      alert(`Test submitted! Your score: ${totalScore}/${maxScore}`);
    } catch (error) {
      console.error('Error submitting test:', error);
      alert('Failed to submit test. Please try again.');
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="fade-in">
        <div className="page-header">
          <div className="page-title">Live Tests</div>
        </div>
        <div className="loading-spinner">Loading tests...</div>
      </div>
    );
  }

  if (takingTest && testData) {
    const currentQuestion = testData.questions[currentQuestionIndex];
    const progress = ((currentQuestionIndex + 1) / testData.questions.length) * 100;

    return (
      <div className="fade-in test-taking">
        <div className="test-header">
          <div className="test-title">{testData.title}</div>
          <div className="test-timer" style={{ color: timeRemaining < 300 ? '#ef4444' : '#374151' }}>
            <Ico name="clock" size={16} color="currentColor" />
            {formatTime(timeRemaining)}
          </div>
        </div>

        <div className="test-progress">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }}></div>
          </div>
          <div className="progress-text">
            Question {currentQuestionIndex + 1} of {testData.questions.length}
          </div>
        </div>

        <div className="question-card">
          <div className="question-header">
            <span className="question-points">{currentQuestion.points} points</span>
          </div>

          <div className="question-text">
            {currentQuestion.question_text}
          </div>

          <div className="question-answers">
            {currentQuestion.question_type === 'multiple_choice' && currentQuestion.test_answers?.map((answer, index) => (
              <label key={answer.id} className="answer-option">
                <input
                  type="radio"
                  name={`question-${currentQuestion.id}`}
                  value={answer.id}
                  checked={answers[currentQuestion.id] === answer.id}
                  onChange={() => handleAnswerChange(currentQuestion.id, answer.id)}
                />
                <span className="answer-label">
                  <span className="answer-letter">{String.fromCharCode(65 + index)}</span>
                  <span className="answer-text">{answer.answer_text}</span>
                </span>
              </label>
            ))}

            {currentQuestion.question_type === 'true_false' && (
              <div className="true-false-options">
                <label className="answer-option">
                  <input
                    type="radio"
                    name={`question-${currentQuestion.id}`}
                    value="true"
                    checked={answers[currentQuestion.id] === 'true'}
                    onChange={() => handleAnswerChange(currentQuestion.id, 'true')}
                  />
                  <span className="answer-label">True</span>
                </label>
                <label className="answer-option">
                  <input
                    type="radio"
                    name={`question-${currentQuestion.id}`}
                    value="false"
                    checked={answers[currentQuestion.id] === 'false'}
                    onChange={() => handleAnswerChange(currentQuestion.id, 'false')}
                  />
                  <span className="answer-label">False</span>
                </label>
              </div>
            )}

            {(currentQuestion.question_type === 'short_answer' || currentQuestion.question_type === 'fill_in') && (
              <div className="short-answer-input">
                <input
                  type="text"
                  className="form-input"
                  placeholder={currentQuestion.question_type === 'fill_in' ? "Fill in the blank" : "Enter your answer"}
                  value={answers[currentQuestion.id] || ''}
                  onChange={(e) => handleAnswerChange(currentQuestion.id, e.target.value)}
                />
              </div>
            )}

            {currentQuestion.question_type === 'long_text' && (
              <div className="long-text-input">
                <textarea
                  className="form-input"
                  placeholder="Write your essay answer here..."
                  value={answers[currentQuestion.id] || ''}
                  onChange={(e) => handleAnswerChange(currentQuestion.id, e.target.value)}
                  rows={8}
                  style={{ resize: 'vertical', minHeight: '120px' }}
                />
              </div>
            )}
          </div>
        </div>

        <div className="test-navigation">
          <button
            className="btn-secondary"
            onClick={handlePrevQuestion}
            disabled={currentQuestionIndex === 0}
          >
            <Ico name="back" size={16} color="#374151" />
            Previous
          </button>

          {currentQuestionIndex < testData.questions.length - 1 ? (
            <button
              className="btn-primary"
              onClick={handleNextQuestion}
            >
              Next
              <Ico name="next" size={16} color="#fff" />
            </button>
          ) : (
            <button
              className="btn-success"
              onClick={() => {
                if (confirm('Are you sure you want to submit this test?')) {
                  handleSubmitTest();
                }
              }}
            >
              <Ico name="check" size={16} color="#fff" />
              Submit Test
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">Live Tests</div>
      </div>

      {!supabase && (
        <div className="alert alert-warning">
          Supabase is not configured. Live tests require database connectivity.
        </div>
      )}

      <div className="tests-grid">
        {availableTests.length === 0 ? (
          <div className="empty-state">
            <Ico name="quiz" size={48} color="#9ca3af" />
            <div className="empty-title">No live tests available</div>
            <div className="empty-subtitle">Check back later for new tests</div>
          </div>
        ) : (
          availableTests.map(test => {
            const hasCompleted = test.session?.is_completed;
            const score = test.session ? `${test.session.score}/${test.session.max_score}` : null;

            return (
              <div key={test.id} className="test-card">
                <div className="test-header">
                  <div className="test-title">
                    {test.title}
                    {test.origin_content_id && (
                      <span className="origin-badge" title="Created from study content">
                        <Ico name="link" size={12} color="#6366f1" />
                      </span>
                    )}
                  </div>
                  <div className="test-status" style={{ color: hasCompleted ? '#16a34a' : '#f59e0b' }}>
                    {hasCompleted ? 'Completed' : 'Available'}
                  </div>
                </div>

                <div className="test-meta">
                  {test.subject && <span className="test-subject">{test.subject}</span>}
                  {test.class && <span className="test-class">{test.class}</span>}
                  <span className="test-type">{test.test_type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
                  <span className="test-duration">{test.duration_minutes} min</span>
                  <span className="test-questions">{test.total_questions} questions</span>
                </div>

                {test.description && (
                  <div className="test-description">{test.description}</div>
                )}

                {hasCompleted && score && (
                  <div className="test-score">
                    <Ico name="grade" size={16} color="#16a34a" />
                    Your Score: {score}
                  </div>
                )}

                <div className="test-actions">
                  {!hasCompleted ? (
                    <button
                      className="btn-primary"
                      onClick={() => startTest(test)}
                      style={{ backgroundColor: '#f59e0b' }}
                    >
                      <Ico name="play" size={16} color="#fff" />
                      Start Test
                    </button>
                  ) : (
                    <button
                      className="btn-secondary"
                      onClick={() => alert(`Your score: ${score}`)}
                    >
                      <Ico name="eye" size={16} color="#374151" />
                      View Results
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// STUDENT PORTAL
function StudentPortal({ user, onLogout, darkMode, onToggleDark }) {
  const { cfg: appCfg } = useContext(SettingsContext);
  const studentNavVisibility = useMemo(
    () => getStudentNavVisibility(appCfg),
    [appCfg],
  );
  const childToParent = useMemo(() => {
    const map = {};
    Object.entries(STUDENT_SUBPAGE_MAP).forEach(([parent, children]) => {
      children.forEach((key) => {
        map[key] = parent;
      });
    });
    return map;
  }, []);
  const [expandedGroups, setExpandedGroups] = useState(() =>
    Object.fromEntries(Object.keys(STUDENT_SUBPAGE_MAP).map((k) => [k, false])),
  );
  const [tab, setTab] = useState(() =>
    readAvailableTab(STUDENT_TAB_KEY, STUDENT_NAV),
  );
  const mainContentRef = useRef(null);
  useEffect(() => {
    mainContentRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [tab]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);
  const [studentNotifications, setStudentNotifications] = useState([]);
  const [studentNotificationsError, setStudentNotificationsError] = useState("");
  const [schoolsData, setSchoolsData] = useState(SCHOOLS_DATA);
  const [studentData, setStudentData] = useState(null);
  const [attendanceData, setAttendanceData] = useState([]);
  const [feesData, setFeesData] = useState([]);
  const [courseProgressSummary, setCourseProgressSummary] = useState({
    enrolledCount: 0,
    completedCount: 0,
    averageCompletion: 0,
    progressItems: [],
  });
  const [studentDataError, setStudentDataError] = useState("");

  const demoStudentRecord = useMemo(
    () => ({
      id: "demo-student",
      full_name: "Kwame Boateng",
      display_name: "Kwame Boateng",
      index_number: "CG-GH-2024053101",
      index: "CG-GH-2024053101",
      class: "Grade 12 Science",
      region: "Greater Accra",
      status: "confirmed",
      photo_url: "",
      gender: "Male",
      date_of_birth: "2008-04-15",
      parent_contact: "+233 20 123 4567",
      personal_contact: "+233 24 987 6543",
      home_address: "Accra, Ghana",
      home_town: "Tema",
      place_of_residence: "Nungua",
      postal_town: "Accra",
      po_box: "P.O. Box 2131",
    }),
    [],
  );
  const [selectionRow, setSelectionRow] = useState(null);
  const [scoreValues, setScoreValues] = useState([]);
  const [scoreRecords, setScoreRecords] = useState([]);

  const buildCourseProgressSummary = (enrollmentRows = [], courseRows = [], completedByEnrollment = {}) => {
    const courseMap = new Map((courseRows || []).filter(Boolean).map((course) => [course.id, course]));
    const progressItems = (enrollmentRows || []).map((enrollment) => {
      const course = courseMap.get(enrollment.course_id) || { title: "Course", lessons: [] };
      const lessonEntries = Array.isArray(course.lessons) ? course.lessons : [];
      const lessonIds = lessonEntries
        .map((lesson) => (lesson && typeof lesson === "object" ? lesson.id : lesson))
        .filter((lessonId) => lessonId !== undefined && lessonId !== null && lessonId !== "");
      const completedLessonIds = new Set(
        ((Array.isArray(completedByEnrollment[enrollment.id]) ? completedByEnrollment[enrollment.id] : []) || [])
          .map((lessonId) => String(lessonId)),
      );
      const totalLessons = lessonIds.length || 0;
      const completedCount = lessonIds.length
        ? lessonIds.filter((lessonId) => completedLessonIds.has(String(lessonId))).length
        : ((Array.isArray(completedByEnrollment[enrollment.id]) ? completedByEnrollment[enrollment.id] : []) || []).length;
      const percent = totalLessons
        ? Math.round((completedCount / totalLessons) * 100)
        : 0;

      return {
        title: course.title || "Course",
        percent: Math.min(100, Math.max(0, percent)),
      };
    });

    const averageCompletion = progressItems.length
      ? Math.round(progressItems.reduce((sum, item) => sum + item.percent, 0) / progressItems.length)
      : 0;
    const completedCount = progressItems.filter((item) => item.percent >= 100).length;

    return {
      enrolledCount: progressItems.length,
      completedCount,
      averageCompletion,
      progressItems: progressItems.slice(0, 3),
    };
  };
  const [chatUsers, setChatUsers] = useState([
    { id: 1, name: "Support Team", avatar: "S", unread: 0, status: "active" },
    { id: 2, name: "Ms. Ama Owusu", avatar: "A", unread: 0, status: "online" },
    { id: 3, name: "Mr. Kwesi Adjei", avatar: "K", unread: 0, status: "away" },
    {
      id: 4,
      name: "Admissions Office",
      avatar: "O",
      unread: 0,
      status: "active",
    },
    { id: 5, name: "Dr. Yaw Mensah", avatar: "Y", unread: 0, status: "online" },
    { id: 6, name: "Accra Campus", avatar: "C", unread: 0, status: "active" },
    { id: 7, name: "Kumasi Branch", avatar: "B", unread: 0, status: "away" },
    { id: 8, name: "Finance Dept", avatar: "F", unread: 0, status: "online" },
    { id: 9, name: "IT Support", avatar: "I", unread: 0, status: "active" },
    {
      id: 10,
      name: "Student Affairs",
      avatar: "E",
      unread: 0,
      status: "online",
    },
  ]);
  const totalChatUnread = chatUsers.reduce((sum, u) => sum + u.unread, 0);
  const unreadStudentNotificationCount = studentNotifications.filter(
    (notification) => !notification.is_read,
  ).length;
  const blockedStudentNavKeys = useMemo(() => {
    const blocked = [];
    for (const item of STUDENT_NAV) {
      if (!item.section && studentNavVisibility[item.key] === false) {
        blocked.push(item.key);
      }
    }
    for (const [parent, children] of Object.entries(STUDENT_SUBPAGE_MAP)) {
      if (blocked.includes(parent)) {
        blocked.push(...children);
      }
    }
    return blocked;
  }, [studentNavVisibility]);
  const firstVisibleStudentTab = STUDENT_NAV.find(
    (item) => !item.section && !blockedStudentNavKeys.includes(item.key),
  )?.key;
  const filteredStudentNav = useMemo(
    () => removeEmptyNavSections(
      STUDENT_NAV.filter((item) =>
        item.section ? true : !blockedStudentNavKeys.includes(item.key),
      ),
    ),
    [blockedStudentNavKeys],
  );
  const BOTTOM = useMemo(
    () =>
      getPriorityBottomKeys(
        ["dashboard", "study-content", "live-tests", "results", "fees"],
        filteredStudentNav,
        new Set(blockedStudentNavKeys),
      ),
    [filteredStudentNav, blockedStudentNavKeys],
  );
  const selectionNoticeKey = `student_selection_notice_seen_${String(user?.email || user?.index || "student")}`;
  const selectionStatus = String(selectionRow?.status || "").toLowerCase();
  const isSelectionApproved =
    !!selectionRow &&
    (!!selectionRow?.approved || selectionStatus === "confirmed");
  const approvedAtRaw =
    selectionRow?.reviewed_at ||
    selectionRow?.reviewedAt ||
    selectionRow?.updated_at ||
    selectionRow?.created_at ||
    null;
  const approvedAtLabel = approvedAtRaw
    ? new Date(approvedAtRaw).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "";
  const approvalInfo = {
    isApproved: isSelectionApproved,
    approvedAtLabel,
    id: selectionRow?.id || "",
    stamp: approvedAtRaw || "",
  };

  const markSelectionApprovalSeen = useCallback(() => {
    if (!approvalInfo.isApproved) return;
    try {
      sessionStorage.setItem(
        selectionNoticeKey,
        `${approvalInfo.id}:${approvalInfo.stamp}`,
      );
    } catch {}
    setNotificationCount(0);
  }, [
    approvalInfo.id,
    approvalInfo.isApproved,
    approvalInfo.stamp,
    selectionNoticeKey,
  ]);

  const goTab = (key, closeSidebar = true) => {
    setTab(key);
    writeStoredTab(STUDENT_TAB_KEY, key);
    if (closeSidebar) setSidebarOpen(false);
  };
  const reloadApp = () => window.location.reload();

  useEffect(() => {
    const parent = childToParent[tab];
    if (parent) {
      setExpandedGroups((prev) => ({ ...prev, [parent]: true }));
    }
  }, [tab, childToParent]);
  useEffect(() => {
    if (!blockedStudentNavKeys.includes(tab)) return;
    if (firstVisibleStudentTab && firstVisibleStudentTab !== tab) {
      setTab(firstVisibleStudentTab);
      writeStoredTab(STUDENT_TAB_KEY, firstVisibleStudentTab);
    }
  }, [blockedStudentNavKeys, firstVisibleStudentTab, tab]);

  useEffect(() => {
    const loadStudentPortalData = async () => {
      setStudentDataError("");
      setStudentData(null);
      setAttendanceData([]);
      setFeesData([]);
      setCourseProgressSummary({
        enrolledCount: 0,
        completedCount: 0,
        averageCompletion: 0,
        progressItems: [],
      });
      setScoreValues([]);
      setScoreRecords([]);
      setSelectionRow(null);
      if (!supabase || isPreviewStudentUser(user?.id)) {
        const demoScores = [82, 86, 90, 88, 93];
        const demoFees = [
          { id: 1, term: "Term 1", amount: 1200, paid: 1200, status: "paid" },
          { id: 2, term: "Term 2", amount: 1200, paid: 980, status: "partial" },
        ];
        const demoAttendance = [
          { id: 1, date: "2025-01-04", status: "Present" },
          { id: 2, date: "2025-01-05", status: "Present" },
          { id: 3, date: "2025-01-06", status: "Absent" },
          { id: 4, date: "2025-01-07", status: "Present" },
          { id: 5, date: "2025-01-08", status: "Present" },
          { id: 6, date: "2025-01-09", status: "Present" },
        ];
        setStudentData(demoStudentRecord);
        setAttendanceData(demoAttendance);
        setFeesData(demoFees);
        setScoreValues(demoScores);
        setCourseProgressSummary({
          enrolledCount: 3,
          completedCount: 1,
          averageCompletion: 72,
          progressItems: [
            { title: "Mathematics", percent: 90 },
            { title: "Science", percent: 74 },
            { title: "English", percent: 68 },
          ],
        });
        setSelectionRow({
          id: "demo-selection",
          status: "confirmed",
          approved: true,
          reviewed_at: new Date().toISOString(),
        });
        return;
      }
      if (!user?.id) {
        setStudentDataError("This student account is not linked to a student record.");
        return;
      }

      const [
        { data: student, error: studentError },
        { data: schools, error: schoolsError },
      ] = await Promise.all([
        supabase.from("students").select("*").eq("id", user.id).maybeSingle(),
        supabase.from("schools").select("*").order("name", { ascending: true }),
      ]);

      if (studentError) {
        setStudentDataError(`Student record could not be loaded: ${studentError.message}`);
        return;
      }
      if (!student) {
        setStudentDataError("No student record is linked to this account.");
        return;
      }
      if (schoolsError) {
        setStudentDataError(`School records could not be loaded: ${schoolsError.message}`);
      } else if (Array.isArray(schools)) {
        setSchoolsData(sortSchoolsByCategory(schools.map(normalizeSchoolRow)));
      }

      const identifier = String(student.index_number || student.index || user?.index || "");
      setStudentData({
        ...student,
        full_name: student.full_name || student.name || user?.name || "Student",
        index: student.index || student.index_number || identifier,
        class: student.class || student.class_name || "",
        region: student.region || "Unknown",
        aggregate: Number(student.aggregate ?? 0),
        photo_url: resolveStudentPhotoUrl(student),
        gender: student.gender || "",
        date_of_birth: student.date_of_birth || "",
        parent_contact: student.parent_contact || "",
        personal_contact: student.personal_contact || "",
        home_address: student.home_address || "",
        home_town: student.home_town || "",
        place_of_residence: student.place_of_residence || "",
        postal_town: student.postal_town || "",
        po_box: student.po_box || "",
        status: student.status || "",
      });

      const studentIndex = String(
        student.index_number || student.index || identifier,
      );
      const fetchStudentScores = async () => {
        const scoreColumns =
          "id, student_id, index_number, score, subject, term, academic_year, exam_type, created_at";
        const primary = await supabase
          .from("scores")
          .select(scoreColumns)
          .eq("student_id", student.id);
        if (primary.error || (primary.data || []).length === 0) {
          const fallback = studentIndex
            ? await supabase
                .from("scores")
                .select(scoreColumns)
                .eq("index_number", studentIndex)
            : { data: [], error: null };
          if (!fallback.error && (fallback.data || []).length) return fallback;
          if (primary.error && fallback.error) return primary;
          if (primary.error && !fallback.error) return fallback;
          if (!primary.error && fallback.error) return fallback;
        }
        return primary;
      };

      const courseProgressPromise = (async () => {
        try {
          const { data: enrollmentRows, error: enrollmentError } = await supabase
            .from("course_enrollments")
            .select("id, course_id")
            .eq("student_id", student.id)
            .order("enrolled_at", { ascending: false });
          if (enrollmentError || !Array.isArray(enrollmentRows) || !enrollmentRows.length) {
            return { enrolledCount: 0, completedCount: 0, averageCompletion: 0, progressItems: [] };
          }

          const courseIds = [...new Set(enrollmentRows.map((row) => row.course_id).filter(Boolean))];
          const [progressResponse, coursesResponse] = await Promise.all([
            supabase
              .from("course_lesson_progress")
              .select("enrollment_id, lesson_id")
              .in("enrollment_id", enrollmentRows.map((row) => row.id)),
            courseIds.length
              ? supabase.from("courses").select("id, title, lessons").in("id", courseIds)
              : Promise.resolve({ data: [] }),
          ]);

          if (progressResponse.error) {
            return { enrolledCount: 0, completedCount: 0, averageCompletion: 0, progressItems: [] };
          }

          const completedByEnrollment = {};
          (progressResponse.data || []).forEach(({ enrollment_id, lesson_id }) => {
            if (!completedByEnrollment[enrollment_id]) completedByEnrollment[enrollment_id] = [];
            completedByEnrollment[enrollment_id].push(lesson_id);
          });
          return buildCourseProgressSummary(enrollmentRows, coursesResponse?.data || [], completedByEnrollment);
        } catch (error) {
          return { enrolledCount: 0, completedCount: 0, averageCompletion: 0, progressItems: [] };
        }
      })();

      const [
        { data: attendanceRows, error: attendanceError },
        { data: feeRows, error: feeError },
        { data: scoreRows, error: scoreError },
        selection,
        courseProgress,
      ] = await Promise.all([
        supabase
          .from("attendance")
          .select("*")
          .eq("student_id", student.id)
          .order("date", { ascending: false }),
        supabase
          .from("fees")
          .select("*")
          .eq("student_id", student.id)
          .order("id", { ascending: false }),
        fetchStudentScores(),
        fetchStudentSelection({
          supabase,
          userEmail: user?.email || getSessionUserEmail(),
          studentData: {
            id: student.id,
            index: student.index || student.index_number,
            index_number: student.index_number || student.index,
            full_name: student.full_name || student.name || user?.name || "",
          },
        }),
        courseProgressPromise,
      ]);

      const loadErrors = [
        attendanceError && `Attendance: ${attendanceError.message}`,
        feeError && `Fees: ${feeError.message}`,
        scoreError && `Scores: ${scoreError.message}`,
      ].filter(Boolean);
      if (loadErrors.length) {
        setStudentDataError((current) =>
          [current, ...loadErrors].filter(Boolean).join(" "),
        );
      }
      setCourseProgressSummary(courseProgress || { enrolledCount: 0, completedCount: 0, averageCompletion: 0, progressItems: [] });
      setAttendanceData(
        (attendanceRows || []).map((row, index) => ({
          id: row.id ?? index + 1,
          date: row.date || row.day || "-",
          status: row.status || "Present",
        })),
      );
      setFeesData(
        (feeRows || []).map((fee, index) => ({
          id: fee.id ?? index + 1,
          term: fee.term || fee.semester || `Term ${index + 1}`,
          amount: Number(fee.amount ?? fee.total ?? 0),
          paid: Number(fee.paid ?? fee.amount_paid ?? 0),
          status:
            fee.status ||
            (Number(fee.paid ?? 0) >= Number(fee.amount ?? 0)
              ? "paid"
              : Number(fee.paid ?? 0) > 0
                ? "partial"
                : "unpaid"),
        })),
      );
      const validScoreRows = (scoreRows || []).filter(
        (row) => {
          const belongsToStudent =
            String(row?.student_id ?? "") === String(student.id) ||
            (studentIndex &&
              String(row?.index_number ?? "") === studentIndex);
          const score = Number(row?.score);
          return (
            belongsToStudent &&
            row?.score !== null &&
            row?.score !== undefined &&
            Number.isFinite(score) &&
            score >= 0 &&
            score <= 100
          );
        },
      );
      setScoreRecords(validScoreRows);
      setScoreValues(
        validScoreRows
          .filter(
            (row) =>
              row.term === appCfg.currentTerm &&
              row.academic_year === appCfg.academicYear,
          )
          .map((row) => Number(row.score)),
      );
      setSelectionRow(selection || null);
    };

    loadStudentPortalData().catch((error) => {
      setStudentDataError(
        `Student records could not be loaded: ${error?.message || "Supabase request failed."}`,
      );
    });
  }, [
    appCfg.academicYear,
    appCfg.currentTerm,
    user?.email,
    user?.id,
    user?.index,
    user?.name,
  ]);

  useEffect(() => {
    if (!supabase || !user?.id || isPreviewStudentUser(user.id)) {
      setStudentNotifications([]);
      setStudentNotificationsError("");
      return;
    }

    let active = true;
    setStudentNotifications([]);
    setStudentNotificationsError("");
    const loadNotifications = async () => {
      const { data, error } = await supabase
        .from("student_notifications")
        .select("id, notification_type, title, message, is_read, created_at")
        .eq("student_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) {
        if (active) {
          setStudentNotificationsError(
            `Profile updates could not be loaded: ${error.message}`,
          );
        }
        return;
      }
      if (active) {
        setStudentNotifications(data || []);
        setStudentNotificationsError("");
      }
    };

    loadNotifications().catch((error) => {
      if (active) {
        setStudentNotificationsError(
          `Profile updates could not be loaded: ${error?.message || "Supabase request failed."}`,
        );
      }
    });

    const channel = supabase
      .channel(`student-notifications-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "student_notifications",
          filter: `student_id=eq.${user.id}`,
        },
        (payload) => {
          const notification = payload.new;
          if (notification.notification_type === "profile_confirmed") {
            setStudentData((current) =>
              current ? { ...current, status: "confirmed" } : current,
            );
          }
          setStudentNotifications((current) =>
            current.some((item) => item.id === notification.id)
              ? current
              : [notification, ...current].slice(0, 50),
          );
        },
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          setStudentNotificationsError(
            "Live profile updates are unavailable. Refresh Announcements to check for new updates.",
          );
        }
      });

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [user?.id]);

  useEffect(() => {
    if (tab !== "announcements" || !supabase || !user?.id) return;
    const unreadIds = studentNotifications
      .filter((notification) => !notification.is_read)
      .map((notification) => notification.id);
    if (!unreadIds.length) return;

    let active = true;
    supabase
      .from("student_notifications")
      .update({ is_read: true })
      .in("id", unreadIds)
      .then(({ error }) => {
        if (!active) return;
        if (error) {
          setStudentNotificationsError(
            `Profile updates could not be marked as read: ${error.message}`,
          );
          return;
        }
        setStudentNotifications((current) =>
          current.map((notification) =>
            unreadIds.includes(notification.id)
              ? { ...notification, is_read: true }
              : notification,
          ),
        );
      })
      .catch((error) => {
        if (active) {
          setStudentNotificationsError(
              `Profile updates could not be marked as read: ${error?.message || "Supabase request failed."}`,
          );
        }
      });

    return () => {
      active = false;
    };
  }, [studentNotifications, tab, user?.id]);

  useEffect(() => {
    if (tab === "my-selection") {
      markSelectionApprovalSeen();
    }
  }, [markSelectionApprovalSeen, tab]);

  useEffect(() => {
    if (!approvalInfo.isApproved) {
      setNotificationCount(0);
      return;
    }
    let seenStamp = "";
    try {
      seenStamp = sessionStorage.getItem(selectionNoticeKey) || "";
    } catch {}
    const currentStamp = `${approvalInfo.id}:${approvalInfo.stamp}`;
    if (
      seenStamp !== currentStamp &&
      tab !== "announcements" &&
      tab !== "my-selection"
    ) {
      setNotificationCount(1);
    } else {
      setNotificationCount(0);
    }
  }, [
    approvalInfo.id,
    approvalInfo.isApproved,
    approvalInfo.stamp,
    selectionNoticeKey,
    tab,
  ]);

  useEffect(() => {
    if (tab === "announcements") {
      markSelectionApprovalSeen();
    }
  }, [markSelectionApprovalSeen, tab]);

  const openNotifications = () => {
    markSelectionApprovalSeen();
    goTab("announcements");
  };
  const handleMainBlankClick = (event) => {
    if (!sidebarOpen) return;
    if (event.target === event.currentTarget) {
      setSidebarOpen(false);
    }
  };

  const renderPage = () => {
    const pages = {
      dashboard: (
        <StudentDashboard
          user={user}
          studentData={studentData}
          attendanceData={attendanceData}
          feesData={feesData}
          selectionInfo={{
            count: normalizeSelectionList(selectionRow).length,
            status: selectionRow?.status || "not-submitted",
          }}
          scoreValues={scoreValues}
          courseProgressSummary={courseProgressSummary}
          onOpenLearningLibrary={() => goTab("study-content")}
          onOpenCourses={() => goTab("courses")}
        />
      ),
      profile: (
        <Suspense fallback={<div className="portal-loading" role="status">Loading profile...</div>}>
          <StudentProfile
            user={user}
            studentData={studentData}
            onProfileUpdated={(updatedProfile) =>
              setStudentData((current) => ({ ...current, ...updatedProfile }))
            }
          />
        </Suspense>
      ),
      results: <StudentAcademicResultsPage scoreRecords={scoreRecords} />,
      "live-tests": <StudentLiveTestsPage user={user} studentData={studentData} />,
      "study-content": (
        <Suspense fallback={<div className="portal-loading" role="status">Loading learning library...</div>}>
          <StudentStudyContentPage studentData={studentData} />
        </Suspense>
      ),
      courses: (
        <Suspense fallback={<div className="portal-loading" role="status">Loading courses...</div>}>
          <CoursesPage mode="student" studentData={studentData} />
        </Suspense>
      ),
      "study-teams": (
        <Suspense fallback={<div className="portal-loading" role="status">Loading study teams...</div>}>
          <StudyTeamsPage user={user} studentData={studentData} />
        </Suspense>
      ),
      attendance: <StudentAttendance attendanceData={attendanceData} />,
      fees: <StudentFees feesData={feesData} />,
      docs: <DocumentsPage />,
      announcements: (
        <div className="fade-in">
          <div className="page-header">
            <div className="page-title">Announcements</div>
            <div className="page-sub">
              Notification channels: {appCfg.emailNotifs ? "Email " : ""}
              {appCfg.smsNotifs ? "SMS" : "In-app"}
            </div>
          </div>
          {studentNotificationsError && (
            <div className="alert alert-danger" role="alert">
              {studentNotificationsError}
            </div>
          )}
          {studentNotifications.map((notification) => (
            <div
              key={notification.id}
              className="card card-padded"
              style={{
                marginBottom: 12,
                borderLeft: "4px solid #16a34a",
                background: notification.is_read ? undefined : "#f0fdf4",
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                {notification.title}
              </div>
              <div style={{ color: "#475569", fontSize: ".9rem" }}>
                {notification.message}
              </div>
              <div style={{ fontSize: ".78rem", color: "#94a3b8", marginTop: 6 }}>
                {new Date(notification.created_at).toLocaleString()}
              </div>
            </div>
          ))}
          {approvalInfo.isApproved && (
            <div
              className="card card-padded"
              style={{
                marginBottom: 12,
                borderLeft: "4px solid #16a34a",
                background: "#f0fdf4",
              }}
            >
              <div
                style={{ fontWeight: 800, marginBottom: 4, color: "#14532d" }}
              >
                Selection Approved
              </div>
              <div style={{ color: "#166534", fontSize: ".9rem" }}>
                Your selected schools have been approved by the admin and
                placement processing can continue.
              </div>
              {approvalInfo.approvedAtLabel && (
                <div
                  style={{ fontSize: ".78rem", color: "#166534", marginTop: 6 }}
                >
                  Approved: {approvalInfo.approvedAtLabel}
                </div>
              )}
            </div>
          )}
          {ANNOUNCEMENTS.map((a) => (
            <div
              key={a.id}
              className={`card card-padded ${a.type === "urgent" ? "" : ""}`}
              style={{
                marginBottom: 12,
                borderLeft: `4px solid ${a.type === "urgent" ? "#dc2626" : a.type === "info" ? "#1a56db" : "#d97706"}`,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{a.title}</div>
              <div style={{ color: "#475569", fontSize: ".9rem" }}>
                {a.body}
              </div>
              <div
                style={{ fontSize: ".78rem", color: "#94a3b8", marginTop: 6 }}
              >
                {a.date}
              </div>
            </div>
          ))}
        </div>
      ),
      selection: (
        <SchoolSelection schoolsData={schoolsData} studentData={studentData} />
      ),
      "my-selection": (
        <MySelection selectionRow={selectionRow} approvalInfo={approvalInfo} />
      ),
      chat: <ChatPage chatUsers={chatUsers} onChatUsersChange={setChatUsers} />,
      assignments: <AssignmentTrackerPage />,
      "exam-schedule": <ExamSchedulePage />,
      "report-card": (
        <ReportCardPage
          studentData={studentData}
          attendanceData={attendanceData}
          feesData={feesData}
        />
      ),
      "pay-fees": <StudentPaymentsPage feesData={feesData} />,
      "upload-docs": <StudentUploadDocsPage />,
      "support-tickets": <StudentTicketsPage />,
      resources: <LearningResourcesPage />,
    };
    const visibleTab = blockedStudentNavKeys.includes(tab)
      ? firstVisibleStudentTab
      : tab;
    if (!visibleTab) {
      return (
        <div className="card card-padded" role="status">
          No student portal features are currently enabled. Please contact your school administrator.
        </div>
      );
    }
    return (
      pages[visibleTab] || (
        <div
          className="card card-padded"
          style={{ textAlign: "center", padding: 48 }}
        >
          Coming soon
        </div>
      )
    );
  };

  if (!appCfg.studentPortalOpen) {
    return (
      <div
        className="app"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
        }}
      >
        <div
          className="card card-padded"
          style={{ maxWidth: 420, textAlign: "center", padding: 40 }}
        >
          <div style={{ fontSize: 3 + "rem", marginBottom: 12 }}> </div>
          <div
            style={{
              fontWeight: 800,
              fontSize: "1.2rem",
              marginBottom: 8,
              color: "#1e3a8a",
            }}
          >
            Student Portal Closed
          </div>
          <div
            style={{ color: "#475569", fontSize: ".95rem", marginBottom: 20 }}
          >
            The student portal is currently closed by the administrator. Please
            check back later or contact your school.
          </div>
          <button className="btn btn-outline" onClick={onLogout}>
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app admin-app student-app">
      <Topbar
        user={user}
        onLogout={onLogout}
        onMenuClick={() => setSidebarOpen((o) => !o)}
        darkMode={darkMode}
        onToggleDark={onToggleDark}
        onOpenNotifications={openNotifications}
        onOpenProfile={() => goTab("profile")}
        onReloadApp={reloadApp}
        notificationCount={notificationCount + unreadStudentNotificationCount}
        chatUnread={totalChatUnread}
        onOpenChat={() => goTab("chat")}
        showChat={studentNavVisibility.chat}
        showNotifications={studentNavVisibility.announcements}
        showProfile={studentNavVisibility.profile}
        systemName={appCfg.systemName}
      />
      <div className="shell">
        {sidebarOpen && (
          <div
            className="sidebar-overlay"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <nav className={`sidebar ${sidebarOpen ? "" : "closed"}`}>
          <button
            className="sidebar-brand brand-btn"
            onClick={reloadApp}
            title="Reload app"
          >
            <img
              src="https://image2url.com/r2/default/images/1773576400522-25d9d22b-3e79-4a9a-adc2-eae0031fbfe1.png"
              alt="Campus Ghana"
            />
            <span className="admin-sidebar-brand-copy">
              <strong>Campus Ghana</strong>
              <small>STUDENT PORTAL</small>
            </span>
          </button>
          {filteredStudentNav.map((item, i) => {
            if (item.section)
              return (
                <div key={i} className="sidebar-section">
                  {item.section}
                </div>
              );
            if (childToParent[item.key]) return null;

            const childrenKeys = (STUDENT_SUBPAGE_MAP[item.key] || []).filter(
              (key) => filteredStudentNav.some((navItem) => navItem.key === key),
            );
            const hasChildren = childrenKeys.length > 0;
            const activeParent = tab === item.key || childrenKeys.includes(tab);

            return (
              <div key={item.key}>
                <button
                  className={`nav-item ${activeParent ? "active" : ""}`}
                  onClick={() => {
                    goTab(item.key, !hasChildren);
                    if (hasChildren) {
                      setExpandedGroups((prev) => ({
                        ...prev,
                        [item.key]: !prev[item.key],
                      }));
                    }
                  }}
                >
                  <Ico
                    name={item.icon}
                    size={26}
                    color={item.color}
                    className="nav-item-icon"
                    style={{
                      strokeWidth: 2.6,
                      filter: "saturate(1.08) contrast(1.05)",
                    }}
                  />
                  <span
                    className="nav-item-label"
                    style={{ color: item.color, fontWeight: 700 }}
                  >
                    {item.label}
                  </span>
                  {hasChildren && (
                    <span
                      style={{
                        marginLeft: "auto",
                        fontWeight: 700,
                        color: "#64748b",
                      }}
                    >
                      {expandedGroups[item.key] ? " " : " "}
                    </span>
                  )}
                </button>

                {hasChildren &&
                  expandedGroups[item.key] &&
                  childrenKeys.map((childKey) => {
                    const child = filteredStudentNav.find((n) => n.key === childKey);
                    if (!child) return null;
                    return (
                      <button
                        key={child.key}
                        className={`nav-item ${tab === child.key ? "active" : ""}`}
                        onClick={() => goTab(child.key)}
                        style={{
                          paddingLeft: 36,
                          marginTop: 2,
                          marginBottom: 2,
                        }}
                      >
                        <Ico
                          name={child.icon}
                          size={20}
                          color={child.color}
                          className="nav-item-icon"
                        />
                        <span
                          className="nav-item-label"
                          style={{
                            color: child.color,
                            fontWeight: 600,
                            fontSize: ".84rem",
                          }}
                        >
                          {child.label}
                        </span>
                      </button>
                    );
                  })}
              </div>
            );
          })}
        </nav>
        <main
          ref={mainContentRef}
          className={`main ${sidebarOpen ? "" : "full"}`}
          onClick={handleMainBlankClick}
        >
          {appCfg.maintenanceMode && (
            <div
              className="alert alert-warning"
              style={{
                margin: "16px 16px 0",
                fontWeight: 700,
                borderRadius: 8,
              }}
            >
                System is currently under maintenance. Some features may be
              unavailable.
            </div>
          )}
          {studentDataError && (
            <div
              className="alert alert-warning"
              role="alert"
              style={{ margin: "16px 16px 0", borderRadius: 8 }}
            >
              {studentDataError}
            </div>
          )}
          {renderPage()}
        </main>
        <div className="bottom-nav">
          <div
            className="bottom-nav-grid"
            style={{ gridTemplateColumns: `repeat(${BOTTOM.length},1fr)` }}
          >
            {BOTTOM.map((k) => {
              const item = STUDENT_NAV.find((n) => n.key === k);
              return (
                <button
                  key={k}
                  className={`bottom-nav-item ${tab === k ? "active" : ""}`}
                  onClick={() => goTab(k)}
                >
                  <Ico name={item.icon} size={30} color={item.color} />
                  <span style={{ fontSize: ".56rem" }}>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ROOT
function GhanaCampus() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [appSettings, setAppSettings] = useState(DEFAULT_SETTINGS);
  const authRestoreRequestRef = useRef(0);
  const authUserId = session?.user?.authUserId;

  const hydrateSessionFromSupabase = useCallback(async (eventUser) => {
    const requestId = ++authRestoreRequestRef.current;
    setAuthLoading(true);
    const isCurrentRequest = () => requestId === authRestoreRequestRef.current;
    if (!supabase) {
      setSession(null);
      setDarkMode(false);
      writeAppSession(null);
      setAuthLoading(false);
      return;
    }

    try {
      let authUser = eventUser;
      if (authUser === undefined) {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        authUser = data?.session?.user;
      }

      if (!authUser) {
        if (!isCurrentRequest()) return;
        setSession(null);
        setDarkMode(false);
        writeAppSession(null);
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", authUser.id)
        .maybeSingle();
      if (profileError || !profile) {
        if (!isCurrentRequest()) return;
        setSession(null);
        setDarkMode(false);
        writeAppSession(null);
        return;
      }

      const displayName =
        profile.full_name ||
        authUser.user_metadata?.full_name ||
        authUser.email ||
        authUser.phone ||
        "User";
      const role = normalizeRoleKey(profile.role);
      let studentRecord = null;
      if (role === "student") {
        const { data, error: studentError } = await supabase
          .from("students")
          .select("id, index_number, index, full_name, display_name")
          .eq("auth_user_id", authUser.id)
          .maybeSingle();
        if (studentError || !data) {
          if (!isCurrentRequest()) return;
          setSession(null);
          writeAppSession(null);
          return;
        }
        studentRecord = data;
      }
      const restoredPortal = resolvePortalFromAccount(profile, role);

      const restoredSession = {
        authSource: "supabase",
        portal: restoredPortal,
        user: {
          id: studentRecord?.id || authUser.id,
          authUserId: authUser.id,
          email: authUser.email,
          role,
          name: studentRecord?.display_name || studentRecord?.full_name || displayName,
          index: studentRecord?.index_number || studentRecord?.index || "",
          registered_school_id: profile.registered_school_id ?? null,
          managed_school_name: profile.managed_school_name || "",
        },
      };
      if (!isCurrentRequest()) return;
      setSession(restoredSession);
      writeAppSession(restoredSession);
      void (async () => {
        try {
          const { data: preferenceRow, error: preferenceError } = await supabase
            .from("user_preferences")
            .select("preferences")
            .eq("user_id", authUser.id)
            .maybeSingle();
          if (preferenceError) {
            console.error("Could not load account preferences:", preferenceError.message);
            return;
          }
          if (isCurrentRequest()) {
            setDarkMode(!!preferenceRow?.preferences?.dark_mode);
          }
        } catch (error) {
          console.error("Could not load account preferences:", error);
        }
      })();
    } catch (error) {
      if (!isCurrentRequest()) return;
      console.error("Could not restore the Supabase session:", error);
      setSession(null);
      setDarkMode(false);
      writeAppSession(null);
    } finally {
      if (isCurrentRequest()) setAuthLoading(false);
    }
  }, []);

  const toggleDarkMode = async () => {
    if (!supabase || !session?.user?.authUserId) {
      window.alert("Sign in to save display preferences.");
      return;
    }

    const nextDarkMode = !darkMode;
    setDarkMode(nextDarkMode);
    const { data: preferenceRow, error: readError } = await supabase
      .from("user_preferences")
      .select("preferences")
      .eq("user_id", session.user.authUserId)
      .maybeSingle();
    if (readError) {
      setDarkMode(!nextDarkMode);
      window.alert(`Display preference was not saved: ${readError.message}`);
      return;
    }

    const { error } = await supabase.from("user_preferences").upsert(
      {
        user_id: session.user.authUserId,
        preferences: {
          ...(preferenceRow?.preferences || {}),
          dark_mode: nextDarkMode,
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) {
      setDarkMode(!nextDarkMode);
      window.alert(`Display preference was not saved: ${error.message}`);
    }
  };

  const login = async (portal, user, password) => {
    if (!supabase) {
      return { ok: false, error: "Supabase is not configured for sign-in." };
    }

    if (portal === "student") {
      const studentIndex = String(user.index || "").trim().toUpperCase();
      if (!/^(?:CG-[A-Z]{2}\d{9,}|CG-\d{10}|\d{12})$/.test(studentIndex)) {
        return {
          ok: false,
          error: "Enter a valid region-based CG- Student ID or a legacy 12-digit ID.",
        };
      }

      const studentEmail =
        `student-${studentIndex}@students.campusghana.invalid`;
      const { data: authData, error: authError } =
        await supabase.auth.signInWithPassword({
          email: studentEmail,
          password,
        });
      if (authError || !authData?.user) {
        return { ok: false, error: "Invalid student ID or password." };
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, role")
        .eq("id", authData.user.id)
        .maybeSingle();
      if (
        profileError ||
        !profile ||
        normalizeRoleKey(profile.role) !== "student"
      ) {
        await supabase.auth.signOut();
        return {
          ok: false,
          error: "This student account has not been provisioned. Contact your school administrator.",
        };
      }

      const { data: studentRecord, error: studentError } = await supabase
        .from("students")
        .select("id, index_number, index")
        .eq("auth_user_id", authData.user.id)
        .maybeSingle();
      const linkedIndex = String(
        studentRecord?.index_number || studentRecord?.index || "",
      );
      if (
        studentError ||
        !studentRecord ||
        linkedIndex !== studentIndex
      ) {
        await supabase.auth.signOut();
        return {
          ok: false,
          error: "This student ID is not linked to the signed-in account. Contact your school administrator.",
        };
      }

      await hydrateSessionFromSupabase(authData.user);
      return { ok: true };
    }

    const { data: authData, error: authError } =
      await supabase.auth.signInWithPassword({
        email: user.email,
        password,
      });
    if (authError || !authData?.user) {
      return { ok: false, error: authError?.message || "Sign in failed." };
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", authData.user.id)
      .maybeSingle();
    if (profileError || !profile) {
      await supabase.auth.signOut();
      return {
        ok: false,
        error: "This account has no approved portal profile. Ask an administrator to provision its role.",
      };
    }

    await hydrateSessionFromSupabase();
    return { ok: true };

  };

  const registerStudent = async (details) => {
    if (!supabase) {
      return { ok: false, error: "Supabase is not configured for account creation." };
    }

    const { data, error } = await supabase.functions.invoke("register-student", {
      body: details,
    });
    if (error) {
      let message = error.message || "Student account creation failed.";
      if (error.context instanceof Response) {
        const responseBody = await error.context.clone().json().catch(() => null);
        if (typeof responseBody?.error === "string") message = responseBody.error;
      }
      return { ok: false, error: message };
    }
    if (!data?.student_id) {
      return { ok: false, error: "The account was created without a Student ID. Contact support before trying again." };
    }
    return { ok: true, studentId: data.student_id, smsSent: data.sms_sent === true };
  };


  const logout = async () => {
    try {
      if (supabase) {
        await supabase.auth.signOut();
      }
    } catch (error) {
      console.error("Could not sign out cleanly:", error);
    } finally {
      setSession(null);
      setDarkMode(false);
      writeAppSession(null);
    }
  };

  useEffect(() => {
    globalThis.__campus_user_email =
      session?.user?.email || "";
  }, [session]);

  useEffect(() => {
    document.title = appSettings.systemName || "Campus Ghana";
    document.body.classList.toggle("dark-mode", !!darkMode);
    document.body.style.background = darkMode ? "#0b1220" : "";
    document.body.style.color = darkMode ? "#e2e8f0" : "";
  }, [darkMode, appSettings.systemName]);

  useEffect(() => {
    const loadSettings = async () => {
      if (!supabase || !authUserId) return;
      const { data } = await supabase
        .from("app_settings")
        .select("config")
        .eq("id", 1)
        .maybeSingle();
      let mergedSettings = data?.config
        ? { ...DEFAULT_SETTINGS, ...data.config }
        : { ...DEFAULT_SETTINGS };
      mergedSettings.studentNavVisibility = getStudentNavVisibility(
        data?.config || {},
      );

      const { data: classRows, error: classError } = await supabase
        .from("classes")
        .select("name")
        .eq("active", true)
        .order("id", { ascending: true });

      if (!classError && Array.isArray(classRows)) {
        mergedSettings = {
          ...mergedSettings,
          classOptions: classRows
            .map((row) => String(row?.name || "").trim())
            .filter(Boolean),
        };
      } else if (isMissingTableError(classError, "classes")) {
        // Keep legacy app_settings.classOptions when classes table is not migrated yet.
      }

      setAppSettings((s) => ({ ...DEFAULT_SETTINGS, ...s, ...mergedSettings }));
    };
    loadSettings();
  }, [authUserId]);

  useEffect(() => {
    if (!supabase) return;

    hydrateSessionFromSupabase();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, authSession) => {
      queueMicrotask(() => {
        hydrateSessionFromSupabase(authSession?.user || null);
      });
    });

    return () => {
      listener?.subscription?.unsubscribe();
    };
  }, [hydrateSessionFromSupabase]);

  const previewStudentSession = {
    portal: "student",
    user: {
      id: "preview-student",
      authUserId: "preview-student",
      email: "student@campusghana.demo",
      role: "student",
      name: "Kwame Boateng",
      index: "CG-GH-2024053101",
      registered_school_id: null,
      managed_school_name: "",
    },
  };

  return (
    <SettingsContext.Provider
      value={{ session, cfg: appSettings, updateCfg: setAppSettings }}
    >
      <style>{css}</style>
      {authLoading ? (
        <div className="portal-loading" role="status">
          <div className="loading-spinner" />
          <p>Restoring your session...</p>
        </div>
      ) : !session ? (
        <Suspense fallback={<div className="portal-loading" role="status"><div className="loading-spinner" /><p>Loading sign in </p></div>}>
          <Landing onSelect={login} onCreateAccount={registerStudent} />
        </Suspense>
      ) : session.portal === "admin" ? (
        <AdminPortal
          user={session.user}
          onLogout={logout}
          darkMode={darkMode}
          onToggleDark={toggleDarkMode}
        />
      ) : session.portal === "school-admin" ? (
        <SchoolAdminPortal
          user={session.user}
          onLogout={logout}
          darkMode={darkMode}
          onToggleDark={toggleDarkMode}
        />
      ) : session.portal === "parent" ? (
        <ParentPortal
          user={session.user}
          onLogout={logout}
          darkMode={darkMode}
          onToggleDark={toggleDarkMode}
        />
      ) : (
        <StudentPortal
          user={session.user}
          onLogout={logout}
          darkMode={darkMode}
          onToggleDark={toggleDarkMode}
        />
      )}
    </SettingsContext.Provider>
  );
}

// Parent Portal Component
function ParentPortal({ user, onLogout, darkMode, onToggleDark }) {
  const [tab, setTab] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [children, setChildren] = useState([]);
  const [selectedChild, setSelectedChild] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState([]);
  const [messages, setMessages] = useState([]);

  // Parent navigation
  const PARENT_NAV = [
    { section: "Overview" },
    { key: "dashboard", icon: "dashboard", label: "Dashboard", color: "#6366f1" },
    { key: "children", icon: "family", label: "My Children", color: "#059669" },
    { section: "Academic Monitoring" },
    { key: "progress", icon: "analytics", label: "Academic Progress", color: "#f97316" },
    { key: "attendance", icon: "attendance", label: "Attendance", color: "#14b8a6" },
    { key: "fees", icon: "fees", label: "Fees & Payments", color: "#22c55e" },
    { key: "results", icon: "results", label: "Exam Results", color: "#7c3aed" },
    { section: "Communication" },
    { key: "messages", icon: "chat", label: "Messages", color: "#ec4899" },
    { key: "notifications", icon: "bell", label: "Notifications", color: "#f59e0b" },
  ];

  const BOTTOM = useMemo(
    () => ["dashboard", "children", "progress", "messages"],
    []
  );

  useEffect(() => {
    loadParentData();
  }, []);

  const loadParentData = async () => {
    if (!supabase) return;

    try {
      setLoading(true);

      // Load children
      const { data: childrenData, error: childrenError } = await supabase
        .from("parent_students")
        .select(`
          student_id,
          relationship,
          is_primary,
          students (
            id,
            full_name,
            index_number,
            class,
            photo_url
          )
        `)
        .eq("parent_id", user.id);

      if (childrenError) {
        console.error("Error loading children:", childrenError);
      } else {
        const formattedChildren = childrenData.map(item => ({
          ...item.students,
          relationship: item.relationship,
          is_primary: item.is_primary
        }));
        setChildren(formattedChildren);
        if (formattedChildren.length > 0 && !selectedChild) {
          setSelectedChild(formattedChildren[0]);
        }
      }

      // Load notifications
      const { data: notificationsData, error: notificationsError } = await supabase
        .from("parent_notifications")
        .select("*")
        .eq("parent_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);

      if (!notificationsError) {
        setNotifications(notificationsData || []);
      }

      // Load messages
      const { data: messagesData, error: messagesError } = await supabase
        .from("parent_teacher_messages")
        .select(`
          *,
          students (full_name),
          teachers (full_name)
        `)
        .eq("parent_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (!messagesError) {
        setMessages(messagesData || []);
      }

    } catch (error) {
      console.error("Error loading parent data:", error);
    } finally {
      setLoading(false);
    }
  };

  const goTab = (key, closeSidebar = true) => {
    setTab(key);
    if (closeSidebar) setSidebarOpen(false);
  };

  const renderDashboard = () => (
    <div className="portal-content">
      <div className="page-header">
        <h1>Parent Dashboard</h1>
        <p>Welcome back, {user.name}</p>
      </div>

      <div className="dashboard-grid">
        <div className="dashboard-card">
          <div className="card-icon"><Ico name="family" size={24} color="#059669" /></div>
          <div className="card-content">
            <h3>{children.length}</h3>
            <p>Children</p>
          </div>
        </div>

        <div className="dashboard-card">
          <div className="card-icon"><Ico name="bell" size={24} color="#f59e0b" /></div>
          <div className="card-content">
            <h3>{notifications.filter(n => !n.is_read).length}</h3>
            <p>Unread Notifications</p>
          </div>
        </div>

        <div className="dashboard-card">
          <div className="card-icon"><Ico name="chat" size={24} color="#ec4899" /></div>
          <div className="card-content">
            <h3>{messages.length}</h3>
            <p>Messages</p>
          </div>
        </div>
      </div>

      {children.length > 0 && (
        <div className="children-overview">
          <h2>My Children</h2>
          <div className="children-grid">
            {children.map(child => (
              <div key={child.id} className="child-card" onClick={() => { setSelectedChild(child); goTab("progress"); }}>
                <div className="child-avatar">
                  {child.photo_url ? (
                    <img src={child.photo_url} alt={child.full_name} />
                  ) : (
                    <Ico name="profile" size={32} color="#64748b" />
                  )}
                </div>
                <div className="child-info">
                  <h4>{child.full_name}</h4>
                  <p>{child.class}   {child.relationship}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderChildren = () => (
    <div className="portal-content">
      <div className="page-header">
        <h1>My Children</h1>
      </div>

      {children.length === 0 ? (
        <div className="empty-state">
          <Ico name="family" size={48} color="#64748b" />
          <h3>No children linked</h3>
          <p>Please contact the school administration to link your children to your account.</p>
        </div>
      ) : (
        <div className="children-list">
          {children.map(child => (
            <div key={child.id} className="child-detail-card">
              <div className="child-header">
                <div className="child-avatar-large">
                  {child.photo_url ? (
                    <img src={child.photo_url} alt={child.full_name} />
                  ) : (
                    <Ico name="profile" size={48} color="#64748b" />
                  )}
                </div>
                <div className="child-details">
                  <h3>{child.full_name}</h3>
                  <p>Class: {child.class}</p>
                  <p>Index: {child.index_number}</p>
                  <p>Relationship: {child.relationship}</p>
                </div>
              </div>
              <div className="child-actions">
                <button className="btn-secondary" onClick={() => { setSelectedChild(child); goTab("progress"); }}>
                  <Ico name="analytics" size={16} /> View Progress
                </button>
                <button className="btn-secondary" onClick={() => { setSelectedChild(child); goTab("attendance"); }}>
                  <Ico name="attendance" size={16} /> View Attendance
                </button>
                <button className="btn-secondary" onClick={() => { setSelectedChild(child); goTab("fees"); }}>
                  <Ico name="fees" size={16} /> View Fees
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderProgress = () => {
    if (!selectedChild) {
      return (
        <div className="portal-content">
          <div className="empty-state">
            <Ico name="analytics" size={48} color="#64748b" />
            <h3>Select a child</h3>
            <p>Please select a child from the dashboard or children tab to view their progress.</p>
          </div>
        </div>
      );
    }

    return (
      <div className="portal-content">
        <div className="page-header">
          <h1>Academic Progress - {selectedChild.full_name}</h1>
          <button className="btn-secondary" onClick={() => goTab("children")}>
            <Ico name="back" size={16} /> Change Child
          </button>
        </div>

        <div className="progress-content">
          <p>Academic progress tracking for {selectedChild.full_name} will be implemented here.</p>
          <p>This will include grades, subject performance, and progress reports.</p>
        </div>
      </div>
    );
  };

  const renderAttendance = () => {
    if (!selectedChild) {
      return (
        <div className="portal-content">
          <div className="empty-state">
            <Ico name="attendance" size={48} color="#64748b" />
            <h3>Select a child</h3>
            <p>Please select a child to view their attendance records.</p>
          </div>
        </div>
      );
    }

    return (
      <div className="portal-content">
        <div className="page-header">
          <h1>Attendance - {selectedChild.full_name}</h1>
          <button className="btn-secondary" onClick={() => goTab("children")}>
            <Ico name="back" size={16} /> Change Child
          </button>
        </div>

        <div className="attendance-content">
          <p>Attendance records for {selectedChild.full_name} will be displayed here.</p>
          <p>This will show attendance percentage, absences, and tardiness.</p>
        </div>
      </div>
    );
  };

  const renderFees = () => {
    if (!selectedChild) {
      return (
        <div className="portal-content">
          <div className="empty-state">
            <Ico name="fees" size={48} color="#64748b" />
            <h3>Select a child</h3>
            <p>Please select a child to view their fee information.</p>
          </div>
        </div>
      );
    }

    return (
      <div className="portal-content">
        <div className="page-header">
          <h1>Fees & Payments - {selectedChild.full_name}</h1>
          <button className="btn-secondary" onClick={() => goTab("children")}>
            <Ico name="back" size={16} /> Change Child
          </button>
        </div>

        <div className="fees-content">
          <p>Fee information and payment history for {selectedChild.full_name} will be displayed here.</p>
          <p>This will include outstanding balances, payment plans, and transaction history.</p>
        </div>
      </div>
    );
  };

  const renderResults = () => {
    if (!selectedChild) {
      return (
        <div className="portal-content">
          <div className="empty-state">
            <Ico name="results" size={48} color="#64748b" />
            <h3>Select a child</h3>
            <p>Please select a child to view their exam results.</p>
          </div>
        </div>
      );
    }

    return (
      <div className="portal-content">
        <div className="page-header">
          <h1>Exam Results - {selectedChild.full_name}</h1>
          <button className="btn-secondary" onClick={() => goTab("children")}>
            <Ico name="back" size={16} /> Change Child
          </button>
        </div>

        <div className="results-content">
          <p>Exam results and grades for {selectedChild.full_name} will be displayed here.</p>
          <p>This will include subject-wise grades, overall performance, and trends.</p>
        </div>
      </div>
    );
  };

  const renderMessages = () => (
    <div className="portal-content">
      <div className="page-header">
        <h1>Messages</h1>
      </div>

      <div className="messages-content">
        <p>Communication with teachers will be implemented here.</p>
        <p>Parents can send messages to teachers and receive responses.</p>
      </div>
    </div>
  );

  const renderNotifications = () => (
    <div className="portal-content">
      <div className="page-header">
        <h1>Notifications</h1>
      </div>

      {notifications.length === 0 ? (
        <div className="empty-state">
          <Ico name="bell" size={48} color="#64748b" />
          <h3>No notifications</h3>
          <p>You don't have any notifications at the moment.</p>
        </div>
      ) : (
        <div className="notifications-list">
          {notifications.map(notification => (
            <div key={notification.id} className={`notification-item ${!notification.is_read ? 'unread' : ''}`}>
              <div className="notification-header">
                <h4>{notification.title}</h4>
                <span className="notification-date">
                  {new Date(notification.created_at).toLocaleDateString()}
                </span>
              </div>
              <p>{notification.message}</p>
              {notification.student_id && (
                <small>Regarding: {children.find(c => c.id === notification.student_id)?.full_name}</small>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderContent = () => {
    switch (tab) {
      case "dashboard": return renderDashboard();
      case "children": return renderChildren();
      case "progress": return renderProgress();
      case "attendance": return renderAttendance();
      case "fees": return renderFees();
      case "results": return renderResults();
      case "messages": return renderMessages();
      case "notifications": return renderNotifications();
      default: return renderDashboard();
    }
  };

  if (loading) {
    return (
      <div className="portal-loading">
        <div className="loading-spinner"></div>
        <p>Loading your dashboard...</p>
      </div>
    );
  }

  return (
    <div className={`portal-container ${darkMode ? "dark-mode" : ""}`}>
      <Topbar
        user={user}
        onLogout={onLogout}
        darkMode={darkMode}
        onToggleDark={onToggleDark}
        onMenuClick={() => setSidebarOpen(true)}
      />

      <div className="portal-main">
        <div className={`portal-sidebar ${sidebarOpen ? "open" : ""}`}>
          <div className="sidebar-content">
            <nav className="portal-nav">
              {PARENT_NAV.map((item, index) => {
                if (item.section) {
                  return (
                    <div key={index} className="nav-section">
                      {item.section}
                    </div>
                  );
                }
                return (
                  <button
                    key={item.key}
                    className={`nav-item ${tab === item.key ? "active" : ""}`}
                    onClick={() => goTab(item.key)}
                    style={{ "--nav-color": item.color }}
                  >
                    <Ico name={item.icon} size={20} color={tab === item.key ? item.color : "#64748b"} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        <div className="portal-content-area">
          {renderContent()}
        </div>
      </div>

      <div className="portal-bottom-nav">
        {BOTTOM.map((key) => {
          const item = PARENT_NAV.find((n) => n.key === key);
          if (!item) return null;
          return (
            <button
              key={key}
              className={`bottom-nav-item ${tab === key ? "active" : ""}`}
              onClick={() => goTab(key)}
              title={item.label}
            >
              <Ico name={item.icon} size={20} color={tab === key ? item.color : "#64748b"} />
            </button>
          );
        })}
      </div>

      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}
    </div>
  );
}

// --- END DEBUG PROVIDER WRAP ---
export default GhanaCampus;
