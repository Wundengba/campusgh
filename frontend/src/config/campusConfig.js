export const DEFAULT_SETTINGS = {
  systemName: "Campus Ghana", academicYear: "2023/2024", currentTerm: "Second Term",
  selectionDeadline: "2024-05-15", maxChoices: 7, schoolRegion: "All Regions",
  classOptions: [],
  allowChanges: true, studentPortalOpen: true, emailNotifs: true, smsNotifs: false,
  maintenanceMode: false, showResultsToStudents: true, autoApproveSelections: false,
  adminFeesPortalEnabled: true, studentFeesPortalEnabled: true,
  studentFeesSummaryVisible: true,
  studentSelectionDeadlineVisible: true,
  studentSelectionPortalEnabled: true,
  studentDashboardEnabled: true,
  studentProfileEnabled: true,
  studentResultsEnabled: true,
  studentAnalyticsEnabled: true,
  studentReportCardEnabled: true,
  studentStudyPlannerEnabled: true,
  studentExamScheduleEnabled: true,
  studentLiveTestsEnabled: true,
  studentGoalsEnabled: true,
  studentAttendanceEnabled: true,
  studentAttendanceCorrectionsEnabled: true,
  studentAnnouncementsEnabled: true,
  studentSupportTicketsEnabled: true,
  studentChatEnabled: true,
  studentDocsEnabled: true,
  studentUploadDocsEnabled: true,
  studentResourcesEnabled: true,
  studentAssignmentsEnabled: true,
  studentCalendarSyncEnabled: true,
  studentSelectSchoolsEnabled: true,
  studentMySelectionEnabled: true,
  studentNavVisibility: {
    dashboard: true,
    profile: true,
    results: true,
    "report-card": true,
    "study-planner": true,
    "exam-schedule": true,
    "live-tests": true,
    "study-content": true,
    "study-teams": true,
    courses: true,
    "study-groups": true,
    goals: true,
    selection: true,
    "my-selection": true,
    predictor: true,
    scholarships: true,
    attendance: true,
    "attendance-corrections": true,
    fees: true,
    "pay-fees": true,
    "payment-plan": true,
    announcements: true,
    "support-tickets": true,
    chat: true,
    docs: true,
    "upload-docs": true,
    resources: true,
    assignments: true,
    "calendar-sync": true,
    "learning-resources": true,
    "virtual-classroom": true,
    "course-marketplace": true,
    "live-streaming": true,
    "video-conferencing": true,
    gamification: true,
    "adaptive-learning": true,
    "collaborative-projects": true,
    "mobile-learning": true,
    "ai-tutor": true,
  },
  locale: "en-GH", timezone: "Africa/Accra", currency: "GHS",
  supportEmail: "support@campusghana.edu.gh", supportPhone: "0240000000",
  sessionTimeoutMins: 30, passwordMinLength: 8, lockoutAttempts: 5,
  twoFactorAdmins: false, enforcePasswordRotation: false,
  backupFrequency: "daily", backupTime: "02:00", auditLogsEnabled: true,
  auditRetentionDays: 180, apiRateLimitPerMin: 120,
  roleDefinitions: [],
  roleMetaOverrides: {},
  // Ensure super_admin has all admin privileges
  rolePrivileges: {
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
      "registered_schools.manage": true
    },
    super_admin: {
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
      "registered_schools.manage": true
    }
  },
};

const LEGACY_STUDENT_NAV_SETTINGS = {
  dashboard: "studentDashboardEnabled",
  profile: "studentProfileEnabled",
  results: "studentResultsEnabled",
  "report-card": "studentReportCardEnabled",
  "study-planner": "studentStudyPlannerEnabled",
  "exam-schedule": "studentExamScheduleEnabled",
  "live-tests": "studentLiveTestsEnabled",
  goals: "studentGoalsEnabled",
  selection: "studentSelectSchoolsEnabled",
  "my-selection": "studentMySelectionEnabled",
  predictor: "studentSelectionPortalEnabled",
  scholarships: "studentSelectionPortalEnabled",
  attendance: "studentAttendanceEnabled",
  "attendance-corrections": "studentAttendanceCorrectionsEnabled",
  fees: "studentFeesPortalEnabled",
  "pay-fees": "studentFeesPortalEnabled",
  "payment-plan": "studentFeesPortalEnabled",
  announcements: "studentAnnouncementsEnabled",
  "support-tickets": "studentSupportTicketsEnabled",
  chat: "studentChatEnabled",
  docs: "studentDocsEnabled",
  "upload-docs": "studentUploadDocsEnabled",
  resources: "studentResourcesEnabled",
  assignments: "studentAssignmentsEnabled",
  "calendar-sync": "studentCalendarSyncEnabled",
};

