import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";

const EDUCATION_LEVELS = ["JHS", "SHS", "University", "Other"];
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const FILE_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const panelStyle = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 16,
  padding: 20,
  boxShadow: "0 8px 26px rgba(15, 23, 42, .05)",
};

const normalizeEducationLevel = (className = "") => {
  const value = className.toLowerCase();
  if (/(jhs|junior|basic)/.test(value)) return "JHS";
  if (/(shs|senior)/.test(value)) return "SHS";
  if (/(university|tertiary|college|level\s*[1-9])/.test(value)) {
    return "University";
  }
  return "Other";
};

const getErrorMessage = (error) =>
  error?.message || "The request could not be completed.";

export default function StudyTeamsPage({ user, studentData }) {
  const actorRole = String(user?.role || "").toLowerCase();
  const isStudent = actorRole === "student";
  const canCreateTeams = [
    "student",
    "admin",
    "school_admin",
    "teacher",
    "staff",
  ].includes(actorRole);
  const studentClass = String(studentData?.class || studentData?.class_name || "").trim();
  const [memberships, setMemberships] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [teamMembers, setTeamMembers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [resources, setResources] = useState([]);
  const [messageText, setMessageText] = useState("");
  const [resourceTitle, setResourceTitle] = useState("");
  const [resourceDescription, setResourceDescription] = useState("");
  const [resourceUrl, setResourceUrl] = useState("");
  const [resourceFile, setResourceFile] = useState(null);
  const [inviteEmails, setInviteEmails] = useState("");
  const [form, setForm] = useState({
    name: "",
    description: "",
    education_level: "",
    class_level: "",
    subject: "",
  });

  useEffect(() => {
    if (!isStudent || !studentClass) return;
    setForm((current) => ({
      ...current,
      education_level: normalizeEducationLevel(studentClass),
      class_level: studentClass,
    }));
  }, [isStudent, studentClass]);

  const loadMemberships = useCallback(async () => {
    if (!supabase || !user?.authUserId) {
      setMemberships([]);
      setErrorMessage(
        !supabase
          ? "Study teams are unavailable because Supabase is not configured."
          : "Sign in again to load study teams.",
      );
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorMessage("");
    const { data, error } = await supabase
      .from("collaborative_study_team_members")
      .select(
        "id, team_id, role_key, invitation_status, invited_at, team:collaborative_study_teams(id, name, description, education_level, class_level, subject, created_by, created_by_role)",
      )
      .eq("user_id", user.authUserId)
      .order("invited_at", { ascending: false });

    if (error) {
      setMemberships([]);
      setErrorMessage(`Study teams could not be loaded: ${error.message}`);
    } else {
      setMemberships((data || []).filter((item) => item.team));
    }
    setLoading(false);
  }, [user?.authUserId]);

  useEffect(() => {
    loadMemberships();
  }, [loadMemberships]);

  const activeMemberships = useMemo(
    () => memberships.filter((item) => item.invitation_status === "accepted"),
    [memberships],
  );
  const pendingInvitations = useMemo(
    () => memberships.filter((item) => item.invitation_status === "pending"),
    [memberships],
  );
  const selectedTeam = activeMemberships.find(
    (item) => item.team_id === selectedTeamId,
  )?.team;

  const loadSelectedTeamData = useCallback(async () => {
    if (!supabase || !selectedTeamId) {
      setMessages([]);
      setResources([]);
      setTeamMembers([]);
      return;
    }

    const [messageResult, resourceResult, memberResult] = await Promise.all([
      supabase
        .from("collaborative_study_team_messages")
        .select("id, sender_id, sender_name, content, created_at")
        .eq("team_id", selectedTeamId)
        .order("created_at", { ascending: true })
        .limit(200),
      supabase
        .from("collaborative_study_team_resources")
        .select("id, shared_by_name, title, description, resource_type, resource_url, storage_path, created_at")
        .eq("team_id", selectedTeamId)
        .order("created_at", { ascending: false }),
      supabase
        .from("collaborative_study_team_members")
        .select("id, display_name, role_key, invitation_status")
        .eq("team_id", selectedTeamId)
        .eq("invitation_status", "accepted"),
    ]);

    const resultError =
      messageResult.error || resourceResult.error || memberResult.error;
    if (resultError) {
      setErrorMessage(`Team content could not be loaded: ${resultError.message}`);
      setMessages([]);
      setResources([]);
      setTeamMembers([]);
      return;
    }

    setMessages(messageResult.data || []);
    setTeamMembers(memberResult.data || []);
    const signedResources = await Promise.all(
      (resourceResult.data || []).map(async (resource) => {
        if (resource.resource_type !== "file") {
          return { ...resource, signed_url: resource.resource_url };
        }
        const { data, error } = await supabase.storage
          .from("study-team-resources")
          .createSignedUrl(resource.storage_path, 60 * 60);
        if (error) {
          return { ...resource, signed_url: "", signing_error: error.message };
        }
        return { ...resource, signed_url: data?.signedUrl || "" };
      }),
    );
    setResources(signedResources);
  }, [selectedTeamId]);

  useEffect(() => {
    loadSelectedTeamData();
  }, [loadSelectedTeamData]);

  const createTeam = async (event) => {
    event.preventDefault();
    if (!supabase || !canCreateTeams) return;
    setBusy(true);
    setErrorMessage("");
    setSuccessMessage("");
    const emails = inviteEmails
      .split(/[\s,;]+/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);

    try {
      const { data, error } = await supabase.rpc(
        "create_collaborative_study_team",
        {
          p_name: form.name,
          p_description: form.description,
          p_education_level: form.education_level,
          p_class_level: form.class_level,
          p_subject: form.subject,
          p_invited_emails: emails,
        },
      );
      if (error) throw error;

      setSuccessMessage("Study team created and invitations sent.");
      setForm((current) => ({
        ...current,
        name: "",
        description: "",
        subject: "",
      }));
      setInviteEmails("");
      await loadMemberships();
      if (data) setSelectedTeamId(data);
    } catch (error) {
      setErrorMessage(`Study team could not be created: ${getErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const respondToInvitation = async (membershipId, response) => {
    setBusy(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const { error } = await supabase.rpc(
        "respond_to_collaborative_study_team_invitation",
        { p_membership_id: membershipId, p_response: response },
      );
      if (error) throw error;
      setSuccessMessage(
        response === "accepted"
          ? "Invitation accepted. You are now a team member."
          : "Invitation declined.",
      );
      await loadMemberships();
    } catch (error) {
      setErrorMessage(`Invitation could not be updated: ${getErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const sendMessage = async (event) => {
    event.preventDefault();
    const content = messageText.trim();
    if (!content || !selectedTeam || !supabase) return;
    setBusy(true);
    setErrorMessage("");
    const { error } = await supabase
      .from("collaborative_study_team_messages")
      .insert({
        team_id: selectedTeam.id,
        sender_id: user.authUserId,
        sender_name: user.name || user.email || "Campus Ghana member",
        content,
      });
    if (error) {
      setErrorMessage(`Message could not be sent: ${error.message}`);
    } else {
      setMessageText("");
      await loadSelectedTeamData();
    }
    setBusy(false);
  };

  const shareResource = async (event) => {
    event.preventDefault();
    if (!selectedTeam || !supabase || !resourceTitle.trim()) return;
    if (resourceFile && resourceUrl.trim()) {
      setErrorMessage("Share either a link or a file, not both.");
      return;
    }
    if (!resourceFile && !/^https?:\/\/\S+$/i.test(resourceUrl.trim())) {
      setErrorMessage("Enter a complete http or https resource link.");
      return;
    }
    if (
      resourceFile &&
      (!FILE_TYPES.has(resourceFile.type) || resourceFile.size > MAX_FILE_SIZE)
    ) {
      setErrorMessage("Choose a supported file type no larger than 20 MB.");
      return;
    }

    setBusy(true);
    setErrorMessage("");
    let uploadedPath = "";
    try {
      let resourceType = "link";
      if (resourceFile) {
        resourceType = "file";
        const safeName = resourceFile.name.replace(/[^\w.-]/g, "_");
        uploadedPath = `${selectedTeam.id}/${user.authUserId}/${Date.now()}-${safeName}`;
        const { error: uploadError } = await supabase.storage
          .from("study-team-resources")
          .upload(uploadedPath, resourceFile, {
            contentType: resourceFile.type,
            upsert: false,
          });
        if (uploadError) throw uploadError;
      }

      const { error } = await supabase
        .from("collaborative_study_team_resources")
        .insert({
          team_id: selectedTeam.id,
          shared_by: user.authUserId,
          shared_by_name: user.name || user.email || "Campus Ghana member",
          title: resourceTitle.trim(),
          description: resourceDescription.trim(),
          resource_type: resourceType,
          resource_url: resourceType === "link" ? resourceUrl.trim() : null,
          storage_path: resourceType === "file" ? uploadedPath : null,
        });
      if (error) throw error;

      setResourceTitle("");
      setResourceDescription("");
      setResourceUrl("");
      setResourceFile(null);
      await loadSelectedTeamData();
      setSuccessMessage("Resource shared with the team.");
    } catch (error) {
      if (uploadedPath) {
        const { error: cleanupError } = await supabase.storage
          .from("study-team-resources")
          .remove([uploadedPath]);
        if (cleanupError) {
          setErrorMessage(
            `Resource could not be saved: ${getErrorMessage(error)} File cleanup also failed: ${cleanupError.message}`,
          );
          setBusy(false);
          return;
        }
      }
      setErrorMessage(`Resource could not be shared: ${getErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const updateForm = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <div style={{ display: "grid", gap: 18, minWidth: 0 }}>
      <header style={{ ...panelStyle, background: "linear-gradient(125deg,#eff6ff,#f5f3ff 70%,#fff)" }}>
        <div style={{ color: "#4f46e5", fontSize: ".8rem", fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase" }}>
          Campus Ghana Community
        </div>
        <h1 style={{ margin: "8px 0", color: "#0f172a", fontSize: "clamp(1.5rem,4vw,2rem)" }}>
          Study teams
        </h1>
        <p style={{ margin: 0, color: "#475569", maxWidth: 780, lineHeight: 1.6 }}>
          Build a team around an education level, class, and subject. Invitees
          choose whether to accept or decline; accepted members can discuss and
          share study links and files.
        </p>
      </header>

      {errorMessage && (
        <div role="alert" style={{ ...panelStyle, color: "#991b1b", background: "#fef2f2", borderColor: "#fecaca" }}>
          {errorMessage}
        </div>
      )}
      {successMessage && (
        <div role="status" style={{ ...panelStyle, color: "#166534", background: "#f0fdf4", borderColor: "#bbf7d0" }}>
          {successMessage}
        </div>
      )}

      {pendingInvitations.length > 0 && (
        <section style={panelStyle}>
          <h2 style={{ margin: "0 0 12px", fontSize: "1.1rem" }}>
            Invitations for you ({pendingInvitations.length})
          </h2>
          <div style={{ display: "grid", gap: 10 }}>
            {pendingInvitations.map((membership) => (
              <div
                key={membership.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 14,
                  flexWrap: "wrap",
                  padding: 12,
                  border: "1px solid #e2e8f0",
                  borderRadius: 12,
                }}
              >
                <div>
                  <strong>{membership.team.name}</strong>
                  <div style={{ color: "#64748b", fontSize: ".88rem", marginTop: 4 }}>
                    {membership.team.education_level} · {membership.team.class_level} · {membership.team.subject}
                  </div>
                  <div style={{ color: "#64748b", fontSize: ".85rem" }}>
                    {membership.team.description}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className="btn btn-blue"
                    type="button"
                    disabled={busy}
                    onClick={() => respondToInvitation(membership.id, "accepted")}
                  >
                    Accept
                  </button>
                  <button
                    className="btn btn-outline"
                    type="button"
                    disabled={busy}
                    onClick={() => respondToInvitation(membership.id, "declined")}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section style={panelStyle}>
        <h2 style={{ margin: "0 0 14px", fontSize: "1.1rem" }}>
          Create a study team
        </h2>
        {!canCreateTeams ? (
          <p style={{ margin: 0, color: "#64748b" }}>
            This account role cannot create study teams.
          </p>
        ) : (
          <form onSubmit={createTeam} style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,220px),1fr))", gap: 12 }}>
              <label className="form-group">
                <span className="form-label">Team name</span>
                <input className="form-control" required minLength={3} maxLength={100} value={form.name} onChange={(event) => updateForm("name", event.target.value)} />
              </label>
              <label className="form-group">
                <span className="form-label">Education level</span>
                <select
                  className="form-control"
                  required
                  disabled={isStudent}
                  value={form.education_level}
                  onChange={(event) => updateForm("education_level", event.target.value)}
                >
                  <option value="">Choose level</option>
                  {EDUCATION_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
                </select>
              </label>
              <label className="form-group">
                <span className="form-label">Class / year</span>
                <input className="form-control" required minLength={1} maxLength={80} disabled={isStudent} value={form.class_level} onChange={(event) => updateForm("class_level", event.target.value)} placeholder="e.g. JHS 2 or SHS 1" />
              </label>
              <label className="form-group">
                <span className="form-label">Subject</span>
                <input className="form-control" required maxLength={100} value={form.subject} onChange={(event) => updateForm("subject", event.target.value)} placeholder="e.g. Mathematics" />
              </label>
            </div>
            <label className="form-group">
              <span className="form-label">Description</span>
              <textarea className="form-control" rows={2} maxLength={1000} value={form.description} onChange={(event) => updateForm("description", event.target.value)} />
            </label>
            <label className="form-group">
              <span className="form-label">Invite participants by account email</span>
              <textarea
                className="form-control"
                rows={2}
                value={inviteEmails}
                onChange={(event) => setInviteEmails(event.target.value)}
                placeholder="Separate email addresses with commas or spaces"
              />
              <span style={{ color: "#64748b", fontSize: ".82rem" }}>
                {isStudent
                  ? "Student-created teams are limited to students in your education level and class."
                  : "Admins and tutors can invite students, tutors, and admins. Invitees must have a Campus Ghana account."}
              </span>
            </label>
            <div>
              <button className="btn btn-blue" type="submit" disabled={busy || loading || (isStudent && !studentClass)}>
                {busy ? "Creating..." : "Create team and invite"}
              </button>
            </div>
          </form>
        )}
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,320px),1fr))", gap: 18, alignItems: "start" }}>
        <section style={panelStyle}>
          <h2 style={{ margin: "0 0 14px", fontSize: "1.1rem" }}>
            Your teams {activeMemberships.length > 0 && `(${activeMemberships.length})`}
          </h2>
          {loading ? (
            <p role="status">Loading your teams...</p>
          ) : activeMemberships.length === 0 ? (
            <p style={{ color: "#64748b", margin: 0 }}>
              You are not in a team yet. Create one or accept an invitation.
            </p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {activeMemberships.map((membership) => {
                const team = membership.team;
                const active = selectedTeamId === team.id;
                return (
                  <button
                    key={team.id}
                    type="button"
                    onClick={() => setSelectedTeamId(team.id)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      background: active ? "#eff6ff" : "#fff",
                      border: `1px solid ${active ? "#93c5fd" : "#e2e8f0"}`,
                      borderRadius: 12,
                      padding: 14,
                      cursor: "pointer",
                    }}
                  >
                    <strong style={{ color: "#0f172a" }}>{team.name}</strong>
                    <div style={{ color: "#64748b", fontSize: ".85rem", marginTop: 5 }}>
                      {team.education_level} · {team.class_level} · {team.subject}
                    </div>
                    {membership.role_key !== "student" && (
                      <span style={{ display: "inline-block", marginTop: 7, color: "#4f46e5", fontSize: ".75rem", fontWeight: 700 }}>
                        {membership.role_key.replaceAll("_", " ")}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section style={panelStyle}>
          {!selectedTeam ? (
            <div style={{ color: "#64748b" }}>
              Select a team to see its participants, discussion, and resources.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 18 }}>
              <div>
                <h2 style={{ margin: "0 0 5px", fontSize: "1.2rem" }}>{selectedTeam.name}</h2>
                <div style={{ color: "#64748b", fontSize: ".88rem" }}>
                  {selectedTeam.education_level} · {selectedTeam.class_level} · {selectedTeam.subject}
                </div>
                {selectedTeam.description && (
                  <p style={{ color: "#475569", margin: "8px 0 0" }}>{selectedTeam.description}</p>
                )}
              </div>

              <div>
                <h3 style={{ margin: "0 0 8px", fontSize: "1rem" }}>
                  Participants ({teamMembers.length})
                </h3>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                  {teamMembers.map((member) => (
                    <span key={member.id} style={{ background: "#f1f5f9", borderRadius: 999, padding: "5px 10px", color: "#334155", fontSize: ".84rem" }}>
                      {member.display_name} · {member.role_key.replaceAll("_", " ")}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <h3 style={{ margin: "0 0 8px", fontSize: "1rem" }}>Team discussion</h3>
                <div style={{ display: "grid", gap: 8, maxHeight: 280, overflowY: "auto", padding: 10, border: "1px solid #e2e8f0", borderRadius: 12, background: "#f8fafc" }}>
                  {messages.length === 0 ? (
                    <span style={{ color: "#64748b" }}>No messages yet. Start the discussion.</span>
                  ) : messages.map((message) => (
                    <article key={message.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 10, overflowWrap: "anywhere" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                        <strong style={{ fontSize: ".85rem" }}>{message.sender_name}</strong>
                        <time style={{ color: "#64748b", fontSize: ".75rem" }}>{new Date(message.created_at).toLocaleString()}</time>
                      </div>
                      <div style={{ whiteSpace: "pre-wrap" }}>{message.content}</div>
                    </article>
                  ))}
                </div>
                <form onSubmit={sendMessage} style={{ display: "flex", gap: 8, marginTop: 9 }}>
                  <input className="form-control" maxLength={4000} value={messageText} onChange={(event) => setMessageText(event.target.value)} placeholder="Write a team message..." />
                  <button className="btn btn-blue" type="submit" disabled={busy || !messageText.trim()}>Send</button>
                </form>
              </div>

              <div>
                <h3 style={{ margin: "0 0 8px", fontSize: "1rem" }}>Shared resources</h3>
                {resources.length === 0 ? (
                  <p style={{ color: "#64748b", margin: "0 0 10px" }}>No resources shared yet.</p>
                ) : (
                  <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                    {resources.map((resource) => (
                      <article key={resource.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 10 }}>
                        {resource.signed_url ? (
                          <a href={resource.signed_url} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>{resource.title}</a>
                        ) : (
                          <strong>{resource.title}</strong>
                        )}
                        {resource.description && <div style={{ color: "#475569", fontSize: ".88rem", marginTop: 4 }}>{resource.description}</div>}
                        <div style={{ color: "#64748b", fontSize: ".78rem", marginTop: 4 }}>
                          Shared by {resource.shared_by_name}
                          {resource.signing_error ? ` · Download unavailable: ${resource.signing_error}` : ""}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
                <form onSubmit={shareResource} style={{ display: "grid", gap: 8, padding: 12, background: "#f8fafc", borderRadius: 12 }}>
                  <strong style={{ fontSize: ".9rem" }}>Share a link or file</strong>
                  <input className="form-control" required maxLength={160} value={resourceTitle} onChange={(event) => setResourceTitle(event.target.value)} placeholder="Resource title" />
                  <input className="form-control" maxLength={1000} value={resourceDescription} onChange={(event) => setResourceDescription(event.target.value)} placeholder="Short description (optional)" />
                  <input className="form-control" type="url" value={resourceUrl} onChange={(event) => { setResourceUrl(event.target.value); if (event.target.value) setResourceFile(null); }} placeholder="https://... resource link" />
                  <label style={{ color: "#475569", fontSize: ".82rem" }}>Or upload a file (20 MB max)
                    <input
                      className="form-control"
                      style={{ marginTop: 5 }}
                      type="file"
                      accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.jpg,.jpeg,.png,.webp"
                      onChange={(event) => { setResourceFile(event.target.files?.[0] || null); if (event.target.files?.[0]) setResourceUrl(""); }}
                    />
                  </label>
                  <div>
                    <button className="btn btn-outline" type="submit" disabled={busy || (!resourceUrl.trim() && !resourceFile)}>
                      {busy ? "Sharing..." : "Share resource"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
