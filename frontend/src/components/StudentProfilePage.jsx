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
import {
  buildStudentCoursePortfolio,
  calculateProfileGoalProgress,
  DEFAULT_STUDENT_PROFILE_PORTFOLIO,
  getStudentProfileCompletenessItems,
  normalizeStudentProfileProjects,
  normalizeStudentProfileSkills,
} from "../utils/studentProfilePortfolio.js";
import { buildVerificationCallbackMessage } from "../utils/verificationPayments.js";
import { resizeStudentPhoto } from "../utils/studentPhoto.js";
import { StudentVerifiedBadge } from "./StudentVerifiedBadge.jsx";
import "./VerificationApplications.css";
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

const getVerificationLoadMessage = (error) => {
  const message = String(error?.message || "");
  if (
    error?.code === "PGRST205" ||
    (/student_verification_(payment_settings|applications)/i.test(message) &&
      /schema cache|could not find the table/i.test(message))
  ) {
    return "Verification applications are not available yet. Please check back soon.";
  }
  return "Verification details are temporarily unavailable. Please try again later.";
};

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
  const [profilePortfolioDraft, setProfilePortfolioDraft] = useState({
    ...DEFAULT_STUDENT_PROFILE_PORTFOLIO,
    goal_target: "",
    skills_input: "",
  });
  const [profilePortfolioLoading, setProfilePortfolioLoading] = useState(true);
  const [profilePortfolioSaving, setProfilePortfolioSaving] = useState(false);
  const [profilePortfolioError, setProfilePortfolioError] = useState("");
  const [profilePortfolioMessage, setProfilePortfolioMessage] = useState("");
  const [profileProjectDraft, setProfileProjectDraft] = useState({
    title: "",
    description: "",
    url: "",
  });
  const [coursePortfolio, setCoursePortfolio] = useState({
    courses: [],
    certificates: [],
    completedCourses: 0,
    completedChapters: 0,
    totalChapters: 0,
    cgpa: null,
  });
  const [coursePortfolioLoading, setCoursePortfolioLoading] = useState(true);
  const [coursePortfolioError, setCoursePortfolioError] = useState("");
  const [verificationSettings, setVerificationSettings] = useState(null);
  const [verificationApplication, setVerificationApplication] = useState(null);
  const [verificationLoading, setVerificationLoading] = useState(true);
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [verificationError, setVerificationError] = useState("");
  const [verificationMessage, setVerificationMessage] = useState("");
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
  const profileCompletionItems = getStudentProfileCompletenessItems(
    student,
    schoolLinkedStudent,
    user?.name,
  );
  const incompleteProfileItems = profileCompletionItems.filter((item) => !item.complete);
  const profileCompletion = Math.round(
    (profileCompletionItems.filter((item) => item.complete).length / profileCompletionItems.length) * 100,
  );
  const profileGoalProgress = calculateProfileGoalProgress(profilePortfolioDraft, coursePortfolio);
  const previewSkills = String(profilePortfolioDraft.skills_input || "")
    .split(",")
    .map((skill) => skill.trim())
    .filter(Boolean)
    .slice(0, 8);
  const previewNameTags = getSocialNameTags(socialProfileDraft.name_tags);
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
          .select("user_id, display_name, username, name_tags, display_name_changed_at, username_changed_at, bio, avatar_url, discoverable")
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
    if (!studentData?.id) return undefined;
    let active = true;
    const loadPortfolio = async () => {
      if (!supabase) {
        setProfilePortfolioError("Profile portfolio settings require a Supabase connection.");
        setProfilePortfolioLoading(false);
        return;
      }
      setProfilePortfolioLoading(true);
      setProfilePortfolioError("");
      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        const authUser = sessionData?.session?.user;
        if (!authUser) throw new Error("Sign in to load your profile portfolio.");
        const { data, error } = await supabase.from("student_profile_portfolios")
          .select("*")
          .eq("user_id", authUser.id)
          .maybeSingle();
        if (error) throw error;
        if (!active) return;
        setProfilePortfolioDraft({
          ...DEFAULT_STUDENT_PROFILE_PORTFOLIO,
          ...(data || {}),
          goal_target: data?.goal_target ?? "",
          goal_due_date: data?.goal_due_date || "",
          skills_input: (data?.skills || []).join(", "),
          projects: Array.isArray(data?.projects) ? data.projects : [],
        });
      } catch (error) {
        if (active) {
          setProfilePortfolioError(`Profile portfolio could not be loaded: ${error?.message || "Please try again."}`);
        }
      } finally {
        if (active) setProfilePortfolioLoading(false);
      }
    };
    loadPortfolio();
    return () => { active = false; };
  }, [studentData?.id]);
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("verification");
    if (!result) return;
    setVerificationMessage(buildVerificationCallbackMessage(
      result,
      url.searchParams.get("verification_reason"),
      url.searchParams.get("verification_reference"),
    ));
    ["verification", "verification_reason", "verification_reference"].forEach((key) =>
      url.searchParams.delete(key)
    );
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);
  useEffect(() => {
    if (!studentData?.id) return undefined;
    let active = true;
    const loadVerificationStatus = async () => {
      if (["confirmed", "suspended"].includes(String(studentData.status || "").toLowerCase())) {
        setVerificationSettings(null);
        setVerificationApplication(null);
        setVerificationError("");
        setVerificationLoading(false);
        return;
      }
      if (!supabase) {
        setVerificationError("Verification applications are not available right now.");
        setVerificationLoading(false);
        return;
      }
      setVerificationLoading(true);
      setVerificationError("");
      const [settingsResult, applicationResult] = await Promise.all([
        supabase.from("student_verification_payment_settings")
          .select("fee_pesewas, currency")
          .eq("id", 1)
          .maybeSingle(),
        supabase.from("student_verification_applications")
          .select("id, status, payment_reference, amount_pesewas, currency, paid_at, reviewed_at, review_note, refund_status, refund_note, created_at")
          .eq("student_id", studentData.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (!active) return;
      if (settingsResult.error || applicationResult.error) {
        setVerificationError(getVerificationLoadMessage(settingsResult.error || applicationResult.error));
      } else {
        setVerificationSettings(settingsResult.data || null);
        setVerificationApplication(applicationResult.data || null);
        if (applicationResult.data?.status === "approved") {
          onProfileUpdated?.({ status: "confirmed" });
        }
      }
      setVerificationLoading(false);
    };
    void loadVerificationStatus();
    return () => { active = false; };
  }, [studentData?.id]);
  useEffect(() => {
    if (!studentData?.id) return undefined;
    let active = true;
    const loadCoursePortfolio = async () => {
      if (!supabase) {
        setCoursePortfolioError("Course achievements require a Supabase connection.");
        setCoursePortfolioLoading(false);
        return;
      }
      setCoursePortfolioLoading(true);
      setCoursePortfolioError("");
      try {
        const { data: enrollmentRows, error: enrollmentError } = await supabase
          .from("course_enrollments")
          .select("id, course_id")
          .eq("student_id", studentData.id);
        if (enrollmentError) throw enrollmentError;
        const enrollments = enrollmentRows || [];
        if (!enrollments.length) {
          if (active) {
            setCoursePortfolio(buildStudentCoursePortfolio());
            setCoursePortfolioLoading(false);
          }
          return;
        }
        const enrollmentIds = enrollments.map((enrollment) => enrollment.id);
        const courseIds = [...new Set(enrollments.map((enrollment) => enrollment.course_id))];
        const [coursesResponse, progressResponse, certificatesResponse, attemptsResponse] = await Promise.all([
          supabase.from("courses").select("id, title, lessons").in("id", courseIds),
          supabase.from("course_lesson_progress")
            .select("enrollment_id, lesson_id")
            .in("enrollment_id", enrollmentIds)
            .eq("quiz_passed", true),
          supabase.from("course_certificates")
            .select("id, enrollment_id, course_title, issued_at")
            .in("enrollment_id", enrollmentIds),
          supabase.from("course_quiz_attempts")
            .select("id, course_id, lesson_id, percentage, created_at, attempt_type, resit_of_attempt_id, correct_count, total_questions")
            .in("course_id", courseIds),
        ]);
        const failedResponse = [coursesResponse, progressResponse, certificatesResponse, attemptsResponse]
          .find((response) => response.error);
        if (failedResponse) throw failedResponse.error;
        if (active) {
          setCoursePortfolio(buildStudentCoursePortfolio({
            enrollments,
            courses: coursesResponse.data || [],
            completedProgress: progressResponse.data || [],
            certificates: certificatesResponse.data || [],
            quizAttempts: attemptsResponse.data || [],
          }));
        }
      } catch (error) {
        if (active) {
          setCoursePortfolioError(`Course achievements could not be loaded: ${error?.message || "Please try again."}`);
        }
      } finally {
        if (active) setCoursePortfolioLoading(false);
      }
    };
    loadCoursePortfolio();
    return () => { active = false; };
  }, [studentData?.id]);
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
        .select("user_id, display_name, username, name_tags, display_name_changed_at, username_changed_at, bio, avatar_url, discoverable")
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
  const openProfileEditor = () => {
    setActiveProfileSection("account");
    setEditingProfile(true);
  };
  const addProfileProject = () => {
    setProfilePortfolioMessage("");
    try {
      const projects = normalizeStudentProfileProjects([
        ...(profilePortfolioDraft.projects || []),
        profileProjectDraft,
      ]);
      setProfilePortfolioDraft((current) => ({ ...current, projects }));
      setProfileProjectDraft({ title: "", description: "", url: "" });
    } catch (error) {
      setProfilePortfolioMessage(error.message);
    }
  };
  const saveProfilePortfolio = async (event) => {
    event.preventDefault();
    if (!supabase) {
      setProfilePortfolioMessage("Profile portfolio settings require a Supabase connection.");
      return;
    }
    setProfilePortfolioSaving(true);
    setProfilePortfolioMessage("");
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const authUser = sessionData?.session?.user;
      if (!authUser) throw new Error("Sign in to save your profile portfolio.");
      const goalTitle = String(profilePortfolioDraft.goal_title || "").trim();
      const goalTargetValue = String(profilePortfolioDraft.goal_target ?? "").trim();
      let goalTarget = null;
      if (goalTitle) {
        goalTarget = Number(goalTargetValue);
        const validTarget = Number.isFinite(goalTarget)
          && (profilePortfolioDraft.goal_type === "cgpa"
            ? goalTarget >= 0.01 && goalTarget <= 4
            : Number.isInteger(goalTarget) && goalTarget >= 1 && goalTarget <= 1000);
        if (!validTarget) {
          throw new Error(profilePortfolioDraft.goal_type === "cgpa"
            ? "Enter a CGPA target from 0.01 to 4.00."
            : "Enter a whole-number target from 1 to 1,000.");
        }
      } else if (goalTargetValue) {
        throw new Error("Add a goal title or clear the target value.");
      }
      if (profilePortfolioDraft.share_goal && !goalTitle) {
        throw new Error("Add an academic goal before sharing it.");
      }
      const skills = normalizeStudentProfileSkills(profilePortfolioDraft.skills_input);
      const projects = normalizeStudentProfileProjects(profilePortfolioDraft.projects || []);
      const sharingSectionsEnabled = profilePortfolioDraft.share_goal
        || profilePortfolioDraft.share_skills
        || profilePortfolioDraft.share_projects
        || profilePortfolioDraft.share_achievements
        || profilePortfolioDraft.share_institution
        || profilePortfolioDraft.share_education_level;
      if (profilePortfolioDraft.share_public && !socialProfileDraft.discoverable) {
        throw new Error("Make your Social profile discoverable before publishing portfolio sections.");
      }
      if (profilePortfolioDraft.share_public && !sharingSectionsEnabled) {
        throw new Error("Select at least one portfolio section to share.");
      }
      const updates = {
        user_id: authUser.id,
        goal_title: goalTitle,
        goal_type: profilePortfolioDraft.goal_type,
        goal_target: goalTarget,
        goal_due_date: goalTitle ? profilePortfolioDraft.goal_due_date || null : null,
        skills,
        projects,
        share_goal: profilePortfolioDraft.share_goal,
        share_skills: profilePortfolioDraft.share_skills,
        share_projects: profilePortfolioDraft.share_projects,
        share_achievements: profilePortfolioDraft.share_achievements,
        share_institution: profilePortfolioDraft.share_institution,
        share_education_level: profilePortfolioDraft.share_education_level,
        share_public: profilePortfolioDraft.share_public,
      };
      const { data, error } = await supabase.from("student_profile_portfolios")
        .upsert(updates, { onConflict: "user_id" })
        .select("*")
        .single();
      if (error) throw error;
      setProfilePortfolioDraft({
        ...data,
        goal_target: data.goal_target ?? "",
        goal_due_date: data.goal_due_date || "",
        skills_input: (data.skills || []).join(", "),
        projects: Array.isArray(data.projects) ? data.projects : [],
      });
      setProfilePortfolioMessage("Your goals and portfolio were saved.");
    } catch (error) {
      setProfilePortfolioMessage(`Portfolio was not saved: ${error?.message || "Please try again."}`);
    } finally {
      setProfilePortfolioSaving(false);
    }
  };
  const startVerificationPayment = async () => {
    if (!supabase) {
      setVerificationError("Verification payment requires a Supabase connection.");
      return;
    }
    setVerificationBusy(true);
    setVerificationError("");
    setVerificationMessage("");
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error("Your session has expired. Sign out, sign back in, and try again.");

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      if (!supabaseUrl) throw new Error("Supabase is not configured for payments.");
      const paymentResponse = await fetch(
        `${String(supabaseUrl).replace(/\/+$/, "")}/functions/v1/verification-payments`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "initialize" }),
        },
      );
      const responseBody = await paymentResponse.json().catch(() => null);
      if (!paymentResponse.ok) {
        throw new Error(
          responseBody?.error ||
          `The payment service returned HTTP ${paymentResponse.status}.`,
        );
      }
      const data = responseBody;
      if (data?.error) throw new Error(data.error);
      if (data?.status === "pending_review") {
        setVerificationApplication((current) => current
          ? { ...current, status: "pending_review" }
          : current);
        setVerificationMessage("Payment received. Your application is now awaiting review.");
        return;
      }
      if (!data?.authorization_url) {
        throw new Error("Paystack did not return a checkout link.");
      }
      window.location.assign(data.authorization_url);
    } catch (error) {
      let message = String(error?.message || "");
      if (error?.context instanceof Response) {
        try {
          const responseBody = await error.context.clone().json();
          if (responseBody?.error) message = String(responseBody.error);
        } catch {
          // Keep the SDK error message when the function has no JSON error body.
        }
      }
      const isNetworkFailure = /failed to send|failed to fetch|networkerror|load failed/i.test(message);
      setVerificationError(
        isNetworkFailure
          ? "The Paystack payment service is unavailable. Refresh the page and try again; if it continues, contact an administrator."
          : `Payment could not be started: ${message || "Please try again."}`,
      );
    } finally {
      setVerificationBusy(false);
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
              ["portfolio", "Portfolio"],
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
                {activeProfileSection === "about" ? "STUDENT SNAPSHOT" : activeProfileSection === "contact" ? "STAY CONNECTED" : activeProfileSection === "social" ? "CAMPUS COMMUNITY" : activeProfileSection === "portfolio" ? "GOALS & ACHIEVEMENTS" : "PREFERENCES & SECURITY"}
              </span>
              <h2>{activeProfileSection === "about" ? "About" : activeProfileSection === "contact" ? "Contact information" : activeProfileSection === "social" ? "Social profile" : activeProfileSection === "portfolio" ? "Goals & portfolio" : "Account settings"}</h2>
              <p>{activeProfileSection === "about"
                ? "Your academic identity and student record at a glance."
                : activeProfileSection === "contact"
                  ? "Your contact details and the places you call home."
                  : activeProfileSection === "social"
                    ? "Manage the name, username, and interests other students see."
                    : activeProfileSection === "portfolio"
                      ? "Set a learning goal, celebrate course progress, and choose what appears on your Social profile."
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
              <p>Use the checklist to update editable details or ask an administrator about official records.</p>
              <ul className="student-profile-completion-checklist">
                {incompleteProfileItems.length ? incompleteProfileItems.map((item) => (
                  <li key={item.key}>
                    <span>{item.label}</span>
                    {item.editable ? (
                      <button type="button" onClick={openProfileEditor}>Update</button>
                    ) : (
                      <a href={`mailto:${supportEmail}?subject=${encodeURIComponent("Update student record")}`}>
                        Ask admin
                      </a>
                    )}
                  </li>
                )) : (
                  <li className="is-complete"><span>Your profile details are up to date.</span></li>
                )}
              </ul>
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

          {activeProfileSection === "portfolio" && (
            <section className="student-profile-tab-panel student-profile-portfolio-panel" id="student-profile-panel-portfolio" role="tabpanel" aria-labelledby="student-profile-tab-portfolio">
              {profilePortfolioLoading && (
                <p className="student-profile-portfolio-message" role="status">Loading your goals and sharing settings...</p>
              )}
              <div className="student-profile-portfolio-grid">
                <article className="student-profile-panel student-profile-achievements">
                  <div className="student-profile-panel-heading">
                    <div>
                      <span className="student-profile-eyebrow">LEARNING PROGRESS</span>
                      <h3>Achievements</h3>
                    </div>
                  </div>
                  <div className="student-profile-portfolio-stats">
                    <div><strong>{coursePortfolio.completedCourses}</strong><span>Certificates earned</span></div>
                    <div><strong>{coursePortfolio.completedChapters}/{coursePortfolio.totalChapters}</strong><span>Chapters passed</span></div>
                    <div><strong>{coursePortfolio.cgpa ?? "—"}</strong><span>Course CGPA estimate</span></div>
                  </div>
                  <p className="student-profile-portfolio-note">
                    Course CGPA is an estimate based on saved course quiz results, not an official school result.
                  </p>
                  {coursePortfolioLoading ? (
                    <p className="student-profile-portfolio-message" role="status">Loading your course progress...</p>
                  ) : coursePortfolioError ? (
                    <p className="student-profile-portfolio-message is-error" role="alert">{coursePortfolioError}</p>
                  ) : coursePortfolio.courses.length ? (
                    <div className="student-profile-course-list">
                      {coursePortfolio.courses.map((course) => {
                        const percent = course.totalLessons
                          ? Math.round((course.completedCount / course.totalLessons) * 100)
                          : 0;
                        return (
                          <article className="student-profile-course-progress" key={course.courseId}>
                            <div>
                              <strong>{course.title}</strong>
                              <span>
                                {course.completedCount} of {course.totalLessons} chapters passed
                                {course.certificate ? " · Certificate earned" : ""}
                              </span>
                            </div>
                            <div className="student-profile-progress" role="progressbar" aria-label={`${course.title} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                              <span style={{ width: `${percent}%` }} />
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="student-profile-portfolio-message">Enroll in a course to start building your learning portfolio.</p>
                  )}
                  {coursePortfolio.certificates.length > 0 && (
                    <div className="student-profile-certificates">
                      <h4>Certificates</h4>
                      {coursePortfolio.certificates.map((certificate) => (
                        <div key={certificate.id}>
                          <strong>{certificate.course_title}</strong>
                          <span>{certificate.issued_at ? new Date(certificate.issued_at).toLocaleDateString() : "Completed"}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </article>

                <div className="student-profile-portfolio-settings">
                  <form className="student-profile-panel student-profile-portfolio-form" onSubmit={saveProfilePortfolio}>
                    <div className="student-profile-panel-heading">
                      <div>
                        <span className="student-profile-eyebrow">YOUR NEXT STEP</span>
                        <h3>Academic goal</h3>
                      </div>
                    </div>
                    <label>
                      Goal
                      <input
                        maxLength={120}
                        value={profilePortfolioDraft.goal_title || ""}
                        onChange={(event) => setProfilePortfolioDraft((current) => ({ ...current, goal_title: event.target.value }))}
                        placeholder="e.g. Complete my biology course"
                      />
                    </label>
                    <div className="student-profile-form-grid">
                      <label>
                        Track progress by
                        <select
                          value={profilePortfolioDraft.goal_type}
                          onChange={(event) => setProfilePortfolioDraft((current) => ({ ...current, goal_type: event.target.value }))}
                        >
                          <option value="chapters">Chapters passed</option>
                          <option value="courses">Courses completed</option>
                          <option value="cgpa">Course CGPA estimate</option>
                        </select>
                      </label>
                      <label>
                        Target
                        <input
                          type="number"
                          min={profilePortfolioDraft.goal_type === "cgpa" ? "0.01" : "1"}
                          max={profilePortfolioDraft.goal_type === "cgpa" ? "4" : "1000"}
                          step={profilePortfolioDraft.goal_type === "cgpa" ? "0.01" : "1"}
                          value={profilePortfolioDraft.goal_target ?? ""}
                          onChange={(event) => setProfilePortfolioDraft((current) => ({ ...current, goal_target: event.target.value }))}
                          placeholder={profilePortfolioDraft.goal_type === "cgpa" ? "e.g. 3.50" : "e.g. 10"}
                        />
                      </label>
                    </div>
                    <label>
                      Target date (optional)
                      <input
                        type="date"
                        value={profilePortfolioDraft.goal_due_date || ""}
                        onChange={(event) => setProfilePortfolioDraft((current) => ({ ...current, goal_due_date: event.target.value }))}
                      />
                    </label>
                    {profilePortfolioDraft.goal_title && (
                      <div className="student-profile-goal-progress">
                        {profileGoalProgress ? (
                          <>
                            <div>
                              <strong>{profileGoalProgress.current} / {profileGoalProgress.target}</strong>
                              <span>{profilePortfolioDraft.goal_type === "cgpa" ? "current estimate / target" : "completed / target"}</span>
                            </div>
                            <div className="student-profile-progress" role="progressbar" aria-label="Academic goal progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={profileGoalProgress.percentage}>
                              <span style={{ width: `${profileGoalProgress.percentage}%` }} />
                            </div>
                          </>
                        ) : (
                          <p>Pass course chapter quizzes to calculate progress toward this goal.</p>
                        )}
                      </div>
                    )}

                    <div className="student-profile-portfolio-divider" />
                    <div className="student-profile-panel-heading">
                      <div>
                        <span className="student-profile-eyebrow">SHOW WHAT YOU CAN DO</span>
                        <h3>Skills &amp; projects</h3>
                      </div>
                    </div>
                    <label>
                      Skills (up to 8, separated by commas)
                      <input
                        maxLength={320}
                        value={profilePortfolioDraft.skills_input || ""}
                        onChange={(event) => setProfilePortfolioDraft((current) => ({ ...current, skills_input: event.target.value }))}
                        placeholder="e.g. Research, public speaking, Python"
                      />
                    </label>
                    {profilePortfolioDraft.projects.length > 0 && (
                      <div className="student-profile-project-list" aria-label="Your projects">
                        {profilePortfolioDraft.projects.map((project, index) => (
                          <article className="student-profile-project" key={`${project.title}-${index}`}>
                            <div><strong>{project.title}</strong>{project.description && <p>{project.description}</p>}{project.url && <span>{project.url}</span>}</div>
                            <button type="button" className="student-profile-secondary-button" onClick={() => setProfilePortfolioDraft((current) => ({ ...current, projects: current.projects.filter((_, itemIndex) => itemIndex !== index) }))}>Remove</button>
                          </article>
                        ))}
                      </div>
                    )}
                    <div className="student-profile-project-form">
                      <label>
                        Project title
                        <input maxLength={80} value={profileProjectDraft.title} onChange={(event) => setProfileProjectDraft((current) => ({ ...current, title: event.target.value }))} placeholder="e.g. Community science project" />
                      </label>
                      <label>
                        Short description
                        <textarea maxLength={280} value={profileProjectDraft.description} onChange={(event) => setProfileProjectDraft((current) => ({ ...current, description: event.target.value }))} placeholder="What did you build or learn?" />
                      </label>
                      <label>
                        Project link (optional)
                        <input type="url" maxLength={2048} value={profileProjectDraft.url} onChange={(event) => setProfileProjectDraft((current) => ({ ...current, url: event.target.value }))} placeholder="https://..." />
                      </label>
                      <button type="button" className="student-profile-secondary-button" onClick={addProfileProject} disabled={profilePortfolioDraft.projects.length >= 5}>Add project</button>
                    </div>

                    <div className="student-profile-portfolio-divider" />
                    <div className="student-profile-panel-heading">
                      <div>
                        <span className="student-profile-eyebrow">PRIVACY &amp; SHARING</span>
                        <h3>Choose what others can see</h3>
                      </div>
                    </div>
                    <label className="student-profile-share-toggle">
                      <input type="checkbox" checked={profilePortfolioDraft.share_public} onChange={(event) => setProfilePortfolioDraft((current) => ({ ...current, share_public: event.target.checked }))} />
                      Publish selected portfolio sections on my discoverable Social profile
                    </label>
                    <div className="student-profile-sharing-options">
                      {[
                        ["share_institution", `School or institution${student.institution ? ` (${student.institution})` : ""}`],
                        ["share_education_level", `Education level${student.class ? ` (${student.class})` : ""}`],
                        ["share_goal", "Academic goal and target"],
                        ["share_skills", "Skills"],
                        ["share_projects", "Projects and links"],
                        ["share_achievements", "Course progress and certificates"],
                      ].map(([key, label]) => (
                        <label key={key} className="student-profile-share-toggle">
                          <input
                            type="checkbox"
                            checked={profilePortfolioDraft[key] === true}
                            onChange={(event) => setProfilePortfolioDraft((current) => ({ ...current, [key]: event.target.checked }))}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    {!socialProfileDraft.discoverable && (
                      <p className="student-profile-privacy-help">
                        Your Social profile is not discoverable yet. Enable it in{" "}
                        <button type="button" className="student-profile-inline-link" onClick={() => setActiveProfileSection("social")}>Social profile settings</button>{" "}
                        before publishing a portfolio.
                      </p>
                    )}
                    <div className="student-profile-privacy-preview">
                      <div className="student-profile-preview-identity">
                        <div className="student-profile-preview-avatar">
                          {student.photo_url
                            ? <img src={student.photo_url} alt="" />
                            : initials || "ST"}
                        </div>
                        <div>
                        <span className="student-profile-eyebrow">PUBLIC PROFILE PREVIEW</span>
                        <h4>{socialProfileDraft.display_name || student.display_name || student.full_name || user?.name || "Student"}</h4>
                        {socialProfileDraft.username && <span>@{socialProfileDraft.username.replace(/^@/, "")}</span>}
                        </div>
                      </div>
                      {previewNameTags.length > 0 && (
                        <div className="student-profile-preview-tags">
                          {previewNameTags.map((tag) => <span key={tag}>{tag}</span>)}
                        </div>
                      )}
                      {socialProfileDraft.bio && <p>{socialProfileDraft.bio}</p>}
                      {profilePortfolioDraft.share_institution && student.institution && <p>{student.institution}</p>}
                      {profilePortfolioDraft.share_education_level && student.class && <p>{student.class}</p>}
                      {profilePortfolioDraft.share_goal && profilePortfolioDraft.goal_title && <p><strong>Goal:</strong> {profilePortfolioDraft.goal_title}</p>}
                      {profilePortfolioDraft.share_skills && previewSkills.length > 0 && (
                        <div className="student-profile-preview-tags">{previewSkills.map((skill, index) => <span key={`${skill}-${index}`}>{skill}</span>)}</div>
                      )}
                      {profilePortfolioDraft.share_projects && profilePortfolioDraft.projects.map((project, index) => (
                        <p key={`${project.title}-${index}`}><strong>Project:</strong> {project.title}</p>
                      ))}
                      {profilePortfolioDraft.share_achievements && coursePortfolio.certificates.length > 0 && (
                        <p>{coursePortfolio.certificates.length} course certificate{coursePortfolio.certificates.length === 1 ? "" : "s"} earned</p>
                      )}
                      <p className="student-profile-privacy-note">
                        Student ID, date of birth, contact details, and home address stay private.
                        {profilePortfolioDraft.share_public && socialProfileDraft.discoverable
                          ? " Selected sections will be visible to signed-in students who can view your profile."
                          : " This portfolio preview is private until you enable sharing and discoverability."}
                      </p>
                    </div>
                    <div className="student-profile-editor-actions">
                      <button className="student-profile-edit-button" type="submit" disabled={profilePortfolioSaving || profilePortfolioLoading}>
                        {profilePortfolioSaving ? "Saving portfolio..." : "Save goals & portfolio"}
                      </button>
                    </div>
                    {profilePortfolioError && <p className="student-profile-portfolio-message is-error" role="alert">{profilePortfolioError}</p>}
                    {profilePortfolioMessage && <p className="student-profile-portfolio-message" role="status">{profilePortfolioMessage}</p>}
                  </form>
                </div>
              </div>
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
              {!editingProfile && (
                <article className="student-profile-panel student-profile-verification">
                  <div className="student-profile-panel-heading">
                    <div>
                      <span className="student-profile-eyebrow">STUDENT VERIFICATION</span>
                      <h3>
                        {studentStatus === "confirmed"
                          ? "Verification status"
                          : isSuspended
                            ? "Verification unavailable"
                            : verificationApplication?.status === "pending_review"
                              ? "Application under review"
                              : "Apply for verification"}
                      </h3>
                    </div>
                    {studentStatus === "confirmed" && !isSuspended && (
                      <span className="student-profile-status is-confirmed">
                        <StudentVerifiedBadge />
                        Verified
                      </span>
                    )}
                  </div>
                  {!verificationLoading && !isSuspended && studentStatus !== "confirmed" && (
                    <div className="verification-payment-actions">
                      {verificationApplication?.status !== "pending_review" && (
                        Number(verificationSettings?.fee_pesewas) > 0 ? (
                          <button
                            className="student-profile-edit-button"
                            type="button"
                            onClick={startVerificationPayment}
                            disabled={verificationBusy}
                          >
                            {verificationBusy
                              ? "Connecting to Paystack..."
                              : `Apply for verification · ${new Intl.NumberFormat("en-GH", {
                                style: "currency",
                                currency: verificationSettings?.currency || "GHS",
                              }).format(Number(verificationSettings.fee_pesewas) / 100)}`}
                          </button>
                        ) : !verificationError && (
                          <p className="verification-feedback">
                            Applications are not open yet. An administrator will set the fee in the dashboard.
                          </p>
                        )
                      )}
                    </div>
                  )}
                  {verificationLoading && (
                    <p className="verification-feedback" role="status">Loading verification details...</p>
                  )}
                  {verificationError && studentStatus !== "confirmed" && !isSuspended && (
                    <p className="verification-feedback is-error" role="alert">{verificationError}</p>
                  )}
                  {verificationMessage && (
                    <p className="verification-feedback" role="status">{verificationMessage}</p>
                  )}
                  {verificationApplication && (
                    <div className="verification-application-summary">
                      <div>
                        <span>Application status</span>
                        <strong>
                          {verificationApplication.status === "pending_review"
                            ? "Paid — awaiting admin review"
                            : verificationApplication.status === "approved"
                              ? "Approved"
                              : "Not approved"}
                        </strong>
                      </div>
                      <div>
                        <span>Application fee</span>
                        <strong>
                          {new Intl.NumberFormat("en-GH", {
                            style: "currency",
                            currency: verificationApplication.currency || "GHS",
                          }).format(Number(verificationApplication.amount_pesewas || 0) / 100)}
                        </strong>
                      </div>
                      {verificationApplication.review_note && (
                        <p className="verification-review-note">
                          Admin note: {verificationApplication.review_note}
                        </p>
                      )}
                      {verificationApplication.status === "declined" && (
                        <p className="verification-review-note">
                          Refund status: {verificationApplication.refund_status === "refunded"
                            ? "Refund recorded"
                            : verificationApplication.refund_status === "not_refunded"
                              ? "No refund recorded"
                              : "Under review"}
                          {verificationApplication.refund_note
                            ? ` ${verificationApplication.refund_note}`
                            : ""}
                        </p>
                      )}
                    </div>
                  )}
                  {isSuspended && (
                    <p className="verification-feedback is-error">
                      Suspended accounts cannot submit verification applications.
                    </p>
                  )}
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
