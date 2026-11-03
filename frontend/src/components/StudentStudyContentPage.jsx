import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import {
  getLearningLevelFromClass,
  getLearningLevelName,
  getLearningResourceLabel,
  LEARNING_LEVELS,
  LEARNING_RESOURCE_TYPES,
} from "../config/learningCatalog.js";

export default function StudentStudyContentPage({ studentData }) {
  const studentClass = studentData?.class || studentData?.class_name || "";
  const inferredLevel = getLearningLevelFromClass(studentClass);
  const [levelOverride, setLevelOverride] = useState("");
  const selectedLevel = inferredLevel || levelOverride;
  const learningLevel = LEARNING_LEVELS.find(
    (level) => level.key === selectedLevel,
  );
  const [content, setContent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedContent, setSelectedContent] = useState(null);
  const [selectedSubject, setSelectedSubject] = useState("");
  const [selectedResourceKind, setSelectedResourceKind] = useState("");
  const [activeChapterIndex, setActiveChapterIndex] = useState(0);
  const [showContentModal, setShowContentModal] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [showQuiz, setShowQuiz] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizScore, setQuizScore] = useState(0);
  const [quizPassed, setQuizPassed] = useState(false);
  const [progress, setProgress] = useState({});
  const [progressError, setProgressError] = useState("");

  useEffect(() => {
    loadContent();
  }, []);

  useEffect(() => {
    if (studentData?.id) loadProgress();
  }, [studentData?.id]);

  const availableSubjects = useMemo(
    () => [...new Set(
      content
        .filter((item) => !item.education_level || item.education_level === "all" || item.education_level === selectedLevel)
        .map((item) => item.subject)
        .filter(Boolean),
    )].sort((a, b) => a.localeCompare(b)),
    [content, selectedLevel],
  );
  const filteredContent = useMemo(
    () => content.filter((item) => {
      const matchesLevel = !item.education_level
        || item.education_level === "all"
        || item.education_level === selectedLevel;
      const matchesSubject = !selectedSubject || item.subject === selectedSubject;
      const matchesKind = !selectedResourceKind
        || (item.resource_kind || "lesson_notes") === selectedResourceKind;
      return matchesLevel && matchesSubject && matchesKind;
    }),
    [content, selectedLevel, selectedResourceKind, selectedSubject],
  );

  const loadContent = async () => {
    if (!supabase) {
      setContent([]);
      setLoadError("Learning materials are unavailable because Supabase is not configured.");
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('study_content')
        .select('*')
        .eq('is_published', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setContent(data || []);
    } catch (error) {
      console.error('Error loading content:', error);
      setContent([]);
      setLoadError(
        `Learning materials could not be loaded: ${
          error instanceof Error ? error.message : "Supabase request failed."
        }`,
      );
    } finally {
      setLoading(false);
    }
  };

  const getProgressKey = (contentId, chapterIndex) => {
    return typeof chapterIndex === 'number' ? `${contentId}:${chapterIndex}` : contentId;
  };

  const hasChapters = (item) => Array.isArray(item?.chapters) && item.chapters.length > 0;

  const isChapterCompleted = (contentId, chapterIndex) => {
    return !!progress[getProgressKey(contentId, chapterIndex)]?.completed;
  };

  const isContentCompleted = (item) => {
    if (!hasChapters(item)) {
      return progress[item.id]?.progress_percentage === 100;
    }
    return item.chapters.every((_, index) => isChapterCompleted(item.id, index));
  };

  const getNextIncompleteChapter = (item) => {
    if (!hasChapters(item)) return -1;
    return item.chapters.findIndex((_, index) => !isChapterCompleted(item.id, index));
  };

  const saveProgressEntry = async (contentId, chapterIndex, entry) => {
    if (!supabase || !studentData?.id) {
      setProgressError("Study progress requires a linked Supabase student account.");
      return;
    }

    const key = getProgressKey(contentId, chapterIndex);
    const { data, error } = await supabase
      .from("student_study_progress")
      .upsert(
        {
          student_id: studentData.id,
          content_id: contentId,
          chapter_index: typeof chapterIndex === "number" ? chapterIndex : null,
          progress_percentage: entry.progress_percentage ?? 100,
          completed: !!entry.completed,
          completed_at: entry.completed ? new Date().toISOString() : null,
          last_accessed_at: new Date().toISOString(),
        },
        { onConflict: "student_id,content_id,chapter_key" },
      )
      .select()
      .single();
    if (error) {
      setProgressError(`Study progress was not saved: ${error.message}`);
      return;
    }

    setProgressError("");
    setProgress((current) => ({ ...current, [key]: data }));
  };

  const loadProgress = async () => {
    if (!supabase || !studentData?.id) {
      setProgress({});
      setProgressError("Study progress requires a linked Supabase student account.");
      return;
    }

    try {
      const { data, error } = await supabase
        .from('student_study_progress')
        .select('*')
        .eq('student_id', studentData.id);

      if (error) throw error;

      const progressMap = {};
      (data || []).forEach((item) => {
        const key = typeof item.chapter_index === 'number'
          ? getProgressKey(item.content_id, item.chapter_index)
          : getProgressKey(item.content_id);
        progressMap[key] = item;
      });

      setProgress(progressMap);
      setProgressError("");
    } catch (error) {
      console.error('Error loading progress:', error);
      setProgress({});
      setProgressError(
        `Study progress could not be loaded: ${error.message || "Supabase request failed."}`,
      );
    }
  };

  const openContent = async (item) => {
    const nextChapter = getNextIncompleteChapter(item);
    setSelectedContent(item);
    setActiveChapterIndex(nextChapter >= 0 ? nextChapter : 0);
    setShowContentModal(true);

    if (!hasChapters(item)) {
      await saveProgressEntry(item.id, null, {
        progress_percentage: 100,
        completed: true,
      });
    }
  };

  const startQuiz = async (contentId, chapterIndex = null) => {
    if (!supabase) return;

    try {
      let query = supabase
        .from('study_questions')
        .select(`
          *,
          study_answers (*)
        `)
        .eq('content_id', contentId)
        .order('order_index');

      if (typeof chapterIndex === 'number') {
        query = query.eq('chapter_index', chapterIndex);
      }

      const { data, error } = await query;
      if (error) throw error;

      const quizQuestions = data || [];
      if (quizQuestions.length === 0) {
        alert('No quiz questions found for this chapter. Please ask the instructor to add chapter-specific questions.');
        return;
      }

      setQuestions(quizQuestions);
      setShowQuiz(true);
      setQuizAnswers({});
      setQuizSubmitted(false);
      setQuizScore(0);
      setQuizPassed(false);
    } catch (error) {
      console.error('Error loading questions:', error);
      alert('Failed to load quiz questions');
    }
  };

  const submitQuiz = async () => {
    if (!supabase || !studentData?.id || !selectedContent) return;

    let totalScore = 0;
    let earnedScore = 0;

    questions.forEach((question) => {
      totalScore += question.points;
      const userAnswer = quizAnswers[question.id];
      let questionCorrect = false;

      if (question.question_type === 'multiple_choice') {
        const correctAnswer = question.study_answers?.find((a) => a.is_correct);
        questionCorrect = correctAnswer && userAnswer === correctAnswer.id;
      } else if (question.question_type === 'true_false') {
        questionCorrect = userAnswer === question.correct_answer;
      } else if (question.question_type === 'short_answer' || question.question_type === 'essay') {
        questionCorrect = Boolean(userAnswer && String(userAnswer).trim());
      }

      if (questionCorrect) {
        earnedScore += question.points;
      }
    });

    const passingScore = Math.ceil(totalScore * 0.7);
    const passed = earnedScore >= passingScore;

    setQuizScore(earnedScore);
    setQuizSubmitted(true);
    setQuizPassed(passed);

    const progressEntry = {
      completed: passed,
      score: earnedScore,
      progress_percentage: passed ? 100 : Math.round((earnedScore / Math.max(totalScore, 1)) * 100),
    };

    const chapterIndex = hasChapters(selectedContent) ? activeChapterIndex : null;
    await saveProgressEntry(selectedContent.id, chapterIndex, progressEntry);

    try {
      const attempts = questions.map((question) => {
        const userAnswer = quizAnswers[question.id] || '';
        let isCorrect = false;

        if (question.question_type === 'multiple_choice') {
          const correctAnswer = question.study_answers?.find((a) => a.is_correct);
          isCorrect = correctAnswer && userAnswer === correctAnswer.id;
        } else if (question.question_type === 'true_false') {
          isCorrect = userAnswer === question.correct_answer;
        } else if (question.question_type === 'short_answer' || question.question_type === 'essay') {
          isCorrect = Boolean(userAnswer && String(userAnswer).trim());
        }

        return {
          student_id: studentData.id,
          question_id: question.id,
          answer_text: userAnswer,
          is_correct: isCorrect,
          points_earned: isCorrect ? question.points : 0,
        };
      });

      const { error } = await supabase
        .from('student_question_attempts')
        .upsert(attempts, { onConflict: 'student_id,question_id' });

      if (error) throw error;
    } catch (error) {
      console.error('Error saving quiz attempts:', error);
    }
  };

  const getDifficultyColor = (level) => {
    switch (level) {
      case 'beginner': return '#10b981';
      case 'intermediate': return '#f59e0b';
      case 'advanced': return '#ef4444';
      default: return '#6b7280';
    }
  };

  if (loading) {
    return (
      <div className="fade-in">
        <div className="page-header">
          <div className="page-title">{learningLevel ? `${learningLevel.label} Learning Library` : "Learning Library"}</div>
          <div className="page-sub">Loading materials for your student level...</div>
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
        <div className="page-title">{learningLevel ? `${learningLevel.label} Learning Library` : "Learning Library"}</div>
        <div className="page-sub">
          {learningLevel?.description || "Choose your education level to browse its learning materials."}
        </div>
      </div>
      <section className="learning-hub-level-picker" aria-labelledby="learning-level-heading">
        <div className="learning-hub-level-heading">
          <div>
            <h2 id="learning-level-heading">Your learning path</h2>
            <p>
              {learningLevel
                ? `Showing all published materials for ${learningLevel.name}${studentClass ? ` · ${studentClass}` : ""}.`
                : "Select your education level to see all materials published for that group."}
            </p>
          </div>
          {!inferredLevel && (
            <label>
              <span>Education level</span>
              <select
                className="form-control"
                value={levelOverride}
                onChange={(event) => setLevelOverride(event.target.value)}
              >
                <option value="">Choose your level</option>
                {LEARNING_LEVELS.map((level) => (
                  <option key={level.key} value={level.key}>{level.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      </section>
      {progressError && <div className="alert alert-warning">{progressError}</div>}
      {loadError && <div className="alert alert-danger" role="alert">{loadError}</div>}
      <div className="learning-hub-filters">
        <label>
          <span>Subject</span>
          <select
            className="form-control"
            value={selectedSubject}
            onChange={(event) => setSelectedSubject(event.target.value)}
          >
            <option value="">All subjects</option>
            {availableSubjects.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
          </select>
        </label>
        <label>
          <span>Material type</span>
          <select
            className="form-control"
            value={selectedResourceKind}
            onChange={(event) => setSelectedResourceKind(event.target.value)}
          >
            <option value="">All materials</option>
            {LEARNING_RESOURCE_TYPES.map((resourceType) => (
              <option key={resourceType.key} value={resourceType.key}>{resourceType.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="tests-grid">
        {filteredContent.map((item) => {
          const completed = isContentCompleted(item);

          return (
            <div key={item.id} className="test-card">
              <div className="test-header">
                <div className="test-title">{item.title}</div>
                <div
                  className="test-status"
                  style={{
                    background: getDifficultyColor(item.difficulty_level),
                    color: 'white'
                  }}
                >
                  {item.difficulty_level}
                </div>
              </div>
              <div className="test-meta">
                <div className="test-subject">{getLearningResourceLabel(item.resource_kind)}</div>
                <div className="test-subject">
                  {!item.education_level || item.education_level === "all"
                    ? learningLevel?.name || "All learning levels"
                    : getLearningLevelName(item.education_level)}
                </div>
                {item.subject && <div className="test-subject">Subject: {item.subject}</div>}
                {item.class_level && <div className="test-class">{item.education_level === "university" ? "Course:" : "Class:"} {item.class_level}</div>}
                {Array.isArray(item.chapters) && item.chapters.length > 0 && (
                  <div className="test-subject">Chapters: {item.chapters.length}</div>
                )}
                <div className="test-duration">Read time: {item.estimated_read_time} min</div>
              </div>
              <div className="test-description">{item.description}</div>
              {completed && (
                <div style={{ color: '#10b981', fontWeight: 'bold', marginBottom: '12px' }}>
                  ✓ Completed
                </div>
              )}
              <div className="test-actions">
                <button
                  className="btn btn-sm btn-blue"
                  onClick={() => openContent(item)}
                >
                  {completed ? 'Review' : 'Start'}
                </button>
                {Array.isArray(item.chapters) && item.chapters.length > 0 && (
                  <div style={{ marginTop: 8, color: '#64748b', fontSize: '0.9rem' }}>
                    Complete each chapter quiz in order.
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {filteredContent.length === 0 && !loadError && (
        <div className="empty-state">
          <div className="empty-title">
            {content.length
              ? "No materials match these filters"
              : learningLevel
                ? `No ${learningLevel.name} materials yet`
                : "No shared materials are available"}
          </div>
          <div className="empty-subtitle">
            {content.length
              ? "Try another subject or material type."
              : "Your school can publish lesson notes, past questions, and study guides here."}
          </div>
        </div>
      )}

      {/* Content Modal */}
      {showContentModal && selectedContent && (
        <div className="modal-overlay" onClick={() => setShowContentModal(false)}>
          <div className="modal-content large-modal fullscreen-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{selectedContent.title}</h3>
              <button className="modal-close" onClick={() => setShowContentModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '16px' }}>
                  <span><strong>Audience:</strong> {!selectedContent.education_level || selectedContent.education_level === "all" ? "All learning levels" : getLearningLevelName(selectedContent.education_level)}</span>
                  <span><strong>Material:</strong> {getLearningResourceLabel(selectedContent.resource_kind)}</span>
                  <span><strong>Type:</strong> {selectedContent.content_type}</span>
                  <span><strong>Subject:</strong> {selectedContent.subject || 'N/A'}</span>
                  <span><strong>{selectedContent.education_level === "university" ? "Course" : "Class"}:</strong> {selectedContent.class_level || 'N/A'}</span>
                  <span><strong>Difficulty:</strong> {selectedContent.difficulty_level}</span>
                </div>
                <p>{selectedContent.description}</p>
              </div>

              {Array.isArray(selectedContent.chapters) && selectedContent.chapters.length > 0 ? (
                <div>
                  <div style={{ marginBottom: 20, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {selectedContent.chapters.map((chapter, index) => {
                      const chapterCompleted = isChapterCompleted(selectedContent.id, index);
                      const unlocked = index <= activeChapterIndex;
                      return (
                        <button
                          key={index}
                          type="button"
                          className="btn btn-sm"
                          disabled={!unlocked}
                          onClick={() => setActiveChapterIndex(index)}
                          style={{
                            background: index === activeChapterIndex ? '#1d4ed8' : chapterCompleted ? '#10b981' : '#f3f4f6',
                            color: index === activeChapterIndex || chapterCompleted ? '#fff' : '#0f172a',
                            cursor: unlocked ? 'pointer' : 'not-allowed'
                          }}
                        >
                          Chapter {index + 1}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ marginBottom: 12, color: '#64748b', fontSize: '0.95rem' }}>
                    Complete the chapter quiz before moving to the next chapter.
                  </div>
                  <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 20 }}>
                    <div style={{ marginBottom: 14, fontWeight: 700 }}>
                      {selectedContent.chapters[activeChapterIndex].title || `Chapter ${activeChapterIndex + 1}`}
                    </div>
                    <div dangerouslySetInnerHTML={{ __html: selectedContent.chapters[activeChapterIndex].content || '<p>No chapter content available.</p>' }} />
                  </div>
                </div>
              ) : (
                <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '20px' }}>
                  <div dangerouslySetInnerHTML={{ __html: selectedContent.content }} />
                </div>
              )}
            </div>
            <div className="modal-footer" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              {Array.isArray(selectedContent.chapters) && selectedContent.chapters.length > 0 ? (
                <>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-blue"
                      onClick={() => startQuiz(selectedContent.id, activeChapterIndex)}
                      disabled={isChapterCompleted(selectedContent.id, activeChapterIndex)}
                    >
                      {isChapterCompleted(selectedContent.id, activeChapterIndex) ? 'Chapter Completed' : 'Take Chapter Quiz'}
                    </button>
                    <span style={{ color: '#64748b' }}>
                      {isChapterCompleted(selectedContent.id, activeChapterIndex) ? 'Quiz passed' : 'Quiz required'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-secondary"
                      onClick={() => setActiveChapterIndex((prev) => Math.max(prev - 1, 0))}
                      disabled={activeChapterIndex === 0}
                    >
                      Previous Chapter
                    </button>
                    <button
                      className="btn btn-green"
                      onClick={() => setActiveChapterIndex((prev) => Math.min(prev + 1, selectedContent.chapters.length - 1))}
                      disabled={!isChapterCompleted(selectedContent.id, activeChapterIndex) || activeChapterIndex === selectedContent.chapters.length - 1}
                    >
                      Next Chapter
                    </button>
                  </div>
                </>
              ) : (
                <button
                  className="btn btn-blue"
                  onClick={() => startQuiz(selectedContent.id)}
                >
                  Take Quiz
                </button>
              )}
              <button
                className="btn btn-secondary"
                onClick={() => setShowContentModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quiz Modal */}
      {showQuiz && (
        <div className="modal-overlay" onClick={() => { setShowQuiz(false); setQuestions([]); setQuizAnswers({}); setQuizSubmitted(false); setQuizScore(0); setQuizPassed(false); }}>
          <div className="modal-content large-modal fullscreen-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                Quiz: {selectedContent?.title}
                {Array.isArray(selectedContent?.chapters) && selectedContent.chapters.length > 0 ? ` — Chapter ${activeChapterIndex + 1}` : ''}
              </h3>
              <button className="modal-close" onClick={() => { setShowQuiz(false); setQuestions([]); setQuizAnswers({}); setQuizSubmitted(false); setQuizScore(0); setQuizPassed(false); }}>×</button>
            </div>
            <div className="modal-body">
              {!quizSubmitted ? (
                <div>
                  <div style={{ marginBottom: '20px' }}>
                    <p>Answer the following questions to unlock the next chapter.</p>
                  </div>

                  {questions.length === 0 ? (
                    <div style={{ color: '#7c3aed' }}>
                      No quiz questions are available for this chapter. Please ask your instructor to add questions for this chapter.
                    </div>
                  ) : questions.map((question, index) => (
                    <div key={question.id} style={{ marginBottom: '24px', padding: '16px', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                      <div style={{ fontWeight: 'bold', marginBottom: '12px' }}>
                        Question {index + 1}: {question.question_text}
                      </div>

                      {question.question_type === 'multiple_choice' && question.study_answers && (
                        <div>
                          {question.study_answers.map((answer) => (
                            <div key={answer.id} style={{ marginBottom: '8px' }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <input
                                  type="radio"
                                  name={`question-${question.id}`}
                                  value={answer.id}
                                  checked={quizAnswers[question.id] === answer.id}
                                  onChange={(e) => setQuizAnswers({...quizAnswers, [question.id]: e.target.value})}
                                />
                                <span>{String.fromCharCode(65 + answer.order_index)}. {answer.answer_text}</span>
                              </label>
                            </div>
                          ))}
                        </div>
                      )}

                      {question.question_type === 'true_false' && (
                        <div>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <input
                              type="radio"
                              name={`question-${question.id}`}
                              value="true"
                              checked={quizAnswers[question.id] === 'true'}
                              onChange={(e) => setQuizAnswers({...quizAnswers, [question.id]: e.target.value})}
                            />
                            <span>True</span>
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <input
                              type="radio"
                              name={`question-${question.id}`}
                              value="false"
                              checked={quizAnswers[question.id] === 'false'}
                              onChange={(e) => setQuizAnswers({...quizAnswers, [question.id]: e.target.value})}
                            />
                            <span>False</span>
                          </label>
                        </div>
                      )}

                      {(question.question_type === 'short_answer' || question.question_type === 'essay') && (
                        <textarea
                          className="form-input"
                          value={quizAnswers[question.id] || ''}
                          onChange={(e) => setQuizAnswers({...quizAnswers, [question.id]: e.target.value})}
                          placeholder="Enter your answer here..."
                          rows={question.question_type === 'essay' ? 4 : 2}
                        />
                      )}

                      <div style={{ fontSize: '0.9em', color: '#64748b', marginTop: '8px' }}>
                        {question.points} point{question.points !== 1 ? 's' : ''}
                      </div>
                    </div>
                  ))}

                  <button
                    className="btn btn-blue"
                    onClick={submitQuiz}
                    disabled={questions.length === 0 || Object.keys(quizAnswers).length < questions.length}
                  >
                    Submit Quiz
                  </button>
                </div>
              ) : (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '2em', marginBottom: '16px' }}>
                    {quizPassed ? '🎉' : '📚'}
                  </div>
                  <h3>Quiz Completed!</h3>
                  <div style={{ fontSize: '1.2em', margin: '16px 0' }}>
                    Your Score: {quizScore} / {questions.reduce((sum, q) => sum + q.points, 0)} points
                  </div>
                  <div style={{ color: '#64748b', marginBottom: '24px' }}>
                    {quizPassed
                      ? 'Great job! You passed the quiz.'
                      : 'Keep studying and try again!'}
                  </div>

                  {questions.map((question, index) => {
                    const userAnswer = quizAnswers[question.id];
                    let isCorrect = false;

                    if (question.question_type === 'multiple_choice') {
                      const correctAnswer = question.study_answers?.find(a => a.is_correct);
                      isCorrect = correctAnswer && userAnswer === correctAnswer.id;
                    } else if (question.question_type === 'true_false') {
                      isCorrect = userAnswer === question.correct_answer;
                    } else {
                      isCorrect = Boolean(userAnswer && String(userAnswer).trim());
                    }

                    return (
                      <div key={question.id} style={{
                        marginBottom: '16px',
                        padding: '12px',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                        background: isCorrect ? '#f0fdf4' : '#fef2f2'
                      }}>
                        <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>
                          Question {index + 1}: {question.question_text}
                        </div>
                        <div style={{ color: isCorrect ? '#166534' : '#dc2626' }}>
                          Your answer: {
                            question.question_type === 'multiple_choice'
                              ? question.study_answers?.find(a => a.id === userAnswer)?.answer_text || 'Not answered'
                              : userAnswer || 'Not answered'
                          }
                        </div>
                        {!isCorrect && question.explanation && (
                          <div style={{ marginTop: '8px', padding: '8px', background: '#f9fafb', borderRadius: '4px' }}>
                            <strong>Explanation:</strong> {question.explanation}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <button
                    className="btn btn-blue"
                    onClick={() => { setShowQuiz(false); setQuestions([]); setQuizAnswers({}); setQuizSubmitted(false); setQuizScore(0); setQuizPassed(false); }}
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
