import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import { supabase } from "../lib/supabaseClient.js";
import {
  isPassingScore,
  PASSMARK_PERCENTAGE,
} from "../config/assessmentSettings.js";
import { getLearningLevelFromClass, LEARNING_LEVELS } from "../config/learningCatalog.js";
import { extractDocumentContent, getDocumentTitle } from "../utils/documentImport.js";
import {
  listOfflineCourses,
  removeOfflineCourse,
  saveOfflineCourse,
} from "../utils/offlineCourseStore.js";
import "./CoursesPage.css";

const COURSE_IMAGES_BUCKET = "course-images";
const COURSE_IMAGE_CACHE_NAME = "campus-ghana-course-images-v1";
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
  explanation: "",
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
  explanation: typeof question?.explanation === "string" ? question.explanation : "",
});

const hasFillInBlank = (value) =>
  /_{2,}|\bfill\s+in(?:\s+the)?\s+blank\b|\bcomplete(?:s)?\s+(?:the|this)\s+(?:blank|missing\s+(?:word|term)|sentence|statement)\b|\b(?:which|what)\s+(?:word|term)\s+(?:best\s+)?completes?\s+(?:the|this)\s+(?:sentence|statement)\b/i
    .test(String(value || ""));

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
  if (hasFillInBlank(prompt) || options.some((option) => hasFillInBlank(option.text))) {
    return "Fill-in-the-blank questions are not supported. Use a multiple-choice question.";
  }
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
      <legend>Optional instructor-written multiple-choice questions</legend>
      <p>Fill-in-the-blank questions are excluded from course quizzes.</p>
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
          <label>Explanation shown after the quiz
            <textarea className="form-control" rows="2" value={question.explanation || ""}
              onChange={(event) => updateQuestion(question.id, { explanation: event.target.value })} />
          </label>
        </section>
      ))}
      <button className="btn btn-outline" type="button"
        onClick={() => onChange([...questions, newQuizQuestion()])}>
        Add quiz question
      </button>
    </fieldset>
  );
}

