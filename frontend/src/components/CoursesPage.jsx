import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { getLearningLevelFromClass, LEARNING_LEVELS } from "../config/learningCatalog.js";
import { extractDocumentContent, getDocumentTitle } from "../utils/documentImport.js";
import "./CoursesPage.css";

const COURSE_IMAGES_BUCKET = "course-images";
const IMAGE_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGES_PER_IMPORT = 80;
const MAX_IMAGE_BYTES_PER_IMPORT = 20 * 1024 * 1024;

const LEVEL_OPTIONS = [
  { key: "all", name: "All education levels" },
  ...LEARNING_LEVELS.map(({ key, name }) => ({ key, name })),
];

const createId = (prefix) =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

const newQuizQuestion = () => ({
  id: createId("question"),
  prompt: "",
  options: [
    { id: createId("option"), text: "" },
    { id: createId("option"), text: "" },
  ],
  correctOptionId: "",
});

const normalizeQuizQuestion = (question) => ({
  id: typeof question?.id === "string" ? question.id : createId("question"),
  prompt: typeof question?.prompt === "string" ? question.prompt : "",
  options: Array.isArray(question?.options)
    ? question.options.map((option) => ({
        id: typeof option?.id === "string" ? option.id : createId("option"),
        text: typeof option?.text === "string" ? option.text : "",
      }))
    : [],
  correctOptionId: typeof question?.correctOptionId === "string" ? question.correctOptionId : "",
});

