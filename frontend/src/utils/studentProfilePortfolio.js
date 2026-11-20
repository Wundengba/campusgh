import { calculateRegisteredCourseCgpa } from "./courseCgpa.js";

export const DEFAULT_STUDENT_PROFILE_PORTFOLIO = Object.freeze({
  goal_title: "",
  goal_type: "chapters",
  goal_target: null,
  goal_due_date: "",
  skills: [],
  projects: [],
  share_goal: false,
  share_skills: false,
  share_projects: false,
  share_achievements: false,
  share_institution: false,
  share_education_level: false,
  share_public: false,
});

export const normalizeStudentProfileSkills = (value) => {
  const entries = Array.isArray(value) ? value : String(value || "").split(",");
  const skills = [];
  const seen = new Set();
  entries.forEach((entry) => {
    const skill = String(entry || "").trim();
    if (!skill) return;
    if (skill.length > 32) throw new Error("Keep each skill to 32 characters or fewer.");
    const key = skill.toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      skills.push(skill);
    }
  });
  if (skills.length > 8) throw new Error("Add up to eight skills.");
  return skills;
};

const normalizeProjectUrl = (value) => {
  const url = String(value || "").trim();
  if (!url) return "";
  if (url.length > 2048) throw new Error("Project links must be 2,048 characters or fewer.");
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Enter a valid project link beginning with http:// or https://.");
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
    throw new Error("Project links must use http:// or https:// and cannot contain credentials.");
  }
  return parsedUrl.toString();
};

export const normalizeStudentProfileProjects = (value) => {
  if (!Array.isArray(value)) throw new Error("Projects must be a list.");
  if (value.length > 5) throw new Error("Add up to five projects.");
  return value.map((project) => {
    const title = String(project?.title || "").trim();
    const description = String(project?.description || "").trim();
    if (!title) throw new Error("Each project needs a title.");
    if (title.length > 80) throw new Error("Project titles must be 80 characters or fewer.");
    if (description.length > 280) throw new Error("Project descriptions must be 280 characters or fewer.");
    return {
      title,
      description,
      url: normalizeProjectUrl(project?.url),
    };
  });
};

export const buildStudentCoursePortfolio = ({
  enrollments = [],
  courses = [],
  completedProgress = [],
  certificates = [],
  quizAttempts = [],
} = {}) => {
  const coursesById = new Map(courses.map((course) => [String(course.id), course]));
  const lessonsByEnrollment = new Map();
  completedProgress.forEach((row) => {
    if (!row?.enrollment_id || !row?.lesson_id) return;
    const completed = lessonsByEnrollment.get(row.enrollment_id) || new Set();
    completed.add(String(row.lesson_id));
    lessonsByEnrollment.set(row.enrollment_id, completed);
  });
  const certificatesByEnrollment = new Map(
    certificates
      .filter((certificate) => certificate?.enrollment_id)
      .map((certificate) => [certificate.enrollment_id, certificate]),
  );
  const registeredCourses = enrollments.map((enrollment) => {
    const course = coursesById.get(String(enrollment.course_id));
    const validLessons = (Array.isArray(course?.lessons) ? course.lessons : [])
      .filter((lesson) => String(lesson?.id || "").trim());
    const completedLessonIds = [...(lessonsByEnrollment.get(enrollment.id) || [])]
      .filter((lessonId) => validLessons.some((lesson) => String(lesson.id) === lessonId));
    const certificate = certificatesByEnrollment.get(enrollment.id);
    return {
      courseId: enrollment.course_id,
      title: course?.title || certificate?.course_title || "Course",
      totalLessons: validLessons.length,
      completedCount: completedLessonIds.length,
      completedLessonIds,
      certificate,
    };
  });
  const gpa = calculateRegisteredCourseCgpa(registeredCourses, quizAttempts);
  const completedChapters = registeredCourses
    .reduce((total, course) => total + course.completedCount, 0);
  const totalChapters = registeredCourses
    .reduce((total, course) => total + course.totalLessons, 0);
  const certificateRows = [...certificatesByEnrollment.values()]
    .sort((left, right) => Date.parse(right.issued_at) - Date.parse(left.issued_at));

  return {
    courses: registeredCourses,
    certificates: certificateRows,
    completedCourses: certificateRows.length,
    completedChapters,
    totalChapters,
    cgpa: gpa.cgpa,
  };
};

export const calculateProfileGoalProgress = (goal, metrics) => {
  const target = Number(goal?.goal_target);
  if (!Number.isFinite(target) || target <= 0) return null;
  const currentValue = goal?.goal_type === "cgpa"
    ? metrics?.cgpa
    : goal?.goal_type === "courses"
      ? metrics?.completedCourses
      : goal?.goal_type === "chapters"
        ? metrics?.completedChapters
        : null;
  if (currentValue === null || currentValue === undefined || currentValue === "") return null;
  const current = Number(currentValue);
  if (!Number.isFinite(current) || current < 0) return null;
  return {
    current,
    target,
    percentage: Math.min(100, Math.round((current / target) * 100)),
  };
};

export const getStudentProfileCompletenessItems = (
  student,
  schoolLinkedStudent = true,
  fallbackName = "",
) => {
  const items = [
    { key: "full_name", label: "Full name", value: student?.full_name || fallbackName, editable: false },
    { key: "student_id", label: "Student ID", value: student?.index || student?.index_number, editable: false },
    { key: "education_level", label: "Education level", value: student?.class, editable: true },
    ...(schoolLinkedStudent
      ? [{ key: "institution", label: "School or institution", value: student?.institution, editable: true }]
      : []),
    { key: "region", label: "Region", value: student?.region, editable: true },
    { key: "district", label: "District", value: student?.district, editable: true },
    { key: "gender", label: "Gender", value: student?.gender, editable: false },
    { key: "date_of_birth", label: "Date of birth", value: student?.date_of_birth, editable: false },
    { key: "contact_email", label: "Contact email", value: student?.contact_email, editable: true },
    { key: "personal_contact", label: "Phone number", value: student?.personal_contact, editable: true },
  ];
  return items.map((item) => ({
    ...item,
    complete: String(item.value || "").trim() !== "",
  }));
};