function CourseDiscussions({ courseId, lessonId, isAdmin }) {
  const [discussions, setDiscussions] = useState([]);
  const [authorNames, setAuthorNames] = useState({});
  const [message, setMessage] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [authUserId, setAuthUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingDiscussionId, setDeletingDiscussionId] = useState("");
  const [error, setError] = useState("");

  const loadDiscussions = useCallback(async () => {
    if (!supabase || !courseId || !lessonId) {
      setDiscussions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    setDiscussions([]);
    setAuthorNames({});
    try {
      const [{ data: userData, error: userError }, { data, error: discussionError }] = await Promise.all([
        supabase.auth.getUser(),
        supabase
          .from("course_discussions")
          .select("id, parent_id, author_id, body, is_hidden, created_at")
          .eq("course_id", courseId)
          .eq("lesson_id", lessonId)
          .order("created_at", { ascending: true }),
      ]);
      if (userError) throw userError;
      if (discussionError) throw discussionError;
      const discussionRows = data || [];
      const authorIds = [...new Set(discussionRows.map((discussion) => discussion.author_id).filter(Boolean))];
      let names = {};
      if (authorIds.length) {
        const { data: authorRows, error: authorError } = await supabase.rpc(
          "get_course_discussion_author_names",
          { p_course_id: courseId, p_author_ids: authorIds },
        );
        if (authorError) throw authorError;
        names = Object.fromEntries((authorRows || [])
          .map((row) => [row.author_id, row.display_name]));
      }
      setAuthUserId(userData.user?.id || "");
      setAuthorNames(names);
      setDiscussions(discussionRows);
    } catch (loadError) {
      setError(`Lesson discussion could not be loaded: ${loadError.message || "Supabase request failed."}`);
      setDiscussions([]);
    } finally {
      setLoading(false);
    }
  }, [courseId, lessonId]);

  useEffect(() => {
    loadDiscussions();
  }, [loadDiscussions]);

  const submitMessage = async (event) => {
    event.preventDefault();
    const body = message.trim();
    if (!supabase || !body || !courseId || !lessonId) return;

    setSaving(true);
    setError("");
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userData.user?.id) throw new Error("Sign in before posting a course question.");
      const { error: insertError } = await supabase.from("course_discussions").insert({
        course_id: courseId,
        lesson_id: lessonId,
        author_id: userData.user.id,
        parent_id: replyTo || null,
        body,
      });
      if (insertError) throw insertError;
      setMessage("");
      setReplyTo("");
      await loadDiscussions();
    } catch (submitError) {
      setError(`Your discussion message could not be saved: ${submitError.message || "Supabase request failed."}`);
    } finally {
      setSaving(false);
    }
  };

  const toggleHidden = async (discussion) => {
    if (!supabase || !isAdmin) return;
    setError("");
    const { error: updateError } = await supabase
      .from("course_discussions")
      .update({ is_hidden: !discussion.is_hidden })
      .eq("id", discussion.id);
    if (updateError) {
      setError(`Discussion moderation failed: ${updateError.message}`);
      return;
    }
    await loadDiscussions();
  };

  const deleteDiscussion = async (discussion) => {
    const replyWarning = !discussion.parent_id
      ? " Any replies in this thread will also be permanently deleted."
      : "";
    if (!window.confirm(`Delete this discussion message?${replyWarning}`)) return;

    setDeletingDiscussionId(discussion.id);
    setError("");
    try {
      const { data, error: deleteError } = await supabase
        .from("course_discussions")
        .delete()
        .eq("id", discussion.id)
        .select("id")
        .maybeSingle();
      if (deleteError) throw deleteError;
      if (!data) throw new Error("This message could not be deleted. It may already be gone.");
      await loadDiscussions();
    } catch (deleteError) {
      setError(`Discussion message could not be deleted: ${deleteError.message || "Supabase request failed."}`);
    } finally {
      setDeletingDiscussionId("");
    }
  };

  const roots = discussions.filter((discussion) => !discussion.parent_id);
  const authorLabel = (authorId) => {
    const name = authorNames[authorId] || (authorId === authUserId ? "You" : "Course member");
    return authorId === authUserId && name !== "You" ? `${name} (you)` : name;
  };
  return (
    <section className="courses-discussions" aria-labelledby={`discussion-${lessonId}`}>
      <div>
        <span className="courses-eyebrow">LESSON Q&amp;A</span>
        <h3 id={`discussion-${lessonId}`}>Questions and discussion</h3>
        <p>Ask a question about this lesson or reply to a classmate.</p>
      </div>
      {error && <div className="alert alert-warning" role="alert">{error}</div>}
      {loading ? <p role="status">Loading lesson discussion...</p> : (
        <div className="courses-discussion-list">
          {roots.map((root) => (
            <article className={`courses-discussion ${root.is_hidden ? "is-hidden" : ""}`} key={root.id}>
              <p>{root.body}</p>
              <small>{authorLabel(root.author_id)} · {new Date(root.created_at).toLocaleString()}</small>
              <div className="courses-discussion-actions">
                {!root.is_hidden && (
                  <button className="btn btn-outline courses-discussion-action" type="button"
                    onClick={() => setReplyTo(root.id)}>
                    Reply
                  </button>
                )}
                {isAdmin && (
                  <button className="btn btn-outline" type="button" onClick={() => toggleHidden(root)}>
                    {root.is_hidden ? "Restore" : "Hide"}
                  </button>
                )}
                {(isAdmin || root.author_id === authUserId) && (
                  <button className="btn btn-outline courses-delete courses-discussion-action" type="button"
                    disabled={Boolean(deletingDiscussionId)}
                    onClick={() => deleteDiscussion(root)}>
                    {deletingDiscussionId === root.id ? "Deleting..." : "Delete"}
                  </button>
                )}
              </div>
              {discussions.filter((reply) => reply.parent_id === root.id).map((reply) => (
                <div className={`courses-discussion-reply ${reply.is_hidden ? "is-hidden" : ""}`} key={reply.id}>
                  <p>{reply.body}</p>
                  <small>{authorLabel(reply.author_id)} · {new Date(reply.created_at).toLocaleString()}</small>
                  {isAdmin && (
                    <button className="btn btn-outline" type="button" onClick={() => toggleHidden(reply)}>
                      {reply.is_hidden ? "Restore" : "Hide"}
                    </button>
                  )}
                  {(isAdmin || reply.author_id === authUserId) && (
                    <button className="btn btn-outline courses-delete courses-discussion-action" type="button"
                      disabled={Boolean(deletingDiscussionId)}
                      onClick={() => deleteDiscussion(reply)}>
                      {deletingDiscussionId === reply.id ? "Deleting..." : "Delete"}
                    </button>
                  )}
                </div>
              ))}
            </article>
          ))}
          {!roots.length && <p>No questions yet. Start the discussion for this lesson.</p>}
        </div>
      )}
      <form className="courses-discussion-form" onSubmit={submitMessage}>
        <label>
          {replyTo ? (isAdmin ? "Instructor reply" : "Your reply")
            : isAdmin ? "Post an instructor update" : "Ask a question"}
          {replyTo && <button type="button" className="courses-cancel-reply" onClick={() => setReplyTo("")}>Cancel reply</button>}
          <textarea className="form-control" rows="3" maxLength={3000} value={message}
            onChange={(event) => setMessage(event.target.value)} required />
        </label>
        <button className="btn btn-blue" type="submit" disabled={saving || !message.trim()}>
          {saving ? "Posting..." : replyTo ? "Post reply" : isAdmin ? "Post update" : "Post question"}
        </button>
      </form>
    </section>
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

const createsPrerequisiteCycle = (courseId, prerequisites, courses) => {
  if (!courseId) return false;
  const courseById = new Map(courses.map((course) => [course.id, course]));
  const visited = new Set();
  const reachesEditedCourse = (candidateId) => {
    if (candidateId === courseId) return true;
    if (visited.has(candidateId)) return false;
    visited.add(candidateId);
    return (courseById.get(candidateId)?.prerequisites || []).some(reachesEditedCourse);
  };
  return prerequisites.some(reachesEditedCourse);
};

const shuffleQuizQuestions = (questions, previousOrder = []) => {
  const shuffled = [...questions];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  if (shuffled.length > 1
    && shuffled.every((question, index) => question.id === previousOrder[index]?.id)) {
    shuffled.unshift(shuffled.pop());
  }
  return shuffled;
};

const estimateCourseDurationMinutes = (course) => {
  const lessons = Array.isArray(course?.lessons) ? course.lessons : [];
  if (!lessons.length) return null;
  const wordCount = lessons.reduce((count, lesson) => {
    const text = String(lesson?.content || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;|&#160;/gi, " ");
    return count + (text.match(/\S+/g) || []).length;
  }, 0);
  return Math.max(5, Math.ceil(wordCount / 200) + lessons.length * 3);
};

const formatCourseDuration = (minutes) => {
  if (!Number.isFinite(minutes)) return "Estimate unavailable";
  if (minutes < 60) return `Approx. ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `Approx. ${hours} hr${hours === 1 ? "" : "s"}${remainingMinutes ? ` ${remainingMinutes} min` : ""}`;
};

const toDateTimeInputValue = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

const formatCourseDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "No due date"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
};

const downloadLessonNotes = (course, lesson) => {
  const text = `${course.title}\n${lesson.title}\n\n${lesson.content || ""}`;
  const blobUrl = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = `${course.title} - ${lesson.title}.txt`
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-");
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
};

const QUIZ_STOP_WORDS = new Set(
  "about after again against all also among another any are because been before being between both but can could did does doing down during each few for from further had has have having here hers herself him himself his how into its itself just more most nor not off once only other our ours ourselves out over own same she should some such than that the their theirs them themselves then there these they this those through too under until very was were what when where which while who whom why will with would you your".split(" "),
);

const courseTextTerms = (text) => (text.match(/\b[A-Za-z][A-Za-z'-]{3,}\b/g) || [])
  .filter((term) => !QUIZ_STOP_WORDS.has(term.toLowerCase()));
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const LESSON_SECTION_HEADINGS = new Map([
  ["LEARNING OUTCOMES", "Learning outcomes"],
  ["TEACH", "Learn the concept"],
  ["WORKED EXAMPLES", "Worked examples"],
  ["GUIDED ACTIVITY", "Guided practice"],
  ["TRY WORK", "Try it yourself"],
]);

const renderMathText = (text, keyPrefix) => {
  const expression = /(-?\d+)\s*\/\s*(-?\d+)|([A-Za-z0-9]+)\^(-?\d+)/g;
  const nodes = [];
  let lastIndex = 0;
  let match;
  let tokenIndex = 0;

  while ((match = expression.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    if (match[1]) {
      nodes.push(
        <span
          aria-label={`${match[1]} over ${match[2]}`}
          className="courses-math-fraction"
          key={`${keyPrefix}-math-${tokenIndex}`}
          role="math"
        >
          <span>{match[1]}</span>
          <span>{match[2]}</span>
        </span>,
      );
    } else {
      nodes.push(
        <span key={`${keyPrefix}-math-${tokenIndex}`}>
          {match[3]}<sup>{match[4]}</sup>
        </span>,
      );
    }
    lastIndex = expression.lastIndex;
    tokenIndex += 1;
  }

  if (!tokenIndex) return text;
  nodes.push(text.slice(lastIndex));
  return nodes;
};

const renderLessonBlocks = (lines, keyPrefix) => {
  const blocks = [];
  let paragraph = [];
  let listItems = [];
  let blockIndex = 0;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(
      <p key={`${keyPrefix}-paragraph-${blockIndex++}`}>
        {renderMathText(paragraph.join(" "), `${keyPrefix}-paragraph-${blockIndex}`)}
      </p>,
    );
    paragraph = [];
  };

  const flushList = () => {
    if (!listItems.length) return;
    blocks.push(
      <ol key={`${keyPrefix}-list-${blockIndex++}`}>
        {listItems.map((item, index) => (
          <li key={`${keyPrefix}-list-${blockIndex}-${index}`}>
            {renderMathText(item, `${keyPrefix}-list-${blockIndex}-${index}`)}
          </li>
        ))}
      </ol>,
    );
    listItems = [];
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    const heading = LESSON_SECTION_HEADINGS.get(trimmed.toUpperCase());
    const listItem = trimmed.match(/^\d+\.\s+(.+)$/);
    if (!trimmed) {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      blocks.push(<h3 key={`${keyPrefix}-heading-${blockIndex++}`}>{heading}</h3>);
    } else if (listItem) {
      flushParagraph();
      listItems.push(listItem[1]);
    } else {
      flushList();
      paragraph.push(trimmed);
    }
  });

  flushParagraph();
  flushList();
  return blocks;
};

const renderCourseLessonContent = (content) => {
  const lines = String(content || "").split(/\r?\n/);
  const answerStart = lines.findIndex((line) => line.trim().toUpperCase() === "ANSWER GUIDE");
  const lessonLines = answerStart < 0 ? lines : lines.slice(0, answerStart);
  const answerLines = answerStart < 0 ? [] : lines.slice(answerStart + 1);

  return (
    <div className="courses-lesson-body">
      {renderLessonBlocks(lessonLines, "lesson")}
      {answerLines.length > 0 && (
        <details className="courses-lesson-answers">
          <summary>Check your answers after attempting the practice</summary>
          {renderLessonBlocks(answerLines, "answers")}
        </details>
      )}
    </div>
  );
};

const generateCourseQuiz = (course) => {
  const lessons = Array.isArray(course?.lessons) ? course.lessons : [];
  const sentences = lessons.flatMap((lesson, lessonIndex) => {
    const text = String(lesson?.content || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;|&#34;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'");
    return (text.match(/[^.!?\n]+[.!?]?/g) || [])
      .map((sentence) => ({
        lessonIndex,
        lessonTitle: lesson.title || `Lesson ${lessonIndex + 1}`,
        text: sentence.trim().replace(/\s+/g, " "),
      }))
      .filter(({ text: sentence }) => {
        const wordCount = sentence.split(/\s+/).length;
        return wordCount >= 7 && wordCount <= 40 && !hasFillInBlank(sentence);
      });
  });
  const allTerms = [...new Map([
    ...sentences.flatMap(({ text }) => courseTextTerms(text)),
    ...lessons.flatMap((lesson) => courseTextTerms(lesson.title || "")),
    ...courseTextTerms(course?.subject || ""),
  ].map((term) => [term.toLowerCase(), term])).values()];
  const generatedQuestions = [];

  const instructorQuestions = lessons.flatMap((lesson, lessonIndex) =>
    (Array.isArray(lesson.quiz) ? lesson.quiz : [])
      .filter((question) => !getQuizQuestionError(question))
      .map((question, questionIndex) => ({
        ...normalizeQuizQuestion(question),
        id: `instructor-${lessonIndex}-${questionIndex}`,
      })),
  );

  sentences.forEach((sentence, sentenceIndex) => {
    if (generatedQuestions.length >= 10) return;
    const sentenceTerms = new Set(courseTextTerms(sentence.text).map((term) => term.toLowerCase()));
    const answerTerm = courseTextTerms(sentence.text)
      .sort((a, b) => b.length - a.length)
      .find((term) => (sentence.text.match(
        new RegExp(`\\b${escapeRegExp(term)}\\b`, "gi"),
      ) || []).length === 1);
    if (!answerTerm) return;

    const distractors = allTerms.filter((term) =>
      term.toLowerCase() !== answerTerm.toLowerCase()
      && !sentenceTerms.has(term.toLowerCase()))
      .map((term) => sentence.text.replace(
        new RegExp(`\\b${escapeRegExp(answerTerm)}\\b`, "i"),
        term,
      ))
      .filter((statement, index, statements) =>
        statement !== sentence.text && statements.indexOf(statement) === index);
    const options = [sentence.text, ...distractors.slice(0, 3)];
    if (options.length < 2) return;
    const answerIndex = generatedQuestions.length % options.length;
    const positionedOptions = [...options];
    const [answer] = positionedOptions.splice(0, 1);
    positionedOptions.splice(answerIndex, 0, answer);

    generatedQuestions.push({
      id: `generated-${sentence.lessonIndex}-${sentenceIndex}`,
      prompt: `Which statement is accurate according to "${sentence.lessonTitle}"?`,
      explanation: sentence.text,
      options: positionedOptions.map((text, optionIndex) => ({
        id: `generated-${sentence.lessonIndex}-${sentenceIndex}-option-${optionIndex}`,
        text,
      })),
      correctOptionId: `generated-${sentence.lessonIndex}-${sentenceIndex}-option-${answerIndex}`,
    });
  });

  return [...instructorQuestions, ...generatedQuestions].slice(0, 10);
};

const createCourseDraft = (course) => ({
  title: typeof course?.title === "string" ? course.title : "",
  description: typeof course?.description === "string" ? course.description : "",
  subject: typeof course?.subject === "string" ? course.subject : "",
  is_published: typeof course?.is_published === "boolean" ? course.is_published : true,
  due_at: typeof course?.due_at === "string" ? course.due_at : "",
  prerequisites: Array.isArray(course?.prerequisites) ? course.prerequisites : [],
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

export default function CoursesPage({
  mode,
  studentData,
  onPracticeScoreSaved,
  onCourseProgressUpdated,
}) {
  const isAdmin = mode === "admin";
  const studentId = studentData?.id;
  const inferredLevel = getLearningLevelFromClass(
    studentData?.class || studentData?.class_name || "",
  );
  const [courses, setCourses] = useState([]);
  const [courseImageUrls, setCourseImageUrls] = useState({});
  const [enrollments, setEnrollments] = useState([]);
  const [completedByEnrollment, setCompletedByEnrollment] = useState({});
  const [learningStateByEnrollment, setLearningStateByEnrollment] = useState({});
  const [lessonNotesByEnrollment, setLessonNotesByEnrollment] = useState({});
  const [certificatesByEnrollment, setCertificatesByEnrollment] = useState({});
  const [offlineCourseRecords, setOfflineCourseRecords] = useState([]);
  const [adminAnalytics, setAdminAnalytics] = useState([]);
  const [isOffline, setIsOffline] = useState(globalThis.navigator?.onLine === false);
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
  const [showLessonQuiz, setShowLessonQuiz] = useState(false);
  const [lessonQuizQuestions, setLessonQuizQuestions] = useState([]);
  const [lessonQuizQuestionIndex, setLessonQuizQuestionIndex] = useState(0);
  const [lessonQuizAttempt, setLessonQuizAttempt] = useState(0);
  const [lessonQuizAnswers, setLessonQuizAnswers] = useState({});
  const [lessonQuizCorrectionMode, setLessonQuizCorrectionMode] = useState(false);
  const [lessonQuizCorrectionQuestions, setLessonQuizCorrectionQuestions] = useState([]);
  const [lessonQuizCorrectionAnswers, setLessonQuizCorrectionAnswers] = useState({});
  const [lessonQuizInitialAttemptId, setLessonQuizInitialAttemptId] = useState("");
  const [lessonQuizFirstAttemptScore, setLessonQuizFirstAttemptScore] = useState(0);
  const [lessonQuizSubmitted, setLessonQuizSubmitted] = useState(false);
  const [lessonQuizScore, setLessonQuizScore] = useState(0);
  const [lessonQuizPassed, setLessonQuizPassed] = useState(false);
  const [savingLessonQuiz, setSavingLessonQuiz] = useState(false);
  const lessonQuizPageRef = useRef(null);
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

  const restoreOfflineCourses = useCallback(async () => {
    if (isAdmin || !studentId) return false;
    const records = await listOfflineCourses();
    const studentRecords = records.filter((record) => record.studentId === String(studentId));
    if (!studentRecords.length) return false;

    setOfflineCourseRecords(studentRecords);
    setCourses(studentRecords.map((record) => record.course));
    setEnrollments(studentRecords.map((record) => record.enrollment).filter(Boolean));
    setCompletedByEnrollment(Object.fromEntries(studentRecords
      .filter((record) => record.enrollment?.id)
      .map((record) => [record.enrollment.id, new Set(record.completedLessonIds || [])])));
    setLearningStateByEnrollment(Object.fromEntries(studentRecords
      .filter((record) => record.enrollment?.id)
      .map((record) => [record.enrollment.id, { last_lesson_id: record.lastLessonId || null }])));
    setLessonNotesByEnrollment(Object.fromEntries(studentRecords.flatMap((record) =>
      Object.entries(record.lessonNotes || {}).map(([lessonId, note]) => [
        `${record.enrollment?.id}:${lessonId}`,
        note,
      ]))));
    setCertificatesByEnrollment(Object.fromEntries(studentRecords
      .filter((record) => record.enrollment?.id && record.certificate)
      .map((record) => [record.enrollment.id, record.certificate])));
    setCourseImageUrls(Object.assign({}, ...studentRecords.map((record) => record.imageUrls || {})));
    setIsOffline(true);
    setNotice("Offline mode: saved courses are available to read. Quizzes, discussions, and syncing require an internet connection.");
    setError("");
    return true;
  }, [isAdmin, studentId]);

  const loadCourses = useCallback(async () => {
    if (!supabase) {
      try {
        const restored = await restoreOfflineCourses();
        if (!restored) {
          setError("Courses are unavailable because Supabase is not configured and no offline courses are saved.");
          setCourses([]);
        }
      } catch (offlineError) {
        setError(`Courses are unavailable because Supabase is not configured. Offline storage failed: ${offlineError.message}`);
      }
      setLoading(false);
      return;
    }

    setLoading(true);
    setIsOffline(false);
    setError("");
    try {
      const { data: courseRows, error: courseError } = await supabase
        .from("courses")
        .select("*")
        .order("created_at", { ascending: false });
      if (courseError) throw courseError;
      setCourses(courseRows || []);

      if (isAdmin) {
        setEnrollments([]);
        setCompletedByEnrollment({});
        const courseIds = (courseRows || []).map((course) => course.id);
        if (courseIds.length) {
          const { data: enrollmentRows, error: enrollmentError } = await supabase
            .from("course_enrollments")
            .select("id, course_id")
            .in("course_id", courseIds);
          if (enrollmentError) throw enrollmentError;
          const enrollmentsForCourses = enrollmentRows || [];
          const enrollmentIds = enrollmentsForCourses.map((row) => row.id);
          const [progressResponse, attemptResponse] = enrollmentIds.length
            ? await Promise.all([
                supabase
                  .from("course_lesson_progress")
                  .select("enrollment_id, lesson_id")
                  .in("enrollment_id", enrollmentIds)
                  .eq("quiz_passed", true),
                supabase
                  .from("course_quiz_attempts")
                  .select("course_id, percentage")
                  .in("course_id", courseIds),
              ])
            : [{ data: [], error: null }, { data: [], error: null }];
          if (progressResponse.error) throw progressResponse.error;
          if (attemptResponse.error) throw attemptResponse.error;

          const enrollmentCourse = new Map(enrollmentsForCourses
            .map((row) => [row.id, row.course_id]));
          const completedByCourse = new Map();
          (progressResponse.data || []).forEach((row) => {
            const courseId = enrollmentCourse.get(row.enrollment_id);
            if (courseId) {
              completedByCourse.set(courseId, (completedByCourse.get(courseId) || 0) + 1);
            }
          });
          const attemptsByCourse = new Map();
          (attemptResponse.data || []).forEach((row) => {
            const aggregate = attemptsByCourse.get(row.course_id) || { total: 0, count: 0 };
            aggregate.total += Number(row.percentage) || 0;
            aggregate.count += 1;
            attemptsByCourse.set(row.course_id, aggregate);
          });
          setAdminAnalytics(courseRows.map((course) => {
            const totalLessons = course.lessons?.length || 0;
            const enrolledCount = enrollmentsForCourses
              .filter((row) => row.course_id === course.id).length;
            const attempts = attemptsByCourse.get(course.id);
            return {
              courseId: course.id,
              enrolledCount,
              completedChapters: completedByCourse.get(course.id) || 0,
              possibleChapters: totalLessons * enrolledCount,
              averageQuizScore: attempts?.count ? Math.round(attempts.total / attempts.count) : null,
            };
          }));
        } else {
          setAdminAnalytics([]);
        }
      } else if (studentId) {
        const { data: enrollmentRows, error: enrollmentError } = await supabase
          .from("course_enrollments")
          .select("id, course_id, enrolled_at")
          .eq("student_id", studentId)
          .order("enrolled_at", { ascending: false });
        if (enrollmentError) throw enrollmentError;
        const nextEnrollments = enrollmentRows || [];
        setEnrollments(nextEnrollments);

        let progress = {};
        let learningState = {};
        let certificates = {};
        let serverNotes = [];
        if (nextEnrollments.length) {
          const enrollmentIds = nextEnrollments.map((enrollment) => enrollment.id);
          const [progressResponse, stateResponse, notesResponse, certificateResponse] = await Promise.all([
            supabase
              .from("course_lesson_progress")
              .select("enrollment_id, lesson_id")
              .in("enrollment_id", enrollmentIds)
              .eq("quiz_passed", true),
            supabase
              .from("course_learning_state")
              .select("enrollment_id, last_lesson_id")
              .in("enrollment_id", enrollmentIds),
            supabase
              .from("course_lesson_notes")
              .select("enrollment_id, lesson_id, note, bookmarked")
              .in("enrollment_id", enrollmentIds),
            supabase
              .from("course_certificates")
              .select("id, enrollment_id, course_title, issued_at")
              .in("enrollment_id", enrollmentIds),
          ]);
          if (progressResponse.error) throw progressResponse.error;
          if (stateResponse.error) throw stateResponse.error;
          if (notesResponse.error) throw notesResponse.error;
          if (certificateResponse.error) throw certificateResponse.error;
          progress = {};
          (progressResponse.data || []).forEach(({ enrollment_id, lesson_id }) => {
            (progress[enrollment_id] ||= new Set()).add(lesson_id);
          });
          learningState = Object.fromEntries((stateResponse.data || [])
            .map((row) => [row.enrollment_id, row]));
          certificates = Object.fromEntries((certificateResponse.data || [])
            .map((row) => [row.enrollment_id, row]));
          serverNotes = notesResponse.data || [];
        }
        setCompletedByEnrollment(progress);
        setLearningStateByEnrollment(learningState);
        setCertificatesByEnrollment(certificates);

        let storedCourses = [];
        try {
          storedCourses = (await listOfflineCourses())
            .filter((record) => record.studentId === String(studentId));
        } catch (offlineStorageError) {
          setError(`Offline course storage is unavailable: ${offlineStorageError.message}`);
        }
        setOfflineCourseRecords(storedCourses);

        const mergedNotes = new Map(serverNotes.map((row) => [
          `${row.enrollment_id}:${row.lesson_id}`,
          row,
        ]));
        const pendingNotes = [];
        storedCourses.forEach((record) => {
          Object.entries(record.lessonNotes || {}).forEach(([lessonId, note]) => {
            if (!record.enrollment?.id) return;
            const key = `${record.enrollment.id}:${lessonId}`;
            if (note.pendingSync) pendingNotes.push({ record, lessonId, note });
            if (note.pendingSync || !mergedNotes.has(key)) {
              mergedNotes.set(key, {
                enrollment_id: record.enrollment.id,
                lesson_id: lessonId,
                note: note.note || "",
                bookmarked: Boolean(note.bookmarked),
                pendingSync: Boolean(note.pendingSync),
              });
            }
          });
        });
        setLessonNotesByEnrollment(Object.fromEntries(mergedNotes));

        if (pendingNotes.length) {
          const syncResults = await Promise.all(pendingNotes.map(async ({ record, lessonId, note }) => {
            const { error: syncError } = await supabase.from("course_lesson_notes").upsert({
              enrollment_id: record.enrollment.id,
              lesson_id: lessonId,
              note: note.note || "",
              bookmarked: Boolean(note.bookmarked),
              updated_at: new Date().toISOString(),
            }, { onConflict: "enrollment_id,lesson_id" });
            return { record, lessonId, note, error: syncError };
          }));
          const failedSyncs = syncResults.filter((result) => result.error);
          const updatedRecords = [...storedCourses];
          for (const result of syncResults.filter((item) => !item.error)) {
            const recordIndex = updatedRecords.findIndex((record) =>
              record.courseId === result.record.courseId);
            if (recordIndex < 0) continue;
            const record = updatedRecords[recordIndex];
            updatedRecords[recordIndex] = {
              ...record,
              lessonNotes: {
                ...record.lessonNotes,
                [result.lessonId]: { ...result.note, pendingSync: false },
              },
            };
            try {
              await saveOfflineCourse(updatedRecords[recordIndex]);
            } catch (offlineStorageError) {
              setError(`Offline note synced, but its local copy could not be updated: ${offlineStorageError.message}`);
            }
          }
          setOfflineCourseRecords(updatedRecords);
          if (failedSyncs.length) {
            setError(`Some offline notes could not be synced: ${failedSyncs[0].error.message}`);
          }
        }
      } else {
        setEnrollments([]);
        setCompletedByEnrollment({});
        setLearningStateByEnrollment({});
        setLessonNotesByEnrollment({});
        setCertificatesByEnrollment({});
      }
    } catch (loadError) {
      try {
        const restored = await restoreOfflineCourses();
        if (!restored) {
          setError(`Courses could not be loaded: ${loadError.message || "Supabase request failed."}`);
        }
      } catch (offlineError) {
        setError(`Courses could not be loaded: ${loadError.message || "Supabase request failed."} Offline copy unavailable: ${offlineError.message}`);
      }
    } finally {
      setLoading(false);
    }
  }, [isAdmin, restoreOfflineCourses, studentId]);

  useEffect(() => {
    loadCourses();
  }, [loadCourses]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      loadCourses();
    };
    const handleOffline = () => setIsOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [loadCourses]);

  useEffect(() => {
    if (!courses.length) {
      setCourseImageUrls({});
      return undefined;
    }
    if (!supabase || isOffline) return undefined;

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
  }, [courses, isOffline]);

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
  const upcomingDeadlines = useMemo(() => {
    const now = Date.now();
    const reminderWindow = now + (7 * 24 * 60 * 60 * 1000);
    return courses
      .filter((course) => {
        const enrollment = enrollmentByCourse.get(course.id);
        const dueAt = Date.parse(course.due_at || "");
        const progress = enrollment
          ? courseProgress(course, completedByEnrollment[enrollment.id] || new Set())
          : 100;
        return enrollment && Number.isFinite(dueAt) && progress < 100
          && (dueAt <= reminderWindow);
      })
      .sort((left, right) => Date.parse(left.due_at) - Date.parse(right.due_at));
  }, [courses, enrollmentByCourse, completedByEnrollment]);
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
  const activeLessonIndex = activeCourse?.lessons?.findIndex((lesson) => lesson.id === activeLessonId) ?? -1;
  const nextLesson = activeLessonIndex >= 0
    ? activeCourse?.lessons?.[activeLessonIndex + 1]
    : null;
  const studentDisplayName = studentData?.full_name || studentData?.name || "Student";
  const lessonQuizPreview = useMemo(
    () => activeCourse && activeLesson
      ? generateCourseQuiz({ ...activeCourse, lessons: [activeLesson] })
      : [],
    [activeCourse, activeLesson],
  );
  const activeQuizQuestion = lessonQuizQuestions[lessonQuizQuestionIndex];
  const activeLessonNote = activeEnrollment && activeLesson
    ? lessonNotesByEnrollment[`${activeEnrollment.id}:${activeLesson.id}`]
    : null;
  const activeCourseCertificate = activeEnrollment
    ? certificatesByEnrollment[activeEnrollment.id]
    : null;
  const savedOfflineCourseIds = new Set(offlineCourseRecords.map((record) => record.courseId));

  const unmetPrerequisites = (course) => (course.prerequisites || [])
    .map((courseId) => courses.find((item) => item.id === courseId))
    .filter((prerequisite) => {
      if (!prerequisite) return true;
      const enrollment = enrollmentByCourse.get(prerequisite.id);
      return !enrollment
        || courseProgress(prerequisite, completedByEnrollment[enrollment.id] || new Set()) < 100;
    });

  useEffect(() => {
    setShowLessonQuiz(false);
    setLessonQuizQuestions([]);
    setLessonQuizQuestionIndex(0);
    setLessonQuizAnswers({});
    setLessonQuizCorrectionMode(false);
    setLessonQuizCorrectionQuestions([]);
    setLessonQuizCorrectionAnswers({});
    setLessonQuizInitialAttemptId("");
    setLessonQuizFirstAttemptScore(0);
    setLessonQuizSubmitted(false);
    setLessonQuizScore(0);
    setLessonQuizPassed(false);
  }, [activeCourseId, activeLessonId]);

  useEffect(() => {
    if (showLessonQuiz) {
      lessonQuizPageRef.current?.scrollIntoView({ block: "start" });
    }
  }, [lessonQuizAttempt, lessonQuizQuestionIndex, showLessonQuiz]);

  useEffect(() => {
    if (!activeCourse || activeLessonId || isAdmin) return;
    const activeEnrollmentForCourse = enrollmentByCourse.get(activeCourse.id);
    const lastLessonId = activeEnrollmentForCourse
      ? learningStateByEnrollment[activeEnrollmentForCourse.id]?.last_lesson_id
      : null;
    const completed = activeEnrollmentForCourse
      ? completedByEnrollment[activeEnrollmentForCourse.id] || new Set()
      : new Set();
    const lastIndex = (activeCourse.lessons || []).findIndex((lesson) => lesson.id === lastLessonId);
    const nextIndex = (activeCourse.lessons || []).findIndex((lesson) => !completed.has(lesson.id));
    const resumeIndex = lastIndex >= 0
      && (lastIndex === 0 || (activeCourse.lessons || []).slice(0, lastIndex)
        .every((lesson) => completed.has(lesson.id)))
      ? lastIndex
      : nextIndex >= 0 ? nextIndex : 0;
    const lessonId = activeCourse.lessons?.[resumeIndex]?.id;
    if (lessonId) setActiveLessonId(lessonId);
  }, [activeCourse, activeLessonId, isAdmin, enrollmentByCourse, learningStateByEnrollment, completedByEnrollment]);

  useEffect(() => {
    if (isAdmin || !activeEnrollment || !activeLesson || !activeCourse) return;
    if (learningStateByEnrollment[activeEnrollment.id]?.last_lesson_id === activeLesson.id) return;

    const saveLastLesson = async () => {
      if (isOffline || !supabase) {
        setLearningStateByEnrollment((current) => ({
          ...current,
          [activeEnrollment.id]: { last_lesson_id: activeLesson.id },
        }));
        const savedRecord = offlineCourseRecords.find((record) =>
          record.courseId === String(activeCourse.id));
        if (savedRecord) {
          await saveOfflineCourse({ ...savedRecord, lastLessonId: activeLesson.id });
          setOfflineCourseRecords((current) => current.map((record) =>
            record.courseId === String(activeCourse.id)
              ? { ...record, lastLessonId: activeLesson.id }
              : record));
        }
        return;
      }

      const { error: stateError } = await supabase
        .from("course_learning_state")
        .upsert({
          enrollment_id: activeEnrollment.id,
          last_lesson_id: activeLesson.id,
          updated_at: new Date().toISOString(),
        }, { onConflict: "enrollment_id" });
      if (stateError) {
        setError(`Your last lesson could not be saved: ${stateError.message}`);
        return;
      }
      setLearningStateByEnrollment((current) => ({
        ...current,
        [activeEnrollment.id]: { last_lesson_id: activeLesson.id },
      }));
    };

    saveLastLesson().catch((saveError) => {
      setError(`Your last lesson could not be saved: ${saveError.message || "Offline storage failed."}`);
    });
  }, [
    activeCourse,
    activeEnrollment,
    activeLesson,
    isAdmin,
    isOffline,
    learningStateByEnrollment,
    offlineCourseRecords,
  ]);

  const startNewCourse = () => setEditingCourse({
    id: "",
    title: "",
    description: "",
    subject: "",
    education_level: "all",
    is_published: true,
    due_at: "",
    prerequisites: [],
    lessons: [newLesson()],
  });

  const openCourse = (course) => {
    const enrollment = enrollmentByCourse.get(course.id);
    const completed = enrollment
      ? completedByEnrollment[enrollment.id] || new Set()
      : new Set();
    const lastLessonId = enrollment
      ? learningStateByEnrollment[enrollment.id]?.last_lesson_id
      : null;
    const lastIndex = (course.lessons || []).findIndex((lesson) => lesson.id === lastLessonId);
    const firstIncomplete = (course.lessons || []).findIndex((lesson) => !completed.has(lesson.id));
    const lessonIndex = lastIndex >= 0
      && (lastIndex === 0 || (course.lessons || []).slice(0, lastIndex)
        .every((lesson) => completed.has(lesson.id)))
      ? lastIndex
      : firstIncomplete >= 0 ? firstIncomplete : 0;
    setActiveCourseId(course.id);
    setActiveLessonId(course.lessons?.[lessonIndex]?.id || "");
    setShowLessonQuiz(false);
  };

  const saveCourseForOffline = async (course) => {
    const enrollment = enrollmentByCourse.get(course.id);
    if (!studentId || !enrollment) {
      setError("Enroll in this course before saving it for offline use.");
      return;
    }

    setError("");
    try {
      const imageUrls = Object.fromEntries(getCourseImagePaths(course)
        .filter((path) => courseImageUrls[path])
        .map((path) => [path, courseImageUrls[path]]));
      const record = {
        course,
        enrollment,
        studentId: String(studentId),
        completedLessonIds: [...(completedByEnrollment[enrollment.id] || new Set())],
        lastLessonId: learningStateByEnrollment[enrollment.id]?.last_lesson_id || null,
        certificate: certificatesByEnrollment[enrollment.id] || null,
        lessonNotes: Object.fromEntries((course.lessons || []).map((lesson) => [
          lesson.id,
          lessonNotesByEnrollment[`${enrollment.id}:${lesson.id}`] || {
            note: "",
            bookmarked: false,
            pendingSync: false,
          },
        ])),
        imageUrls,
      };
      await saveOfflineCourse(record);
      let uncachedImageCount = 0;
      if (Object.keys(imageUrls).length) {
        try {
          const imageCache = await globalThis.caches.open(COURSE_IMAGE_CACHE_NAME);
          for (const imageUrl of Object.values(imageUrls)) {
            try {
              const response = await fetch(imageUrl);
              if (!response.ok) throw new Error(`Image request returned ${response.status}.`);
              await imageCache.put(imageUrl, response.clone());
            } catch {
              uncachedImageCount += 1;
            }
          }
        } catch {
          uncachedImageCount = Object.keys(imageUrls).length;
        }
      }
      setOfflineCourseRecords((current) => [
        ...current.filter((item) => item.courseId !== String(course.id)),
        { ...record, courseId: String(course.id) },
      ]);
      setNotice(uncachedImageCount
        ? `"${course.title}" is saved for offline reading. ${uncachedImageCount} image${uncachedImageCount === 1 ? "" : "s"} could not be cached.`
        : `"${course.title}" is saved on this device for offline reading.`);
    } catch (offlineError) {
      setError(`Course could not be saved for offline use: ${offlineError.message}`);
    }
  };

  const removeCourseOffline = async (course) => {
    try {
      const savedRecord = offlineCourseRecords.find((record) =>
        record.courseId === String(course.id));
      await removeOfflineCourse(course.id);
      setOfflineCourseRecords((current) =>
        current.filter((record) => record.courseId !== String(course.id)));
      setNotice(`"${course.title}" was removed from this device's offline courses.`);
      const imageUrlsInUse = new Set(offlineCourseRecords
        .filter((record) => record.courseId !== String(course.id))
        .flatMap((record) => Object.values(record.imageUrls || {})));
      const removedImageUrls = Object.values(savedRecord?.imageUrls || {})
        .filter((url) => !imageUrlsInUse.has(url));
      if (removedImageUrls.length) {
        try {
          const imageCache = await globalThis.caches.open(COURSE_IMAGE_CACHE_NAME);
          await Promise.all(removedImageUrls.map((url) => imageCache.delete(url)));
        } catch (cacheError) {
          setError(`Course was removed, but some cached images could not be removed: ${cacheError.message}`);
        }
      }
    } catch (offlineError) {
      setError(`Saved course could not be removed: ${offlineError.message}`);
    }
  };

  const saveLessonNote = async (note, bookmarked) => {
    if (!activeEnrollment || !activeLesson) return;
    setError("");
    const key = `${activeEnrollment.id}:${activeLesson.id}`;
    const entry = {
      enrollment_id: activeEnrollment.id,
      lesson_id: activeLesson.id,
      note: String(note || "").slice(0, 5000),
      bookmarked: Boolean(bookmarked),
      updated_at: new Date().toISOString(),
    };
    if (isOffline || !supabase) {
      const savedRecord = offlineCourseRecords.find((record) =>
        record.courseId === String(activeCourse?.id));
      if (!savedRecord) {
        setError("Save this course for offline use before editing notes without a connection.");
        return;
      }
      const localEntry = { ...entry, pendingSync: true };
      try {
        await saveOfflineCourse({
          ...savedRecord,
          lessonNotes: { ...savedRecord.lessonNotes, [activeLesson.id]: localEntry },
        });
        setLessonNotesByEnrollment((current) => ({ ...current, [key]: localEntry }));
        setOfflineCourseRecords((current) => current.map((record) =>
          record.courseId === String(activeCourse.id)
            ? { ...record, lessonNotes: { ...record.lessonNotes, [activeLesson.id]: localEntry } }
            : record));
        setNotice("Note saved on this device. It will sync when you reconnect.");
      } catch (offlineError) {
        setError(`Offline note could not be saved: ${offlineError.message}`);
      }
      return;
    }

    const { data, error: noteError } = await supabase
      .from("course_lesson_notes")
      .upsert(entry, { onConflict: "enrollment_id,lesson_id" })
      .select("enrollment_id, lesson_id, note, bookmarked")
      .single();
    if (noteError) {
      setError(`Lesson note could not be saved: ${noteError.message}`);
      return;
    }
    setLessonNotesByEnrollment((current) => ({ ...current, [key]: data }));
    const savedRecord = offlineCourseRecords.find((record) =>
      record.courseId === String(activeCourse?.id));
    if (savedRecord) {
      try {
        const updatedRecord = {
          ...savedRecord,
          lessonNotes: { ...savedRecord.lessonNotes, [activeLesson.id]: data },
        };
        await saveOfflineCourse(updatedRecord);
        setOfflineCourseRecords((current) => current.map((record) =>
          record.courseId === updatedRecord.courseId ? updatedRecord : record));
      } catch (offlineError) {
        setError(`Lesson note was saved online but not cached offline: ${offlineError.message}`);
      }
    }
    setNotice(data.bookmarked ? "Lesson bookmark and note saved." : "Lesson note saved.");
  };

  const downloadCourseCertificate = async (course, enrollment) => {
    if (!enrollment) return;
    setError("");
    try {
      let certificate = certificatesByEnrollment[enrollment.id];
      if (!certificate) {
        if (!supabase || isOffline) {
          throw new Error("No saved certificate is available offline. Reconnect and try again.");
        }
        const { data, error: certificateError } = await supabase
          .from("course_certificates")
          .select("id, enrollment_id, course_title, issued_at")
          .eq("enrollment_id", enrollment.id)
          .maybeSingle();
        if (certificateError) throw certificateError;
        if (!data) throw new Error("The completion certificate has not been issued yet.");
        certificate = data;
        setCertificatesByEnrollment((current) => ({
          ...current,
          [enrollment.id]: certificate,
        }));
      }

      const pdf = new jsPDF({ orientation: "landscape" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      pdf.setFillColor(239, 248, 250);
      pdf.rect(12, 12, pageWidth - 24, 186, "F");
      pdf.setDrawColor(22, 107, 139);
      pdf.setLineWidth(1.2);
      pdf.rect(18, 18, pageWidth - 36, 174);
      pdf.setTextColor(18, 59, 112);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(25);
      pdf.text("CERTIFICATE OF COMPLETION", pageWidth / 2, 55, { align: "center" });
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(14);
      pdf.text("This certifies that", pageWidth / 2, 78, { align: "center" });
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(24);
      pdf.text(studentData?.full_name || studentData?.name || "Student", pageWidth / 2, 98, {
        align: "center",
        maxWidth: pageWidth - 50,
      });
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(14);
      pdf.text("has successfully completed", pageWidth / 2, 117, { align: "center" });
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(20);
      pdf.text(certificate.course_title || course.title, pageWidth / 2, 137, {
        align: "center",
        maxWidth: pageWidth - 50,
      });
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.text(`Issued ${formatCourseDate(certificate.issued_at)} · Certificate ${certificate.id}`,
        pageWidth / 2, 166, { align: "center", maxWidth: pageWidth - 50 });
      pdf.save(`${course.title} - Certificate.pdf`.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-"));
    } catch (certificateError) {
      setError(`Certificate could not be downloaded: ${certificateError.message}`);
    }
  };

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
    const prerequisites = (editingCourse.prerequisites || []).filter(Boolean);
    if (prerequisites.includes(editingCourse.id)
      || createsPrerequisiteCycle(editingCourse.id, prerequisites, courses)) {
      setError("Prerequisite courses cannot create a circular learning path.");
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
        due_at: editingCourse.due_at ? new Date(editingCourse.due_at).toISOString() : null,
        prerequisites: prerequisites.filter((id) => id !== editingCourse.id),
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
          due_at: course.due_at ? new Date(course.due_at).toISOString() : null,
          prerequisites: (course.prerequisites || []).filter(Boolean),
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
      due_at: null,
      prerequisites: [],
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
    const unmet = unmetPrerequisites(course);
    if (unmet.length) {
      setError(`Complete these prerequisite courses first: ${unmet.map((item) => item?.title || "Unavailable course").join(", ")}.`);
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

  const startLessonQuiz = () => {
    const previousOrder = lessonQuizQuestions.length ? lessonQuizQuestions : lessonQuizPreview;
    setLessonQuizQuestions(shuffleQuizQuestions(lessonQuizPreview, previousOrder));
    setLessonQuizQuestionIndex(0);
    setLessonQuizAnswers({});
    setLessonQuizCorrectionMode(false);
    setLessonQuizCorrectionQuestions([]);
    setLessonQuizCorrectionAnswers({});
    setLessonQuizInitialAttemptId("");
    setLessonQuizFirstAttemptScore(0);
    setLessonQuizSubmitted(false);
    setLessonQuizScore(0);
    setLessonQuizPassed(false);
    setLessonQuizAttempt((current) => current + 1);
    setShowLessonQuiz(true);
  };

  const submitLessonQuiz = async (event) => {
    event.preventDefault();
    if (!supabase || !studentId || !activeEnrollment || !activeCourse || !activeLesson) {
      setError("Your student account could not be linked to this course quiz.");
      return;
    }
    if (!lessonQuizQuestions.length) {
      setError("This chapter does not have enough content to create a quiz.");
      return;
    }
    if (lessonQuizCorrectionMode
      && (!lessonQuizInitialAttemptId
        || !lessonQuizCorrectionQuestions.length
        || lessonQuizCorrectionQuestions.some((question) => !lessonQuizCorrectionAnswers[question.id]))) {
      setError("Answer every correction before submitting the resit.");
      return;
    }
    if (!lessonQuizCorrectionMode
      && Object.keys(lessonQuizAnswers).length < lessonQuizQuestions.length) {
      setError("Answer every quiz question before submitting.");
      return;
    }

    const firstAttemptCorrectCount = lessonQuizQuestions.filter((question) =>
      lessonQuizAnswers[question.id] === question.correctOptionId).length;
    const correctionCorrectCount = lessonQuizCorrectionQuestions.filter((question) =>
      lessonQuizCorrectionAnswers[question.id] === question.correctOptionId).length;
    const attemptCorrectCount = lessonQuizCorrectionMode
      ? correctionCorrectCount
      : firstAttemptCorrectCount;
    const attemptQuestionCount = lessonQuizCorrectionMode
      ? lessonQuizCorrectionQuestions.length
      : lessonQuizQuestions.length;
    const attempt = {
      student_id: studentId,
      enrollment_id: activeEnrollment.id,
      course_id: activeCourse.id,
      lesson_id: activeLesson.id,
      course_title: activeCourse.title,
      lesson_title: activeLesson.title,
      correct_count: attemptCorrectCount,
      total_questions: attemptQuestionCount,
      percentage: Math.round((attemptCorrectCount / attemptQuestionCount) * 100),
      attempt_type: lessonQuizCorrectionMode ? "resit" : "initial",
      resit_of_attempt_id: lessonQuizCorrectionMode ? lessonQuizInitialAttemptId : null,
    };

    setSavingLessonQuiz(true);
    setError("");
    try {
      const { data: savedAttempt, error: attemptError } = await supabase
        .from("course_quiz_attempts")
        .insert(attempt)
        .select("id, course_id, lesson_id, course_title, lesson_title, correct_count, total_questions, percentage, created_at, attempt_type, resit_of_attempt_id")
        .single();
      if (attemptError) throw attemptError;

      if (!lessonQuizCorrectionMode) {
        const incorrectQuestions = lessonQuizQuestions.filter((question) =>
          lessonQuizAnswers[question.id] !== question.correctOptionId);
        onPracticeScoreSaved?.(savedAttempt);
        if (incorrectQuestions.length) {
          setLessonQuizFirstAttemptScore(firstAttemptCorrectCount);
          setLessonQuizCorrectionQuestions(incorrectQuestions);
          setLessonQuizCorrectionAnswers({});
          setLessonQuizInitialAttemptId(savedAttempt.id);
          setLessonQuizCorrectionMode(true);
          setLessonQuizAttempt((current) => current + 1);
          return;
        }
      }

      const finalCorrectCount = lessonQuizCorrectionMode
        ? lessonQuizFirstAttemptScore + correctionCorrectCount
        : firstAttemptCorrectCount;
      const passed = isPassingScore(finalCorrectCount, lessonQuizQuestions.length);
      let nextCompleted = activeCompleted;
      if (passed && !activeCompleted.has(activeLesson.id)) {
        const { error: progressError } = await supabase
          .from("course_lesson_progress")
          .upsert({
            enrollment_id: activeEnrollment.id,
            lesson_id: activeLesson.id,
            quiz_passed: true,
          }, { onConflict: "enrollment_id,lesson_id" });
        if (progressError) {
          setError(`Quiz score was saved, but progress could not be updated: ${progressError.message}`);
        } else {
          nextCompleted = new Set(activeCompleted);
          nextCompleted.add(activeLesson.id);
          setCompletedByEnrollment((current) => ({
            ...current,
            [activeEnrollment.id]: nextCompleted,
          }));
        }
      }

      setLessonQuizScore(finalCorrectCount);
      setLessonQuizSubmitted(true);
      setLessonQuizPassed(passed);
      if (lessonQuizCorrectionMode) onPracticeScoreSaved?.(savedAttempt);

      if (nextCompleted !== activeCompleted) {
        const progressItems = courses
          .filter((course) => course.is_published && enrollmentByCourse.has(course.id))
          .map((course) => {
            const enrollment = enrollmentByCourse.get(course.id);
            const completed = enrollment.id === activeEnrollment.id
              ? nextCompleted
              : completedByEnrollment[enrollment.id] || new Set();
            const totalLessons = course.lessons?.length || 0;
            const completedCount = (course.lessons || [])
              .filter((lesson) => completed.has(lesson.id)).length;
            return {
              courseId: course.id,
              title: course.title || "Course",
              percent: totalLessons ? Math.round((completedCount / totalLessons) * 100) : 0,
              completedCount,
              totalLessons,
            };
          });
        onCourseProgressUpdated?.({
          enrolledCount: progressItems.length,
          completedCount: progressItems.filter((item) => item.percent >= 100).length,
          averageCompletion: progressItems.length
            ? Math.round(progressItems.reduce((sum, item) => sum + item.percent, 0) / progressItems.length)
            : 0,
          progressItems,
        });
      }
    } catch (submitError) {
      setError(`Quiz score could not be saved: ${submitError.message || "Supabase request failed."}`);
    } finally {
      setSavingLessonQuiz(false);
    }
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
      {!isAdmin && upcomingDeadlines.length > 0 && (
        <section className="courses-deadline-reminders" aria-labelledby="course-deadline-heading">
          <div>
            <span className="courses-eyebrow">COURSE REMINDERS</span>
            <h2 id="course-deadline-heading">Upcoming deadlines</h2>
          </div>
          <ul>
            {upcomingDeadlines.map((course) => {
              const overdue = Date.parse(course.due_at) < Date.now();
              return (
                <li key={course.id} className={overdue ? "is-overdue" : ""}>
                  <strong>{course.title}</strong>
                  <span>{overdue ? "Overdue" : "Due"} · {formatCourseDate(course.due_at)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
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
                      <label>Course deadline
                        <input className="form-control" type="datetime-local" disabled={disabled}
                          value={toDateTimeInputValue(entry.course.due_at)}
                          onChange={(event) => updateCourse({ due_at: event.target.value })} />
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
                <label>Course deadline
                  <input className="form-control" type="datetime-local"
                    value={toDateTimeInputValue(editingCourse.due_at)}
                    onChange={(event) => setEditingCourse({ ...editingCourse, due_at: event.target.value })} />
                </label>
                <label>Prerequisite courses
                  <select className="form-control" multiple
                    value={editingCourse.prerequisites || []}
                    onChange={(event) => setEditingCourse({
                      ...editingCourse,
                      prerequisites: [...event.target.selectedOptions].map((option) => option.value),
                    })}>
                    {courses.filter((course) => course.id !== editingCourse.id).map((course) => (
                      <option key={course.id} value={course.id}>{course.title}</option>
                    ))}
                  </select>
                  <small>Select courses learners must complete before they can enroll.</small>
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
                  {editingCourse.id && (
                    <CourseDiscussions
                      courseId={editingCourse.id}
                      lessonId={lesson.id}
                      isAdmin
                    />
                  )}
                </section>
              ))}
              <button className="btn btn-blue" type="submit" disabled={saving}>
                {saving ? "Saving..." : editingCourse.id ? "Save changes" : "Create course"}
              </button>
            </form>
          )}

          <section className="courses-admin-analytics" aria-labelledby="course-analytics-heading">
            <div className="courses-editor-heading">
              <div>
                <span className="courses-eyebrow">INSTRUCTOR INSIGHTS</span>
                <h2 id="course-analytics-heading">Course progress analytics</h2>
              </div>
              <span>Aggregated student progress and quiz results</span>
            </div>
            <div className="courses-analytics-grid">
              {courses.map((course) => {
                const analytics = adminAnalytics.find((item) => item.courseId === course.id);
                return (
                  <article key={course.id}>
                    <strong>{course.title}</strong>
                    <span>{analytics?.enrolledCount ?? "—"} enrolled</span>
                    <span>
                      {analytics?.possibleChapters
                        ? `${analytics.completedChapters} of ${analytics.possibleChapters} chapter completions`
                        : "No chapter completions"}
                    </span>
                    <span>
                      {analytics?.averageQuizScore === null || analytics?.averageQuizScore === undefined
                        ? "No quiz attempts"
                        : `${analytics.averageQuizScore}% mean quiz attempt score`}
                    </span>
                  </article>
                );
              })}
              {!courses.length && <p>Create a course to see learning analytics.</p>}
            </div>
          </section>

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
        showLessonQuiz ? (
          <section className="courses-chapter-quiz-page">
            <button className="btn btn-outline courses-quiz-back" type="button"
              onClick={() => setShowLessonQuiz(false)} disabled={savingLessonQuiz}>
              Back to chapter
            </button>
            <div className="card card-padded courses-chapter-quiz-card">
              <span className="courses-eyebrow">
                {lessonQuizCorrectionMode ? "QUIZ RESIT" : "CHAPTER QUIZ"}
              </span>
              <h2>{activeLesson?.title}</h2>
              <p className="courses-chapter-quiz-intro">
                {lessonQuizCorrectionMode
                  ? `Your first attempt scored ${lessonQuizFirstAttemptScore} of ${lessonQuizQuestions.length}. Correct only the questions below. These corrections are a resit; your final score keeps your original correct answers and adds correct resit answers.`
                  : "Answer all questions. Any incorrect answers will be collected for corrections after you submit the full quiz."}
              </p>
              {lessonQuizQuestions.length ? (
                <form onSubmit={submitLessonQuiz}>
                  {!lessonQuizCorrectionMode && !lessonQuizSubmitted && activeQuizQuestion && (
                    <>
                      <div className="courses-quiz-question-progress" aria-live="polite">
                        <span>Question {lessonQuizQuestionIndex + 1} of {lessonQuizQuestions.length}</span>
                        <div
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={lessonQuizQuestions.length}
                          aria-valuenow={lessonQuizQuestionIndex + 1}
                          aria-label="Quiz progress"
                        >
                          <span style={{
                            width: `${((lessonQuizQuestionIndex + 1) / lessonQuizQuestions.length) * 100}%`,
                          }} />
                        </div>
                      </div>
                      <fieldset className="courses-practice-question" key={activeQuizQuestion.id}>
                        <legend>{lessonQuizQuestionIndex + 1}. {activeQuizQuestion.prompt}</legend>
                        {activeQuizQuestion.options.map((option) => (
                          <label className="courses-practice-option" key={option.id}>
                            <input
                              type="radio"
                              name={`chapter-answer-${activeQuizQuestion.id}`}
                              value={option.id}
                              checked={lessonQuizAnswers[activeQuizQuestion.id] === option.id}
                              disabled={lessonQuizSubmitted || savingLessonQuiz}
                              onChange={() => setLessonQuizAnswers((current) => ({
                                ...current,
                                [activeQuizQuestion.id]: option.id,
                              }))}
                            />
                            <span>{option.text}</span>
                          </label>
                        ))}
                      </fieldset>
                      <div className="courses-quiz-navigation">
                        {lessonQuizQuestionIndex > 0 ? (
                          <button className="btn btn-outline" type="button" onClick={() => {
                            setLessonQuizQuestionIndex((index) => index - 1);
                          }}>
                            Previous question
                          </button>
                        ) : <span />}
                        {lessonQuizQuestionIndex < lessonQuizQuestions.length - 1 ? (
                          <button
                            className="btn btn-blue"
                            type="button"
                            disabled={!lessonQuizAnswers[activeQuizQuestion.id]}
                            onClick={() => setLessonQuizQuestionIndex((index) => index + 1)}
                          >
                            Next question
                          </button>
                        ) : (
                          <button
                            className="btn btn-blue"
                            type="submit"
                            disabled={savingLessonQuiz
                              || Object.keys(lessonQuizAnswers).length < lessonQuizQuestions.length}
                          >
                            {savingLessonQuiz ? "Saving score…" : "Submit chapter quiz"}
                          </button>
                        )}
                      </div>
                    </>
                  )}
                  {lessonQuizCorrectionMode && !lessonQuizSubmitted && (
                    <>
                      <p className="courses-chapter-quiz-intro">
                        {lessonQuizCorrectionQuestions.length} question{lessonQuizCorrectionQuestions.length === 1 ? "" : "s"} need correction.
                      </p>
                      {lessonQuizCorrectionQuestions.map((question) => {
                        const originalIndex = lessonQuizQuestions
                          .findIndex((item) => item.id === question.id);
                        return (
                          <fieldset className="courses-practice-question" key={question.id}>
                            <legend>Question {originalIndex + 1}. {question.prompt}</legend>
                            {question.options.map((option) => (
                              <label className="courses-practice-option" key={option.id}>
                                <input
                                  type="radio"
                                  name={`chapter-correction-${question.id}`}
                                  value={option.id}
                                  checked={lessonQuizCorrectionAnswers[question.id] === option.id}
                                  disabled={savingLessonQuiz}
                                  onChange={() => setLessonQuizCorrectionAnswers((current) => ({
                                    ...current,
                                    [question.id]: option.id,
                                  }))}
                                />
                                <span>{option.text}</span>
                              </label>
                            ))}
                          </fieldset>
                        );
                      })}
                      <button
                        className="btn btn-blue"
                        type="submit"
                        disabled={savingLessonQuiz
                          || lessonQuizCorrectionQuestions.some(
                            (question) => !lessonQuizCorrectionAnswers[question.id],
                          )}
                      >
                        {savingLessonQuiz ? "Saving resit…" : "Submit corrections"}
                      </button>
                    </>
                  )}
                  {lessonQuizSubmitted && (
                    <p className="courses-quiz-result" role="status">
                      {lessonQuizCorrectionMode
                        ? `First attempt: ${lessonQuizFirstAttemptScore} of ${lessonQuizQuestions.length}. Resit: ${lessonQuizScore - lessonQuizFirstAttemptScore} of ${lessonQuizCorrectionQuestions.length} corrections correct. Final score: ${lessonQuizScore} of ${lessonQuizQuestions.length} (${Math.round((lessonQuizScore / lessonQuizQuestions.length) * 100)}%).`
                        : `You scored ${lessonQuizScore} of ${lessonQuizQuestions.length} (${Math.round((lessonQuizScore / lessonQuizQuestions.length) * 100)}%). Your score has been saved.`}
                    </p>
                  )}
                  {lessonQuizSubmitted && (
                    <section className="courses-quiz-review" aria-labelledby="quiz-review-heading">
                      <h3 id="quiz-review-heading">Review your answers</h3>
                      {lessonQuizQuestions.map((question, index) => {
                        const correctionAnswer = lessonQuizCorrectionQuestions
                          .some((item) => item.id === question.id)
                          ? lessonQuizCorrectionAnswers[question.id]
                          : "";
                        const answerId = correctionAnswer || lessonQuizAnswers[question.id];
                        const selectedOption = question.options.find((option) => option.id === answerId);
                        const correctOption = question.options.find(
                          (option) => option.id === question.correctOptionId,
                        );
                        const isCorrect = answerId === question.correctOptionId;
                        return (
                          <article className={isCorrect ? "is-correct" : "needs-review"} key={question.id}>
                            <strong>Question {index + 1} · {isCorrect ? "Correct" : "Review this answer"}</strong>
                            <p>{question.prompt}</p>
                            <span>Your answer: {selectedOption?.text || "No answer"}</span>
                            {!isCorrect && <span>Correct answer: {correctOption?.text || "Unavailable"}</span>}
                            {question.explanation && <p>{question.explanation}</p>}
                          </article>
                        );
                      })}
                    </section>
                  )}
                  {lessonQuizSubmitted && (
                    lessonQuizPassed ? (
                      <>
                        <p className="courses-quiz-result" role="status">
                          {activeCompleted.has(activeLesson?.id)
                            ? `Congratulations, ${studentDisplayName}! You passed the chapter quiz. ${
                                nextLesson
                                  ? "The next chapter is now unlocked."
                                  : "You completed the final chapter."
                              }`
                            : `Congratulations, ${studentDisplayName}! You passed, but progress could not be saved, so the next chapter remains locked.`}
                        </p>
                        {activeCompleted.has(activeLesson?.id) && nextLesson ? (
                          <button className="btn btn-blue" type="button" onClick={() => {
                            setActiveLessonId(nextLesson.id);
                            setShowLessonQuiz(false);
                          }}>
                            Continue to next chapter
                          </button>
                        ) : (
                          <button className="btn btn-outline" type="button"
                            onClick={() => setShowLessonQuiz(false)}>
                            Back to chapter
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="courses-quiz-generation-error" role="status">
                          Score at least {PASSMARK_PERCENTAGE}% to pass and unlock the next chapter.
                        </p>
                        <button className="btn btn-outline" type="button" onClick={startLessonQuiz}>
                          Try again
                        </button>
                      </>
                    )
                  )}
                </form>
              ) : (
                <p className="courses-quiz-generation-error" role="status">
                  A quiz is not available for this chapter yet. Ask your instructor to add quiz questions or more lesson content.
                </p>
              )}
            </div>
          </section>
        ) : (
          <section className="courses-player">
          <button className="btn btn-outline" type="button" onClick={() => {
            setActiveCourseId("");
            setActiveLessonId("");
          }} disabled={savingLessonQuiz}>
            All courses
          </button>
          <div className="courses-player-layout">
            <aside className="card card-padded courses-lesson-list">
              <span className="courses-eyebrow">{levelName(activeCourse.education_level)}</span>
              <h2>{activeCourse.title}</h2>
              <p>{activeCourse.description}</p>
              <p className="courses-course-duration">
                Estimated completion time: {formatCourseDuration(estimateCourseDurationMinutes(activeCourse))}
              </p>
              {activeCourse.due_at && (
                <p className="courses-card-deadline">Deadline · {formatCourseDate(activeCourse.due_at)}</p>
              )}
              {activeEnrollment && (
                <button className="btn btn-outline" type="button"
                  onClick={() => savedOfflineCourseIds.has(String(activeCourse.id))
                    ? removeCourseOffline(activeCourse)
                    : saveCourseForOffline(activeCourse)}>
                  {savedOfflineCourseIds.has(String(activeCourse.id))
                    ? "Remove offline copy"
                    : "Save course offline"}
                </button>
              )}
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
                {(activeCourse.lessons || []).map((lesson, index) => {
                  const unlocked = index === 0 || (activeCourse.lessons || [])
                    .slice(0, index)
                    .every((previousLesson) => activeCompleted.has(previousLesson.id));
                  return (
                    <li key={lesson.id}>
                      <button
                        type="button"
                        className={lesson.id === activeLessonId ? "is-active" : ""}
                        onClick={() => setActiveLessonId(lesson.id)}
                        disabled={!unlocked || savingLessonQuiz}
                      >
                        <span>
                          {lessonNotesByEnrollment[`${activeEnrollment?.id}:${lesson.id}`]?.bookmarked
                            ? "★"
                            : activeCompleted.has(lesson.id) ? "Done" : unlocked ? index + 1 : "Locked"}
                        </span>
                        {lesson.title}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </aside>
            <article className="card card-padded courses-lesson-content">
              {activeLesson ? (
                <>
                  <span className="courses-eyebrow">{activeCourse.subject || "COURSE LESSON"}</span>
                  <h2>{activeLesson.title}</h2>
                  <div className="courses-lesson-actions">
                    <button className="btn btn-outline" type="button"
                      onClick={() => downloadLessonNotes(activeCourse, activeLesson)}>
                      Download lesson notes
                    </button>
                  </div>
                  <div className="courses-lesson-text">
                    {renderCourseLessonContent(activeLesson.content)}
                  </div>
                  <CourseImageGallery images={activeLesson.images} imageUrls={courseImageUrls} />
                  {!isAdmin && activeEnrollment && (
                    <section className="courses-personal-notes" aria-labelledby="personal-notes-heading">
                      <label className="courses-bookmark-toggle">
                        <input type="checkbox" checked={Boolean(activeLessonNote?.bookmarked)}
                          onChange={(event) => setLessonNotesByEnrollment((current) => ({
                            ...current,
                            [`${activeEnrollment.id}:${activeLesson.id}`]: {
                              ...activeLessonNote,
                              note: activeLessonNote?.note || "",
                              bookmarked: event.target.checked,
                              pendingSync: isOffline,
                            },
                          }))} />
                        Bookmark this lesson
                      </label>
                      <label id="personal-notes-heading">
                        My private lesson notes
                        <textarea className="form-control" rows="4" maxLength={5000}
                          value={activeLessonNote?.note || ""}
                          onChange={(event) => setLessonNotesByEnrollment((current) => ({
                            ...current,
                            [`${activeEnrollment.id}:${activeLesson.id}`]: {
                              ...activeLessonNote,
                              note: event.target.value,
                              bookmarked: Boolean(activeLessonNote?.bookmarked),
                              pendingSync: isOffline,
                            },
                          }))} />
                      </label>
                      <button className="btn btn-outline" type="button"
                        onClick={() => saveLessonNote(activeLessonNote?.note, activeLessonNote?.bookmarked)}>
                        {isOffline ? "Save note on this device" : "Save note and bookmark"}
                      </button>
                    </section>
                  )}
                  <div className="courses-lesson-progress-note">
                    Score at least {PASSMARK_PERCENTAGE}% on the chapter quiz below to unlock the next chapter.
                  </div>
                  {!isAdmin && activeEnrollment && (
                    <section className="courses-practice-quiz" aria-labelledby="chapter-quiz-title">
                      <div>
                        <span className="courses-eyebrow">CHAPTER CHECK-IN</span>
                        <h3 id="chapter-quiz-title">Ready to check this chapter?</h3>
                        <p>Score at least {PASSMARK_PERCENTAGE}% to pass, save your progress, and unlock the next chapter.</p>
                      </div>
                      {isOffline ? (
                        <p role="status">Quiz attempts need an internet connection. Your saved lesson is available to read offline.</p>
                      ) : lessonQuizPreview.length ? (
                        <button className="btn btn-blue" type="button"
                          onClick={startLessonQuiz}>
                          Take chapter quiz
                        </button>
                      ) : (
                        <p className="courses-quiz-generation-error" role="status">
                          A quiz is not available for this chapter yet. Ask your instructor to add quiz questions or more lesson content.
                        </p>
                      )}
                    </section>
                  )}
                  {!isAdmin && activeEnrollment && (
                    isOffline
                      ? <p className="courses-offline-note">Discussion is unavailable offline. Your saved lesson notes remain on this device.</p>
                      : <CourseDiscussions
                          courseId={activeCourse.id}
                          lessonId={activeLesson.id}
                          isAdmin={false}
                        />
                  )}
                  {!isAdmin && activeEnrollment && courseProgress(activeCourse, activeCompleted) === 100 && (
                    <section className="courses-certificate-card" aria-label="Course completion certificate">
                      <div>
                        <strong>Course complete</strong>
                        <span>
                          {activeCourseCertificate
                            ? `Certificate issued ${formatCourseDate(activeCourseCertificate.issued_at)}`
                            : "Your completion certificate is ready."}
                        </span>
                      </div>
                      <button className="btn btn-blue" type="button"
                        onClick={() => downloadCourseCertificate(activeCourse, activeEnrollment)}>
                        Download certificate
                      </button>
                    </section>
                  )}
                </>
              ) : (
                <div className="courses-empty">Choose a lesson to start studying.</div>
              )}
            </article>
          </div>
          </section>
        )
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
              const unmet = enrollment ? [] : unmetPrerequisites(course);
              const offlineSaved = savedOfflineCourseIds.has(String(course.id));
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
                  {!!course.due_at && (
                    <small className="courses-card-deadline">Deadline · {formatCourseDate(course.due_at)}</small>
                  )}
                  {!!(course.prerequisites || []).length && (
                    <div className="courses-prerequisite-note">
                      <strong>Prerequisites:</strong>{" "}
                      {(course.prerequisites || []).map((prerequisiteId) =>
                        courses.find((item) => item.id === prerequisiteId)?.title || "Unavailable course")
                        .join(", ")}
                      {unmet.length
                        ? " · Complete before enrolling"
                        : enrollment ? " · Complete" : " · Ready"}
                    </div>
                  )}
                  <div className="courses-card-footer">
                    <span>{course.lessons?.length || 0} lessons · {formatCourseDuration(
                      estimateCourseDurationMinutes(course),
                    )}{enrollment
                      ? `   ${complete === 100 ? "Completed" : `${complete}% complete`}`
                      : ""}</span>
                    {enrollment ? (
                      <div>
                        <button className="btn btn-blue" type="button" onClick={() => openCourse(course)}>
                          Continue learning
                        </button>
                        <button className="btn btn-outline" type="button"
                          onClick={() => offlineSaved ? removeCourseOffline(course) : saveCourseForOffline(course)}>
                          {offlineSaved ? "Remove offline copy" : "Save offline"}
                        </button>
                        {complete === 100 && (
                          <button className="btn btn-outline" type="button"
                            onClick={() => downloadCourseCertificate(course, enrollment)}>
                            Certificate
                          </button>
                        )}
                      </div>
                    ) : (
                      <button className="btn btn-blue" type="button" onClick={() => enroll(course)}
                        disabled={isOffline || !studentId || unmet.length > 0}
                        title={unmet.length ? "Complete prerequisite courses before enrolling." : ""}>
                        {unmet.length ? "Prerequisites required" : "Register for course"}
                      </button>
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
