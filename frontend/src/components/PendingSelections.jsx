import React, { useEffect, useState, useContext } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { normalizeSelectionList, resolveStudentPhotoUrl } from "../utils/campusData.js";
import { SettingsContext } from "../context/SettingsContext.js";
import { isAtLeastAdmin } from "../config/campusConfig.js";

export default function PendingSelections() {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const { session } = useContext(SettingsContext) || {};
  const user = session?.user || {};
  const userRole = (user.role || "").toLowerCase();

  useEffect(() => {
    const fetchPending = async () => {
      setLoading(true);
      // Fetch pending selections and join with students
      const { data: selections, error } = await supabase
        .from("school_selections")
        .select(`*, student:students(id, full_name, index_number, photo_url)`)
        .eq("status", "pending");
      setPending(selections || []);
      setLoading(false);
    };
    fetchPending();
  }, []);


  // DEBUG: Show current user role
  const debugRole = (
    <div style={{ background: '#fef9c3', color: '#92400e', padding: 8, borderRadius: 6, marginBottom: 12, fontSize: 14 }}>
      <b>Debug:</b> Current user role: <span style={{ fontWeight: 600 }}>{userRole || '(none)'}</span>
    </div>
  );

  if (loading) return <div>Loading pending selections...</div>;
  if (!pending.length) return <div>No pending selections found.</div>;

  // Approve selection
  const handleApprove = async (row) => {
    if (!window.confirm("Approve this selection?")) return;
    await supabase
      .from("school_selections")
      .update({ status: "confirmed", approved: true, reviewed_at: new Date().toISOString(), rejection_reason: null })
      .eq("id", row.id);
    setPending((prev) => prev.filter((r) => r.id !== row.id));
  };

  // Reject selection
  const handleReject = async (row) => {
    const reason = window.prompt("Enter rejection reason (optional):", "");
    if (reason === null) return; // Cancelled
    await supabase
      .from("school_selections")
      .update({ status: "rejected", approved: false, reviewed_at: new Date().toISOString(), rejection_reason: reason })
      .eq("id", row.id);
    setPending((prev) => prev.filter((r) => r.id !== row.id));
  };


  if (!isAtLeastAdmin(userRole)) {
    return <div className="card">{debugRole}<h2>Pending School Selections</h2><div style={{margin:24, color:'#d97706'}}>You are not authorized to review selections.</div></div>;
  }

  return (
    <div className="card">
      {debugRole}
      <h2>Pending School Selections</h2>
      {/* Standalone debug Reject button for visibility testing */}
      <div style={{ margin: '12px 0' }}>
        <button className="btn btn-red" onClick={() => alert('Reject button clicked (debug)')}>Reject (Debug)</button>
      </div>
      <table className="students-table" style={{ width: "100%", marginTop: 16 }}>
        <thead>
          <tr>
            <th>Photo</th>
            <th>Name</th>
            <th>Index Number</th>
            <th>Selected Schools</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {pending.map((row) => {
            const student = row.student || {};
            const picks = normalizeSelectionList(row);
            return (
              <tr key={row.id}>
                <td>
                  {student.photo_url ? (
                    <img src={resolveStudentPhotoUrl(student)} alt="Student" style={{ width: 48, height: 48, borderRadius: "50%" }} />
                  ) : (
                    <span style={{ color: "#94a3b8" }}>No Photo</span>
                  )}
                </td>
                <td>{student.full_name || "-"}</td>
                <td>{student.index_number || "-"}</td>
                <td>
                  {picks.length === 0
                    ? "No schools selected"
                    : picks.map((school, idx) => (
                        <span key={school.id}>
                          {school.name}
                          {idx < picks.length - 1 ? ", " : ""}
                        </span>
                      ))}
                </td>
                <td>
                  <button className="btn btn-green" style={{ marginRight: 8 }} onClick={() => handleApprove(row)}>
                    Approve
                  </button>
                  <button className="btn btn-red" onClick={() => handleReject(row)}>
                    Reject
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