export function getStudentNavVisibility(config = {}) {
  const existingVisibility = config.studentNavVisibility || {};
  return Object.fromEntries(
    Object.entries(DEFAULT_SETTINGS.studentNavVisibility).map(([key, defaultValue]) => {
      if (Object.prototype.hasOwnProperty.call(existingVisibility, key)) {
        return [key, existingVisibility[key] !== false];
      }
      const legacyKey = LEGACY_STUDENT_NAV_SETTINGS[key];
      return [
        key,
        legacyKey && Object.prototype.hasOwnProperty.call(config, legacyKey)
          ? config[legacyKey] !== false
          : defaultValue,
      ];
    }),
  );
}

// Helper: check if user is at least admin (admin or super_admin)
export function isAtLeastAdmin(role) {
  const r = String(role || "").toLowerCase();
  return r === "admin" || r === "super_admin";
}

export const getGrade = (score) => {
  const numericScore = Number(score);
  if (score == null || !Number.isFinite(numericScore)) {
    return { grade: "-", color: "#94a3b8", bg: "#f1f5f9" };
  }
  if (numericScore >= 90) return { grade: "1", color: "#14532d", bg: "#dcfce7" };
  if (numericScore >= 80) return { grade: "2", color: "#166534", bg: "#ecfdf5" };
  if (numericScore >= 76) return { grade: "3", color: "#1e3a8a", bg: "#dbeafe" };
  if (numericScore >= 70) return { grade: "4", color: "#1e40af", bg: "#eff6ff" };
  if (numericScore >= 66) return { grade: "5", color: "#0c4a6e", bg: "#e0f2fe" };
  if (numericScore >= 60) return { grade: "6", color: "#78350f", bg: "#fef3c7" };
  if (numericScore >= 56) return { grade: "7", color: "#7c2d12", bg: "#ffedd5" };
  if (numericScore >= 50) return { grade: "8", color: "#9a3412", bg: "#fff7ed" };
  return { grade: "9", color: "#7f1d1d", bg: "#fee2e2" };
};

export const CORE_RESULT_SUBJECTS = [
  "English Language",
  "Mathematics",
  "Integrated Science",
  "Social Studies",
];

export function calculateSubjectAggregate(subjectScores = []) {
  const scoresBySubject = new Map();
  subjectScores.forEach(({ subject, score }) => {
    if (!subject || !Number.isFinite(Number(score))) return;
    const key = subject.trim().toLowerCase();
    if (!scoresBySubject.has(key)) {
      scoresBySubject.set(key, { subject: subject.trim(), scores: [] });
    }
    scoresBySubject.get(key).scores.push(Number(score));
  });

  const gradedSubjects = [...scoresBySubject.values()].map(
    ({ subject, scores }) => {
      const averageScore =
        scores.reduce((total, score) => total + score, 0) / scores.length;
      return {
        subject,
        score: averageScore,
        grade: Number(getGrade(averageScore).grade),
      };
    },
  );
  const coreSubjects = CORE_RESULT_SUBJECTS.map((requiredSubject) =>
    gradedSubjects.find(
      ({ subject }) => subject.toLowerCase() === requiredSubject.toLowerCase(),
    ),
  );
  const missingCoreSubjects = CORE_RESULT_SUBJECTS.filter(
    (requiredSubject) =>
      !gradedSubjects.some(
        ({ subject }) => subject.toLowerCase() === requiredSubject.toLowerCase(),
      ),
  );
  const bestElectives = gradedSubjects
    .filter(
      ({ subject }) =>
        !CORE_RESULT_SUBJECTS.some(
          (coreSubject) => coreSubject.toLowerCase() === subject.toLowerCase(),
        ),
    )
    .sort(
      (left, right) =>
        left.grade - right.grade ||
        right.score - left.score ||
        left.subject.localeCompare(right.subject),
    )
    .slice(0, 2);

  return {
    aggregate:
      missingCoreSubjects.length === 0 && bestElectives.length === 2
        ? [...coreSubjects, ...bestElectives].reduce(
            (total, subject) => total + subject.grade,
            0,
          )
        : null,
    coreSubjects: coreSubjects.filter(Boolean),
    bestElectives,
    missingCoreSubjects,
    missingElectives: Math.max(0, 2 - bestElectives.length),
  };
}