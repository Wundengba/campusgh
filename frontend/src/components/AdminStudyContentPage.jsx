import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { extractDocumentText, getDocumentTitle } from "../utils/documentImport.js";
import {
  getLearningLevelName,
  getLearningResourceLabel,
  LEARNING_LEVELS,
  LEARNING_RESOURCE_TYPES,
  LEARNING_SUBJECTS,
} from "../config/learningCatalog.js";
import { isProfilesTableMissingError } from "../utils/campusData.js";
import { markProfilesTableUnavailable, profilesTableAvailable } from "../utils/profileTableState.js";

export default function StudyContentPage({ currentUser }) {
  const [content, setContent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editingContent, setEditingContent] = useState(null);
  const [showQuestionsModal, setShowQuestionsModal] = useState(false);
  const [selectedContent, setSelectedContent] = useState(null);
  const [contentForm, setContentForm] = useState({
    title: '',
    description: '',
    content_type: 'lesson',
    education_level: 'jhs',
    resource_kind: 'lesson_notes',
    subject: '',
    class_level: '',
    content: '',
    tags: [],
    chapters: [],
    difficulty_level: 'intermediate',
    estimated_read_time: 15,
    is_published: false
  });
  const [questions, setQuestions] = useState([]);
  const [questionForm, setQuestionForm] = useState({
    question_text: '',
    question_type: 'multiple_choice',
    chapter_index: 0,
    points: 1,
    correct_answer: '',
    explanation: '',
    answers: [{ answer_text: '', is_correct: false }, { answer_text: '', is_correct: false }]
  });
  const [activity, setActivity] = useState([]);
  const [quizAttempts, setQuizAttempts] = useState([]);
  const [questionMap, setQuestionMap] = useState({});
  const [studentProfiles, setStudentProfiles] = useState({});
  const [activityLoading, setActivityLoading] = useState(true);
  const [exportingContentId, setExportingContentId] = useState(null);
  const [mappedLiveTests, setMappedLiveTests] = useState(new Map());
  const [originMappingAvailable, setOriginMappingAvailable] = useState(true);

  useEffect(() => {
    loadContent();
    loadActivity();
  }, []);

  const loadMappedLiveTests = async () => {
    if (!supabase) {
      setMappedLiveTests(new Map());
      return;
    }

    try {
      const { data, error } = await supabase
        .from('live_tests')
        .select('id, title, origin_content_id')
        .not('origin_content_id', 'is', null);

      if (error) {
        if (error.message?.includes('origin_content_id')) {
          setOriginMappingAvailable(false);
          setMappedLiveTests(new Map());
          return;
        }
        throw error;
      }

      const map = new Map();
      data?.forEach((test) => {
        if (test.origin_content_id) {
          map.set(test.origin_content_id, test);
        }
      });
      setMappedLiveTests(map);
    } catch (error) {
      console.error('Error loading mapped live tests:', error);
      setMappedLiveTests(new Map());
      setOriginMappingAvailable(false);
    }
  };

  const deriveTestTypeFromStudyQuestions = (questions) => {
    if (!questions || questions.length === 0) return 'mixed';
    const normalized = questions.map((question) => {
      if (question.question_type === 'essay') return 'long_text';
      return question.question_type;
    });
    const uniqueTypes = Array.from(new Set(normalized));
    if (uniqueTypes.length === 1) return uniqueTypes[0];
    return 'mixed';
  };

  const handleExportStudyContentToLiveTest = async (contentItem) => {
    if (!supabase || !contentItem) return;
    if (exportingContentId) return;

    const existingTest = mappedLiveTests.get(contentItem.id);
    if (originMappingAvailable && existingTest) {
      alert(`This study content is already mapped to a live test:\n${existingTest.title}`);
      return;
    }

    setExportingContentId(contentItem.id);

    try {
      const { data: studyQuestions, error: questionsError } = await supabase
        .from('study_questions')
        .select(`*, study_answers (*)`)
        .eq('content_id', contentItem.id)
        .order('order_index');

      if (questionsError) throw questionsError;

      const questionsToCopy = studyQuestions || [];
      const testType = deriveTestTypeFromStudyQuestions(questionsToCopy);
      const durationMinutes = Math.max(10, contentItem.estimated_read_time || 30);

      const liveTestPayload = {
        title: `Live Test: ${contentItem.title}`,
        description: contentItem.description || `Quiz from study content: ${contentItem.title}`,
        subject: contentItem.subject || '',
        class: contentItem.class_level || '',
        test_type: testType,
        duration_minutes: durationMinutes,
        total_questions: questionsToCopy.length,
        is_active: true,
        created_by: currentUser?.id
      };

      if (originMappingAvailable) {
        liveTestPayload.origin_content_id = contentItem.id;
      }

      const { data: createdTest, error: createTestError } = await supabase
        .from('live_tests')
        .insert([liveTestPayload])
        .select()
        .single();

      if (createTestError) throw createTestError;

      if (questionsToCopy.length > 0) {
        const questionInserts = questionsToCopy.map((question, index) => ({
          test_id: createdTest.id,
          question_text: question.question_text,
          question_type: question.question_type === 'essay' ? 'long_text' : question.question_type,
          points: question.points,
          correct_answer: question.correct_answer,
          explanation: question.explanation,
          order_index: index
        }));

        const { data: createdQuestions, error: createQuestionsError } = await supabase
          .from('test_questions')
          .insert(questionInserts)
          .select();

        if (createQuestionsError) throw createQuestionsError;

        const answersToInsert = [];
        createdQuestions?.forEach((createdQuestion, index) => {
          const sourceQuestion = questionsToCopy[index];
          if (sourceQuestion.question_type === 'multiple_choice') {
            sourceQuestion.study_answers?.forEach((answer) => {
              answersToInsert.push({
                question_id: createdQuestion.id,
                answer_text: answer.answer_text,
                is_correct: answer.is_correct,
                order_index: answer.order_index
              });
            });
          }
        });

        if (answersToInsert.length > 0) {
          const { error: createAnswersError } = await supabase
            .from('test_answers')
            .insert(answersToInsert);
          if (createAnswersError) throw createAnswersError;
        }
      }

      if (originMappingAvailable) {
        const newMap = new Map(mappedLiveTests);
        newMap.set(contentItem.id, createdTest);
        setMappedLiveTests(newMap);
      }

      alert(`Live test created from "${contentItem.title}" successfully.`);
    } catch (error) {
      console.error('Error exporting study content to live test:', error);
      alert(`Failed to create live test: ${error?.message || error}`);
    } finally {
      setExportingContentId(null);
    }
  };

  const loadContent = async () => {
    if (!supabase) {
      setContent([]);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('study_content')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setContent(data || []);
      await loadMappedLiveTests();
    } catch (error) {
      console.error('Error loading content:', error);
      setContent([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateContent = async () => {
    if (!supabase || !contentForm.title.trim()) return;

    try {
      const { data, error } = await supabase
        .from('study_content')
        .insert([{
          ...contentForm,
          created_by: currentUser?.id
        }])
        .select()
        .single();

      if (error) throw error;

      setContent([data, ...content]);
      setShowCreateModal(false);
      resetContentForm();
    } catch (error) {
      console.error('Error creating content:', error);
      alert(`Failed to create content: ${error.message}`);
    }
  };

  const downloadStudyContentTemplate = () => {
    const template = [{
      title: 'Learning material title',
      description: 'Short description',
      content_type: 'lesson',
      education_level: 'jhs',
      resource_kind: 'lesson_notes',
      subject: 'Mathematics',
      class_level: '',
      content: 'Learning material content',
      tags: [],
      chapters: [],
      difficulty_level: 'intermediate',
      estimated_read_time: 15,
      is_published: false,
      questions: [{
        question_text: 'Question text',
        question_type: 'multiple_choice',
        chapter_index: 0,
        points: 1,
        correct_answer: '0',
        explanation: '',
        answers: [
          { answer_text: 'Correct answer', is_correct: true },
          { answer_text: 'Another answer', is_correct: false }
        ]
      }]
    }];
    const url = URL.createObjectURL(new Blob([JSON.stringify(template, null, 2)], {
      type: 'application/json'
    }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'learning-materials-import-template.json';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const handleImportContent = async (files) => {
    if (!supabase || !files.length) return;

    setImporting(true);
    try {
      if (files.length > 200) {
        throw new Error('Import up to 200 files at a time.');
      }

      const importedData = [];
      for (const file of files) {
        if (file.size > 5 * 1024 * 1024) {
          throw new Error(`${file.name} is larger than the 5 MB limit.`);
        }
        const extension = file.name.split('.').pop()?.toLowerCase();
        if (extension === 'json') {
          const jsonData = JSON.parse(await file.text());
          if (!Array.isArray(jsonData)) {
            throw new Error(`${file.name} must contain a JSON array of learning materials.`);
          }
          importedData.push(...jsonData);
        } else if (extension === 'pdf' || extension === 'docx') {
          importedData.push({
            title: getDocumentTitle(file.name),
            description: `Imported from ${file.name}`,
            content_type: 'document',
            education_level: 'all',
            resource_kind: 'course_materials',
            content: await extractDocumentText(file),
            is_published: false,
          });
        } else {
          throw new Error(`${file.name} is not supported. Choose a JSON, PDF, or DOCX file.`);
        }
      }

      if (!Array.isArray(importedData)) {
        throw new Error('Import data must be an array of content items.');
      }
      if (importedData.length > 200) {
        throw new Error('Import up to 200 learning materials at a time.');
      }

      const validItems = [];
      const errors = [];
      const validContentTypes = new Set(['lesson', 'article', 'video', 'document', 'interactive']);
      const validLevels = new Set(['all', ...LEARNING_LEVELS.map(({ key }) => key)]);
      const validResourceKinds = new Set(LEARNING_RESOURCE_TYPES.map(({ key }) => key));
      const validDifficultyLevels = new Set(['beginner', 'intermediate', 'advanced']);

      for (const [index, item] of importedData.entries()) {
        const row = index + 1;
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          errors.push(`Row ${row}: expected a learning material object.`);
          continue;
        }
        if (typeof item.title !== 'string' || !item.title.trim()) {
          errors.push(`Row ${row}: title is required.`);
          continue;
        }

        const contentType = item.content_type || 'lesson';
        const educationLevel = item.education_level || 'all';
        const resourceKind = item.resource_kind || 'lesson_notes';
        const difficultyLevel = item.difficulty_level || 'intermediate';
        if (!validContentTypes.has(contentType)) {
          errors.push(`Row ${row}: unsupported content_type "${contentType}".`);
          continue;
        }
        if (!validLevels.has(educationLevel)) {
          errors.push(`Row ${row}: education_level must be all, jhs, shs, or university.`);
          continue;
        }
        if (!validResourceKinds.has(resourceKind)) {
          errors.push(`Row ${row}: unsupported resource_kind "${resourceKind}".`);
          continue;
        }
        if (!validDifficultyLevels.has(difficultyLevel)) {
          errors.push(`Row ${row}: unsupported difficulty_level "${difficultyLevel}".`);
          continue;
        }
        if (item.tags !== undefined && (!Array.isArray(item.tags) || item.tags.some((tag) => typeof tag !== 'string'))) {
          errors.push(`Row ${row}: tags must be an array of strings.`);
          continue;
        }
        if (item.chapters !== undefined && !Array.isArray(item.chapters)) {
          errors.push(`Row ${row}: chapters must be an array.`);
          continue;
        }

        const contentItem = {
          title: item.title.trim(),
          description: typeof item.description === 'string' ? item.description : '',
          content_type: contentType,
          education_level: educationLevel,
          resource_kind: resourceKind,
          subject: typeof item.subject === 'string' ? item.subject : '',
          class_level: typeof item.class_level === 'string' ? item.class_level : '',
          content: typeof item.content === 'string' ? item.content : '',
          tags: Array.isArray(item.tags) ? item.tags : [],
          chapters: Array.isArray(item.chapters) ? item.chapters : [],
          difficulty_level: difficultyLevel,
          estimated_read_time: Number.isInteger(item.estimated_read_time) && item.estimated_read_time > 0
            ? item.estimated_read_time
            : 15,
          is_published: typeof item.is_published === 'boolean' ? item.is_published : false,
          created_by: currentUser?.id
        };

        validItems.push({ content: contentItem, sourceIndex: index });
      }

      if (validItems.length === 0) {
        throw new Error(errors.length
          ? `No valid learning materials found. ${errors.slice(0, 5).join(' ')}`
          : 'The file contains no learning materials.');
      }

      const { data, error } = await supabase
        .from('study_content')
        .insert(validItems.map(({ content: item }) => item))
        .select();

      if (error) throw error;

      for (let itemIndex = 0; itemIndex < validItems.length; itemIndex += 1) {
        const sourceItem = importedData[validItems[itemIndex].sourceIndex];
        const createdItem = data[itemIndex];
        if (sourceItem.questions === undefined) continue;
        if (!Array.isArray(sourceItem.questions)) {
          errors.push(`Row ${validItems[itemIndex].sourceIndex + 1}: questions must be an array.`);
          continue;
        }
        if (!sourceItem.questions.length) continue;

        const importableQuestions = sourceItem.questions.filter((question, questionIndex) => {
          const row = validItems[itemIndex].sourceIndex + 1;
          if (!question || typeof question.question_text !== 'string' || !question.question_text.trim()) {
            errors.push(`Row ${row}, question ${questionIndex + 1}: question_text is required.`);
            return false;
          }
          if (question.question_type && !['multiple_choice', 'true_false', 'short_answer', 'essay'].includes(question.question_type)) {
            errors.push(`Row ${row}, question ${questionIndex + 1}: unsupported question_type.`);
            return false;
          }
          if (question.answers !== undefined && !Array.isArray(question.answers)) {
            errors.push(`Row ${row}, question ${questionIndex + 1}: answers must be an array.`);
            return false;
          }
          return true;
        });
        if (!importableQuestions.length) continue;

        const questionsToInsert = importableQuestions.map((q, qIndex) => ({
          content_id: createdItem.id,
          question_text: q.question_text.trim(),
          question_type: q.question_type || 'multiple_choice',
          chapter_index: Number.isInteger(q.chapter_index) && q.chapter_index >= 0 ? q.chapter_index : 0,
          points: Number.isInteger(q.points) && q.points > 0 ? q.points : 1,
          correct_answer: typeof q.correct_answer === 'string' ? q.correct_answer : '',
          explanation: typeof q.explanation === 'string' ? q.explanation : '',
          order_index: qIndex
        }));

        const { data: createdQuestions, error: questionsError } = await supabase
          .from('study_questions')
          .insert(questionsToInsert)
          .select();

        if (questionsError) {
          errors.push(`Questions for "${createdItem.title}" could not be imported: ${questionsError.message}`);
          continue;
        }

        for (let qIndex = 0; qIndex < importableQuestions.length; qIndex += 1) {
          const importedQuestion = importableQuestions[qIndex];
          const createdQuestion = createdQuestions[qIndex];
          if (!createdQuestion || !Array.isArray(importedQuestion.answers)
            || (importedQuestion.question_type || 'multiple_choice') !== 'multiple_choice') continue;

          const answersToInsert = [];
          importedQuestion.answers.forEach((answer, answerIndex) => {
            if (!answer || typeof answer.answer_text !== 'string' || !answer.answer_text.trim()) {
              errors.push(`Question "${createdQuestion.question_text}", answer ${answerIndex + 1}: answer_text is required.`);
              return;
            }
            answersToInsert.push({
              question_id: createdQuestion.id,
              answer_text: answer.answer_text.trim(),
              is_correct: answer.is_correct === true,
              order_index: answersToInsert.length
            });
          });

          if (answersToInsert.length) {
            const { error: answersError } = await supabase
              .from('study_answers')
              .insert(answersToInsert);

            if (answersError) {
              errors.push(`Answers for question "${createdQuestion.question_text}" could not be imported: ${answersError.message}`);
            }
          }
        }
      }

      setContent([...(data || []), ...content]);
      setShowImportModal(false);
      alert(`Imported ${validItems.length} learning material(s).${
        errors.length ? ` ${errors.length} issue(s): ${errors.slice(0, 5).join(' ')}` : ''
      }`);

    } catch (error) {
      console.error('Error importing content:', error);
      alert(`Failed to import learning materials: ${error.message}`);
    } finally {
      setImporting(false);
    }
  };

  const handleUpdateContent = async () => {
    if (!supabase || !editingContent || !contentForm.title.trim()) return;

    try {
      const { data, error } = await supabase
        .from('study_content')
        .update(contentForm)
        .eq('id', editingContent.id)
        .select()
        .single();

      if (error) throw error;

      setContent(content.map(item => item.id === editingContent.id ? data : item));
      setEditingContent(null);
      setShowCreateModal(false);
      resetContentForm();
    } catch (error) {
      console.error('Error updating content:', error);
      alert(`Failed to update content: ${error.message}`);
    }
  };

  const handleDeleteContent = async (contentId) => {
    if (!supabase || !confirm('Are you sure you want to delete this content?')) return;

    try {
      const { error } = await supabase
        .from('study_content')
        .delete()
        .eq('id', contentId);

      if (error) throw error;

      setContent(content.filter(item => item.id !== contentId));
    } catch (error) {
      console.error('Error deleting content:', error);
      alert(`Failed to delete content: ${error.message}`);
    }
  };

  const handleTogglePublish = async (contentId, isPublished) => {
    if (!supabase) return;

    try {
      const { error } = await supabase
        .from('study_content')
        .update({ is_published: isPublished })
        .eq('id', contentId);

      if (error) throw error;

      setContent(content.map(item =>
        item.id === contentId ? { ...item, is_published: isPublished } : item
      ));
    } catch (error) {
      console.error('Error updating publish status:', error);
      alert(`Failed to update publish status: ${error.message}`);
    }
  };

  const resetContentForm = () => {
    setContentForm({
      title: '',
      description: '',
      content_type: 'lesson',
      education_level: 'jhs',
      resource_kind: 'lesson_notes',
      subject: '',
      class_level: '',
      content: '',
      tags: [],
      chapters: [],
      difficulty_level: 'intermediate',
      estimated_read_time: 15,
      is_published: false
    });
  };

  const loadQuestions = async (contentId) => {
    if (!supabase) return;

    try {
      const { data, error } = await supabase
        .from('study_questions')
        .select(`
          *,
          study_answers (*)
        `)
        .eq('content_id', contentId)
        .order('chapter_index', { ascending: true })
        .order('order_index', { ascending: true });

      if (error) throw error;
      setQuestions(data || []);
    } catch (error) {
      console.error('Error loading questions:', error);
      setQuestions([]);
    }
  };

  const handleAddQuestion = async () => {
    if (!supabase || !selectedContent || !questionForm.question_text.trim()) return;

    try {
      // Insert question
      const questionPayload = {
        content_id: selectedContent.id,
        question_text: questionForm.question_text,
        question_type: questionForm.question_type,
        points: questionForm.points,
        correct_answer: questionForm.correct_answer,
        explanation: questionForm.explanation,
        order_index: questions.length
      };

      if (typeof questionForm.chapter_index === 'number') {
        questionPayload.chapter_index = questionForm.chapter_index;
      }

      const { data: questionData, error: questionError } = await supabase
        .from('study_questions')
        .insert([questionPayload])
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
            .from('study_answers')
            .insert(answersToInsert);

          if (answersError) throw answersError;
        }
      }

      // Reload questions
      await loadQuestions(selectedContent.id);
      resetQuestionForm();
    } catch (error) {
      console.error('Error adding question:', error);
      alert(`Failed to add question: ${error.message}`);
    }
  };

  const resetQuestionForm = () => {
    setQuestionForm({
      question_text: '',
      question_type: 'multiple_choice',
      chapter_index: 0,
      points: 1,
      correct_answer: '',
      explanation: '',
      answers: [{ answer_text: '', is_correct: false }, { answer_text: '', is_correct: false }]
    });
  };

  const openEditModal = (item) => {
    setEditingContent(item);
    setContentForm({
      title: item.title,
      description: item.description || '',
      content_type: item.content_type,
      education_level: item.education_level || 'all',
      resource_kind: item.resource_kind || 'lesson_notes',
      subject: item.subject || '',
      class_level: item.class_level || '',
      content: item.content || '',
      tags: item.tags || [],
      chapters: item.chapters || [],
      difficulty_level: item.difficulty_level,
      estimated_read_time: item.estimated_read_time || 15,
      is_published: item.is_published
    });
    setShowCreateModal(true);
  };

  const openQuestionsModal = async (item) => {
    setSelectedContent(item);
    await loadQuestions(item.id);
    setShowQuestionsModal(true);
  };

  const loadActivity = async () => {
    if (!supabase) {
      setActivity([]);
      setQuizAttempts([]);
      setQuestionMap({});
      setStudentProfiles({});
      setActivityLoading(false);
      return;
    }

    try {
      const [progressResp, attemptsResp] = await Promise.all([
        supabase
          .from('student_study_progress')
          .select('*')
          .order('last_accessed_at', { ascending: false }),
        supabase
          .from('student_question_attempts')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

      if (progressResp.error) throw progressResp.error;
      if (attemptsResp.error) throw attemptsResp.error;

      const progressRecords = progressResp.data || [];
      const attemptRows = attemptsResp.data || [];
      const studentIds = Array.from(
        new Set(progressRecords.map((record) => record.student_id).concat(attemptRows.map((record) => record.student_id)).filter(Boolean))
      );
      const profilesMap = {};

      if (profilesTableAvailable && studentIds.length > 0) {
        const { data: profileRows, error: profileError } = await supabase
          .from('profiles')
          .select('id, full_name, email, role')
          .in('id', studentIds);

        if (profileError) {
          if (isProfilesTableMissingError(profileError)) {
            markProfilesTableUnavailable();
          } else {
            throw profileError;
          }
        } else {
          profileRows?.forEach((profile) => {
            profilesMap[profile.id] = profile;
          });
        }
      }

      const questionIds = Array.from(
        new Set(attemptRows.map((record) => record.question_id).filter(Boolean))
      );
      const questionsMap = {};

      if (questionIds.length > 0) {
        const { data: questionRows, error: questionError } = await supabase
          .from('study_questions')
          .select('id, content_id, question_text')
          .in('id', questionIds);

        if (questionError) throw questionError;
        questionRows?.forEach((question) => {
          questionsMap[question.id] = question;
        });
      }

      setActivity(progressRecords);
      setQuizAttempts(attemptRows);
      setQuestionMap(questionsMap);
      setStudentProfiles(profilesMap);
    } catch (error) {
      console.error('Error loading lesson activity:', error);
      setActivity([]);
      setQuizAttempts([]);
      setQuestionMap({});
      setStudentProfiles({});
    } finally {
      setActivityLoading(false);
    }
  };

  const getStudentName = (studentId) => {
    const profile = studentProfiles[studentId];
    return profile?.full_name || profile?.email || studentId || 'Unknown student';
  };

  const contentActivityMap = useMemo(() => {
    const map = new Map();
    activity.forEach((record) => {
      const items = map.get(record.content_id) || [];
      items.push(record);
      map.set(record.content_id, items);
    });
    return map;
  }, [activity]);

  const quizContentActivityMap = useMemo(() => {
    const map = new Map();
    quizAttempts.forEach((attempt) => {
      const question = questionMap[attempt.question_id];
      if (!question?.content_id) return;
      const items = map.get(question.content_id) || [];
      items.push({ ...attempt, question });
      map.set(question.content_id, items);
    });
    return map;
  }, [quizAttempts, questionMap]);

  const recentActivity = useMemo(() => activity.slice(0, 8), [activity]);
  const recentQuizActivity = useMemo(() => quizAttempts.slice(0, 8), [quizAttempts]);

  const totalActiveStudents = useMemo(
    () => new Set(activity.map((record) => record.student_id).filter(Boolean)).size,
    [activity],
  );

  const totalQuizStudents = useMemo(
    () => new Set(quizAttempts.map((record) => record.student_id).filter(Boolean)).size,
    [quizAttempts],
  );

  if (loading) {
    return (
      <div className="fade-in">
        <div className="page-header">
          <div className="page-title">Learning Library</div>
          <div className="page-sub">Loading BECE, WASSCE, and university resources...</div>
        </div>
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <div className="spinner"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in study-content-page">
      <div className="page-header">
        <div className="page-title">Learning Library</div>
        <div className="page-sub">Publish BECE preparation, WASSCE core and elective lessons, and university course resources.</div>
      </div>

      <div className="page-actions-row">
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button
            className="btn btn-blue"
            onClick={() => setShowCreateModal(true)}
          >
            + Add Content
          </button>
          <button
            className="btn btn-outline"
            onClick={() => setShowImportModal(true)}
          >
              Import Content
          </button>
        </div>
      </div>

      <div className="activity-panel">
        <div className="activity-header">
          <div>
            <h3>Student Lesson Activity</h3>
            <p style={{ margin: 0, color: '#64748b' }}>
              Track which lessons students are taking, who accessed them, and how far they progressed.
            </p>
          </div>
        </div>

        <div className="activity-summary-grid">
          <div className="activity-summary-card">
            <div className="summary-label">Lessons Published</div>
            <div className="summary-value">{content.length}</div>
          </div>
          <div className="activity-summary-card">
            <div className="summary-label">Progress Records</div>
            <div className="summary-value">{activity.length}</div>
          </div>
          <div className="activity-summary-card">
            <div className="summary-label">Quiz Attempts</div>
            <div className="summary-value">{quizAttempts.length}</div>
          </div>
          <div className="activity-summary-card">
            <div className="summary-label">Students in Quizzes</div>
            <div className="summary-value">{totalQuizStudents}</div>
          </div>
          <div className="activity-summary-card">
            <div className="summary-label">Mapped Live Tests</div>
            <div className="summary-value">{mappedLiveTests.size}</div>
          </div>
        </div>

        {activityLoading ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <div className="spinner"></div>
          </div>
        ) : activity.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px 12px' }}>
            No student lesson activity yet. Students will appear here as they begin lessons.
          </div>
        ) : (
          <div className="activity-table-wrap">
            <table className="activity-table">
              <thead>
                <tr>
                  <th>Lesson</th>
                  <th>Student</th>
                  <th>Progress</th>
                  <th>Last accessed</th>
                </tr>
              </thead>
              <tbody>
                {recentActivity.map((record) => (
                  <tr key={`${record.student_id}-${record.content_id}-${record.last_accessed_at}`}>
                    <td>{content.find((item) => item.id === record.content_id)?.title || 'Unknown lesson'}</td>
                    <td>{getStudentName(record.student_id)}</td>
                    <td>{`${record.progress_percentage || 0}%`}</td>
                    <td>{record.last_accessed_at ? new Date(record.last_accessed_at).toLocaleString() : 'Unknown'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

        <div className="activity-table-card" style={{ marginTop: 20 }}>
          <div style={{ marginBottom: 12, fontWeight: 600 }}>Recent Quiz Attempts</div>
          {activityLoading ? (
            <div style={{ textAlign: 'center', padding: 24 }}>
              <div className="spinner"></div>
            </div>
          ) : quizAttempts.length === 0 ? (
            <div className="empty-state" style={{ padding: '24px 12px' }}>
              No quiz attempts yet. Students will appear here as they start a quiz.
            </div>
          ) : (
            <div className="activity-table-wrap">
              <table className="activity-table">
                <thead>
                  <tr>
                    <th>Lesson</th>
                    <th>Student</th>
                    <th>Question</th>
                    <th>Correct</th>
                    <th>Points</th>
                  </tr>
                </thead>
                <tbody>
                  {recentQuizActivity.map((attempt) => (
                    <tr key={`${attempt.student_id}-${attempt.question_id}-${attempt.id}`}>
                      <td>{content.find((item) => item.id === questionMap[attempt.question_id]?.content_id)?.title || 'Unknown lesson'}</td>
                      <td>{getStudentName(attempt.student_id)}</td>
                      <td>{questionMap[attempt.question_id]?.question_text || 'Unknown question'}</td>
                      <td>{attempt.is_correct ? 'Yes' : 'No'}</td>
                      <td>{attempt.points_earned ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      <div className="tests-grid">
        {content.map((item) => {
          const itemActivity = contentActivityMap.get(item.id) || [];
          const itemQuizActivity = quizContentActivityMap.get(item.id) || [];
          const topStudents = itemActivity
            .slice(0, 3)
            .map((record) => getStudentName(record.student_id));

          return (
            <div key={item.id} className="test-card">
              <div className="test-header">
                <div className="test-title">{item.title}</div>
                <div className="test-status" style={{
                  background: item.is_published ? '#dcfce7' : '#fef3c7',
                  color: item.is_published ? '#166534' : '#92400e'
                }}>
                  {item.is_published ? 'Published' : 'Draft'}
                </div>
              </div>
              <div className="test-meta">
                <div className="test-subject">{getLearningResourceLabel(item.resource_kind)}</div>
                <div className="test-subject">{item.education_level === "all" ? "All learning levels" : getLearningLevelName(item.education_level)}</div>
                <div className="test-subject">Format: {item.content_type}</div>
                {item.subject && <div className="test-subject">Subject: {item.subject}</div>}
                {item.class_level && <div className="test-class">{item.education_level === "university" ? "Course:" : "Class:"} {item.class_level}</div>}
                {item.chapters?.length > 0 && <div className="test-subject">Chapters: {item.chapters.length}</div>}
                <div className="test-duration">Read time: {item.estimated_read_time} min</div>
              </div>
              <div className="test-description">{item.description}</div>
              {(itemActivity.length > 0 || itemQuizActivity.length > 0) && (
                <div className="lesson-activity-summary">
                  <div>{itemActivity.length} lesson view{itemActivity.length !== 1 ? 's' : ''}</div>
                  {itemQuizActivity.length > 0 && (
                    <div>{itemQuizActivity.length} quiz attempt{itemQuizActivity.length !== 1 ? 's' : ''}</div>
                  )}
                  {topStudents.length > 0 && (
                    <div style={{ marginTop: 6, color: '#475569', fontSize: '0.9rem' }}>
                      {topStudents.join(', ')}{itemActivity.length > 3 ? ` +${itemActivity.length - 3} more` : ''}
                    </div>
                  )}
                </div>
              )}
              <div className="test-actions">
                <button
                  className="btn btn-sm"
                  onClick={() => handleExportStudyContentToLiveTest(item)}
                  disabled={exportingContentId === item.id}
                  style={{ backgroundColor: exportingContentId === item.id ? '#94a3b8' : '#7c3aed', color: '#fff' }}
                >
                  {exportingContentId === item.id ? 'Exporting...' : 'Export to Live Test'}
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => openEditModal(item)}
                >
                  Edit
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => openQuestionsModal(item)}
                >
                  Questions ({questions.filter(q => q.content_id === item.id).length})
                </button>
                <button
                  className={`btn btn-sm ${item.is_published ? 'btn-danger' : 'btn-success'}`}
                  onClick={() => handleTogglePublish(item.id, !item.is_published)}
                >
                  {item.is_published ? 'Unpublish' : 'Publish'}
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => handleDeleteContent(item.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {content.length === 0 && (
        <div className="empty-state">
          <div className="empty-title">No learning materials yet</div>
          <div className="empty-subtitle">Publish BECE, WASSCE, or university resources from the Learning Library editor.</div>
        </div>
      )}

      {/* Create/Edit Content Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => { setShowCreateModal(false); setEditingContent(null); resetContentForm(); }}>
          <div className="modal-content large-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingContent ? 'Edit Content' : 'Create New Content'}</h3>
              <button className="modal-close" onClick={() => { setShowCreateModal(false); setEditingContent(null); resetContentForm(); }}>X</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Title *</label>
                <input
                  type="text"
                  className="form-input"
                  value={contentForm.title}
                  onChange={(e) => setContentForm({...contentForm, title: e.target.value})}
                  placeholder="Enter content title"
                />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  className="form-input"
                  value={contentForm.description}
                  onChange={(e) => setContentForm({...contentForm, description: e.target.value})}
                  placeholder="Brief description of the content"
                  rows={3}
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Learning audience</label>
                  <select
                    className="form-input"
                    value={contentForm.education_level}
                    onChange={(e) => setContentForm({ ...contentForm, education_level: e.target.value })}
                  >
                    {LEARNING_LEVELS.map((level) => (
                      <option key={level.key} value={level.key}>
                        {level.label}
                      </option>
                    ))}
                    <option value="all">All learning levels</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Material focus</label>
                  <select
                    className="form-input"
                    value={contentForm.resource_kind}
                    onChange={(e) => setContentForm({ ...contentForm, resource_kind: e.target.value })}
                  >
                    {LEARNING_RESOURCE_TYPES.map((resourceType) => (
                      <option key={resourceType.key} value={resourceType.key}>
                        {resourceType.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Content Type</label>
                  <select
                    className="form-input"
                    value={contentForm.content_type}
                    onChange={(e) => setContentForm({...contentForm, content_type: e.target.value})}
                  >
                    <option value="lesson">Lesson</option>
                    <option value="article">Article</option>
                    <option value="video">Video</option>
                    <option value="document">Document</option>
                    <option value="interactive">Interactive</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Difficulty Level</label>
                  <select
                    className="form-input"
                    value={contentForm.difficulty_level}
                    onChange={(e) => setContentForm({...contentForm, difficulty_level: e.target.value})}
                  >
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="advanced">Advanced</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>{contentForm.education_level === "university" ? "Course or subject" : "Subject"}</label>
                  <input
                    type="text"
                    className="form-input"
                    list={`learning-subjects-${contentForm.education_level}`}
                    value={contentForm.subject}
                    onChange={(e) => setContentForm({...contentForm, subject: e.target.value})}
                    placeholder={contentForm.education_level === "university" ? "Search or enter a course" : "Search or enter a subject"}
                  />
                  <datalist id={`learning-subjects-${contentForm.education_level}`}>
                    {(LEARNING_SUBJECTS[contentForm.education_level] || []).map((subject) => (
                      <option key={subject} value={subject} />
                    ))}
                  </datalist>
                </div>
                <div className="form-group">
                  <label>{contentForm.education_level === "university" ? "Course / paper code" : "Class level"}</label>
                  <input
                    type="text"
                    className="form-input"
                    value={contentForm.class_level}
                    onChange={(e) => setContentForm({...contentForm, class_level: e.target.value})}
                    placeholder={contentForm.education_level === "university" ? "e.g., CS 201" : contentForm.education_level === "shs" ? "e.g., SHS 2" : "e.g., JHS 3"}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Estimated Read Time (minutes)</label>
                  <input
                    type="number"
                    className="form-input"
                    value={contentForm.estimated_read_time}
                    onChange={(e) => setContentForm({...contentForm, estimated_read_time: parseInt(e.target.value) || 15})}
                    min={1}
                  />
                </div>
                <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <label style={{ margin: 0 }}>Publish Content</label>
                  <input
                    type="checkbox"
                    checked={contentForm.is_published}
                    onChange={(e) => setContentForm({...contentForm, is_published: e.target.checked})}
                  />
                </div>
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <label style={{ margin: 0 }}>Chapters</label>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setContentForm({
                      ...contentForm,
                      chapters: [...(contentForm.chapters || []), { title: '', content: '' }]
                    })}
                  >
                    + Add Chapter
                  </button>
                </div>
                {(contentForm.chapters || []).length === 0 ? (
                  <div style={{ color: '#64748b', fontSize: '0.95rem', marginBottom: 10 }}>
                    Add chapters for this content item to break it into sections.
                  </div>
                ) : null}
                {(contentForm.chapters || []).map((chapter, index) => (
                  <div key={index} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, marginBottom: 12 }}>
                    <div className="form-row" style={{ alignItems: 'flex-start' }}>
                      <div className="form-group" style={{ flex: 1 }}>
                        <label>Chapter Title</label>
                        <input
                          type="text"
                          className="form-input"
                          value={chapter.title}
                          onChange={(e) => {
                            const chapters = [...(contentForm.chapters || [])];
                            chapters[index] = { ...chapters[index], title: e.target.value };
                            setContentForm({ ...contentForm, chapters });
                          }}
                          placeholder="Chapter title"
                        />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', marginTop: 24 }}>
                        <button
                          type="button"
                          className="btn btn-danger"
                          style={{ height: 36 }}
                          onClick={() => {
                            const chapters = (contentForm.chapters || []).filter((_, i) => i !== index);
                            setContentForm({ ...contentForm, chapters });
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    <div className="form-group">
                      <label>Chapter Content</label>
                      <textarea
                        className="form-input"
                        value={chapter.content}
                        onChange={(e) => {
                          const chapters = [...(contentForm.chapters || [])];
                          chapters[index] = { ...chapters[index], content: e.target.value };
                          setContentForm({ ...contentForm, chapters });
                        }}
                        placeholder="Enter chapter content"
                        rows={4}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="form-group">
                <label>Content (HTML/Markdown)</label>
                <textarea
                  className="form-input"
                  value={contentForm.content}
                  onChange={(e) => setContentForm({...contentForm, content: e.target.value})}
                  placeholder="Enter the main content here..."
                  rows={10}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => { setShowCreateModal(false); setEditingContent(null); resetContentForm(); }}
              >
                Cancel
              </button>
              <button
                className="btn btn-blue"
                onClick={editingContent ? handleUpdateContent : handleCreateContent}
              >
                {editingContent ? 'Update Content' : 'Create Content'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showImportModal && (
        <div className="modal-overlay" onClick={() => { if (!importing) setShowImportModal(false); }}>
          <div className="modal-content" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Bulk import learning materials</h3>
              <button
                className="modal-close"
                type="button"
                disabled={importing}
                onClick={() => setShowImportModal(false)}
              >X</button>
            </div>
            <div className="modal-body">
              <p>Upload JSON arrays or PDF/DOCX documents, up to 200 files (maximum 5 MB each). Documents are imported as unpublished materials with extracted text. Scanned PDFs require OCR and cannot be imported. Invalid JSON rows are skipped and reported; JSON items may include questions and multiple-choice answers.</p>
              <p>
                Education levels: <code>all</code>, <code>jhs</code>, <code>shs</code>, <code>university</code>.
                Content types: <code>lesson</code>, <code>article</code>, <code>video</code>, <code>document</code>, <code>interactive</code>.
              </p>
              <button className="btn btn-outline" type="button" onClick={downloadStudyContentTemplate}>
                Download JSON template
              </button>
              <div className="form-group" style={{ marginTop: 16 }}>
                <label htmlFor="study-content-import-file">Choose JSON, PDF, or DOCX files</label>
                <input
                  id="study-content-import-file"
                  className="form-input"
                  type="file"
                  accept=".json,.pdf,.docx,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  multiple
                  disabled={importing}
                  onChange={(event) => {
                    const files = Array.from(event.target.files || []);
                    event.target.value = '';
                    if (files.length) handleImportContent(files);
                  }}
                />
              </div>
              {importing && <div role="status">Importing learning materials...</div>}
            </div>
          </div>
        </div>
      )}

      {/* Questions Modal */}
      {showQuestionsModal && selectedContent && (
        <div className="modal-overlay" onClick={() => { setShowQuestionsModal(false); setSelectedContent(null); setQuestions([]); }}>
          <div className="modal-content large-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Questions for: {selectedContent.title}</h3>
              <button className="modal-close" onClick={() => { setShowQuestionsModal(false); setSelectedContent(null); setQuestions([]); }}> </button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: '20px' }}>
                <h4>Add New Question</h4>
                <div className="form-group">
                  <label>Question Text *</label>
                  <textarea
                    className="form-input"
                    value={questionForm.question_text}
                    onChange={(e) => setQuestionForm({...questionForm, question_text: e.target.value})}
                    placeholder="Enter the question"
                    rows={3}
                  />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Question Type</label>
                    <select
                      className="form-input"
                      value={questionForm.question_type}
                      onChange={(e) => setQuestionForm({...questionForm, question_type: e.target.value})}
                    >
                      <option value="multiple_choice">Multiple Choice</option>
                      <option value="true_false">True/False</option>
                      <option value="short_answer">Short Answer</option>
                      <option value="essay">Essay</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Chapter</label>
                    <input
                      type="number"
                      className="form-input"
                      value={questionForm.chapter_index}
                      onChange={(e) => setQuestionForm({...questionForm, chapter_index: parseInt(e.target.value) >= 0 ? parseInt(e.target.value) : 0})}
                      min={0}
                    />
                    <small style={{ color: '#64748b' }}>Enter the chapter number for this question</small>
                  </div>
                  <div className="form-group">
                    <label>Points</label>
                    <input
                      type="number"
                      className="form-input"
                      value={questionForm.points}
                      onChange={(e) => setQuestionForm({...questionForm, points: parseInt(e.target.value) || 1})}
                      min={1}
                    />
                  </div>
                </div>

                {questionForm.question_type === 'multiple_choice' && (
                  <div className="form-group">
                    <label>Answer Options</label>
                    {questionForm.answers.map((answer, index) => (
                      <div key={index} style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                        <input
                          type="text"
                          className="form-input"
                          value={answer.answer_text}
                          onChange={(e) => {
                            const newAnswers = [...questionForm.answers];
                            newAnswers[index].answer_text = e.target.value;
                            setQuestionForm({...questionForm, answers: newAnswers});
                          }}
                          placeholder={`Option ${index + 1}`}
                        />
                        <input
                          type="checkbox"
                          checked={answer.is_correct}
                          onChange={(e) => {
                            const newAnswers = [...questionForm.answers];
                            newAnswers[index].is_correct = e.target.checked;
                            setQuestionForm({...questionForm, answers: newAnswers});
                          }}
                        />
                        <label>Correct</label>
                        {questionForm.answers.length > 2 && (
                          <button
                            type="button"
                            onClick={() => {
                              const newAnswers = questionForm.answers.filter((_, i) => i !== index);
                              setQuestionForm({...questionForm, answers: newAnswers});
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setQuestionForm({
                        ...questionForm,
                        answers: [...questionForm.answers, { answer_text: '', is_correct: false }]
                      })}
                    >
                      + Add Option
                    </button>
                  </div>
                )}

                {questionForm.question_type === 'true_false' && (
                  <div className="form-group">
                    <label>Correct Answer</label>
                    <select
                      className="form-input"
                      value={questionForm.correct_answer}
                      onChange={(e) => setQuestionForm({...questionForm, correct_answer: e.target.value})}
                    >
                      <option value="">Select answer</option>
                      <option value="true">True</option>
                      <option value="false">False</option>
                    </select>
                  </div>
                )}

                {(questionForm.question_type === 'short_answer' || questionForm.question_type === 'essay') && (
                  <div className="form-group">
                    <label>Expected Answer</label>
                    <textarea
                      className="form-input"
                      value={questionForm.correct_answer}
                      onChange={(e) => setQuestionForm({...questionForm, correct_answer: e.target.value})}
                      placeholder="Enter the expected answer or keywords"
                      rows={2}
                    />
                  </div>
                )}

                <div className="form-group">
                  <label>Explanation (Optional)</label>
                  <textarea
                    className="form-input"
                    value={questionForm.explanation}
                    onChange={(e) => setQuestionForm({...questionForm, explanation: e.target.value})}
                    placeholder="Explain the correct answer"
                    rows={2}
                  />
                </div>

                <button
                  className="btn btn-blue"
                  onClick={handleAddQuestion}
                  disabled={!questionForm.question_text.trim()}
                >
                  Add Question
                </button>
              </div>

              <div>
                <h4>Existing Questions ({questions.length})</h4>
                {questions.length === 0 ? (
                  <p>No questions added yet.</p>
                ) : (
                  <div className="questions-list">
                    {questions.map((question, index) => (
                      <div key={question.id} className="question-item">
                        <div className="question-header">
                          <div className="question-number">Q{index + 1}</div>
                          <div className="question-text">{question.question_text}</div>
                          <div className="question-meta">
                            <span className="question-type">{question.question_type.replace('_', ' ')}</span>
                            <span className="question-points">{question.points} pts</span>
                            <span className="question-chapter">Chapter {question.chapter_index ?? 0}</span>
                          </div>
                        </div>
                        {question.question_type === 'multiple_choice' && question.study_answers && (
                          <div className="question-answers">
                            {question.study_answers.map((answer) => (
                              <div key={answer.id} className={`answer-option ${answer.is_correct ? 'correct' : ''}`}>
                                <div className="answer-label">
                                  <span className="answer-letter">{String.fromCharCode(65 + answer.order_index)}</span>
                                  {answer.answer_text}
                                </div>
                              </div>
                            ))}
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
