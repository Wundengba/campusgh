import { useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { SettingsContext } from "../context/SettingsContext.js";
import { GHANA_DISTRICTS } from "../data/ghanaDistricts.js";
import { resizeStudentPhoto } from "../utils/studentPhoto.js";
import "./StudentProfilePage.css";

const getStudentEducationLevel = (student) => {
  const explicitLevel = String(
    student?.education_level || student?.educationLevel || student?.level || "",
  ).toLowerCase();
  const className = String(student?.class || student?.class_name || "").toLowerCase();
  const level = explicitLevel || className;
  if (/\bjhs\b|junior high/.test(level)) return "JHS";
  if (/\bshs\b|senior high/.test(level)) return "SHS";
  if (/university|tertiary|college/.test(level)) return "University";
  return "Other";
};

function StudentVerifiedBadge() {
  return (
    <svg
      className="student-verified-badge"
      viewBox="0 0 20 20"
      role="img"
      aria-label="Verified student"
      focusable="false"
    >
      <title>Verified student</title>
      <circle cx="10" cy="10" r="9" fill="#1877f2" />
      <path
        d="m5.8 10.1 2.7 2.6 5.8-5.7"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ProfileDetail({ label, value }) {
  const displayValue =
    value == null || String(value).trim() === "" ? "Not provided" : value;
  return (
    <div className="student-profile-detail">
      <span>{label}</span>
      <strong>{displayValue}</strong>
    </div>
  );
}

export function StudentProfile({ user, studentData, onProfileUpdated }) {
  const { cfg } = useContext(SettingsContext);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileDraft, setProfileDraft] = useState({});
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [profilePhotoFile, setProfilePhotoFile] = useState(null);
  const [profilePhotoPreview, setProfilePhotoPreview] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteAccountMessage, setDeleteAccountMessage] = useState("");
  const isLoadingProfile = !studentData;
  const student = studentData || {
    full_name: "Loading profile...",
    index: "--",
    class: "--",
    region: "--",
    aggregate: null,
    photo_url: "",
  };
  const initials = String(student?.full_name || user?.name || "ST")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const aggregateValue = isLoadingProfile
    ? null
    : Number(student?.aggregate ?? 0);
  const studentStatus = String(student?.status || "").toLowerCase();
  const isSuspended = studentStatus === "suspended";
  const supportEmail = cfg.supportEmail || "support@campusghana.edu";
  const supportPhone = cfg.supportPhone || "+233 00 000 0000";
  const profileDetails = [
    ["Education level", student.class],
    ["Institution", student.institution],
    ["Region", student.region],
    ["District", student.district],
    ["Gender", student.gender],
    ["Date of birth", student.date_of_birth],
  ];
  const profileCompletionFields = [
    student.full_name || user?.name,
    student.index || student.index_number,
    student.class,
    student.institution,
    student.region,
    student.district,
    student.gender,
    student.date_of_birth,
    student.contact_email,
    student.personal_contact,
  ];
  const profileCompletion = Math.round(
    (profileCompletionFields.filter((value) => String(value || "").trim()).length /
      profileCompletionFields.length) *
      100,
  );
  useEffect(() => {
    if (!studentData) return;
    setProfileDraft({
      display_name: studentData.display_name || "",
      class: getStudentEducationLevel(studentData) === "Other"
        ? ""
        : getStudentEducationLevel(studentData),
      institution: studentData.institution || "",
      region: studentData.region || "",
      district: studentData.district || "",
      contact_email: studentData.contact_email || "",
      personal_contact: studentData.personal_contact || "",
      home_address: studentData.home_address || "",
      home_town: studentData.home_town || "",
      place_of_residence: studentData.place_of_residence || "",
      postal_town: studentData.postal_town || "",
      po_box: studentData.po_box || "",
    });
  }, [studentData]);
  useEffect(() => {
    if (!profilePhotoFile) {
      setProfilePhotoPreview("");
      return undefined;
    }
    const previewUrl = URL.createObjectURL(profilePhotoFile);
    setProfilePhotoPreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [profilePhotoFile]);
  const profileDistricts =
    GHANA_DISTRICTS.find((item) => item.name === profileDraft.region)?.districts || [];
  const handleProfilePhotoChange = (event) => {
    const file = event.target.files?.[0] || null;
    if (file && !file.type.startsWith("image/")) {
      setProfilePhotoFile(null);
      setProfileMessage("Choose an image file for your profile photo.");
      event.target.value = "";
      return;
    }
    if (file && file.size > 10 * 1024 * 1024) {
      setProfilePhotoFile(null);
      setProfileMessage("Choose a photo smaller than 10 MB.");
      event.target.value = "";
      return;
    }
    setProfilePhotoFile(file);
    setProfileMessage("");
  };
  const saveEditableProfile = async (event) => {
    event.preventDefault();
    if (!supabase || !studentData?.id) {
      setProfileMessage("Your profile could not be saved because your student account is not linked.");
      return;
    }
    setSavingProfile(true);
    setProfileMessage("");
    let uploadedPhotoPath = "";
    try {
      const changes = { ...profileDraft };
      const studentIndex = String(studentData.index_number || studentData.index || "").trim();
      if (profilePhotoFile) {
        if (!studentIndex) throw new Error("Your Student ID is missing, so the profile photo cannot be saved.");
        const photoBlob = await resizeStudentPhoto(profilePhotoFile);
        uploadedPhotoPath = `${studentIndex}/profile-${Date.now()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from("student-photos")
          .upload(uploadedPhotoPath, photoBlob, {
            contentType: "image/jpeg",
            upsert: false,
          });
        if (uploadError) throw uploadError;
        const { data: photoUrlData } = supabase.storage
          .from("student-photos")
          .getPublicUrl(uploadedPhotoPath);
        changes.photo_url = photoUrlData.publicUrl;
      }

      const { data, error } = await supabase.rpc(
        "update_student_self_service_profile",
        { p_changes: changes },
      );
      if (error) {
        if (uploadedPhotoPath) {
          const { error: cleanupError } = await supabase.storage
            .from("student-photos")
            .remove([uploadedPhotoPath]);
          if (cleanupError) {
            throw new Error(`${error.message}. The new photo could not be cleaned up: ${cleanupError.message}`);
          }
        }
        throw error;
      }
      if (!data || typeof data !== "object") {
        throw new Error("Profile update returned no saved student record. Please refresh and try again.");
      }
      const oldPhotoPath = (() => {
        if (!uploadedPhotoPath || !studentData.photo_url) return "";
        try {
          const path = decodeURIComponent(new URL(studentData.photo_url).pathname)
            .split("/student-photos/")[1] || "";
          return path.startsWith(`${studentIndex}/`) ? path : "";
        } catch {
          return "";
        }
      })();
      onProfileUpdated?.(data);
      setProfilePhotoFile(null);
      setEditingProfile(false);
      if (oldPhotoPath && oldPhotoPath !== uploadedPhotoPath) {
        const { error: cleanupError } = await supabase.storage
          .from("student-photos")
          .remove([oldPhotoPath]);
        setProfileMessage(cleanupError
          ? `Profile saved, but the previous photo could not be removed: ${cleanupError.message}`
          : "Your profile details were saved.");
      } else {
        setProfileMessage("Your profile details were saved.");
      }
    } catch (error) {
      setProfileMessage(`Profile was not saved: ${error?.message || "Unknown error."}`);
    } finally {
      setSavingProfile(false);
    }
  };
  const changePassword = async () => {
    if (newPassword.length < 10) {
      setPasswordMessage("Choose a password with at least 10 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage("The passwords do not match.");
      return;
    }
    if (!supabase) {
      setPasswordMessage("Supabase is not configured; the password was not changed.");
      return;
    }
    setSavingPassword(true);
    setPasswordMessage("");
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
      data: { campus_student_password_changed: true },
    });
    if (error) {
      setPasswordMessage(`Password was not changed: ${error.message}`);
    } else {
      setPasswordMessage("Password changed successfully.");
      setNewPassword("");
      setConfirmPassword("");
    }
    setSavingPassword(false);
  };

  const deleteStudentAccount = async () => {
    if (!supabase || !studentData?.id) {
      setDeleteAccountMessage("Your student account could not be deleted because it is not linked.");
      return;
    }
    const confirmed = window.confirm(
      "Delete your student account? This removes your profile and signs you out immediately.",
    );
    if (!confirmed) return;

    setDeletingAccount(true);
    setDeleteAccountMessage("");
    try {
      const { data, error } = await supabase.functions.invoke("delete-student-account", {
        body: { self_delete: true },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      await supabase.auth.signOut();
      window.location.href = "/";
    } catch (error) {
      setDeleteAccountMessage(
        "We could not delete your account right now. Please try again later or contact support.",
      );
    } finally {
      setDeletingAccount(false);
    }
  };

  return (
    <div className="student-profile-page">
      <header className="student-profile-page-header">
        <div>
          <span className="student-profile-eyebrow">STUDENT WORKSPACE</span>
          <h1>My Profile</h1>
          <p>{cfg.systemName} - {cfg.currentTerm} - {cfg.academicYear}</p>
        </div>
        {!isLoadingProfile && (
          <button
            className="student-profile-edit-button"
            type="button"
            onClick={() => setEditingProfile((current) => !current)}
          >
            {editingProfile ? "Close editor" : "Edit profile"}
          </button>
        )}
      </header>

      {isLoadingProfile ? (
        <div className="student-profile-loading" role="status">Loading your profile data...</div>
      ) : (
        <>
          <section className="student-profile-overview">
            <article className="student-profile-panel student-profile-identity">
              <div className="student-profile-avatar">
                {student.photo_url ? (
                  <img src={student.photo_url} alt={student.full_name || "Student"} />
                ) : (
                  initials || "ST"
                )}
              </div>
              <div className="student-profile-identity-copy">
                <span className="student-profile-eyebrow">YOUR ACCOUNT</span>
                <h2>
                  {student.full_name || user?.name || "Student"}
                  {studentStatus === "confirmed" && !isSuspended && (
                    <StudentVerifiedBadge />
                  )}
                </h2>
                <p>{student.index || student.index_number || "Student ID unavailable"}</p>
                <div className="student-profile-tags">
                  <span>{student.class || "Education level not set"}</span>
                  <span>{student.institution || "Institution not set"}</span>
                </div>
              </div>
              <div className="student-profile-session">
                <span>ACADEMIC SESSION</span>
                <strong>{cfg.currentTerm}</strong>
                <small>{cfg.academicYear}</small>
              </div>
            </article>

            <article className="student-profile-panel student-profile-completion">
              <div className="student-profile-panel-heading">
                <div>
                  <span className="student-profile-eyebrow">PROFILE HEALTH</span>
                  <h3>Profile completeness</h3>
                </div>
                <span className="student-profile-completion-value">{profileCompletion}%</span>
              </div>
              <div
                className="student-profile-progress"
                role="progressbar"
                aria-label="Profile completeness"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={profileCompletion}
              >
                <span style={{ width: `${profileCompletion}%` }} />
              </div>
              <p>Complete your contact and academic details to keep your student record up to date.</p>
            </article>
          </section>

          <section className="student-profile-metrics" aria-label="Student summary">
            <article className="student-profile-panel student-profile-metric">
              <span className="student-profile-metric-icon student-profile-icon-blue">ID</span>
              <div><span>STUDENT ID</span><strong>{student.index || student.index_number || " "}</strong></div>
            </article>
            <article className="student-profile-panel student-profile-metric">
              <span className="student-profile-metric-icon student-profile-icon-violet">OK</span>
              <div>
                <span>VERIFICATION</span>
                <strong>{
                  isSuspended ? "Suspended" : studentStatus === "confirmed" ? "Confirmed" : "Pending review"
                }</strong>
              </div>
            </article>
            <article className="student-profile-panel student-profile-metric">
              <span className="student-profile-metric-icon student-profile-icon-green">G</span>
              <div><span>REGION</span><strong>{student.region || "Not provided"}</strong></div>
            </article>
          </section>

          <section className="student-profile-content-grid">
            <article className="student-profile-panel student-profile-info-panel">
              <div className="student-profile-panel-heading">
                <div>
                  <span className="student-profile-eyebrow">STUDENT RECORD</span>
                  <h3>Personal &amp; academic details</h3>
                </div>
                {isSuspended ? (
                  <span className="student-profile-status student-profile-status-suspended">Suspended</span>
                ) : String(student.status || "").toLowerCase() === "confirmed" ? (
                  <span className="student-profile-status is-confirmed">Confirmed</span>
                ) : (
                  <span className="student-profile-status">Pending verification</span>
                )}
              </div>
              <div className="student-profile-details-grid">
                <ProfileDetail label="Full name" value={student.full_name || user?.name} />
                <ProfileDetail label="Display name" value={student.display_name} />
                {profileDetails.map(([label, value]) => (
                  <ProfileDetail key={label} label={label} value={value} />
                ))}
                <ProfileDetail
                  label="Aggregate"
                  value={Number.isFinite(aggregateValue) ? aggregateValue : ""}
                />
              </div>
            </article>

            <div className="student-profile-side-panels">
              <article className="student-profile-panel">
                <div className="student-profile-panel-heading">
                  <div><span className="student-profile-eyebrow">CONTACT</span><h3>Contact details</h3></div>
                </div>
                <div className="student-profile-details-list">
                  <ProfileDetail label="Email address" value={student.contact_email} />
                  <ProfileDetail label="Phone number" value={student.personal_contact} />
                </div>
              </article>
              <article className="student-profile-panel">
                <div className="student-profile-panel-heading">
                  <div><span className="student-profile-eyebrow">LOCATION</span><h3>Address &amp; residence</h3></div>
                </div>
                <div className="student-profile-details-list">
                  <ProfileDetail label="Home address" value={student.home_address} />
                  <ProfileDetail label="Home town" value={student.home_town} />
                  <ProfileDetail label="Place of residence" value={student.place_of_residence} />
                  <ProfileDetail label="Postal town" value={student.postal_town} />
                  <ProfileDetail label="P.O. Box" value={student.po_box} />
                </div>
              </article>
              <article className="student-profile-panel student-profile-support">
                <span className="student-profile-eyebrow">NEED HELP?</span>
                <h3>We&apos;re here to support you</h3>
                <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
                <a href={`tel:${supportPhone.replace(/[^\d+]/g, "")}`}>{supportPhone}</a>
              </article>
            </div>
          </section>

          {editingProfile && (
            <section className="student-profile-panel student-profile-editor">
              <div className="student-profile-panel-heading">
                <div>
                  <span className="student-profile-eyebrow">PROFILE SETTINGS</span>
                  <h3>Edit your profile</h3>
                  <p>Your name, gender, date of birth, and Student ID can only be changed by an administrator.</p>
                </div>
              </div>
              <div className="student-profile-locked-details">
                {[
                  ["Full name", student.full_name || user?.name || " "],
                  ["Gender", student.gender || " "],
                  ["Date of birth", student.date_of_birth || " "],
                  ["Student ID", student.index || " "],
                ].map(([label, value]) => (
                  <div key={label}><span>{label}</span><strong>{value}</strong></div>
                ))}
              </div>
              <form onSubmit={saveEditableProfile}>
                <div className="student-profile-photo-control">
                  <label htmlFor="student-profile-photo">Profile photo</label>
                  <div>
                    {profilePhotoPreview || student.photo_url ? (
                      <img src={profilePhotoPreview || student.photo_url} alt="Profile preview" />
                    ) : (
                      <span className="student-profile-photo-placeholder">{initials}</span>
                    )}
                    <input id="student-profile-photo" type="file" accept="image/*" onChange={handleProfilePhotoChange} />
                    <small>Images are resized before upload.</small>
                  </div>
                </div>
                <div className="student-profile-form-grid">
                  <label>Display name<input maxLength={32} value={profileDraft.display_name || ""} onChange={(event) => setProfileDraft((current) => ({ ...current, display_name: event.target.value }))} /></label>
                  <label>Education level<select value={profileDraft.class || ""} onChange={(event) => setProfileDraft((current) => ({ ...current, class: event.target.value }))} required><option value="">Select education level</option>{["JHS", "SHS", "University"].map((level) => <option key={level} value={level}>{level}</option>)}</select></label>
                  <label>Institution or school<input maxLength={180} value={profileDraft.institution || ""} onChange={(event) => setProfileDraft((current) => ({ ...current, institution: event.target.value }))} /></label>
                  <label>Region<select value={profileDraft.region || ""} onChange={(event) => setProfileDraft((current) => ({ ...current, region: event.target.value, district: "" }))}><option value="">Select region</option>{GHANA_DISTRICTS.map((region) => <option key={region.name} value={region.name}>{region.name}</option>)}</select></label>
                  <label>District<select value={profileDraft.district || ""} disabled={!profileDraft.region} onChange={(event) => setProfileDraft((current) => ({ ...current, district: event.target.value }))}><option value="">Select district</option>{profileDraft.district && !profileDistricts.includes(profileDraft.district) && <option value={profileDraft.district}>{profileDraft.district}</option>}{[...profileDistricts].sort((a, b) => a.localeCompare(b)).map((district) => <option key={district} value={district}>{district}</option>)}</select></label>
                  <label>Signup email address<input type="email" autoComplete="email" maxLength={254} value={profileDraft.contact_email || ""} onChange={(event) => setProfileDraft((current) => ({ ...current, contact_email: event.target.value }))} /></label>
                  <label>Signup phone number<input type="tel" autoComplete="tel" maxLength={20} value={profileDraft.personal_contact || ""} onChange={(event) => setProfileDraft((current) => ({ ...current, personal_contact: event.target.value }))} /></label>
                  {[
                    ["home_address", "Home address"],
                    ["home_town", "Home town"],
                    ["place_of_residence", "Place of residence"],
                    ["postal_town", "Postal town"],
                    ["po_box", "P.O. Box"],
                  ].map(([key, label]) => (
                    <label key={key}>{label}<input value={profileDraft[key] || ""} onChange={(event) => setProfileDraft((current) => ({ ...current, [key]: event.target.value }))} /></label>
                  ))}
                </div>
                <p className="student-profile-editor-note">Your signup email is for contact and does not change your Student ID sign-in.</p>
                <div className="student-profile-editor-actions">
                  <button className="student-profile-secondary-button" type="button" onClick={() => setEditingProfile(false)}>Cancel</button>
                  <button className="student-profile-edit-button" type="submit" disabled={savingProfile}>{savingProfile ? "Saving profile..." : "Save profile"}</button>
                </div>
                {profileMessage && <div className="student-profile-message" role="status">{profileMessage}</div>}
              </form>
            </section>
          )}

          <details className="student-profile-panel student-profile-security">
            <summary><span><span className="student-profile-eyebrow">ACCOUNT SECURITY</span><strong>Change password</strong></span><span className="student-profile-security-hint">Keep your account secure</span></summary>
            <p>Use a password with at least 10 characters. Your password is private and should not be shared.</p>
            <div className="student-profile-form-grid">
              <label>New password<input type="password" autoComplete="new-password" minLength={10} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
              <label>Confirm new password<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
            </div>
            <button className="student-profile-edit-button" type="button" onClick={changePassword} disabled={savingPassword || !newPassword || !confirmPassword}>{savingPassword ? "Changing password..." : "Update password"}</button>
            {passwordMessage && <div className="student-profile-message" role="status">{passwordMessage}</div>}

            <div className="student-profile-danger-zone">
              <div>
                <span className="student-profile-eyebrow">DANGEROUS ACTION</span>
                <h3>Delete my account</h3>
              </div>
              <p>This permanently removes your student profile and signs you out from Campus Ghana.</p>
              <button className="student-profile-delete-button" type="button" onClick={deleteStudentAccount} disabled={deletingAccount}>
                {deletingAccount ? "Deleting account..." : "Delete my account"}
              </button>
            </div>
            {deleteAccountMessage && <div className="student-profile-message student-profile-message-danger" role="status">{deleteAccountMessage}</div>}
          </details>
        </>
      )}
    </div>
  );
}
