const scoreToGradePoints = (score) => {
  if (score >= 80) return 4;
  if (score >= 70) return 3;
  if (score >= 60) return 2;
  if (score >= 50) return 1;
  return 0;
};

export const classifyUccCgpa = (cgpa) => {
  if (cgpa === null || cgpa === undefined || cgpa === "") return null;
  const value = Number(cgpa);
  if (!Number.isFinite(value) || value < 0 || value > 4) return null;
  if (value >= 3.6) return "First Class";
  if (value >= 3.0) return "Second Class Upper";
  if (value >= 2.5) return "Second Class Lower";
  if (value >= 2.0) return "Third Class";
  if (value >= 1.0) return "Pass";
  return "Keep Building";
};

export const calculateRegisteredCourseCgpa = (registeredCourses, quizAttempts) => {
  const registeredCourseRecords = new Map();
  (Array.isArray(registeredCourses) ? registeredCourses : []).forEach((course) => {
    const courseId = String(course?.courseId ?? "").trim();
    if (courseId && !registeredCourseRecords.has(courseId)) {
      registeredCourseRecords.set(courseId, course);
    }
  });
  const quizAttemptRows = Array.isArray(quizAttempts) ? quizAttempts : [];
  const attemptsById = new Map(quizAttemptRows
    .filter((attempt) => attempt?.id)
    .map((attempt) => [String(attempt.id), attempt]));
  const latestAttemptsByCourseLesson = new Map();

  quizAttemptRows.forEach((attempt) => {
    const courseId = String(attempt?.course_id ?? "").trim();
    const lessonId = String(attempt?.lesson_id ?? "").trim();
    if (!registeredCourseRecords.has(courseId) || !lessonId) return;

    let percentage = Number(attempt?.percentage);
    if (attempt?.attempt_type === "resit") {
      const initialAttempt = attemptsById.get(String(attempt.resit_of_attempt_id ?? ""));
      const initialCorrectCount = Number(initialAttempt?.correct_count);
      const resitCorrectCount = Number(attempt.correct_count);
      const initialQuestionCount = Number(initialAttempt?.total_questions);
      const resitQuestionCount = Number(attempt.total_questions);
      if (!initialAttempt
        || initialAttempt.attempt_type !== "initial"
        || String(initialAttempt.course_id) !== courseId
        || String(initialAttempt.lesson_id) !== lessonId
        || !Number.isInteger(initialCorrectCount)
        || !Number.isInteger(resitCorrectCount)
        || !Number.isInteger(initialQuestionCount)
        || !Number.isInteger(resitQuestionCount)
        || initialQuestionCount <= 0
        || resitQuestionCount <= 0
        || initialCorrectCount < 0
        || resitCorrectCount < 0
        || initialCorrectCount > initialQuestionCount
        || resitCorrectCount > resitQuestionCount
        || resitQuestionCount > initialQuestionCount) return;
      percentage = Math.round(
        ((initialCorrectCount + resitCorrectCount) / initialQuestionCount) * 100,
      );
    }
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) return;

    const key = JSON.stringify([courseId, lessonId]);
    const previousAttempt = latestAttemptsByCourseLesson.get(key);
    const attemptTime = Date.parse(attempt.created_at);
    const previousAttemptTime = Date.parse(previousAttempt?.created_at);
    if (!previousAttempt
      || (Number.isFinite(attemptTime)
        && (!Number.isFinite(previousAttemptTime) || attemptTime > previousAttemptTime))) {
      latestAttemptsByCourseLesson.set(key, {
        courseId,
        lessonId,
        percentage,
        created_at: attempt.created_at,
      });
    }
  });

  const courseAttempts = new Map();
  latestAttemptsByCourseLesson.forEach(({ courseId, lessonId, percentage }) => {
    const current = courseAttempts.get(courseId) || [];
    current.push({ lessonId, percentage });
    courseAttempts.set(courseId, current);
  });

  const courseGpas = [...registeredCourseRecords.entries()].map(([courseId, course]) => {
    const attempts = courseAttempts.get(courseId) || [];
    const totalChapters = Number(course.totalLessons);
    const hasChapterCount = Number.isInteger(totalChapters) && totalChapters > 0;
    const completedChapterIds = Array.isArray(course.completedLessonIds)
      ? new Set(course.completedLessonIds.map((lessonId) => String(lessonId)))
      : null;
    const chapterGradePoints = attempts.map(({ percentage }) => scoreToGradePoints(percentage));

    let gpa = null;
    let cgpaWeight = 1;
    if (attempts.length && hasChapterCount) {
      const completedCount = Math.min(
        totalChapters,
        Math.max(0, Number(course.completedCount) || 0),
      );
      cgpaWeight = totalChapters;

      if (completedChapterIds) {
        const completedGradePointTotal = attempts
          .filter(({ lessonId }) => completedChapterIds.has(lessonId))
          .reduce((total, { percentage }) => total + scoreToGradePoints(percentage), 0);
        gpa = (completedGradePointTotal / totalChapters).toFixed(2);
      } else {
        const averageGradePoints = chapterGradePoints.reduce((total, points) => total + points, 0)
          / chapterGradePoints.length;
        gpa = (averageGradePoints * completedCount / totalChapters).toFixed(2);
      }
    } else if (attempts.length) {
      const averagePercentage = attempts.reduce((total, attempt) => total + attempt.percentage, 0)
        / attempts.length;
      gpa = scoreToGradePoints(averagePercentage).toFixed(2);
    }

    return {
      courseId,
      title: course.title || "Course",
      gpa,
      cgpaWeight,
    };
  });
  const courseGradePoints = courseGpas
    .filter((course) => course.gpa !== null)
    .map((course) => ({
      gradePoints: Number(course.gpa),
      weight: course.cgpaWeight,
    }));
  return {
    cgpa: courseGradePoints.length
      ? (courseGradePoints.reduce((total, course) => total + course.gradePoints * course.weight, 0)
        / courseGradePoints.reduce((total, course) => total + course.weight, 0)).toFixed(2)
      : null,
    gradedCourseCount: courseGradePoints.length,
    registeredCourseCount: registeredCourseRecords.size,
    courseGpas: courseGpas.map(({ cgpaWeight, ...course }) => course),
  };
};
