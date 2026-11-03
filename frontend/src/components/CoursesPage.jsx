import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { getLearningLevelFromClass, LEARNING_LEVELS } from "../config/learningCatalog.js";
import "./CoursesPage.css";

const LEVEL_OPTIONS = [
  { key: "all", name: "All education levels" },
  ...LEARNING_LEVELS.map(({ key, name }) => ({ key, name })),
];

const newLesson = () => ({
  id: globalThis.crypto?.randomUUID?.() || `lesson-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  title: "",
  content: "",
});

const levelName = (level) =>
  LEVEL_OPTIONS.find((option) => option.key === level)?.name || "All education levels";

const courseProgress = (course, completedLessons) => {
  const lessonCount = course.lessons?.length || 0;
  if (!lessonCount) return 0;
  return Math.round(
    (course.lessons.filter((lesson) => completedLessons.has(lesson.id)).length / lessonCount) * 100,
  );
};

export default function CoursesPage({ mode, studentData }) {
  const isAdmin = mode === "admin";
  const studentId = studentData?.id;
  const inferredLevel = getLearningLevelFromClass(
    studentData?.class || studentData?.class_name || "",
  );
  const [courses, setCourses] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [completedByEnrollment, setCompletedByEnrollment] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [levelFilter, setLevelFilter] = useState(inferredLevel || "all");
  const [search, setSearch] = useState("");
  const [editingCourse, setEditingCourse] = useState(null);
  const [activeCourseId, setActiveCourseId] = useState("");
  const [activeLessonId, setActiveLessonId] = useState("");

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
          const { data: progressRows, error: progressError } = await supabase
            .from("course_lesson_progress")
            .select("enrollment_id, lesson_id")
            .in("enrollment_id", nextEnrollments.map((enrollment) => enrollment.id));
          if (progressError) throw progressError;
          const progress = {};
          (progressRows || []).forEach(({ enrollment_id, lesson_id }) => {
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

  const enrolledCourseIds = useMemo(
    () => new Set(enrollments.map((enrollment) => enrollment.course_id)),
    [enrollments],
  );
  const enrollmentByCourse = useMemo(
    () => new Map(enrollments.map((enrollment) => [enrollment.course_id, enrollment])),
    [enrollments],
  );
  const visibleCourses = useMemo(() => {
    const query = search.trim().toLowerCase();
    return courses.filter((course) => {
      if (!isAdmin && !course.is_published) return false;
      const matchesLevel = levelFilter === "all" || course.education_level === "all"
        || course.education_level === levelFilter;
      const matchesSearch = !query
        || `${course.title} ${course.description} ${course.subject}`.toLowerCase().includes(query);
      return matchesLevel && matchesSearch;
    });
  }, [courses, isAdmin, levelFilter, search]);

  const activeCourse = courses.find((course) => course.id === activeCourseId);
  const activeEnrollment = activeCourse && enrollmentByCourse.get(activeCourse.id);
  const activeCompleted = activeEnrollment
    ? completedByEnrollment[activeEnrollment.id] || new Set()
    : new Set();
  const activeLesson = activeCourse?.lessons?.find((lesson) => lesson.id === activeLessonId);

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

    setSaving(true);
    setError("");
    setNotice("");
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
      setEditingCourse(null);
      setNotice(editingCourse.id ? "Course updated." : "Course created.");
      await loadCourses();
    } catch (saveError) {
      setError(`Course could not be saved: ${saveError.message || "Supabase request failed."}`);
    } finally {
      setSaving(false);
    }
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
          <button className="btn btn-blue" type="button" onClick={startNewCourse}>Create course</button>
        )}
      </header>

      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      {isAdmin ? (
        <>
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
                </section>
              ))}
              <button className="btn btn-blue" type="submit" disabled={saving}>
                {saving ? "Saving..." : editingCourse.id ? "Save changes" : "Create course"}
              </button>
            </form>
          )}

          <div className="courses-list-heading">
            <h2>Course library</h2>
            <span>{courses.length} course{courses.length === 1 ? "" : "s"}</span>
          </div>
          <div className="courses-grid">
            {courses.map((course) => (
              <article className="card card-padded courses-card" key={course.id}>
                <div className="courses-card-tags">
                  <span>{levelName(course.education_level)}</span>
                  <span className={course.is_published ? "courses-status-live" : "courses-status-draft"}>
                    {course.is_published ? "Available" : "Hidden"}
                  </span>
                </div>
                <h3>{course.title}</h3>
                {course.subject && <div className="courses-subject">{course.subject}</div>}
                <p>{course.description || "No description provided."}</p>
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
          {!courses.length && <div className="card card-padded courses-empty">No courses yet. Create the first course to get started.</div>}
        </>
      ) : activeCourse ? (
        <section className="courses-player">
          <button className="btn btn-outline" type="button" onClick={() => { setActiveCourseId(""); setActiveLessonId(""); }}>
            ← All courses
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
                      onClick={() => setActiveLessonId(lesson.id)}>
                      <span>{activeCompleted.has(lesson.id) ? "✓" : index + 1}</span>
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
                  <button className={activeCompleted.has(activeLesson.id) ? "btn btn-outline" : "btn btn-blue"}
                    type="button" onClick={() => toggleLessonComplete(activeLesson)}>
                    {activeCompleted.has(activeLesson.id) ? "Mark as not complete" : "Mark lesson complete"}
                  </button>
                </>
              ) : (
                <div className="courses-empty">Choose a lesson to start studying.</div>
              )}
            </article>
          </div>
        </section>
      ) : (
        <>
          <div className="courses-filters">
            <label>
              Education level
              <select className="form-control" value={levelFilter} onChange={(event) => setLevelFilter(event.target.value)}>
                {LEVEL_OPTIONS.map((level) => <option key={level.key} value={level.key}>{level.name}</option>)}
              </select>
            </label>
            <label className="courses-search">
              Find a course
              <input className="form-control" type="search" value={search}
                onChange={(event) => setSearch(event.target.value)} placeholder="Search title, subject, or description" />
            </label>
          </div>
          <div className="courses-list-heading">
            <h2>{levelFilter === "all" ? "Available courses" : `${levelName(levelFilter)} courses`}</h2>
            <span>{enrollments.length} enrolled</span>
          </div>
          <div className="courses-grid">
            {visibleCourses.map((course) => {
              const enrollment = enrollmentByCourse.get(course.id);
              const complete = enrollment
                ? courseProgress(course, completedByEnrollment[enrollment.id] || new Set())
                : 0;
              return (
                <article className="card card-padded courses-card" key={course.id}>
                  <div className="courses-card-tags"><span>{levelName(course.education_level)}</span></div>
                  <h3>{course.title}</h3>
                  {course.subject && <div className="courses-subject">{course.subject}</div>}
                  <p>{course.description || "Explore the lessons in this course."}</p>
                  <div className="courses-card-footer">
                    <span>{course.lessons?.length || 0} lessons{enrollment ? ` · ${complete}% complete` : ""}</span>
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
            </div>
          )}
        </>
      )}
    </div>
  );
}