const newLesson = () => ({
  id: globalThis.crypto?.randomUUID?.() || `lesson-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  title: "",
  content: "",
  quiz: [],
});

const levelName = (level) =>
  LEVEL_OPTIONS.find((option) => option.key === level)?.name || "All education levels";

const getQuizQuestionError = (question) => {
  const prompt = typeof question?.prompt === "string" ? question.prompt.trim() : "";
  const options = Array.isArray(question?.options)
    ? question.options.filter((option) => typeof option?.text === "string" && option.text.trim())
    : [];
  if (!prompt) return "Add a question prompt.";
  if (options.length < 2) return "Add at least two answer choices.";
  if (!options.some((option) => option.id === question.correctOptionId)) {
    return "Mark one answer choice as correct.";
  }
  return "";
};

const courseDescription = (description, fallback) => {
  const cleanDescription = typeof description === "string" ? description.trim() : "";
  if (!cleanDescription || /^imported from\s+.+$/i.test(cleanDescription)) return fallback;
  return cleanDescription;
};

function QuizEditor({ questions = [], disabled = false, onChange }) {
  const updateQuestion = (questionId, change) => onChange(
    questions.map((question) => question.id === questionId ? { ...question, ...change } : question),
  );
  return (
    <fieldset className="courses-quiz-editor" disabled={disabled}>
      <legend>Optional lesson practice quiz</legend>
      <p>Write multiple-choice questions for practice. Scores are not saved and should not be used for formal assessment.</p>
      {questions.map((question, questionIndex) => (
        <section className="courses-quiz-question-editor" key={question.id}>
          <div className="courses-quiz-question-heading">
            <strong>Question {questionIndex + 1}</strong>
            <button className="btn btn-outline" type="button" aria-label={`Remove quiz question ${questionIndex + 1}`}
              onClick={() => onChange(questions.filter((item) => item.id !== question.id))}>
              Remove
            </button>
          </div>
          <label>Question
            <textarea className="form-control" rows="2" value={question.prompt}
              onChange={(event) => updateQuestion(question.id, { prompt: event.target.value })} />
          </label>
          <div className="courses-quiz-options">
            {question.options.map((option, optionIndex) => (
              <label className="courses-quiz-option-editor" key={option.id}>
                <span>Choice {optionIndex + 1}</span>
                <input className="form-control" value={option.text}
                  onChange={(event) => updateQuestion(question.id, {
                    options: question.options.map((item) => item.id === option.id
                      ? { ...item, text: event.target.value }
                      : item),
                  })} />
                <span className="courses-quiz-correct-choice">
                  <input type="radio" name={`correct-${question.id}`}
                    checked={question.correctOptionId === option.id}
                    disabled={!option.text.trim()}
                    onChange={() => updateQuestion(question.id, { correctOptionId: option.id })} />
                  Correct answer
                </span>
                <button className="btn btn-outline courses-delete" type="button"
                  aria-label={`Remove choice ${optionIndex + 1} from question ${questionIndex + 1}`}
                  disabled={question.options.length <= 2}
                  onClick={() => updateQuestion(question.id, {
                    options: question.options.filter((item) => item.id !== option.id),
                    correctOptionId: question.correctOptionId === option.id ? "" : question.correctOptionId,
                  })}>
                  Remove choice
                </button>
              </label>
            ))}
          </div>
          <button className="btn btn-outline" type="button" disabled={question.options.length >= 6}
            onClick={() => updateQuestion(question.id, {
              options: [...question.options, { id: createId("option"), text: "" }],
            })}>
            Add answer choice
          </button>
        </section>
      ))}
      <button className="btn btn-outline" type="button"
        onClick={() => onChange([...questions, newQuizQuestion()])}>
        Add quiz question
      </button>
    </fieldset>
  );
}

function CourseCover({ course, imageUrls }) {
  const imagePath = course.cover_image_path;
  const imageUrl = course.coverImage?.previewUrl
    || (imagePath && imageUrls?.[imagePath]) || "";
  const subject = course.subject?.trim() || levelName(course.education_level);
  return (
    <div className={`courses-cover ${imageUrl ? "has-image" : `courses-cover-${course.education_level || "all"}`}`}
      role="img" aria-label={`${course.title || "Course"} cover${subject ? `: ${subject}` : ""}`}>
      {!imageUrl && (
        <div className="courses-cover-artwork" aria-hidden="true">
          <span className="courses-cover-orbit courses-cover-orbit-one" />
          <span className="courses-cover-orbit courses-cover-orbit-two" />
          <span className="courses-cover-mark">{(course.subject || course.title || "C").trim().charAt(0).toUpperCase()}</span>
        </div>
      )}
      {imageUrl && <img src={imageUrl} alt="" loading="lazy" />}
      <div className="courses-cover-caption">
        <span>{subject}</span>
        <strong>{course.title || "Course cover"}</strong>
      </div>
    </div>
  );
}

function CourseImageGallery({ images = [], imageUrls, onRemove }) {
  if (!Array.isArray(images) || !images.length) return null;
  return (
    <div className="courses-image-gallery" aria-label="Course illustrations">
      {images.map((image, index) => {
        const url = image.previewUrl || (image.path && imageUrls?.[image.path]) || "";
        return url && (
          <figure key={image.path || image.previewUrl || `${image.alt}-${index}`}>
            <img src={url} alt={image.alt || `Course illustration ${index + 1}`} loading="lazy" />
            {image.caption && <figcaption>{image.caption}</figcaption>}
            {onRemove && (
              <button className="courses-image-remove" type="button" onClick={() => onRemove(image)}>
                Remove image
              </button>
            )}
          </figure>
        );
      })}
    </div>
  );
}

const getCourseImagePaths = (course) => [
  course.cover_image_path,
  ...(Array.isArray(course.lessons) ? course.lessons : []).flatMap((lesson) =>
    (Array.isArray(lesson?.images) ? lesson.images : []).map((image) => image?.path)),
].filter((path, index, paths) => path && paths.indexOf(path) === index);

const importedCourseTitle = (fileName) =>
  getDocumentTitle(fileName)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());

const courseProgress = (course, completedLessons) => {
  const lessonCount = course.lessons?.length || 0;
  if (!lessonCount) return 0;
  return Math.round(
    (course.lessons.filter((lesson) => completedLessons.has(lesson.id)).length / lessonCount) * 100,
  );
};

const createCourseDraft = (course) => ({
  title: typeof course?.title === "string" ? course.title : "",
  description: typeof course?.description === "string" ? course.description : "",
  subject: typeof course?.subject === "string" ? course.subject : "",
  is_published: typeof course?.is_published === "boolean" ? course.is_published : true,
  coverImage: null,
  lessons: Array.isArray(course?.lessons)
    ? course.lessons.map((lesson) => ({
        id: newLesson().id,
        title: typeof lesson?.title === "string" ? lesson.title : "",
        content: typeof lesson?.content === "string" ? lesson.content : "",
        images: [],
        quiz: Array.isArray(lesson?.quiz) ? lesson.quiz.map(normalizeQuizQuestion) : [],
      }))
    : [],
});

const reviewCourseDraft = (course, existingTitles, seenTitles) => {
  const errors = [];
  const warnings = [];
  const title = course.title.trim();
  const lessonTitles = new Set();
  if (!title) errors.push("Course title is required.");
  if (!course.lessons.length) errors.push("Add at least one lesson.");

  course.lessons.forEach((lesson, index) => {
    if (!lesson.title.trim() || !lesson.content.trim()) {
      errors.push(`Lesson ${index + 1} needs a title and learning content.`);
    } else {
      if (lesson.content.trim().length < 40) {
        warnings.push(`Lesson ${index + 1} content is brief; review it for completeness.`);
      }
      const lessonTitle = lesson.title.trim().toLowerCase();
      if (lessonTitles.has(lessonTitle)) {
        warnings.push(`Lesson title "${lesson.title.trim()}" is repeated.`);
      }
      lessonTitles.add(lessonTitle);
    }
    (lesson.quiz || []).forEach((question, questionIndex) => {
      const questionError = getQuizQuestionError(question);
      if (questionError) errors.push(`Lesson ${index + 1}, quiz question ${questionIndex + 1}: ${questionError}`);
    });
  });

  if (title && (existingTitles.has(title.toLowerCase()) || seenTitles.has(title.toLowerCase()))) {
    warnings.push(`Another course is already named "${title}".`);
  }
  if (!course.description.trim()) warnings.push("Course description is empty.");
  if (title) seenTitles.add(title.toLowerCase());
  return { errors, warnings };
};

export default function CoursesPage({ mode, studentData }) {
  const isAdmin = mode === "admin";
  const studentId = studentData?.id;
  const inferredLevel = getLearningLevelFromClass(
    studentData?.class || studentData?.class_name || "",
  );
  const [courses, setCourses] = useState([]);
  const [courseImageUrls, setCourseImageUrls] = useState({});
  const [enrollments, setEnrollments] = useState([]);
  const [completedByEnrollment, setCompletedByEnrollment] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [importEducationLevel, setImportEducationLevel] = useState(inferredLevel || "all");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [levelFilter, setLevelFilter] = useState(inferredLevel || "all");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [progressFilter, setProgressFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [editingCourse, setEditingCourse] = useState(null);
  const [activeCourseId, setActiveCourseId] = useState("");
  const [activeLessonId, setActiveLessonId] = useState("");
  const [quizAnswers, setQuizAnswers] = useState({});
  const [quizResults, setQuizResults] = useState({});
  const previewObjectUrls = useRef(new Set());

  const releasePreviewObjectUrls = () => {
    previewObjectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    previewObjectUrls.current.clear();
  };
  const createImageAsset = (blob, name, alt, contentType = blob.type) => {
    const previewUrl = URL.createObjectURL(blob);
    previewObjectUrls.current.add(previewUrl);
    return { blob, name, alt, contentType, previewUrl };
  };

  useEffect(() => () => {
    previewObjectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    previewObjectUrls.current.clear();
  }, []);

  const loadCourses = useCallback(async () => {
    if (!supabase) {
      setError("Courses are unavailable because Supabase is not configured.");
      setCourses([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const { data: courseRows, error: courseError } = await supabase
        .from("courses")
        .select("*")
        .order("created_at", { ascending: false });
      if (courseError) throw courseError;
      setCourses(courseRows || []);

      if (!isAdmin && studentId) {
        const { data: enrollmentRows, error: enrollmentError } = await supabase
          .from("course_enrollments")
          .select("id, course_id, enrolled_at")
          .eq("student_id", studentId)
          .order("enrolled_at", { ascending: false });
        if (enrollmentError) throw enrollmentError;
        const nextEnrollments = enrollmentRows || [];
        setEnrollments(nextEnrollments);

        if (nextEnrollments.length) {
          const progressResponse = await supabase
            .from("course_lesson_progress")
            .select("enrollment_id, lesson_id")
            .in("enrollment_id", nextEnrollments.map((enrollment) => enrollment.id));
          if (progressResponse.error) throw progressResponse.error;
          const progress = {};
          (progressResponse.data || []).forEach(({ enrollment_id, lesson_id }) => {
            (progress[enrollment_id] ||= new Set()).add(lesson_id);
          });
          setCompletedByEnrollment(progress);
        } else {
          setCompletedByEnrollment({});
        }
      }
    } catch (loadError) {
      setError(`Courses could not be loaded: ${loadError.message || "Supabase request failed."}`);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, studentId]);

  useEffect(() => {
    loadCourses();
  }, [loadCourses]);

  useEffect(() => {
    if (!supabase || !courses.length) {
      setCourseImageUrls({});
      return undefined;
    }

    let cancelled = false;
    const imagePaths = [...new Set(courses.flatMap((course) => getCourseImagePaths(course)))];
    if (!imagePaths.length) {
      setCourseImageUrls({});
      return undefined;
    }
    supabase.storage.from(COURSE_IMAGES_BUCKET).createSignedUrls(imagePaths, 86400)
      .then(({ data, error: imageError }) => {
        if (cancelled) return;
        if (imageError) {
          setError(`Course images could not be loaded: ${imageError.message}`);
          return;
        }
        const signedImages = (data || []).filter((item) => item.path && item.signedUrl);
        if (signedImages.length !== imagePaths.length) {
          setError("Some course images could not be opened. Check the course-images migration and storage permissions.");
        }
        setCourseImageUrls(Object.fromEntries(
          signedImages
            .map((item) => [item.path, item.signedUrl]),
        ));
      })
      .catch((imageError) => {
        if (!cancelled) {
          setError(`Course images could not be loaded: ${imageError.message || "Storage request failed."}`);
        }
      });
    return () => { cancelled = true; };
  }, [courses]);

  const enrollmentByCourse = useMemo(
    () => new Map(enrollments.map((enrollment) => [enrollment.course_id, enrollment])),
    [enrollments],
  );
  const visibleCourses = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filteredCourses = courses.filter((course) => {
      if (!isAdmin && !course.is_published) return false;
      const matchesLevel = levelFilter === "all" || course.education_level === "all"
        || course.education_level === levelFilter;
      const matchesSubject = subjectFilter === "all" || course.subject?.trim() === subjectFilter;
      const lessonText = (course.lessons || []).flatMap((lesson) => [
        lesson.title,
        lesson.content,
        ...(Array.isArray(lesson.quiz) ? lesson.quiz.map((question) => question.prompt) : []),
      ]).join(" ");
      const matchesSearch = !query
        || `${course.title} ${course.description} ${course.subject} ${lessonText}`.toLowerCase().includes(query);
      if (!matchesLevel || !matchesSubject || !matchesSearch) return false;
      if (isAdmin || progressFilter === "all") return true;

      const enrollment = enrollmentByCourse.get(course.id);
      if (progressFilter === "not_enrolled") return !enrollment;
      if (!enrollment) return false;
      const progress = courseProgress(course, completedByEnrollment[enrollment.id] || new Set());
      if (progressFilter === "completed") return progress === 100;
      if (progressFilter === "not_started") return progress === 0;
      return progress > 0 && progress < 100;
    });
    return filteredCourses.sort((courseA, courseB) => {
      if (sortBy === "title_asc") return courseA.title.localeCompare(courseB.title);
      if (sortBy === "title_desc") return courseB.title.localeCompare(courseA.title);
      if (sortBy === "lessons_desc") return (courseB.lessons?.length || 0) - (courseA.lessons?.length || 0);
      const dateA = Date.parse(courseA.created_at || "") || 0;
      const dateB = Date.parse(courseB.created_at || "") || 0;
      return sortBy === "oldest" ? dateA - dateB : dateB - dateA;
    });
  }, [courses, isAdmin, levelFilter, progressFilter, search, sortBy, subjectFilter, enrollmentByCourse, completedByEnrollment]);
  const subjectOptions = useMemo(
    () => [...new Set(courses
      .filter((course) => isAdmin || course.is_published)
      .map((course) => course.subject?.trim())
      .filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [courses, isAdmin],
  );
  const studentProgress = useMemo(() => {
    const enrolledCourses = courses.filter((course) =>
      !isAdmin && course.is_published && enrollmentByCourse.has(course.id));
    const progressValues = enrolledCourses.map((course) => {
      const enrollment = enrollmentByCourse.get(course.id);
      return courseProgress(course, completedByEnrollment[enrollment.id] || new Set());
    });
    const completed = progressValues.filter((progress) => progress === 100).length;
    const notStarted = progressValues.filter((progress) => progress === 0).length;
    return {
      enrolled: enrolledCourses.length,
      completed,
      notStarted,
      inProgress: enrolledCourses.length - completed - notStarted,
      average: enrolledCourses.length
        ? Math.round(progressValues.reduce((total, progress) => total + progress, 0) / enrolledCourses.length)
        : 0,
    };
  }, [courses, isAdmin, enrollmentByCourse, completedByEnrollment]);
  const importPreviewRows = useMemo(() => {
    const existingTitles = new Set(courses.map((course) => course.title.trim().toLowerCase()));
    const seenTitles = new Set();
    return (importPreview?.drafts || []).map((entry) => ({
      ...entry,
      ...reviewCourseDraft(entry.course, existingTitles, seenTitles),
    }));
  }, [courses, importPreview]);

  const activeCourse = courses.find((course) => course.id === activeCourseId);
  const activeEnrollment = activeCourse && enrollmentByCourse.get(activeCourse.id);
  const activeCompleted = activeEnrollment
    ? completedByEnrollment[activeEnrollment.id] || new Set()
    : new Set();
  const activeLesson = activeCourse?.lessons?.find((lesson) => lesson.id === activeLessonId);
  const activeQuizResult = activeLesson && quizResults[activeLesson.id];
  const activeQuizAnswers = activeLesson && quizAnswers[activeLesson.id] || {};

  useEffect(() => {
    if (!activeCourse || activeLessonId || isAdmin) return;
    const firstLessonId = activeCourse.lessons?.[0]?.id;
    if (firstLessonId) setActiveLessonId(firstLessonId);
  }, [activeCourse, activeLessonId, isAdmin]);

  const startNewCourse = () => setEditingCourse({
    id: "",
    title: "",
    description: "",
    subject: "",
    education_level: "all",
    is_published: true,
    lessons: [newLesson()],
  });

  const saveCourse = async (event) => {
    event.preventDefault();
    if (!supabase || !editingCourse) return;
    const lessons = (editingCourse.lessons || [])
      .map((lesson) => ({ ...lesson, title: lesson.title.trim(), content: lesson.content.trim() }))
      .filter((lesson) => lesson.title && lesson.content);
    if (!editingCourse.title.trim()) {
      setError("Enter a course title.");
      return;
    }
    if (lessons.length !== editingCourse.lessons.length) {
      setError("Give every lesson a title and learning content, or remove the empty lesson.");
      return;
    }
    if (!lessons.length) {
      setError("Add at least one lesson before saving the course.");
      return;
    }
    const invalidQuiz = lessons.flatMap((lesson, lessonIndex) =>
      (lesson.quiz || []).map((question, questionIndex) => ({
        lessonIndex,
        questionIndex,
        message: getQuizQuestionError(question),
      })).filter((question) => question.message))[0];
    if (invalidQuiz) {
      setError(`Lesson ${invalidQuiz.lessonIndex + 1}, quiz question ${invalidQuiz.questionIndex + 1}: ${invalidQuiz.message}`);
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    let imageCleanupError = null;
    try {
      const payload = {
        title: editingCourse.title.trim(),
        description: editingCourse.description.trim(),
        subject: editingCourse.subject.trim(),
        education_level: editingCourse.education_level,
        is_published: editingCourse.is_published,
        lessons,
        updated_at: new Date().toISOString(),
      };
      const result = editingCourse.id
        ? await supabase.from("courses").update(payload).eq("id", editingCourse.id)
        : await supabase.from("courses").insert({
            ...payload,
            created_by: (await supabase.auth.getUser()).data.user?.id || null,
          });
      if (result.error) throw result.error;
      if (editingCourse.id) {
        const retainedImagePaths = new Set(getCourseImagePaths({ ...editingCourse, lessons }));
        const removedImagePaths = getCourseImagePaths(editingCourse)
          .filter((path) => !retainedImagePaths.has(path));
        if (removedImagePaths.length) {
          const { error: storageError } = await supabase.storage
            .from(COURSE_IMAGES_BUCKET)
            .remove(removedImagePaths);
          if (storageError) imageCleanupError = storageError.message;
        }
      }
      setEditingCourse(null);
      setNotice(editingCourse.id ? "Course updated." : "Course created.");
      await loadCourses();
      if (imageCleanupError) {
        setError(`Course was saved, but removed lesson images could not be deleted: ${imageCleanupError}`);
      }
    } catch (saveError) {
      setError(`Course could not be saved: ${saveError.message || "Supabase request failed."}`);
    } finally {
      setSaving(false);
    }
  };

  const importCourses = async (files) => {
    if (!files.length || !supabase) return;
    setError("");
    setNotice("");
    releasePreviewObjectUrls();

    const drafts = [];
    const fileErrors = [];
    let remainingImageSlots = MAX_IMAGES_PER_IMPORT;
    if (files.length > 200) {
      fileErrors.push("Select no more than 200 files at a time.");
    } else {
      for (const file of files) {
        try {
          if (file.size > 5 * 1024 * 1024) {
            throw new Error("File exceeds the 5 MB limit.");
          }
          const extension = file.name.split(".").pop()?.toLowerCase();
          if (extension === "json") {
            const data = JSON.parse(await file.text());
            if (!Array.isArray(data)) throw new Error("Expected a JSON array of courses.");
            if (drafts.length + data.length > 200) {
              throw new Error("This file exceeds the 200-course batch limit.");
            }
            data.forEach((course, index) => drafts.push({
              id: `${drafts.length}`,
              fileName: file.name,
              row: index + 1,
              course: createCourseDraft(course),
            }));
          } else if (extension === "pdf" || extension === "docx") {
            if (drafts.length >= 200) throw new Error("The 200-course batch limit has been reached.");
            const title = importedCourseTitle(file.name);
            const extracted = await extractDocumentContent(file, {
              maxImages: Math.min(12, remainingImageSlots),
            });
            const images = extracted.images.map((image) =>
              createImageAsset(image.blob, image.name, image.alt, image.contentType));
            remainingImageSlots -= images.length;
            const course = createCourseDraft({
              title,
              lessons: [{ title, content: extracted.text }],
            });
            course.coverImage = images[0] || null;
            course.lessons[0].images = images;
            drafts.push({
              id: `${drafts.length}`,
              fileName: file.name,
              row: 1,
              importWarnings: extracted.warnings,
              course,
            });
          } else {
            throw new Error("Unsupported format. Choose JSON, PDF, or DOCX.");
          }
        } catch (fileError) {
          fileErrors.push(`${file.name}: ${fileError.message || "Could not read this file."}`);
        }
      }
    }

    if (!drafts.length && !fileErrors.length) fileErrors.push("The selected files contain no courses.");
    setImportPreview({ drafts, fileErrors, importedCount: null });
    setNotice(drafts.length
      ? "Review the course preview, correct any issues, then confirm the import."
      : "");
    setImporting(false);
  };

  const updateImportDraft = (id, updateCourse) => {
    setImportPreview((current) => current && ({
      ...current,
      drafts: current.drafts.map((entry) => entry.id === id
        ? { ...entry, course: updateCourse(entry.course) }
        : entry),
    }));
  };

  const setImportCover = (entryId, file) => {
    if (!file) return;
    if (!IMAGE_CONTENT_TYPES.has(file.type)) {
      setError("Choose a JPEG, PNG, WebP, or GIF image for the course cover.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Course cover images must be 5 MB or smaller.");
      return;
    }
    setError("");
    const coverImage = createImageAsset(
      file,
      file.name,
      `Cover image for ${importPreviewRows.find((entry) => entry.id === entryId)?.course.title || "course"}`,
    );
    updateImportDraft(entryId, (course) => ({ ...course, coverImage }));
  };

  const closeImportPreview = () => {
    releasePreviewObjectUrls();
    setImportPreview(null);
  };

  const confirmCourseImport = async () => {
    if (!supabase || !importPreview || importPreview.importedCount !== null) return;
    const validRows = importPreviewRows.filter((entry) => !entry.errors.length);
    if (!validRows.length) {
      setError("There are no valid courses to import. Correct the listed issues first.");
      return;
    }
    const importAssets = new Set();
    validRows.forEach(({ course }) => {
      if (course.coverImage) importAssets.add(course.coverImage);
      (course.lessons || []).forEach((lesson) => (lesson.images || []).forEach((image) => {
        importAssets.add(image);
      }));
    });
    if (importAssets.size > MAX_IMAGES_PER_IMPORT) {
      setError(`Select no more than ${MAX_IMAGES_PER_IMPORT} course images in one import.`);
      return;
    }
    const imageBytes = [...importAssets].reduce((total, asset) => total + asset.blob.size, 0);
    if (imageBytes > MAX_IMAGE_BYTES_PER_IMPORT) {
      setError("Selected course images exceed the 20 MB import limit. Remove some images or choose smaller files.");
      return;
    }
    if (!LEVEL_OPTIONS.some((level) => level.key === importEducationLevel)) {
      setError("Choose a valid education level before importing.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    const uploadedPaths = [];
    const uploadedAssets = new Map();
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const uploadAsset = async (asset, courseId) => {
        if (!asset) return null;
        if (uploadedAssets.has(asset)) return uploadedAssets.get(asset);
        if (!IMAGE_CONTENT_TYPES.has(asset.contentType)) {
          throw new Error(`${asset.name} uses an unsupported image type.`);
        }
        const extension = asset.contentType.split("/")[1].replace("jpeg", "jpg");
        const path = `${courseId}/${globalThis.crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from(COURSE_IMAGES_BUCKET)
          .upload(path, asset.blob, {
            cacheControl: "31536000",
            contentType: asset.contentType,
            upsert: false,
          });
        if (uploadError) throw uploadError;
        uploadedPaths.push(path);
        const uploadedAsset = { path, alt: asset.alt || "Course illustration" };
        uploadedAssets.set(asset, uploadedAsset);
        return uploadedAsset;
      };

      const rows = [];
      for (const { course } of validRows) {
        const id = globalThis.crypto.randomUUID();
        const lessons = [];
        for (const lesson of course.lessons) {
          const images = [];
          for (const image of lesson.images || []) {
            const uploadedImage = await uploadAsset(image, id);
            if (uploadedImage) images.push(uploadedImage);
          }
          lessons.push({
            id: newLesson().id,
            title: lesson.title.trim(),
            content: lesson.content.trim(),
            images,
            quiz: lesson.quiz || [],
          });
        }
        const firstLessonImage = lessons.flatMap((lesson) => lesson.images)[0]?.path || null;
        const cover = course.coverImage
          ? await uploadAsset(course.coverImage, id)
          : null;
        rows.push({
          id,
          title: course.title.trim(),
          description: course.description.trim(),
          subject: course.subject.trim(),
          education_level: importEducationLevel,
          is_published: course.is_published,
          cover_image_path: cover?.path || firstLessonImage,
          lessons,
          created_by: userData.user?.id || null,
        });
      }
      const { error: insertError } = await supabase.from("courses").insert(rows);
      if (insertError) throw insertError;

      setImportPreview((current) => current && ({ ...current, importedCount: rows.length }));
      setNotice(`Imported ${rows.length} course${rows.length === 1 ? "" : "s"}.`);
      await loadCourses();
    } catch (importError) {
      let message = importError.message || "Supabase request failed.";
      if (uploadedPaths.length) {
        const { error: cleanupError } = await supabase.storage
          .from(COURSE_IMAGES_BUCKET)
          .remove(uploadedPaths);
        if (cleanupError) message += ` Uploaded images could not be cleaned up: ${cleanupError.message}`;
      }
      setError(`Courses could not be imported: ${message}`);
    } finally {
      setSaving(false);
    }
  };

  const downloadCourseTemplate = () => {
    const template = [{
      title: "Course title",
      description: "Course description",
      subject: "Subject",
      is_published: true,
      lessons: [{
        title: "Lesson title",
        content: "Lesson content",
        quiz: [{
          id: "question-1",
          prompt: "Example question?",
          options: [
            { id: "option-a", text: "First answer" },
            { id: "option-b", text: "Second answer" },
          ],
          correctOptionId: "option-a",
        }],
      }],
    }];
    const url = URL.createObjectURL(new Blob([JSON.stringify(template, null, 2)], {
      type: "application/json",
    }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "courses-import-template.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const deleteCourse = async (course) => {
    if (!supabase || !window.confirm(`Remove "${course.title}" and its enrollments and progress?`)) return;
    setError("");
    setNotice("");
    const { error: deleteError } = await supabase.from("courses").delete().eq("id", course.id);
    if (deleteError) {
      setError(`Course could not be removed: ${deleteError.message}`);
      return;
    }
    const imagePaths = getCourseImagePaths(course);
    if (imagePaths.length) {
      const { error: imageError } = await supabase.storage
        .from(COURSE_IMAGES_BUCKET)
        .remove(imagePaths);
      if (imageError) {
        setNotice("Course was removed, but some stored images could not be deleted. Contact support to clean them up.");
        setError(`Course images could not be removed: ${imageError.message}`);
        await loadCourses();
        return;
      }
    }
    setNotice("Course and its enrollment records were removed.");
    await loadCourses();
  };

  const enroll = async (course) => {
    if (!supabase || !studentId) {
      setError("Your student account is not linked to a student record, so you cannot enroll yet.");
      return;
    }
    setError("");
    setNotice("");
    const { error: enrollmentError } = await supabase
      .from("course_enrollments")
      .insert({ course_id: course.id, student_id: studentId });
    if (enrollmentError) {
      setError(`Could not enroll in this course: ${enrollmentError.message}`);
      return;
    }
    setNotice(`You're enrolled in ${course.title}.`);
    await loadCourses();
  };

  const syncLessonCompletion = useCallback(async (lessonId) => {
    if (!supabase || !activeEnrollment || !lessonId) return;
    if (activeCompleted.has(lessonId)) return;
    setError("");

    try {
      const { data: existingRows, error: lookupError } = await supabase
        .from("course_lesson_progress")
        .select("id")
        .eq("enrollment_id", activeEnrollment.id)
        .eq("lesson_id", lessonId)
        .limit(1);

      if (lookupError) throw lookupError;
      if (existingRows?.length) {
        setCompletedByEnrollment((current) => {
          const next = { ...current };
          next[activeEnrollment.id] = new Set(current[activeEnrollment.id] || []);
          next[activeEnrollment.id].add(lessonId);
          return next;
        });
        return;
      }

      const { error: insertError } = await supabase.from("course_lesson_progress").insert({
        enrollment_id: activeEnrollment.id,
        lesson_id: lessonId,
      });

      if (insertError) {
        setError(`Progress could not be updated: ${insertError.message}`);
        return;
      }

      setCompletedByEnrollment((current) => {
        const next = { ...current };
        next[activeEnrollment.id] = new Set(current[activeEnrollment.id] || []);
        next[activeEnrollment.id].add(lessonId);
        return next;
      });
    } catch (syncError) {
      setError(`Progress could not be updated: ${syncError.message || "Supabase request failed."}`);
    }
  }, [activeCompleted, activeEnrollment, supabase]);

  useEffect(() => {
    if (!activeCourse || !activeLessonId) return;
    if (isAdmin) return;
    syncLessonCompletion(activeLessonId);
  }, [activeCourse, activeLessonId, isAdmin, syncLessonCompletion]);

  const toggleLessonComplete = async (lesson) => {
    if (!supabase || !activeEnrollment) return;
    setError("");
    const wasCompleted = activeCompleted.has(lesson.id);
    const result = wasCompleted
      ? await supabase.from("course_lesson_progress")
          .delete()
          .eq("enrollment_id", activeEnrollment.id)
          .eq("lesson_id", lesson.id)
      : await supabase.from("course_lesson_progress")
          .insert({ enrollment_id: activeEnrollment.id, lesson_id: lesson.id });
    if (result.error) {
      setError(`Progress could not be updated: ${result.error.message}`);
      return;
    }
    setCompletedByEnrollment((current) => {
      const next = { ...current, [activeEnrollment.id]: new Set(current[activeEnrollment.id] || []) };
      if (wasCompleted) next[activeEnrollment.id].delete(lesson.id);
      else next[activeEnrollment.id].add(lesson.id);
      return next;
    });
  };

  const submitLessonQuiz = (event) => {
    event.preventDefault();
    if (!activeLesson?.quiz?.length) return;
    const unanswered = activeLesson.quiz.find((question) => !activeQuizAnswers[question.id]);
    if (unanswered) {
      setError("Answer every question before checking your quiz.");
      return;
    }
    setError("");
    const score = activeLesson.quiz.filter((question) =>
      activeQuizAnswers[question.id] === question.correctOptionId).length;
    setQuizResults((current) => ({
      ...current,
      [activeLesson.id]: { score, total: activeLesson.quiz.length },
    }));
  };

  const setLessonQuizAnswer = (questionId, optionId) => {
    if (!activeLesson) return;
    setQuizAnswers((current) => ({
      ...current,
      [activeLesson.id]: { ...(current[activeLesson.id] || {}), [questionId]: optionId },
    }));
    setQuizResults((current) => {
      const next = { ...current };
      delete next[activeLesson.id];
      return next;
    });
  };

  const courseFilters = (
    <div className="courses-filters">
      <label>
        Education level
        <select className="form-control" value={levelFilter} onChange={(event) => {
          setLevelFilter(event.target.value);
          setSubjectFilter("all");
        }}>
          {LEVEL_OPTIONS.map((level) => <option key={level.key} value={level.key}>{level.name}</option>)}
        </select>
      </label>
      <label>
        Subject
        <select className="form-control" value={subjectFilter}
          onChange={(event) => setSubjectFilter(event.target.value)}>
          <option value="all">All subjects</option>
          {subjectOptions.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
        </select>
      </label>
      {!isAdmin && (
        <label>
          Course progress
          <select className="form-control" value={progressFilter}
            onChange={(event) => setProgressFilter(event.target.value)}>
            <option value="all">All courses</option>
            <option value="not_enrolled">Not enrolled</option>
            <option value="not_started">Not started</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
          </select>
        </label>
      )}
      <label className="courses-search">
        Find a course
        <input className="form-control" type="search" value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search courses and lesson content" />
      </label>
      <label>
        Sort by
        <select className="form-control" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="title_asc">Title (A-Z)</option>
          <option value="title_desc">Title (Z-A)</option>
          <option value="lessons_desc">Most lessons</option>
        </select>
      </label>
    </div>
  );

  if (loading) {
    return <div className="portal-loading" role="status">Loading courses...</div>;
  }

  return (
    <div className="courses-page fade-in">
      <header className="courses-hero">
        <div>
          <span className="courses-eyebrow">{isAdmin ? "ACADEMIC MANAGEMENT" : "LEARN AT YOUR PACE"}</span>
          <h1>{isAdmin ? "Courses" : "Courses & learning"}</h1>
          <p>
            {isAdmin
              ? "Create courses, organize lessons, and manage the learning library."
              : "Explore courses, register, study lessons, and track your progress."}
          </p>
        </div>
        {isAdmin && (
          <div className="courses-admin-actions">
            <label className="btn btn-outline courses-import-button">
              {importing ? "Importing..." : "Import courses"}
              <input
                type="file"
                accept=".json,.pdf,.docx,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                multiple
                disabled={importing}
                onChange={(event) => {
                  const files = Array.from(event.target.files || []);
                  event.target.value = "";
                  if (files.length) {
                    setImporting(true);
                    importCourses(files);
                  }
                }}
              />
            </label>
            <button className="btn btn-blue" type="button" onClick={startNewCourse}>Create course</button>
          </div>
        )}
      </header>

      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}
      {isAdmin && (
        <div className="courses-import-help">
          <label>
            Education level for this import
            <select className="form-control" value={importEducationLevel}
              onChange={(event) => setImportEducationLevel(event.target.value)}>
              {LEVEL_OPTIONS.map((level) => <option key={level.key} value={level.key}>{level.name}</option>)}
            </select>
          </label>
          <span>Selected level applies to every imported course. JSON arrays, PDF, and DOCX are accepted; scanned PDFs need OCR.</span>
          <button className="btn btn-outline" type="button" onClick={downloadCourseTemplate}>
            Download JSON template
          </button>
        </div>
      )}

      {isAdmin && importPreview && (
        <section className="card card-padded courses-import-preview" aria-labelledby="courses-import-preview-title">
          <div className="courses-editor-heading">
            <div>
              <h2 id="courses-import-preview-title">
                {importPreview.importedCount === null ? "Review imported courses" : "Import report"}
              </h2>
              <p>
                {importPreview.importedCount === null
                  ? `${importPreviewRows.filter((entry) => !entry.errors.length).length} ready   ${importPreviewRows.filter((entry) => entry.errors.length).length} need attention`
                  : `${importPreview.importedCount} course${importPreview.importedCount === 1 ? "" : "s"} imported.`}
              </p>
            </div>
            <button className="btn btn-outline" type="button" disabled={saving}
              onClick={closeImportPreview}>Close preview</button>
          </div>
          {!!importPreview.fileErrors.length && (
            <div className="courses-import-file-errors" role="alert">
              <strong>Files that could not be fully read</strong>
              <ul>{importPreview.fileErrors.map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}</ul>
            </div>
          )}
          {!!importPreviewRows.length && (
            <div className="courses-import-rows">
              {importPreviewRows.map((entry) => {
                const disabled = importPreview.importedCount !== null;
                const updateCourse = (change) => updateImportDraft(entry.id, (course) => ({ ...course, ...change }));
                const firstDocumentImage = entry.course.lessons.flatMap((lesson) => lesson.images || [])[0] || null;
                return (
                  <article className="courses-import-row" key={entry.id}>
                    <div className="courses-import-row-heading">
                      <div>
                        <strong>Course from {entry.fileName}, row {entry.row}</strong>
                        <span className={entry.errors.length ? "courses-import-invalid" : "courses-import-valid"}>
                          {entry.errors.length ? "Needs attention" : "Ready to import"}
                        </span>
                      </div>
                      <button className="btn btn-outline courses-delete" type="button" disabled={disabled}
                        onClick={() => setImportPreview((current) => current && ({
                          ...current,
                          drafts: current.drafts.filter((item) => item.id !== entry.id),
                        }))}>
                        Remove
                      </button>
                    </div>
                    <div className="courses-import-cover-editor">
                      <CourseCover course={entry.course} imageUrls={courseImageUrls} />
                      <label>
                        Course cover image
                        <input className="form-control" type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif" disabled={disabled}
                          onChange={(event) => {
                            setImportCover(entry.id, event.target.files?.[0]);
                            event.target.value = "";
                          }} />
                        <span>Use an extracted document image or choose a JPEG, PNG, WebP, or GIF cover.</span>
                      </label>
                    </div>
                    {!!(firstDocumentImage || entry.course.coverImage) && (
                      <button className="btn btn-outline courses-cover-reset" type="button" disabled={disabled}
                        onClick={() => updateCourse({
                          coverImage: entry.course.coverImage === firstDocumentImage ? null : firstDocumentImage,
                        })}>
                        {entry.course.coverImage === firstDocumentImage
                          ? "Use generated artwork"
                          : firstDocumentImage ? "Use first document image" : "Remove custom cover"}
                      </button>
                    )}
                    {!!entry.errors.length && (
                      <ul className="courses-import-issues" role="alert">
                        {entry.errors.map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}
                      </ul>
                    )}
                    {!!entry.importWarnings?.length && (
                      <ul className="courses-import-warnings">
                        {entry.importWarnings.map((message, index) => (
                          <li key={`${index}-${message}`}>{message}</li>
                        ))}
                      </ul>
                    )}
                    {!!entry.warnings.length && (
                      <ul className="courses-import-warnings">
                        {entry.warnings.map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}
                      </ul>
                    )}
                    <div className="courses-import-fields">
                      <label>Course title
                        <input className="form-control" value={entry.course.title} disabled={disabled}
                          onChange={(event) => updateCourse({ title: event.target.value })} />
                      </label>
                      <label>Subject
                        <input className="form-control" value={entry.course.subject} disabled={disabled}
                          onChange={(event) => updateCourse({ subject: event.target.value })} />
                      </label>
                      <label className="courses-import-description">Description
                        <textarea className="form-control" rows="2" value={entry.course.description} disabled={disabled}
                          onChange={(event) => updateCourse({ description: event.target.value })} />
                      </label>
                      <label className="courses-publish-toggle">
                        <input type="checkbox" checked={entry.course.is_published} disabled={disabled}
                          onChange={(event) => updateCourse({ is_published: event.target.checked })} />
                        Available to students after import
                      </label>
                    </div>
                    <div className="courses-import-lessons-heading">
                      <strong>Lessons ({entry.course.lessons.length})</strong>
                      <button className="btn btn-outline" type="button" disabled={disabled}
                        onClick={() => updateCourse({ lessons: [...entry.course.lessons, newLesson()] })}>
                        Add lesson
                      </button>
                    </div>
                    {entry.course.lessons.map((lesson, index) => (
                      <section className="courses-lesson-editor" key={lesson.id}>
                        <div className="courses-lesson-editor-heading">
                          <strong>Lesson {index + 1}</strong>
                          <button className="btn btn-outline" type="button" disabled={disabled}
                            onClick={() => updateCourse({
                              lessons: entry.course.lessons.filter((item) => item.id !== lesson.id),
                            })}>
                            Remove lesson
                          </button>
                        </div>
                        <label>Lesson title
                          <input className="form-control" value={lesson.title} disabled={disabled}
                            onChange={(event) => updateCourse({
                              lessons: entry.course.lessons.map((item) =>
                                item.id === lesson.id ? { ...item, title: event.target.value } : item),
                            })} />
                        </label>
                        <label>Learning content
                          <textarea className="form-control" rows="5" value={lesson.content} disabled={disabled}
                            onChange={(event) => updateCourse({
                              lessons: entry.course.lessons.map((item) =>
                                item.id === lesson.id ? { ...item, content: event.target.value } : item),
                            })} />
                        </label>
                        <QuizEditor questions={lesson.quiz || []} disabled={disabled}
                          onChange={(quiz) => updateCourse({
                            lessons: entry.course.lessons.map((item) =>
                              item.id === lesson.id ? { ...item, quiz } : item),
                          })} />
                        <CourseImageGallery
                          images={lesson.images}
                          imageUrls={courseImageUrls}
                          onRemove={(image) => updateImportDraft(entry.id, (course) => {
                            const remainingImages = course.lessons
                              .flatMap((item) => item.images || [])
                              .filter((item) => item !== image);
                            return {
                              ...course,
                              coverImage: course.coverImage === image
                                ? remainingImages[0] || null
                                : course.coverImage,
                              lessons: course.lessons.map((item) => ({
                                ...item,
                                images: (item.images || []).filter((itemImage) => itemImage !== image),
                              })),
                            };
                          })}
                        />
                      </section>
                    ))}
                  </article>
                );
              })}
            </div>
          )}
          {importPreview.importedCount === null && (
            <div className="courses-import-confirm">
              <span>Warnings are advisory; resolve all required fields before importing.</span>
              <button className="btn btn-blue" type="button" disabled={saving || importing
                || !importPreviewRows.some((entry) => !entry.errors.length)}
                onClick={confirmCourseImport}>
                {saving ? "Importing..." : `Import ${importPreviewRows.filter((entry) => !entry.errors.length).length} valid course${importPreviewRows.filter((entry) => !entry.errors.length).length === 1 ? "" : "s"}`}
              </button>
            </div>
          )}
        </section>
      )}

      {isAdmin ? (
        <>
          {courseFilters}
          {editingCourse && (
            <form className="card card-padded courses-editor" onSubmit={saveCourse}>
              <div className="courses-editor-heading">
                <h2>{editingCourse.id ? "Edit course" : "Create a course"}</h2>
                <button className="btn btn-outline" type="button" onClick={() => setEditingCourse(null)}>Cancel</button>
              </div>
              <div className="courses-form-grid">
                <label>Course title
                  <input className="form-control" value={editingCourse.title} required
                    onChange={(event) => setEditingCourse({ ...editingCourse, title: event.target.value })} />
                </label>
                <label>Subject
                  <input className="form-control" value={editingCourse.subject}
                    onChange={(event) => setEditingCourse({ ...editingCourse, subject: event.target.value })} />
                </label>
                <label>Education level
                  <select className="form-control" value={editingCourse.education_level}
                    onChange={(event) => setEditingCourse({ ...editingCourse, education_level: event.target.value })}>
                    {LEVEL_OPTIONS.map((level) => <option key={level.key} value={level.key}>{level.name}</option>)}
                  </select>
                </label>
                <label className="courses-publish-toggle">
                  <input type="checkbox" checked={editingCourse.is_published}
                    onChange={(event) => setEditingCourse({ ...editingCourse, is_published: event.target.checked })} />
                  Available to students
                </label>
              </div>
              <label className="courses-description">Course description
                <textarea className="form-control" rows="3" value={editingCourse.description}
                  onChange={(event) => setEditingCourse({ ...editingCourse, description: event.target.value })} />
              </label>
              <div className="courses-lessons-heading">
                <h3>Lessons</h3>
                <button className="btn btn-outline" type="button"
                  onClick={() => setEditingCourse({ ...editingCourse, lessons: [...editingCourse.lessons, newLesson()] })}>
                  Add lesson
                </button>
              </div>
              {editingCourse.lessons.map((lesson, index) => (
                <section className="courses-lesson-editor" key={lesson.id}>
                  <div className="courses-lesson-editor-heading">
                    <strong>Lesson {index + 1}</strong>
                    <button className="btn btn-outline" type="button" aria-label={`Remove lesson ${index + 1}`}
                      onClick={() => setEditingCourse({
                        ...editingCourse,
                        lessons: editingCourse.lessons.filter((item) => item.id !== lesson.id),
                      })}>Remove</button>
                  </div>
                  <input className="form-control" placeholder="Lesson title" value={lesson.title}
                    onChange={(event) => setEditingCourse({
                      ...editingCourse,
                      lessons: editingCourse.lessons.map((item) => item.id === lesson.id ? { ...item, title: event.target.value } : item),
                    })} />
                  <textarea className="form-control" rows="5" placeholder="Lesson content"
                    value={lesson.content}
                    onChange={(event) => setEditingCourse({
                      ...editingCourse,
                      lessons: editingCourse.lessons.map((item) => item.id === lesson.id ? { ...item, content: event.target.value } : item),
                    })} />
                  <QuizEditor questions={lesson.quiz || []}
                    onChange={(quiz) => setEditingCourse({
                      ...editingCourse,
                      lessons: editingCourse.lessons.map((item) =>
                        item.id === lesson.id ? { ...item, quiz } : item),
                    })} />
                </section>
              ))}
              <button className="btn btn-blue" type="submit" disabled={saving}>
                {saving ? "Saving..." : editingCourse.id ? "Save changes" : "Create course"}
              </button>
            </form>
          )}

          <div className="courses-list-heading">
            <h2>Course library</h2>
            <span>{visibleCourses.length} course{visibleCourses.length === 1 ? "" : "s"}</span>
          </div>
          <div className="courses-grid">
            {visibleCourses.map((course) => (
              <article className="card card-padded courses-card" key={course.id}>
                <CourseCover course={course} imageUrls={courseImageUrls} />
                <div className="courses-card-tags">
                  <span>{levelName(course.education_level)}</span>
                  <span className={course.is_published ? "courses-status-live" : "courses-status-draft"}>
                    {course.is_published ? "Available" : "Hidden"}
                  </span>
                </div>
                <h3>{course.title}</h3>
                {course.subject && <div className="courses-subject">{course.subject}</div>}
                <p>{courseDescription(course.description, "Explore the lessons in this course.")}</p>
                <div className="courses-card-footer">
                  <span>{course.lessons?.length || 0} lessons</span>
                  <div>
                    <button className="btn btn-outline" type="button"
                      onClick={() => setEditingCourse({ ...course, lessons: course.lessons || [] })}>Edit</button>
                    <button className="btn btn-outline courses-delete" type="button"
                      onClick={() => deleteCourse(course)}>Remove</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          {!visibleCourses.length && (
            <div className="card card-padded courses-empty">
              {courses.length
                ? "No courses match these filters. Try another search or clear the filters."
                : "No courses yet. Create the first course to get started."}
              {courses.length > 0 && (
                <button className="btn btn-outline courses-reset-filters" type="button" onClick={() => {
                  setLevelFilter("all");
                  setSubjectFilter("all");
                  setSearch("");
                }}>Clear filters</button>
              )}
            </div>
          )}
        </>
      ) : activeCourse ? (
        <section className="courses-player">
          <button className="btn btn-outline" type="button" onClick={() => { setActiveCourseId(""); setActiveLessonId(""); }}>
            All courses
          </button>
          <div className="courses-player-layout">
            <aside className="card card-padded courses-lesson-list">
              <span className="courses-eyebrow">{levelName(activeCourse.education_level)}</span>
              <h2>{activeCourse.title}</h2>
              <p>{activeCourse.description}</p>
              <div className="courses-progress">
                <div className="courses-progress-label">
                  <strong>Course progress</strong>
                  <span>{courseProgress(activeCourse, activeCompleted)}%</span>
                </div>
                <div className="courses-progress-track">
                  <div style={{ width: `${courseProgress(activeCourse, activeCompleted)}%` }} />
                </div>
              </div>
              <ol>
                {(activeCourse.lessons || []).map((lesson, index) => (
                  <li key={lesson.id}>
                    <button type="button" className={lesson.id === activeLessonId ? "is-active" : ""}
                      onClick={() => {
                        setActiveLessonId(lesson.id);
                        syncLessonCompletion(lesson.id);
                      }}>
                      <span>{activeCompleted.has(lesson.id) ? "Done" : index + 1}</span>
                      {lesson.title}
                    </button>
                  </li>
                ))}
              </ol>
            </aside>
            <article className="card card-padded courses-lesson-content">
              {activeLesson ? (
                <>
                  <span className="courses-eyebrow">{activeCourse.subject || "COURSE LESSON"}</span>
                  <h2>{activeLesson.title}</h2>
                  <div className="courses-lesson-text">{activeLesson.content}</div>
                  <CourseImageGallery images={activeLesson.images} imageUrls={courseImageUrls} />
                  {Array.isArray(activeLesson.quiz) && !!activeLesson.quiz.length && (
                    <form className="courses-practice-quiz" onSubmit={submitLessonQuiz}>
                      <div>
                        <span className="courses-eyebrow">PRACTICE</span>
                        <h3>Knowledge check</h3>
                        <p>Check your understanding. This practice score is not saved.</p>
                      </div>
                      {activeLesson.quiz.map((question, questionIndex) => {
                        const selectedOption = activeQuizAnswers[question.id];
                        return (
                          <fieldset className="courses-practice-question" key={question.id}>
                            <legend>{questionIndex + 1}. {question.prompt}</legend>
                            {(Array.isArray(question.options) ? question.options : [])
                              .filter((option) => typeof option.text === "string" && option.text.trim())
                              .map((option) => (
                              <label className={`courses-practice-option ${
                                activeQuizResult
                                  ? option.id === question.correctOptionId
                                    ? "is-correct"
                                    : selectedOption === option.id ? "is-incorrect" : ""
                                  : ""
                              }`} key={option.id}>
                                <input type="radio" name={`answer-${question.id}`}
                                  value={option.id} checked={selectedOption === option.id}
                                  onChange={() => setLessonQuizAnswer(question.id, option.id)} />
                                <span>{option.text}</span>
                              </label>
                            ))}
                          </fieldset>
                        );
                      })}
                      {activeQuizResult && (
                        <p className="courses-quiz-result" role="status">
                          You scored {activeQuizResult.score} of {activeQuizResult.total}.
                        </p>
                      )}
                      <button className="btn btn-blue" type="submit" disabled={!!activeQuizResult}>
                        Check answers
                      </button>
                      {activeQuizResult && (
                        <button className="btn btn-outline" type="button" onClick={() => {
                          setQuizResults((current) => {
                            const next = { ...current };
                            delete next[activeLesson.id];
                            return next;
                          });
                          setQuizAnswers((current) => {
                            const next = { ...current };
                            delete next[activeLesson.id];
                            return next;
                          });
                        }}>Try again</button>
                      )}
                    </form>
                  )}
                  <div className="courses-lesson-progress-note">
                    Progress updates automatically as you study this lesson.
                  </div>
                </>
              ) : (
                <div className="courses-empty">Choose a lesson to start studying.</div>
              )}
            </article>
          </div>
        </section>
      ) : (
        <>
          {courseFilters}
          <section className="courses-progress-summary" aria-label="Your learning progress">
            <article><span>Enrolled</span><strong>{studentProgress.enrolled}</strong></article>
            <article><span>Not started</span><strong>{studentProgress.notStarted}</strong></article>
            <article><span>In progress</span><strong>{studentProgress.inProgress}</strong></article>
            <article><span>Completed</span><strong>{studentProgress.completed}</strong></article>
            <article><span>Average progress</span><strong>{studentProgress.average}%</strong></article>
          </section>
          <div className="courses-list-heading">
            <h2>{levelFilter === "all" ? "Available courses" : `${levelName(levelFilter)} courses`}</h2>
            <span>{visibleCourses.length} course{visibleCourses.length === 1 ? "" : "s"}   {studentProgress.enrolled} enrolled</span>
          </div>
          <div className="courses-grid">
            {visibleCourses.map((course) => {
              const enrollment = enrollmentByCourse.get(course.id);
              const complete = enrollment
                ? courseProgress(course, completedByEnrollment[enrollment.id] || new Set())
                : 0;
              return (
                <article className="card card-padded courses-card" key={course.id}>
                  <CourseCover course={course} imageUrls={courseImageUrls} />
                  <div className="courses-card-tags"><span>{levelName(course.education_level)}</span></div>
                  <h3>{course.title}</h3>
                  {course.subject && <div className="courses-subject">{course.subject}</div>}
                  <p>{courseDescription(course.description, "Explore the lessons in this course.")}</p>
                  <div className="courses-card-footer">
                    <span>{course.lessons?.length || 0} lessons{enrollment
                      ? `   ${complete === 100 ? "Completed" : `${complete}% complete`}`
                      : ""}</span>
                    {enrollment ? (
                      <button className="btn btn-blue" type="button" onClick={() => {
                        setActiveCourseId(course.id);
                        setActiveLessonId(course.lessons?.[0]?.id || "");
                      }}>Continue learning</button>
                    ) : (
                      <button className="btn btn-blue" type="button" onClick={() => enroll(course)}>Register for course</button>
                    )}
                  </div>
                  {enrollment && (
                    <div className="courses-progress-track">
                      <div style={{ width: `${complete}%` }} />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          {!visibleCourses.length && (
            <div className="card card-padded courses-empty">
              No courses are available for this level or search. Try another level or check back later.
              <button className="btn btn-outline courses-reset-filters" type="button" onClick={() => {
                setLevelFilter("all");
                setSubjectFilter("all");
                setProgressFilter("all");
                setSearch("");
              }}>Clear filters</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
