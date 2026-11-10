import { useState } from "react";
import { GHANA_REGIONS } from "../data/demoData.js";
import { Ico } from "./Ico.jsx";

export function SchoolRegistrationPage({ onBack, onRegisterSchool, setupError = "" }) {
  const [form, setForm] = useState({
    name: "",
    location: "",
    region: "Ashanti",
    category: "",
    type: "",
    active: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedSchool, setSavedSchool] = useState(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const set = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));

  const openReviewModal = () => {
    if (setupError) {
      setError(setupError);
      return;
    }
    if (!form.name.trim()) {
      setError("School name is required.");
      return;
    }
    if (!form.location.trim()) {
      setError("Location is required.");
      return;
    }

    setError("");
    setShowReviewModal(true);
  };

  const registerSchool = async () => {
    setSaving(true);
    setError("");

    try {
      const school = await onRegisterSchool({
        name: form.name.trim(),
        location: form.location.trim(),
        region: form.region,
        category: form.category,
        type: form.type,
        active: form.active,
      });
      setShowReviewModal(false);
      setSavedSchool(school);
    } catch (err) {
      setError(
        String(err?.message || "Unable to register the school right now."),
      );
    } finally {
      setSaving(false);
    }
  };

  if (savedSchool) {
    return (
      <div className="fade-in">
        <div className="school-reg-success">
          <div className="alert alert-success" style={{ marginBottom: 0 }}>
            School registered successfully!
          </div>
          <div className="enroll-success-title">
            {savedSchool.name} has been added
          </div>
          <div className="enroll-success-sub">
            The school has been added to the platform registry and is ready for
            admin setup and school management workflows.
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button className="btn btn-outline" onClick={onBack}>
              Back To Schools
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div className="school-reg-shell">
        <div className="school-reg-hero">
          <div className="school-reg-hero-copy">
            <div className="school-reg-kicker">School Directory</div>
            <div className="school-reg-title">Register a new school</div>
            <div className="school-reg-sub">
              Register a school on the platform so its admins can be created and
              the school can manage its operations in its own workspace.
            </div>
          </div>
          <div className="school-reg-chip">
            <Ico name="schools" size={14} color="#99f6e4" /> Platform onboarding
          </div>
        </div>

        <div className="school-reg-summary-grid">
          <div className="school-reg-summary-card">
            <div className="school-reg-summary-label">Onboarding Goal</div>
            <div className="school-reg-summary-value">Profile</div>
            <div className="school-reg-summary-sub">
              Capture the school identity and its operating region clearly
              before access is provisioned.
            </div>
          </div>
          <div className="school-reg-summary-card">
            <div className="school-reg-summary-label">Access Setup</div>
            <div className="school-reg-summary-value">Admin Ready</div>
            <div className="school-reg-summary-sub">
              The registered school can immediately receive school-admin
              accounts after registration.
            </div>
          </div>
          <div className="school-reg-summary-card">
            <div className="school-reg-summary-label">Visibility</div>
            <div className="school-reg-summary-value">Controlled</div>
            <div className="school-reg-summary-sub">
              Use the active toggle to decide whether the school is currently
              allowed into live platform operations.
            </div>
          </div>
        </div>

        <div className="school-reg-grid">
          <aside className="school-reg-side">
            <div className="school-reg-stat">
              <div className="school-reg-stat-label">Grade</div>
              <div className="school-reg-stat-value">
                {form.category || "-"}
              </div>
            </div>
            <div className="school-reg-stat">
              <div className="school-reg-stat-label">School Type</div>
              <div className="school-reg-stat-value">{form.type || "-"}</div>
            </div>
            <div className="school-reg-note">
              Add the official school name, location, grade, and school type
              carefully. These details feed directly into the registered-school
              directory and admin setup flow.
            </div>
          </aside>

          <div className="card school-reg-form-card">
            <div className="school-reg-head">
              <div>
                <div className="school-reg-head-title">
                  School registration form
                </div>
                <div className="school-reg-head-sub">
                  Capture the core school details needed to onboard the school
                  and assign platform access.
                </div>
              </div>
              <div className="enroll-form-status">Draft</div>
            </div>

            <div className="school-reg-section">
              <div className="school-reg-section-title">Identity</div>
              <div className="school-reg-section-sub">
                The core public-facing information for the school profile.
              </div>
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">School Name</label>
                  <input
                    className="form-control"
                    placeholder="Campus Ghana"
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Location</label>
                  <input
                    className="form-control"
                    placeholder="Obuasi"
                    value={form.location}
                    onChange={(e) => set("location", e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Region</label>
                  <select
                    className="form-control"
                    value={form.region}
                    onChange={(e) => set("region", e.target.value)}
                  >
                    {GHANA_REGIONS.map((region) => (
                      <option key={region}>{region}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">School Type</label>
                  <select
                    className="form-control"
                    value={form.type}
                    onChange={(e) => set("type", e.target.value)}
                  >
                    <option value="">Select school type</option>
                    <option>Mixed</option>
                    <option>Boys</option>
                    <option>Girls</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="school-reg-section">
              <div className="school-reg-section-title">
                School classification
              </div>
              <div className="school-reg-section-sub">
                These values define how the school is labeled and organized
                inside the registered-school directory.
              </div>
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Grade</label>
                  <select
                    className="form-control"
                    value={form.category}
                    onChange={(e) => set("category", e.target.value)}
                  >
                    <option value="">Select grade</option>
                    <option>A</option>
                    <option>B</option>
                    <option>C</option>
                  </select>
                </div>
              </div>
              <div className="school-reg-switch" style={{ marginTop: 14 }}>
                <div className="school-reg-switch-copy">
                  <div className="school-reg-switch-title">
                    Accept admissions
                  </div>
                  <div className="school-reg-switch-sub">
                    Inactive schools remain in the registry but can be held back
                    from active platform use.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => set("active", e.target.checked)}
                />
              </div>
            </div>

            {(setupError || error) && (
              <div className="alert alert-warning" style={{ margin: "0 22px" }}>
                {setupError || error}
              </div>
            )}

            <div className="school-reg-actions">
              <div className="school-reg-actions-note">
                Required fields are validated before save. Registered schools
                are kept in their own registry for super-admin management.
              </div>
              <div className="school-reg-actions-row">
                <button className="btn btn-outline" onClick={onBack}>
                  Cancel
                </button>
                <button
                  className="btn btn-blue"
                  onClick={openReviewModal}
                  disabled={saving || !!setupError}
                >
                  {saving ? "Saving..." : "Review Summary"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {showReviewModal && (
          <div
            className="modal-backdrop"
            onClick={() => !saving && setShowReviewModal(false)}
          >
            <div
              className="modal-card"
              style={{ maxWidth: 560 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-head">
                <div>
                  <div className="modal-title">Review school registration</div>
                  <div className="modal-sub">
                    Confirm the school details before creating the platform
                    registration.
                  </div>
                </div>
                <button
                  className="modal-close"
                  onClick={() => !saving && setShowReviewModal(false)}
                >
                  <Ico name="close" size={18} color="#1e3a8a" />
                </button>
              </div>

              <div className="metric-list">
                <div className="metric-row">
                  <span>School Name</span>
                  <strong>{form.name || "-"}</strong>
                </div>
                <div className="metric-row">
                  <span>Location</span>
                  <strong>{form.location || "-"}</strong>
                </div>
                <div className="metric-row">
                  <span>Region</span>
                  <strong>{form.region || "-"}</strong>
                </div>
                <div className="metric-row">
                  <span>School Type</span>
                  <strong>{form.type || "Not selected"}</strong>
                </div>
                <div className="metric-row">
                  <span>Grade</span>
                  <strong>{form.category || "Not selected"}</strong>
                </div>
                <div className="metric-row">
                  <span>Status</span>
                  <strong>{form.active ? "Active" : "Inactive"}</strong>
                </div>
              </div>

              <div className="modal-actions">
                <button
                  className="btn btn-outline"
                  onClick={() => setShowReviewModal(false)}
                  disabled={saving}
                >
                  Edit
                </button>
                <button
                  className="btn btn-blue"
                  onClick={registerSchool}
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Save School Registration"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
