import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStudentCoursePortfolio,
  calculateProfileGoalProgress,
  getStudentProfileCompletenessItems,
  normalizeStudentProfileProjects,
  normalizeStudentProfileSkills,
} from "./studentProfilePortfolio.js";

test("normalizes profile skills without duplicates and enforces the limit", () => {
  assert.deepEqual(normalizeStudentProfileSkills("Design, football, DESIGN"), ["Design", "football"]);
  assert.throws(
    () => normalizeStudentProfileSkills("one, two, three, four, five, six, seven, eight, nine"),
    /up to eight skills/,
  );
  assert.throws(() => normalizeStudentProfileSkills("x".repeat(33)), /32 characters or fewer/);
});

test("validates project titles and allows only safe web URLs", () => {
  assert.deepEqual(normalizeStudentProfileProjects([{
    title: "Science fair",
    description: "A student project",
    url: "https://example.com/project",
  }]), [{
    title: "Science fair",
    description: "A student project",
    url: "https://example.com/project",
  }]);
  assert.throws(
    () => normalizeStudentProfileProjects([{ title: "Unsafe", url: "javascript:alert(1)" }]),
    /http:\/\/ or https:\/\//,
  );
  assert.throws(() => normalizeStudentProfileProjects([{ description: "No title" }]), /needs a title/);
});

test("builds course portfolio counts and a chapter-weighted CGPA from saved progress", () => {
  const portfolio = buildStudentCoursePortfolio({
    enrollments: [
      { id: "enrollment-1", course_id: "course-1" },
      { id: "enrollment-2", course_id: "course-2" },
    ],
    courses: [
      { id: "course-1", title: "Biology", lessons: [{ id: "one" }, { id: "two" }] },
      { id: "course-2", title: "Chemistry", lessons: [{ id: "three" }] },
    ],
    completedProgress: [
      { enrollment_id: "enrollment-1", lesson_id: "one" },
      { enrollment_id: "enrollment-1", lesson_id: "one" },
      { enrollment_id: "enrollment-2", lesson_id: "three" },
    ],
    certificates: [
      { id: "certificate-1", enrollment_id: "enrollment-2", course_title: "Chemistry", issued_at: "2026-01-02" },
    ],
    quizAttempts: [
      { id: "attempt-1", course_id: "course-1", lesson_id: "one", percentage: 85, created_at: "2026-01-01" },
      { id: "attempt-2", course_id: "course-2", lesson_id: "three", percentage: 75, created_at: "2026-01-01" },
    ],
  });

  assert.equal(portfolio.completedCourses, 1);
  assert.equal(portfolio.completedChapters, 2);
  assert.equal(portfolio.totalChapters, 3);
  assert.equal(portfolio.cgpa, "2.33");
  assert.equal(portfolio.courses[1].certificate.id, "certificate-1");
});

test("calculates clamped goal progress and leaves unavailable metrics untracked", () => {
  assert.deepEqual(
    calculateProfileGoalProgress(
      { goal_type: "chapters", goal_target: 10 },
      { completedChapters: 12 },
    ),
    { current: 12, target: 10, percentage: 100 },
  );
  assert.equal(
    calculateProfileGoalProgress({ goal_type: "cgpa", goal_target: 3.5 }, { cgpa: null }),
    null,
  );
});

test("marks administrator-managed and editable profile completeness fields", () => {
  const items = getStudentProfileCompletenessItems({
    full_name: "Ama Mensah",
    index: "CG-123",
    class: "",
    contact_email: "ama@example.com",
  });

  assert.equal(items.find((item) => item.key === "full_name").editable, false);
  assert.equal(items.find((item) => item.key === "education_level").editable, true);
  assert.equal(items.find((item) => item.key === "contact_email").complete, true);
  assert.equal(items.some((item) => item.key === "institution"), true);
});
