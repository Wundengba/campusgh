import { useContext, useEffect, useState } from "react";
import {
  IoCallOutline,
  IoLocationOutline,
  IoMailOutline,
  IoSchoolOutline,
} from "react-icons/io5";
import { supabase } from "../lib/supabaseClient.js";
import { SettingsContext } from "../context/SettingsContext.js";
import { GHANA_DISTRICTS } from "../data/ghanaDistricts.js";
import { resizeStudentPhoto } from "../utils/studentPhoto.js";
import { StudentVerifiedBadge } from "./StudentVerifiedBadge.jsx";
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

const getSocialCooldownDate = (changedAt, days) => {
  if (!changedAt) return null;
  const date = new Date(changedAt);
  date.setDate(date.getDate() + days);
  return date > new Date() ? date : null;
};

const getSocialNameTags = (value) => [...new Set(
  String(value || "").split(",").map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean),
)];

function ProfileDetail({ label, value }) {
  if (value == null || String(value).trim() === "") return null;
  return (
    <div className="student-profile-detail">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ProfileContactItem({ icon: Icon, label, value, href }) {
  if (!value) return null;
  return (
    <div className="student-profile-contact-item">
      <span className="student-profile-contact-icon"><Icon size={18} /></span>
      <div>
        <span>{label}</span>
        <strong>{value || "Not added yet"}</strong>
      </div>
      {value && href && <a href={href} aria-label={`${label}: ${value}`}>{label === "Email" ? "Email" : "Call"}</a>}
    </div>
  );
}

export function StudentProfile({
  user,
  studentData,
  schoolLinkedStudent = true,
  onProfileUpdated,
  onOpenSocialMemberProfile,
}) {
  const { cfg } = useContext(SettingsContext);
  const [editingProfile, setEditingProfile] = useState(false);
  const [activeProfileSection, setActiveProfileSection] = useState("social");
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
  const [socialProfile, setSocialProfile] = useState(null);
  const [socialProfileCounts, setSocialProfileCounts] = useState(null);
  const [socialProfileCountsError, setSocialProfileCountsError] = useState("");
  const [socialConnectionView, setSocialConnectionView] = useState("");
  const [socialConnections, setSocialConnections] = useState([]);
  const [socialConnectionsLoading, setSocialConnectionsLoading] = useState(false);
  const [socialConnectionsError, setSocialConnectionsError] = useState("");
  const [socialProfileDraft, setSocialProfileDraft] = useState({
    display_name: "",
    username: "",
    name_tags: "",
    bio: "",
    discoverable: false,
  });
  const [loadingSocialProfile, setLoadingSocialProfile] = useState(true);
  const [savingSocialProfile, setSavingSocialProfile] = useState(false);
  const [socialProfileMessage, setSocialProfileMessage] = useState("");
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
  const aggregateValue = isLoadingProfile || student?.aggregate == null || String(student.aggregate).trim() === ""
    ? null
    : Number(student.aggregate);
  const studentStatus = String(student?.status || "").toLowerCase();
  const isSuspended = studentStatus === "suspended";
  const supportEmail = cfg.supportEmail || "support@campusghana.edu";
  const supportPhone = cfg.supportPhone || "+233 00 000 0000";
  const homeAddress = [
    student.home_address,
    student.home_town,
    student.place_of_residence,
    student.postal_town,
    student.po_box,
  ].filter(Boolean).join(", ");
  const locationDetails = [student.region, student.district].filter(Boolean).join(" · ");
  const profileDetails = [
    ["Education level", student.class],
    ["Gender", student.gender],
    ["Date of birth", student.date_of_birth],
  ];
  const profileCompletionFields = [
    student.full_name || user?.name,
    student.index || student.index_number,
    student.class,
    ...(schoolLinkedStudent ? [student.institution] : []),
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
  const handleProfileTabKeyDown = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = [...event.currentTarget.querySelectorAll('[role="tab"]')];
    const currentIndex = tabs.indexOf(event.target);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    tabs[nextIndex]?.click();
    tabs[nextIndex]?.focus();
  };
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
    if (!socialConnectionView) return undefined;
    let active = true;
    const loadConnections = async () => {
      if (!supabase) {
        setSocialConnectionsError("Your network is unavailable without a database connection.");
        return;
      }
      setSocialConnectionsLoading(true);
      setSocialConnectionsError("");
      const { data, error } = await supabase.rpc("get_campus_social_profile_connections", {
        p_direction: socialConnectionView,
      });
      if (!active) return;
      if (error) {
        setSocialConnections([]);
        setSocialConnectionsError(error.message || "Could not load this profile list.");
      } else {
        setSocialConnections(data || []);
      }
      setSocialConnectionsLoading(false);
    };
    loadConnections();
    return () => { active = false; };
  }, [socialConnectionView]);
  useEffect(() => {
    let active = true;
    const loadSocialProfile = async () => {
      if (!supabase) {
        if (active) {
          setSocialProfileMessage("Social profile settings require a Supabase connection.");
          setLoadingSocialProfile(false);
        }
        return;
      }
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const authUser = sessionData?.session?.user;
      if (sessionError || !authUser) {
        if (active) {
          setSocialProfileMessage(sessionError?.message || "Sign in to load your Social profile settings.");
          setLoadingSocialProfile(false);
        }
        return;
      }
      const [profileResult, countsResult] = await Promise.all([
        supabase.from("campus_social_profiles")
          .select("user_id, display_name, username, name_tags, display_name_changed_at, username_changed_at, bio, institution, education_level, avatar_url, discoverable")
          .eq("user_id", authUser.id)
          .maybeSingle(),
        supabase.rpc("get_campus_social_profile_counts"),
      ]);
      const { data, error } = profileResult;
      if (!active) return;
      if (error) {
        setSocialProfileMessage(error.message);
        setLoadingSocialProfile(false);
        return;
      }
      if (countsResult.error) {
        setSocialProfileCounts(null);
        setSocialProfileCountsError(countsResult.error.message);
      } else {
        setSocialProfileCounts(countsResult.data || null);
        setSocialProfileCountsError("");
      }
      const nextProfile = data || null;
      setSocialProfile(nextProfile);
      setSocialProfileDraft({
        display_name: nextProfile?.display_name || studentData?.display_name || studentData?.full_name || user?.name || "",
        username: nextProfile?.username || "",
        name_tags: (nextProfile?.name_tags || []).join(", "),
        bio: nextProfile?.bio || "",
        discoverable: nextProfile?.discoverable === true,
      });
      setLoadingSocialProfile(false);
    };
    loadSocialProfile();
    return () => { active = false; };
  }, [studentData, user?.name]);
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
  const saveSocialProfile = async (event) => {
    event.preventDefault();
    if (!supabase) {
      setSocialProfileMessage("Social profile settings require a Supabase connection.");
      return;
    }
    setSavingSocialProfile(true);
    setSocialProfileMessage("");
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const authUser = sessionData?.session?.user;
      if (!authUser) throw new Error("Sign in to update your Social profile.");
      const displayName = socialProfileDraft.display_name.trim().slice(0, 80);
      const username = socialProfileDraft.username.trim().replace(/^@/, "").toLowerCase() || null;
      const nameTags = getSocialNameTags(socialProfileDraft.name_tags);
      if (!displayName) throw new Error("Your display name cannot be empty.");
      if (nameTags.length > 3) throw new Error("Add up to three name tags, separated by commas.");

      const updates = {
        user_id: authUser.id,
        display_name: displayName,
        username,
        name_tags: nameTags,
        bio: socialProfileDraft.bio.trim().slice(0, 280),
        discoverable: socialProfileDraft.discoverable,
        institution: String(studentData?.institution || studentData?.school_name || "").slice(0, 160),
        education_level: String(studentData?.class || studentData?.class_name || "").slice(0, 80),
        avatar_url: studentData?.photo_url || null,
      };
      const { data, error } = await supabase.from("campus_social_profiles")
        .upsert(updates, { onConflict: "user_id" })
        .select("user_id, display_name, username, name_tags, display_name_changed_at, username_changed_at, bio, institution, education_level, avatar_url, discoverable")
        .single();
      if (error) throw error;
      setSocialProfile(data);
      setSocialProfileDraft({
        display_name: data.display_name || "",
        username: data.username || "",
        name_tags: (data.name_tags || []).join(", "),
        bio: data.bio || "",
        discoverable: data.discoverable === true,
      });
      setSocialProfileMessage("Social profile saved successfully.");
    } catch (error) {
      setSocialProfileMessage(`Social profile was not saved: ${error?.message || "Please try again."}`);
    } finally {
      setSavingSocialProfile(false);
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
          <span className="student-profile-eyebrow">CAMPUS GHANA PROFILE</span>
          <h1>My Social Profile</h1>
          <p>
            {cfg.systemName}
            {schoolLinkedStudent && (
              <span className="student-profile-header-term">
                {" "}- {cfg.currentTerm} - {cfg.academicYear}
              </span>
            )}
          </p>
        </div>
        {!isLoadingProfile && (
          <button
            className="student-profile-edit-button student-profile-header-edit-button"
            type="button"
            onClick={() => {
              setActiveProfileSection("account");
              setEditingProfile((current) => !current);
            }}
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
              <div className="student-profile-identity-body">
                <div className="student-profile-avatar">
                  {student.photo_url ? (
                    <img src={student.photo_url} alt={student.full_name || "Student"} />
                  ) : (
                    initials || "ST"
                  )}
                </div>
                <div className="student-profile-identity-copy">
                  <h2>
                    {socialProfile?.display_name || student.display_name || student.full_name || user?.name || "Student"}
                    {studentStatus === "confirmed" && !isSuspended && (
                      <StudentVerifiedBadge />
                    )}
                  </h2>
                  {socialProfile?.name_tags?.length > 0 && (
                    <div className="student-profile-social-tags">
                      {socialProfile.name_tags.map((tag) => (
                        <span className="student-profile-social-tag" key={tag}>{tag}</span>
                      ))}
                    </div>
                  )}
                  <p className="student-profile-social-handle">
                    <span>Student profile · Campus Ghana</span>
                  </p>
                  <div className="student-profile-social-counts" aria-label="Social profile statistics">
                    {[
                      ["Posts", socialProfileCounts?.posts, ""],
                      ["Followers", socialProfileCounts?.followers, "community"],
                      ["Following", socialProfileCounts?.following, "network"],
                    ].map(([label, count, direction]) => direction ? (
                      <button
                        key={label}
                        type="button"
                        aria-expanded={socialConnectionView === direction}
                        onClick={() => setSocialConnectionView((current) => current === direction ? "" : direction)}
                      >
                        <strong>{Number.isFinite(Number(count)) ? Number(count).toLocaleString() : "—"}</strong>
                        <small>{label}</small>
                      </button>
                    ) : (
                      <span key={label}>
                        <strong>{Number.isFinite(Number(count)) ? Number(count).toLocaleString() : "—"}</strong>
                        <small>{label}</small>
                      </span>
                    ))}
                  </div>
                  {socialConnectionView && (
                    <section className="student-profile-connections" aria-live="polite">
                      <h3>{socialConnectionView === "community" ? "Your community" : "Your network"}</h3>
                      {socialConnectionsLoading ? (
                        <p>Loading profiles...</p>
                      ) : socialConnectionsError ? (
                        <p role="alert">{socialConnectionsError}</p>
                      ) : socialConnections.length ? (
                        <div className="student-profile-connection-list">
                          {socialConnections.map((connection) => (
                            <button
                              className="student-profile-connection"
                              key={connection.user_id}
                              type="button"
                              onClick={() => onOpenSocialMemberProfile?.(connection)}
                            >
                              {connection.avatar_url
                                ? <img src={connection.avatar_url} alt="" />
                                : <span className="student-profile-connection-fallback" aria-hidden="true">
                                    {String(connection.display_name || "ST").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}
                                  </span>}
                              <span>{connection.display_name || "Campus student"}{connection.username && <small>@{connection.username}</small>}</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p>No discoverable profiles to display here yet.</p>
                      )}
                    </section>
                  )}
                  {socialProfileCountsError && (
                    <span className="student-profile-social-counts-error" role="status">
                      Social counts are unavailable.
                    </span>
                  )}
                </div>
                {schoolLinkedStudent && (
                  <div className="student-profile-session">
                    <span>ACADEMIC SESSION</span>
                    <strong>{cfg.currentTerm}</strong>
                    <small>{cfg.academicYear}</small>
                  </div>
                )}
              </div>
            </article>

          </section>

          <nav className="student-profile-tabs" role="tablist" aria-label="Profile sections" onKeyDown={handleProfileTabKeyDown}>
            {[
              ["social", "Social profile"],
              ["about", "About"],
              ["contact", "Contact"],
              ["account", "Account"],
            ].map(([section, label]) => (
              <button
                className={activeProfileSection === section ? "is-active" : ""}
                type="button"
                key={section}
                id={`student-profile-tab-${section}`}
                role="tab"
                aria-selected={activeProfileSection === section}
                aria-controls={`student-profile-panel-${section}`}
                tabIndex={activeProfileSection === section ? 0 : -1}
                onClick={() => {
                  setActiveProfileSection(section);
                  if (section !== "account") setEditingProfile(false);
                }}
              >
                {label}
              </button>
            ))}
          </nav>

          <header className="student-profile-section-heading">
            <div>
              <span className="student-profile-eyebrow">
                {activeProfileSection === "about" ? "STUDENT SNAPSHOT" : activeProfileSection === "contact" ? "STAY CONNECTED" : activeProfileSection === "social" ? "CAMPUS COMMUNITY" : "PREFERENCES & SECURITY"}
              </span>
              <h2>{activeProfileSection === "about" ? "About" : activeProfileSection === "contact" ? "Contact information" : activeProfileSection === "social" ? "Social profile" : "Account settings"}</h2>
              <p>{activeProfileSection === "about"
                ? "Your academic identity and student record at a glance."
                : activeProfileSection === "contact"
                  ? "Your contact details and the places you call home."
                  : activeProfileSection === "social"
                    ? "Manage the name, username, and interests other students see."
                    : "Manage your profile, sign-in security, and account access."}</p>
            </div>
          </header>

          {activeProfileSection === "about" && (
            <section className="student-profile-tab-panel" id="student-profile-panel-about" role="tabpanel" aria-labelledby="student-profile-tab-about">
          <section className="student-profile-metrics" aria-label="Student summary">
            {(student.index || student.index_number) && (
              <article className="student-profile-panel student-profile-metric">
                <span className="student-profile-metric-icon student-profile-icon-blue">ID</span>
                <div><span>STUDENT ID</span><strong>{student.index || student.index_number}</strong></div>
              </article>
            )}
            <article className="student-profile-panel student-profile-metric">
              <span className="student-profile-metric-icon student-profile-icon-violet">OK</span>
              <div>
                <span>VERIFICATION</span>
                <strong>{
                  isSuspended ? "Suspended" : studentStatus === "confirmed" ? "Confirmed" : "Pending review"
                }</strong>
              </div>
            </article>
            {schoolLinkedStudent && Number.isFinite(aggregateValue) && (
              <article className="student-profile-panel student-profile-metric">
                <span className="student-profile-metric-icon student-profile-icon-green">G</span>
                <div><span>AGGREGATE</span><strong>{aggregateValue}</strong></div>
              </article>
            )}
          </section>

          <section className="student-profile-content-grid">
            <article className="student-profile-panel student-profile-info-panel" id="student-profile-about">
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
          </section>
          )}

          {activeProfileSection === "contact" && (
            <section className="student-profile-tab-panel student-profile-contact-panel" id="student-profile-panel-contact" role="tabpanel" aria-labelledby="student-profile-tab-contact">
              <div className="student-profile-contact-grid">
                {(student.contact_email || student.personal_contact) && (
                  <article className="student-profile-panel student-profile-contact-card">
                    <div className="student-profile-panel-heading">
                      <div><span className="student-profile-eyebrow">REACH ME</span><h3>Contact details</h3></div>
                    </div>
                    <div className="student-profile-contact-list">
                      <ProfileContactItem
                        icon={IoMailOutline}
                        label="Email"
                        value={student.contact_email}
                        href={student.contact_email ? `mailto:${student.contact_email}` : ""}
                      />
                      <ProfileContactItem
                        icon={IoCallOutline}
                        label="Phone"
                        value={student.personal_contact}
                        href={student.personal_contact ? `tel:${String(student.personal_contact).replace(/[^\d+]/g, "")}` : ""}
                      />
                    </div>
                  </article>
                )}
                {((schoolLinkedStudent && student.institution) || locationDetails || homeAddress) && (
                  <article className="student-profile-panel student-profile-contact-card">
                    <div className="student-profile-panel-heading">
                      <div><span className="student-profile-eyebrow">{schoolLinkedStudent ? "CAMPUS & LOCATION" : "LOCATION"}</span><h3>Where I&apos;m based</h3></div>
                    </div>
                    <div className="student-profile-contact-list">
                      {schoolLinkedStudent && <ProfileContactItem icon={IoSchoolOutline} label="Institution" value={student.institution} />}
                      <ProfileContactItem icon={IoLocationOutline} label="Region &amp; district" value={locationDetails} />
                    </div>
                    {homeAddress && <div className="student-profile-address">
                      <span className="student-profile-eyebrow">HOME ADDRESS</span>
                      <strong>{homeAddress}</strong>
                    </div>}
                  </article>
                )}
              </div>
              <article className="student-profile-panel student-profile-support">
                <div>
                  <span className="student-profile-eyebrow">CAMPUS GHANA SUPPORT</span>
                  <h3>Need a hand?</h3>
                  <p>Our support team can help with your student account.</p>
                </div>
                <div className="student-profile-support-actions">
                  <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
                  <a href={`tel:${supportPhone.replace(/[^\d+]/g, "")}`}>{supportPhone}</a>
                </div>
              </article>
            </section>
          )}

          {activeProfileSection === "social" && (
            <section className="student-profile-tab-panel student-profile-social-panel" id="student-profile-panel-social" role="tabpanel" aria-labelledby="student-profile-tab-social">
              <article className="student-profile-panel student-profile-social-settings">
                <div className="student-profile-panel-heading">
                  <div>
                    <span className="student-profile-eyebrow">YOUR CAMPUS IDENTITY</span>
                    <h3>Social profile settings</h3>
                    <p>Your student photo and school details stay connected to your student profile.</p>
                  </div>
                </div>
                {loadingSocialProfile ? (
                  <p className="student-profile-social-message" role="status">Loading Social profile settings...</p>
                ) : (
                  <form className="student-profile-social-form" onSubmit={saveSocialProfile} onChange={() => setSocialProfileMessage("")}>
                    <label>
                      Social display name
                      <input
                        maxLength={80}
                        value={socialProfileDraft.display_name}
                        disabled={Boolean(getSocialCooldownDate(socialProfile?.display_name_changed_at, 90))}
                        onChange={(event) => setSocialProfileDraft((current) => ({ ...current, display_name: event.target.value }))}
                      />
                      <small>{getSocialCooldownDate(socialProfile?.display_name_changed_at, 90)
                        ? `You can change this again ${getSocialCooldownDate(socialProfile.display_name_changed_at, 90).toLocaleDateString()}.`
                        : "Shown on your Social posts and profile. Change your student-record name in Account settings."}</small>
                    </label>
                    <label>
                      Username
                      <div className="student-profile-social-username"><span>@</span><input maxLength={24} value={socialProfileDraft.username} disabled={Boolean(getSocialCooldownDate(socialProfile?.username_changed_at, 15))} onChange={(event) => setSocialProfileDraft((current) => ({ ...current, username: event.target.value.replace(/^@/, "") }))} placeholder="your_username" /></div>
                      <small>{getSocialCooldownDate(socialProfile?.username_changed_at, 15)
                        ? `You can change your username again ${getSocialCooldownDate(socialProfile.username_changed_at, 15).toLocaleDateString()}.`
                        : "Use 3-24 letters, numbers, or underscores. Username changes are limited to once every 15 days."}</small>
                    </label>
                    <label>
                      Name tags
                      <input maxLength={80} value={socialProfileDraft.name_tags} onChange={(event) => setSocialProfileDraft((current) => ({ ...current, name_tags: event.target.value }))} placeholder="e.g. Technology, Football, Music" />
                      <small>Add up to three interests. They appear below your display name on Social posts and your profile.</small>
                    </label>
                    <label>
                      About you
                      <textarea maxLength={280} value={socialProfileDraft.bio} onChange={(event) => setSocialProfileDraft((current) => ({ ...current, bio: event.target.value }))} placeholder="Share a little about yourself" />
                    </label>
                    <label className="student-profile-social-discoverable">
                      <input type="checkbox" checked={socialProfileDraft.discoverable} onChange={(event) => setSocialProfileDraft((current) => ({ ...current, discoverable: event.target.checked }))} />
                      Let students find and follow me
                    </label>
                    <button className="student-profile-edit-button" type="submit" disabled={savingSocialProfile}>
                      {savingSocialProfile ? "Saving Social profile..." : "Save Social profile"}
                    </button>
                    {socialProfileMessage && (
                      <div className={`student-profile-social-message${socialProfileMessage.includes("successfully") ? " is-success" : " is-error"}`} role={socialProfileMessage.includes("successfully") ? "status" : "alert"}>
                        {socialProfileMessage}
                      </div>
                    )}
                  </form>
                )}
              </article>
            </section>
          )}

          {activeProfileSection === "account" && (
            <section className="student-profile-tab-panel student-profile-account-panel" id="student-profile-panel-account" role="tabpanel" aria-labelledby="student-profile-tab-account">
              {!editingProfile && (
                <article className="student-profile-panel student-profile-account-overview">
                  <div className="student-profile-panel-heading">
                    <div>
                      <span className="student-profile-eyebrow">YOUR ACCOUNT</span>
                      <h3>Student account status</h3>
                    </div>
                  </div>
                  <div className="student-profile-account-summary">
                    <span className={`student-profile-account-status${studentStatus === "confirmed" && !isSuspended ? " is-confirmed" : isSuspended ? " is-suspended" : ""}`}>
                      <span aria-hidden="true" />
                      {isSuspended ? "Account suspended" : studentStatus === "confirmed" ? "Student verified" : "Verification pending"}
                    </span>
                    <p>Your student record and access are managed securely through Campus Ghana.</p>
                  </div>
                </article>
              )}

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
                  {schoolLinkedStudent && <label>Institution or school<input maxLength={180} value={profileDraft.institution || ""} onChange={(event) => setProfileDraft((current) => ({ ...current, institution: event.target.value }))} /></label>}
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

          <details className="student-profile-panel student-profile-security" id="student-profile-security">
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
          </section>
          )}
        </>
      )}
    </div>
  );
}
