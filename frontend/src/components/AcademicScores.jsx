import React, { useState, useContext } from "react";
import { SUBJECTS } from "../data/demoData.js";
import { SettingsContext } from "../context/SettingsContext.js";
import { supabase } from "../lib/supabaseClient.js";
import { useEffect } from "react";

export default function AcademicScores() {
  // Get current user and role from context if available
  const { session, cfg } = useContext(SettingsContext) || {};
  const user = session?.user || {};
  const userRole = (user.role || "").toLowerCase();
  // Subjects available to the current user (admin: all, teacher: filtered)
  const [teacherSubjects, setTeacherSubjects] = useState(SUBJECTS);
    // Fetch teacher's subjects from Supabase if user is a teacher
    useEffect(() => {
      const fetchTeacherSubjects = async () => {
        if (userRole !== "teacher" || !user.email || !supabase) {
          setTeacherSubjects(SUBJECTS);
          return;
        }
        try {
          const { data: teacherRows, error: teacherError } = await supabase
            .from("teachers")
            .select("subject")
            .eq("email", user.email)
            .limit(1);
          if (teacherError) throw teacherError;
          if (teacherRows && teacherRows.length > 0 && teacherRows[0].subject) {
            // Parse comma-separated subjects
            const allowed = teacherRows[0].subject
              .split(",")
              .map((s) => s.trim().toLowerCase());
            setTeacherSubjects(SUBJECTS.filter((s) => allowed.includes(s.toLowerCase())));
          } else {
            setTeacherSubjects(SUBJECTS);
          }
        } catch (err) {
          setTeacherSubjects(SUBJECTS);
        }
      };
      fetchTeacherSubjects();
      // eslint-disable-next-line
    }, [userRole, user.email]);
  const [scores, setScores] = useState([]);
  const [search, setSearch] = useState("");
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Fetch students and scores from Supabase on mount
  useEffect(() => {
    const fetchData = async () => {
      if (!supabase) return;
      setLoading(true);
      setError("");
      try {
        // Fetch students
        const { data: studentRows, error: studentError } = await supabase.from("students").select("id, full_name, index_number");
        if (studentError) throw studentError;
        setStudents(studentRows || []);
        // Fetch scores
        const { data: scoreRows, error: scoreError } = await supabase.from("scores").select("student_id, index_number, subject, score");
        if (scoreError) throw scoreError;
        // Build a map: { student_id: { subject: score } }
        const scoreMap = {};
        (scoreRows || []).forEach(row => {
          if (!scoreMap[row.student_id]) scoreMap[row.student_id] = {};
          scoreMap[row.student_id][row.subject] = row.score;
        });
        setScores((studentRows || []).map(student => ({
          student_id: student.id,
          name: student.full_name,
          index: student.index_number,
          scores: Object.fromEntries(SUBJECTS.map(subject => [subject, scoreMap[student.id]?.[subject] ?? ""])),
        })));
      } catch (err) {
        setError("Failed to fetch students or scores from Supabase.");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
    // eslint-disable-next-line
  }, []);
  const handleScoreChange = (studentIdx, subject, value) => {
    let score = value.replace(/[^0-9.]/g, "");
    if (score !== "") {
      score = Math.max(0, Math.min(100, Number(score)));
    }
    setScores((prev) => {
      const updated = [...prev];
      updated[studentIdx] = {
        ...updated[studentIdx],
        scores: { ...updated[studentIdx].scores, [subject]: score },
      };
      return updated;
    });
  };

  const handleSave = () => {
    if (!supabase) return alert("Supabase not configured");
    setSaving(true);
    setError("");
    // Flatten scores for upsert
    const rows = [];
    scores.forEach(student => {
      SUBJECTS.forEach(subject => {
        const score = student.scores[subject];
        if (score !== "" && !isNaN(Number(score))) {
          rows.push({
            student_id: student.student_id,
            index_number: student.index,
            subject,
            score: Number(score),
            exam_type: "test",
          });
        }
      });
    });
    const upsertScores = async () => {
      try {
        const { error } = await supabase.from("scores").upsert(rows, { onConflict: ["student_id", "subject", "exam_type"] });
        if (error) throw error;
        alert("Scores saved!");
      } catch (err) {
        setError("Failed to save scores to Supabase.");
      } finally {
        setSaving(false);
      }
    };
    upsertScores();
  };

  return (
    <div className="card card-padded fade-in">
      <div className="page-header">
        <div className="page-title">Academic Test Scores</div>
        <div className="page-sub">Admins and teachers can add or update test scores for each student and subject. Scores must be between 0 and 100.</div>
      </div>
      {error && <div className="alert alert-warning" style={{marginBottom:12}}>{error}</div>}
      {loading ? (
        <div style={{margin:24}}>Loading scores...</div>
      ) : (
        <>
          <div style={{marginBottom:16}}>
            <input
              type="text"
              className="form-control"
              style={{maxWidth:340}}
              placeholder="Search by name or index number..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="students-table">
              <thead>
                <tr>
                  <th>Student Name</th>
                  {teacherSubjects.map((subject) => (
                    <th key={subject}>{subject}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scores.filter(row =>
                  row.name.toLowerCase().includes(search.toLowerCase()) ||
                  String(row.index).toLowerCase().includes(search.toLowerCase())
                ).map((row, i) => (
                  <tr key={row.student_id}>
                    <td>{row.name}</td>
                    {teacherSubjects.map((subject) => (
                      <td key={subject}>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          className="form-control"
                          style={{ width: 60 }}
                          value={row.scores[subject]}
                          onChange={(e) => handleScoreChange(i, subject, e.target.value)}
                          disabled={saving}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="modal-actions" style={{ marginTop: 18 }}>
        <button className="btn btn-blue" onClick={handleSave} disabled={saving || loading}>{saving ? "Saving..." : "Save Scores"}</button>
      </div>
    </div>
  );
}
