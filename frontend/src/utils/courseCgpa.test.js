import assert from "node:assert/strict";
import test from "node:test";
import { calculateRegisteredCourseCgpa, classifyUccCgpa } from "./courseCgpa.js";

test("classifies CGPA using UCC degree-class boundaries", () => {
  [
    ["4.00", "First Class"],
    ["3.60", "First Class"],
    ["3.59", "Second Class Upper"],
    ["3.00", "Second Class Upper"],
    ["2.99", "Second Class Lower"],
    ["2.50", "Second Class Lower"],
    ["2.49", "Third Class"],
    ["2.00", "Third Class"],
    ["1.99", "Pass"],
    ["1.00", "Pass"],
    ["0.99", "Keep Building"],
    ["0.00", "Keep Building"],
  ].forEach(([cgpa, expected]) => {
    assert.equal(classifyUccCgpa(cgpa), expected, `CGPA ${cgpa}`);
  });
  assert.equal(classifyUccCgpa(null), null);
  assert.equal(classifyUccCgpa(""), null);
  assert.equal(classifyUccCgpa("not-a-number"), null);
  assert.equal(classifyUccCgpa("4.01"), null);
});

test("uses each chapter's latest attempt and weights registered courses equally", () => {
  const result = calculateRegisteredCourseCgpa(
    [
      { courseId: "course-a", title: "Course A" },
      { courseId: "course-b", title: "Course B" },
      { courseId: "course-c", title: "Course C" },
    ],
    [
      {
        id: "initial-a1",
        course_id: "course-a",
        lesson_id: "lesson-1",
        attempt_type: "initial",
        correct_count: 1,
        total_questions: 2,
        percentage: 50,
        created_at: "2025-01-02T00:00:00Z",
      },
      {
        id: "resit-a1",
        course_id: "course-a",
        lesson_id: "lesson-1",
        attempt_type: "resit",
        resit_of_attempt_id: "initial-a1",
        correct_count: 1,
        total_questions: 1,
        percentage: 100,
        created_at: "2025-01-03T00:00:00Z",
      },
      {
        id: "initial-a2",
        course_id: "course-a",
        lesson_id: "lesson-2",
        attempt_type: "initial",
        correct_count: 2,
        total_questions: 5,
        percentage: 40,
        created_at: "2025-01-02T00:00:00Z",
      },
      {
        id: "initial-b1",
        course_id: "course-b",
        lesson_id: "lesson-1",
        attempt_type: "initial",
        correct_count: 4,
        total_questions: 5,
        percentage: 80,
        created_at: "2025-01-02T00:00:00Z",
      },
      {
        id: "initial-unregistered",
        course_id: "not-registered",
        lesson_id: "lesson-1",
        attempt_type: "initial",
        correct_count: 5,
        total_questions: 5,
        percentage: 100,
        created_at: "2025-01-03T00:00:00Z",
      },
    ],
  );

  assert.deepEqual(result, {
    cgpa: "3.50",
    gradedCourseCount: 2,
    registeredCourseCount: 3,
    courseGpas: [
      { courseId: "course-a", title: "Course A", gpa: "3.00" },
      { courseId: "course-b", title: "Course B", gpa: "4.00" },
      { courseId: "course-c", title: "Course C", gpa: null },
    ],
  });
});

test("does not produce a CGPA when registered courses have no valid quiz attempts", () => {
  const result = calculateRegisteredCourseCgpa(
    [{ courseId: "course-a" }],
    [
      { course_id: "course-a", lesson_id: "lesson-1", percentage: 120, created_at: "2025-01-01T00:00:00Z" },
      { course_id: "not-registered", lesson_id: "lesson-2", percentage: 90, created_at: "2025-01-02T00:00:00Z" },
    ],
  );

  assert.deepEqual(result, {
    cgpa: null,
    gradedCourseCount: 0,
    registeredCourseCount: 1,
    courseGpas: [{ courseId: "course-a", title: "Course", gpa: null }],
  });
});

test("uses completed chapters out of the total to calculate GPA and chapter-weighted CGPA", () => {
  const result = calculateRegisteredCourseCgpa(
    [
      {
        courseId: "course-a",
        title: "Course A",
        totalLessons: 4,
        completedCount: 2,
        completedLessonIds: ["lesson-1", "lesson-2"],
      },
      {
        courseId: "course-b",
        title: "Course B",
        totalLessons: 2,
        completedCount: 1,
        completedLessonIds: ["lesson-1"],
      },
    ],
    [
      { course_id: "course-a", lesson_id: "lesson-1", percentage: 100, created_at: "2025-01-02T00:00:00Z" },
      { course_id: "course-a", lesson_id: "lesson-2", percentage: 70, created_at: "2025-01-02T00:00:00Z" },
      { course_id: "course-a", lesson_id: "lesson-3", percentage: 100, created_at: "2025-01-02T00:00:00Z" },
      { course_id: "course-b", lesson_id: "lesson-1", percentage: 80, created_at: "2025-01-02T00:00:00Z" },
    ],
  );

  assert.deepEqual(result, {
    cgpa: "1.83",
    gradedCourseCount: 2,
    registeredCourseCount: 2,
    courseGpas: [
      { courseId: "course-a", title: "Course A", gpa: "1.75" },
      { courseId: "course-b", title: "Course B", gpa: "2.00" },
    ],
  });
});
