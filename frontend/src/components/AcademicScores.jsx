import { useContext, useEffect, useMemo, useState } from "react";
import { SUBJECTS } from "../data/demoData.js";
import { SettingsContext } from "../context/SettingsContext.js";
import { supabase } from "../lib/supabaseClient.js";
import styles from "./AcademicScores.module.css";

export default function AcademicScores() {
  const { session, cfg } = useContext(SettingsContext) || {};
  const currentTerm = cfg?.currentTerm || "Unspecified Term";
  const academicYear = cfg?.academicYear || "Unspecified Academic Year";
  const user = session?.user || {};
  const userRole = String(user.role || "").toLowerCase();
  const [teacherSubjects, setTeacherSubjects] = useState(SUBJECTS);
  const [selectedSubjects, setSelectedSubjects] = useState(SUBJECTS);
  const [teacherSubjectError, setTeacherSubjectError] = useState("");
  const [scores, setScores] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;
    const fetchTeacherSubjects = async () => {
      if (userRole !== "teacher" || !user.email || !supabase) {
        setTeacherSubjects(SUBJECTS);
        setTeacherSubjectError("");
        return;
      }
      const { data, error: teacherError } = await supabase
        .from("teachers")
        .select("subject")
        .eq("email", user.email)
        .limit(1);
      if (!active) return;
      if (teacherError) {
        setTeacherSubjects([]);
        setTeacherSubjectError(
          `Your teaching subjects could not be loaded: ${teacherError.message}`,
        );
        return;
      }

      const assignedSubjects = String(data?.[0]?.subject || "")
        .split(",")
        .map((subject) => subject.trim().toLowerCase())
        .filter(Boolean);
      setTeacherSubjects(
        assignedSubjects.length
          ? SUBJECTS.filter((subject) =>
              assignedSubjects.includes(subject.toLowerCase()),
            )
          : [],
      );
      setTeacherSubjectError("");
    };

    fetchTeacherSubjects().catch((fetchError) => {
      if (!active) return;
      setTeacherSubjects([]);
      setTeacherSubjectError(
        `Your teaching subjects could not be loaded: ${fetchError.message}`,
      );
    });
    return () => {
      active = false;
    };
  }, [user.email, userRole]);

  useEffect(() => {
    let active = true;
    const fetchData = async () => {
      if (!supabase) {
        setError("Supabase is not configured. Academic scores cannot be loaded or saved.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const [{ data: studentRows, error: studentError }, { data: scoreRows, error: scoreError }] =
          await Promise.all([
            supabase
              .from("students")
              .select("id, full_name, index_number")
              .order("full_name", { ascending: true }),
            supabase
              .from("scores")
              .select("student_id, index_number, subject, score")
              .eq("exam_type", "test")
              .eq("term", currentTerm)
              .eq("academic_year", academicYear),
          ]);
        if (studentError) throw studentError;
        if (scoreError) throw scoreError;
        if (!active) return;

        const scoreMap = {};
        (scoreRows || []).forEach((row) => {
          if (!row.student_id) return;
          if (!scoreMap[row.student_id]) scoreMap[row.student_id] = {};
          scoreMap[row.student_id][row.subject] = row.score;
        });
        setScores(
          (studentRows || []).map((student) => ({
            student_id: student.id,
            name: student.full_name || "Unnamed student",
            index: student.index_number || "",
            scores: Object.fromEntries(
              SUBJECTS.map((subject) => [
                subject,
                scoreMap[student.id]?.[subject] ?? "",
              ]),
            ),
          })),
        );
      } catch (fetchError) {
        if (active) {
          setError(
            `Academic scores could not be loaded: ${
              fetchError instanceof Error
                ? fetchError.message
                : "Supabase request failed."
            }`,
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchData();
    return () => {
      active = false;
    };
  }, [academicYear, currentTerm]);

  const normalizedSearch = search.trim().toLowerCase();
  const activeSubjects =
    userRole === "teacher"
      ? teacherSubjects
      : teacherSubjects.filter((subject) => selectedSubjects.includes(subject));
  const filteredScores = useMemo(
    () =>
      scores.filter(
        (row) =>
          row.name.toLowerCase().includes(normalizedSearch) ||
          String(row.index).toLowerCase().includes(normalizedSearch),
      ),
    [normalizedSearch, scores],
  );
  const scoreValues = useMemo(
    () =>
      scores.flatMap((student) =>
        activeSubjects
          .map((subject) => student.scores[subject])
          .filter((score) => score !== "" && Number.isFinite(Number(score)))
          .map(Number),
      ),
    [activeSubjects, scores],
  );
  const averageScore = scoreValues.length
    ? Math.round(scoreValues.reduce((total, score) => total + score, 0) / scoreValues.length)
    : null;

  const handleScoreChange = (studentId, subject, value) => {
    const sanitized = value.replace(/[^0-9.]/g, "");
    const score =
      sanitized === ""
        ? ""
        : Math.max(0, Math.min(100, Number(sanitized)));
    setSuccess("");
    setScores((current) =>
      current.map((student) =>
        student.student_id === studentId
          ? {
              ...student,
              scores: { ...student.scores, [subject]: score },
            }
          : student,
      ),
    );
  };

  const handleSave = async () => {
    if (!supabase) {
      setError("Supabase is not configured. Academic scores cannot be saved.");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const rows = [];
      scores.forEach((student) => {
        activeSubjects.forEach((subject) => {
          const score = student.scores[subject];
          if (score !== "" && Number.isFinite(Number(score))) {
            rows.push({
              student_id: student.student_id,
              index_number: student.index || null,
              subject,
              score: Number(score),
              exam_type: "test",
              term: currentTerm,
              academic_year: academicYear,
            });
          }
        });
      });
      if (!rows.length) {
        setError("Enter at least one score before saving.");
        return;
      }

      const { error: saveError } = await supabase
        .from("scores")
        .upsert(rows, {
          onConflict: "student_id,subject,exam_type,academic_year,term",
        });
      if (saveError) throw saveError;
      setSuccess(`${rows.length} score${rows.length === 1 ? "" : "s"} saved successfully.`);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? `Scores were not saved: ${saveError.message}`
          : "Scores were not saved because the Supabase request failed.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={`${styles.page} fade-in`}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>Academic management</span>
          <h1 className={styles.title}>Academic scores</h1>
          <p className={styles.subtitle}>
            Record, review, and update student assessment results in one place.
            Scores are marked out of 100.
          </p>
        </div>
        <div className={styles.heroMeta}>
          <span className={styles.metaLabel}>Assessment</span>
          <strong>Class test</strong>
          <span>
            {currentTerm} · {academicYear}
          </span>
          <span>Score range: 0–100</span>
        </div>
      </header>

      <div className={styles.summaryGrid}>
        <article className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Students</span>
          <strong className={styles.summaryValue}>
            {loading ? "—" : scores.length.toLocaleString()}
          </strong>
          <span className={styles.summaryHint}>In the current student roster</span>
        </article>
        <article className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Scores entered</span>
          <strong className={styles.summaryValue}>
            {loading ? "—" : scoreValues.length.toLocaleString()}
          </strong>
          <span className={styles.summaryHint}>
            Across {activeSubjects.length} selected subject
            {activeSubjects.length === 1 ? "" : "s"}
          </span>
        </article>
        <article className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Average score</span>
          <strong className={styles.summaryValue}>
            {loading || averageScore === null ? "—" : `${averageScore}%`}
          </strong>
          <span className={styles.summaryHint}>Based on entered scores</span>
        </article>
      </div>

      {error && (
        <div className={styles.noticeError} role="alert">
          {error}
        </div>
      )}
      {teacherSubjectError && (
        <div className={styles.noticeError} role="alert">
          {teacherSubjectError}
        </div>
      )}
      {success && (
        <div className={styles.noticeSuccess} role="status">
          {success}
        </div>
      )}

      <section className={styles.workspace} aria-label="Student assessment scores">
        <div className={styles.toolbar}>
          <div>
            <h2 className={styles.tableTitle}>Student scorebook</h2>
            <p className={styles.tableSubtitle}>
              {loading
                ? "Loading student records…"
                : `${filteredScores.length} of ${scores.length} students`}
            </p>
          </div>
          <label className={styles.searchWrap}>
            <span className={styles.searchIcon} aria-hidden="true">
              ⌕
            </span>
            <span className={styles.visuallyHidden}>Search students</span>
            <input
              className={styles.search}
              type="search"
              placeholder="Search by name or student ID"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>

        {userRole !== "teacher" && (
          <details className={styles.subjectPicker}>
            <summary className={styles.subjectPickerSummary}>
              <span className={styles.subjectPickerLabel}>Subjects to enter</span>
              <span className={styles.subjectPickerSelection}>
                {selectedSubjects.length === SUBJECTS.length
                  ? "All subjects"
                  : selectedSubjects.length
                    ? `${selectedSubjects.length} selected`
                    : "Choose subjects"}
              </span>
              <span className={styles.subjectPickerChevron} aria-hidden="true" />
            </summary>
            <div className={styles.subjectPickerMenu}>
              <div className={styles.subjectPickerHeader}>
                <p className={styles.subjectPickerHint}>
                  Choose one or more subjects to show in the scorebook.
                </p>
                <div className={styles.subjectPickerActions}>
                  <button
                    type="button"
                    className={styles.subjectAction}
                    onClick={() => setSelectedSubjects([...SUBJECTS])}
                    disabled={saving || selectedSubjects.length === SUBJECTS.length}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className={styles.subjectAction}
                    onClick={() => setSelectedSubjects([])}
                    disabled={saving || selectedSubjects.length === 0}
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className={styles.subjectOptions}>
                {SUBJECTS.map((subject) => (
                  <label
                    key={subject}
                    className={`${styles.subjectOption} ${
                      selectedSubjects.includes(subject)
                        ? styles.subjectOptionSelected
                        : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSubjects.includes(subject)}
                      onChange={(event) =>
                        setSelectedSubjects((current) =>
                          event.target.checked
                            ? [...current, subject]
                            : current.filter((item) => item !== subject),
                        )
                      }
                      disabled={saving}
                    />
                    <span>{subject}</span>
                  </label>
                ))}
              </div>
            </div>
          </details>
        )}

        {!loading && !teacherSubjectError && activeSubjects.length === 0 && (
          <div className={styles.emptyState}>
            <strong>
              {userRole === "teacher" ? "No subjects assigned" : "No subjects selected"}
            </strong>
            <span>
              {userRole === "teacher"
                ? "Ask your administrator to update your teaching subjects."
                : "Select at least one subject above to enter scores."}
            </span>
          </div>
        )}

        {!loading && activeSubjects.length > 0 && (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.studentHeading} scope="col">
                    Student
                  </th>
                  {activeSubjects.map((subject) => (
                    <th key={subject} scope="col">
                      {subject}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredScores.map((row) => (
                  <tr key={row.student_id}>
                    <th className={styles.studentCell} scope="row">
                      <span className={styles.studentName}>{row.name}</span>
                      <span className={styles.studentId}>
                        ID: {row.index || "Not assigned"}
                      </span>
                    </th>
                    {activeSubjects.map((subject) => (
                      <td key={subject}>
                        <div className={styles.scoreField}>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            inputMode="decimal"
                            aria-label={`${subject} score for ${row.name}`}
                            className={styles.scoreInput}
                            value={row.scores[subject]}
                            onChange={(event) =>
                              handleScoreChange(
                                row.student_id,
                                subject,
                                event.target.value,
                              )
                            }
                            disabled={saving}
                          />
                          <span>/100</span>
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
                {!filteredScores.length && (
                  <tr>
                    <td
                      className={styles.emptyCell}
                      colSpan={activeSubjects.length + 1}
                    >
                      {scores.length
                        ? "No students match your search."
                        : "No student records are available yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {loading && (
          <div className={styles.loadingState} role="status">
            <span className={styles.spinner} />
            Loading student scores…
          </div>
        )}

        <footer className={styles.footer}>
          <span className={styles.footerNote}>
            Changes are saved to the school scorebook.
          </span>
          <button
            className={styles.saveButton}
            type="button"
            onClick={handleSave}
            disabled={saving || loading || activeSubjects.length === 0}
          >
            {saving ? (
              <>
                <span className={styles.buttonSpinner} />
                Saving scores…
              </>
            ) : (
              "Save scores"
            )}
          </button>
        </footer>
      </section>
    </section>
  );
}
