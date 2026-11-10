import { useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { Ico } from "./Ico.jsx";
import { NotificationContext } from "./NotificationSystem.jsx";
import { SettingsContext } from "../context/SettingsContext.js";
import { useIsMobileLayout } from "../hooks/useIsMobileLayout.js";
import { sortStudentsByIndex } from "../utils/campusData.js";
import { GHANA_REGIONS } from "../data/demoData.js";

const normalizeParentContactValue = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D+/g, "");
  if (!digits) return raw;
  if (digits.length === 9) return `0${digits}`;
  if (digits.length === 10 && digits.startsWith("0")) return digits;
  if (digits.length === 12 && digits.startsWith("233")) {
    return `0${digits.slice(3)}`;
  }
  return digits;
};

const isBasic8Student = (studentClass) => {
  if (!studentClass) return false;
  return /basic\s*8/i.test(String(studentClass).trim());
};

const isBasic9Student = (studentClass) => {
  if (!studentClass) return false;
  return /basic\s*9/i.test(String(studentClass).trim());
};

const getStudentIdFromParentContact = (parentContact, studentClass) => {
  if (isBasic8Student(studentClass) || isBasic9Student(studentClass)) return null;
  const normalized = normalizeParentContactValue(parentContact);
  if (!normalized) return null;
  return normalized.endsWith("27") ? normalized : `${normalized}27`;
};

const buildStudentDraft = (student = null) => {
  const studentClass = student?.class || student?.class_name || "";
  const normalizedParentContact =
    student?.parent_contact ||
    student?.parent_phone ||
    student?.guardian_phone ||
    student?.guardian_contact ||
    "";
  const generatedIndex = getStudentIdFromParentContact(
    normalizedParentContact,
    studentClass,
  );

  return {
    full_name: student?.full_name || student?.name || "",
    gender: student?.gender || "",
    index:
      generatedIndex ||
      student?.index ||
      student?.index_number ||
      student?.index_no ||
      "",
    class: student?.class || student?.class_name || "",
    region: student?.region || "Ashanti",
    parent_contact: normalizedParentContact,
    registered_school_id:
      student?.registered_school_id != null
        ? String(student.registered_school_id)
        : "",
    date_of_birth: student?.date_of_birth || "",
    // aggregate removed
    status: student?.status || "pending",
    photo_url: student?.photo_url || "",
  };
};

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

const resolveClassOptions = (cfg) => {
  const rows = Array.isArray(cfg?.classOptions) ? cfg.classOptions : [];
  const cleaned = rows.map((row) => String(row || "").trim()).filter(Boolean);
  return cleaned;
};

function ActionStatusModal({ state, onClose }) {
  const isSuccess = state.type === "success";

  useEffect(() => {
    if (!state?.open) {
      return undefined;
    }

    const timer = setTimeout(
      () => {
        onClose();
      },
      state.type === "failure" ? 4500 : 2200,
    );
    return () => clearTimeout(timer);
  }, [onClose, state?.open, state?.type, state?.title, state?.message]);

  if (!state?.open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        style={{ maxWidth: 460 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head" style={{ marginBottom: 12 }}>
          <div>
            <div
              className="modal-title"
              style={{ color: isSuccess ? "#166534" : "#991b1b" }}
            >
              {state.title ||
                (isSuccess ? "Update Successful" : "Update Failed")}
            </div>
            <div
              className="modal-sub"
              style={{ fontSize: ".88rem", marginTop: 6, color: "#475569" }}
            >
              {state.message ||
                (isSuccess
                  ? "Your changes were saved."
                  : "Something went wrong while saving your changes.")}
            </div>
          </div>
        </div>
        <div className="modal-actions" style={{ marginTop: 10 }}>
          <button
            className={`btn ${isSuccess ? "btn-blue" : "btn-red"}`}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function StudentEditorModal({
  open,
  title,
  draft,
  saving,
  onChange,
  onClose,
  onSave,
  registeredSchools = [],
  canAssignRegisteredSchool = false,
}) {
  const { cfg } = useContext(SettingsContext);
  const classOptions = resolveClassOptions(cfg);
  const classOptionsWithCurrent =
    draft.class && !classOptions.includes(draft.class)
      ? [draft.class, ...classOptions]
      : classOptions;

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">{title}</div>
            <div className="modal-sub">
              Update the core student record used across admissions, attendance,
              fees, and school reporting.
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>
            X
          </button>
        </div>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Full Name</label>
            <input
              className="form-control"
              value={draft.full_name}
              onChange={(e) => onChange("full_name", e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Student ID</label>
            <input
              className="form-control"
              value={draft.index}
              onChange={(e) => onChange("index", e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Gender</label>
            <select
              className="form-control"
              value={draft.gender || ""}
              onChange={(e) => onChange("gender", e.target.value)}
            >
              <option value="">Not provided</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Class</label>
            <select
              className="form-control"
              value={draft.class}
              onChange={(e) => onChange("class", e.target.value)}
            >
              {!classOptions.length && (
                <option value="">No classes configured in Settings</option>
              )}
              {classOptionsWithCurrent.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Region</label>
            <select
              className="form-control"
              value={draft.region}
              onChange={(e) => onChange("region", e.target.value)}
            >
              {GHANA_REGIONS.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </div>
          {canAssignRegisteredSchool && (
            <div className="form-group">
              <label className="form-label">Registered School</label>
              <select
                className="form-control"
                value={draft.registered_school_id || ""}
                onChange={(e) =>
                  onChange("registered_school_id", e.target.value)
                }
              >
                <option value="">Not assigned</option>
                {registeredSchools.map((school) => (
                  <option key={school.id} value={String(school.id)}>
                    {school.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {/* Aggregate input removed */}
          <div className="form-group">
            <label className="form-label">Status</label>
            <select
              className="form-control"
              value={draft.status}
              onChange={(e) => onChange("status", e.target.value)}
            >
              <option value="pending">pending</option>
              <option value="confirmed">confirmed</option>
              <option value="active">active</option>
              <option value="suspended">suspended</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Parent Contact</label>
            <input
              className="form-control"
              value={draft.parent_contact || ""}
              onChange={(e) => onChange("parent_contact", e.target.value)}
              placeholder="e.g. 0241234567"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Date of Birth</label>
            <input
              className="form-control"
              type="date"
              value={draft.date_of_birth || ""}
              onChange={(e) => onChange("date_of_birth", e.target.value)}
            />
          </div>
          <div className="form-group" style={{ gridColumn: "1 / -1" }}>
            <label className="form-label">Photo URL</label>
            <input
              className="form-control"
              value={draft.photo_url}
              onChange={(e) => onChange("photo_url", e.target.value)}
              placeholder="Optional photo URL"
            />
          </div>
        </div>
        <div className="modal-actions">
          <button
            className="btn btn-outline"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button className="btn btn-blue" onClick={onSave} disabled={saving}>
            {saving ? "Saving..." : "Save Student"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function StudentsPage({
  onEnroll,
  onEditStudent = null,
  studentsData,
  showEnrollAction = true,
  heroKicker = "Admissions Registry",
  heroTitle = "Student records, cleaned up and ready for action",
  heroSub = "Review the current intake pipeline, search across enrolled learners quickly, and move straight into adding a new student without leaving the admissions workspace.",
  heroNote = "Live list view across configured classes and region origin.",
  directoryTitle = "Student directory",
  directorySub = "Students grouped by registered school and class. Search by name or student ID.",
  emptyRemoteMessage = "No student rows are currently available from Supabase.",
  onReloadStudents,
  registeredSchools = [],
  canAssignRegisteredSchool = false,
  isSuperAdmin = false,
}) {
  const { cfg } = useContext(SettingsContext);
  const classOptions = resolveClassOptions(cfg);
  const [search, setSearch] = useState("");
  const [editingStudent, setEditingStudent] = useState(null);
  const [studentDraft, setStudentDraft] = useState(() => buildStudentDraft());
  const [savingStudent, setSavingStudent] = useState(false);
  const [movingStudent, setMovingStudent] = useState(null);
  const [movingSchoolId, setMovingSchoolId] = useState("");
  const [savingMove, setSavingMove] = useState(false);
  const [selectedStudentIds, setSelectedStudentIds] = useState([]);
  const [bulkClass, setBulkClass] = useState("");
  const [bulkSchoolId, setBulkSchoolId] = useState("");
  const [bulkStatus, setBulkStatus] = useState("");
  const [applyingBulk, setApplyingBulk] = useState(false);
  const [provisioningLogins, setProvisioningLogins] = useState(false);
  const [selectedFilterSchoolId, setSelectedFilterSchoolId] = useState("");
  const [selectedFilterClassId, setSelectedFilterClassId] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("");
  const [selectedEducationLevel, setSelectedEducationLevel] = useState("");
  const [selectedExactClass, setSelectedExactClass] = useState("");
  const [selectedStudentStatus, setSelectedStudentStatus] = useState("");
  const [viewingStudent, setViewingStudent] = useState(null);
  const [statusModal, setStatusModal] = useState({
    open: false,
    type: "success",
    title: "",
    message: "",
  });
  const isMobile = useIsMobileLayout();
  const [archivingId, setArchivingId] = useState(null);
  const [restoringId, setRestoringId] = useState(null);
  const [showArchivedStudents, setShowArchivedStudents] = useState(false);
  const [archivedStudents, setArchivedStudents] = useState([]);
  const [loadingArchivedStudents, setLoadingArchivedStudents] = useState(false);
  const { notify } = useContext(NotificationContext) || {};

  const loadArchivedStudents = async () => {
    if (!supabase) {
      notify && notify("Student account archive is unavailable.", "error");
      return;
    }

    setLoadingArchivedStudents(true);
    try {
      const { data, error } = await supabase.rpc(
        "list_deleted_student_accounts",
      );
      if (error) throw error;
      setArchivedStudents(Array.isArray(data) ? data : []);
    } catch (err) {
      setArchivedStudents([]);
      notify &&
        notify(
          "Failed to load archived students: " +
            (err?.message || "Unknown error"),
          "error",
        );
    } finally {
      setLoadingArchivedStudents(false);
    }
  };

  const toggleArchivedStudents = async () => {
    const shouldShow = !showArchivedStudents;
    setShowArchivedStudents(shouldShow);
    if (shouldShow) await loadArchivedStudents();
  };

  const handleArchive = async (student) => {
    if (
      !window.confirm(
        `Move '${student.full_name}' (ID: ${student.index}) to deleted accounts? It can be restored for 30 days before permanent deletion.`,
      )
    )
      return;
    setArchivingId(student.id);
    try {
      if (!supabase) throw new Error("Student account archive is unavailable.");
      if (!student.id || String(student.id).startsWith("local-")) {
        throw new Error(
          "This student is not a saved database record and cannot be archived.",
        );
      }

      const { error } = await supabase.rpc("archive_student_account", {
        p_student_id: student.id,
      });
      if (error) throw error;

      notify &&
        notify("Student archived. It can be restored for 30 days.", "success");
      if (typeof onReloadStudents === "function") {
        await onReloadStudents();
      }
      if (showArchivedStudents) await loadArchivedStudents();
    } catch (err) {
      notify &&
        notify(
          "Failed to archive student: " + (err?.message || "Unknown error"),
          "error",
        );
    } finally {
      setArchivingId(null);
    }
  };

  const handleRestore = async (studentId) => {
    setRestoringId(studentId);
    try {
      if (!supabase) throw new Error("Student account archive is unavailable.");
      const { error } = await supabase.rpc("restore_deleted_student_account", {
        p_student_id: studentId,
      });
      if (error) throw error;

      notify && notify("Student account restored successfully.", "success");
      await loadArchivedStudents();
      if (typeof onReloadStudents === "function") {
        await onReloadStudents();
      }
    } catch (err) {
      notify &&
        notify(
          "Failed to restore student: " + (err?.message || "Unknown error"),
          "error",
        );
    } finally {
      setRestoringId(null);
    }
  };
  const students = studentsData?.length
    ? sortStudentsByIndex(studentsData)
    : [];
  const searchFiltered = students.filter(
    (s) =>
      String(s.full_name || "").toLowerCase().includes(search.toLowerCase()) ||
      String(s.index || "").toLowerCase().includes(search.toLowerCase()),
  );
  const studentLocationOf = (student) => {
    const region = String(student?.region || "").trim();
    const district = String(student?.district || "").trim();
    return [district, region].filter(Boolean).join(", ") ||
      String(student?.location || "").trim() ||
      "Location not provided";
  };
  const locations = [...new Set(students.map(studentLocationOf))].sort((a, b) =>
    a.localeCompare(b),
  );
  const exactClasses = [...new Set(
    students.map((student) => String(student.class || student.class_name || "").trim())
      .filter(Boolean),
  )].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const filtered = searchFiltered.filter((student) => {
    const status = String(student.status || "pending").toLowerCase();
    return (
      (!selectedLocation || studentLocationOf(student) === selectedLocation) &&
      (!selectedEducationLevel ||
        getStudentEducationLevel(student) === selectedEducationLevel) &&
      (!selectedExactClass ||
        String(student.class || student.class_name || "").trim() === selectedExactClass) &&
      (!selectedStudentStatus || status === selectedStudentStatus)
    );
  });

  const schoolNameById = new Map(
    (registeredSchools || []).map((school) => [String(school.id), school.name]),
  );

  // Group students by school and then by class
  const groupedStudents = useMemo(() => {
    const groups = {};

    filtered.forEach(student => {
      const schoolId = student.registered_school_id || 'unassigned';
      const schoolName = schoolId === 'unassigned' ? 'Not Assigned' : schoolNameById.get(String(schoolId)) || `School #${schoolId}`;
      const className = student.class || 'No Class';

      if (!groups[schoolId]) {
        groups[schoolId] = {
          name: schoolName,
          classes: {},
          totalStudents: 0
        };
      }

      if (!groups[schoolId].classes[className]) {
        groups[schoolId].classes[className] = [];
      }

      groups[schoolId].classes[className].push(student);
      groups[schoolId].totalStudents++;
    });

    return groups;
  }, [filtered, schoolNameById]);

  // Get available classes for selected school
  const availableClasses = useMemo(() => {
    if (!selectedFilterSchoolId) return [];
    const schoolData = groupedStudents[selectedFilterSchoolId];
    if (!schoolData) return [];
    return Object.keys(schoolData.classes).sort();
  }, [selectedFilterSchoolId, groupedStudents]);

  // Get students for selected school and class
  const displayedStudents = useMemo(() => {
    if (!selectedFilterSchoolId) return filtered;
    if (!selectedFilterClassId) {
      // Show all students from selected school
      const schoolData = groupedStudents[selectedFilterSchoolId];
      if (!schoolData) return [];
      return Object.values(schoolData.classes).flat();
    }
    // Show students from selected school and class
    const schoolData = groupedStudents[selectedFilterSchoolId];
    if (!schoolData) return [];
    return schoolData.classes[selectedFilterClassId] || [];
  }, [selectedFilterSchoolId, selectedFilterClassId, groupedStudents, filtered]);
  const parentContactOf = (student) =>
    student?.parent_contact ||
    student?.parent_phone ||
    student?.guardian_phone ||
    student?.guardian_contact ||
    "-";
  const schoolOf = (student) => {
    const id = student?.registered_school_id;
    if (id == null || String(id).trim() === "") return "Not assigned";
    return schoolNameById.get(String(id)) || `School #${id}`;
  };
  const initialsFor = (name) =>
    String(name || "ST")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  // Aggregate logic removed
  const pendingCount = students.filter(
    (student) => student.status === "pending",
  ).length;
  const canEditStudents = typeof onEditStudent === "function";
  const displayedStudentIds = displayedStudents.map((student) => String(student.id));
  const selectedInDisplayedCount = displayedStudentIds.filter((id) =>
    selectedStudentIds.includes(id),
  ).length;
  const allDisplayedSelected =
    displayedStudentIds.length > 0 &&
    selectedInDisplayedCount === displayedStudentIds.length;

  const toggleStudentSelection = (student) => {
    const id = String(student.id);
    setSelectedStudentIds((current) =>
      current.includes(id) ? current.filter((row) => row !== id) : [...current, id],
    );
  };

  const toggleSelectAllDisplayed = () => {
    if (!displayedStudentIds.length) return;
    setSelectedStudentIds((current) => {
      if (
        displayedStudentIds.every((id) => current.includes(id)) &&
        displayedStudentIds.length
      ) {
        return current.filter((id) => !displayedStudentIds.includes(id));
      }
      return [
        ...current.filter((id) => !displayedStudentIds.includes(id)),
        ...displayedStudentIds,
      ];
    });
  };

  const applyBulkAssignments = async () => {
    if (!canEditStudents || typeof onEditStudent !== "function") return;
    if (!selectedStudentIds.length) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Bulk Update Failed",
        message: "Select at least one student first.",
      });
      return;
    }
    if (
      !bulkClass &&
      bulkStatus === "" &&
      !(canAssignRegisteredSchool && bulkSchoolId !== "")
    ) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Bulk Update Failed",
        message: "Choose a class, status, or school assignment to apply.",
      });
      return;
    }

    setApplyingBulk(true);
    let updatedCount = 0;
    try {
      const studentsById = new Map(students.map((student) => [String(student.id), student]));
      for (const id of selectedStudentIds) {
        const student = studentsById.get(id);
        if (!student) continue;
        const nextDraft = buildStudentDraft(student);
        if (bulkClass) nextDraft.class = bulkClass;
        if (isSuperAdmin && bulkStatus !== "") {
          nextDraft.status = bulkStatus;
        }
        if (canAssignRegisteredSchool && bulkSchoolId !== "") {
          nextDraft.registered_school_id =
            bulkSchoolId === "__UNASSIGN__" ? "" : bulkSchoolId;
        }
        await onEditStudent(student, nextDraft);
        updatedCount += 1;
      }
      if (typeof onReloadStudents === "function") {
        await onReloadStudents();
      }
      setSelectedStudentIds([]);
      setStatusModal({
        open: true,
        type: "success",
        title: "Bulk Update Complete",
        message: `Updated ${updatedCount} student${updatedCount === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Bulk Update Failed",
        message: error?.message || "Could not apply bulk assignment.",
      });
    } finally {
      setApplyingBulk(false);
    }
  };

  const provisionSelectedStudentLogins = async (studentIdsToProvision = selectedStudentIds) => {
    const selectedIds = studentIdsToProvision.filter((id) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id),
    );
    if (!selectedIds.length) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Login Setup Failed",
        message: "Select registered student records with valid database IDs.",
      });
      return;
    }
    if (!supabase) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Login Setup Failed",
        message: "Supabase is not configured.",
      });
      return;
    }

    setProvisioningLogins(true);
    try {
      const results = [];
      for (let start = 0; start < selectedIds.length; start += 100) {
        const { data, error } = await supabase.functions.invoke(
          "provision-student-logins",
          { body: { student_ids: selectedIds.slice(start, start + 100) } },
        );
        if (error) throw error;
        if (!Array.isArray(data?.results)) {
          throw new Error(data?.error || "The provisioning service returned an invalid response.");
        }
        results.push(...data.results);
      }

      const readyCount = results.filter((result) => result.status === "ready").length;
      const failedResults = results.filter((result) => result.status !== "ready");
      setStatusModal({
        open: true,
        type: failedResults.length ? "failure" : "success",
        title: failedResults.length ? "Some Logins Need Attention" : "Student Logins Ready",
        message: [
          `${readyCount} student login${readyCount === 1 ? "" : "s"} ready.`,
          failedResults.length
            ? `${failedResults.length} failed: ${failedResults
                .slice(0, 5)
                .map((result) => result.message || result.student_id)
                .join("; ")}${failedResults.length > 5 ? "; more failures not shown." : ""}`
            : "New accounts use the recorded parent/guardian contact as their temporary password. Existing passwords were not changed.",
        ].join(" "),
      });
    } catch (error) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Login Setup Failed",
        message: error?.message || "The student login provisioning service could not be reached.",
      });
    } finally {
      setProvisioningLogins(false);
    }
  };

  const openStudentEditor = (student) => {
    setEditingStudent(student);
    setStudentDraft(buildStudentDraft(student));
  };

  const openStudentProfile = (student) => setViewingStudent(student);

  const openMoveStudentModal = (student) => {
    setMovingStudent(student);
    setMovingSchoolId(String(student?.registered_school_id || ""));
  };

  const saveMoveStudent = async () => {
    if (!movingStudent) return;
    setSavingMove(true);
    try {
      const nextDraft = buildStudentDraft(movingStudent);
      nextDraft.registered_school_id = movingSchoolId === "" ? "" : movingSchoolId;
      await onEditStudent?.(movingStudent, nextDraft);
      setMovingStudent(null);
      setMovingSchoolId("");
      setStatusModal({
        open: true,
        type: "success",
        title: "Student Moved",
        message: "Student school assignment updated successfully.",
      });
      if (typeof onReloadStudents === "function") {
        await onReloadStudents();
      }
    } catch (error) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Move Failed",
        message: error?.message || "Could not move student.",
      });
    } finally {
      setSavingMove(false);
    }
  };

  const saveStudentEdit = async () => {
    if (
      !editingStudent ||
      !studentDraft.full_name.trim() ||
      !studentDraft.index.trim()
    ) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Student Update Failed",
        message: "Student name and ID are required.",
      });
      return;
    }

    setSavingStudent(true);
    try {
      await onEditStudent?.(editingStudent, studentDraft);
      setEditingStudent(null);
      setStatusModal({
        open: true,
        type: "success",
        title: "Student Saved",
        message: "Student record updated successfully.",
      });
    } catch (error) {
      setStatusModal({
        open: true,
        type: "failure",
        title: "Student Update Failed",
        message: error?.message || "Could not save the student record.",
      });
    } finally {
      setSavingStudent(false);
    }
  };
  return (
    <div className="fade-in">
      <ActionStatusModal
        state={statusModal}
        onClose={() =>
          setStatusModal((current) => ({ ...current, open: false }))
        }
      />
      {viewingStudent && (
        <div
          className="modal-overlay"
          onClick={() => setViewingStudent(null)}
          role="presentation"
        >
          <section
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-student-profile-title"
            onClick={(event) => event.stopPropagation()}
            style={{ width: "min(680px, calc(100vw - 32px))", maxHeight: "85vh", overflowY: "auto" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
              {viewingStudent.photo_url ? (
                <img
                  src={viewingStudent.photo_url}
                  alt=""
                  className="students-avatar"
                  style={{ width: 64, height: 64, borderRadius: "50%" }}
                />
              ) : (
                <div className="students-avatar-placeholder" style={{ width: 64, height: 64, borderRadius: "50%" }}>
                  {initialsFor(viewingStudent.full_name)}
                </div>
              )}
              <div>
                <h2 id="admin-student-profile-title" style={{ margin: 0 }}>
                  {viewingStudent.full_name}
                </h2>
                <div style={{ color: "#64748b", marginTop: 4 }}>
                  Student ID: {viewingStudent.index || " "}
                </div>
              </div>
            </div>
            <div className="student-profile-card-body" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              {[
                ["Status", viewingStudent.status || "pending"],
                ["Education level", getStudentEducationLevel(viewingStudent)],
                ["Exact class", viewingStudent.class || viewingStudent.class_name || " "],
                ["School", schoolOf(viewingStudent)],
                ["Region", viewingStudent.region || " "],
                ["District", viewingStudent.district || " "],
                ["Date of birth", viewingStudent.date_of_birth || " "],
                ["Gender", viewingStudent.gender || " "],
                ["Email", viewingStudent.email || " "],
                ["Phone", viewingStudent.phone || viewingStudent.phone_number || " "],
                ["Parent / guardian contact", parentContactOf(viewingStudent)],
                ["Institution", viewingStudent.institution || viewingStudent.school_name || " "],
              ].map(([label, value]) => (
                <div key={label} style={{ padding: 12, border: "1px solid #e2e8f0", borderRadius: 10 }}>
                  <div style={{ color: "#64748b", fontSize: ".8rem", marginBottom: 4 }}>{label}</div>
                  <strong style={{ overflowWrap: "anywhere" }}>{value}</strong>
                </div>
              ))}
            </div>
            <div className="modal-actions" style={{ marginTop: 20 }}>
              <button className="btn btn-blue" type="button" onClick={() => setViewingStudent(null)}>
                Close profile
              </button>
            </div>
          </section>
        </div>
      )}
      <div className="students-shell">
        <div className="students-hero">
          <div className="students-hero-copy">
            <div className="students-hero-kicker">{heroKicker}</div>
            <div className="students-hero-title">{heroTitle}</div>
            <div className="students-hero-sub">{heroSub}</div>
          </div>
          <div className="students-hero-actions">
            {showEnrollAction && (
              <button className="btn btn-blue" onClick={onEnroll}>
                <Ico name="enroll" size={16} color="#fff" /> Enroll Student
              </button>
            )}
            <div className="students-hero-note">{heroNote}</div>
          </div>
        </div>

        <div className="students-summary-grid">
          <div className="students-summary-card">
            <div className="students-summary-label">Total Students</div>
            <div className="students-summary-value">{students.length}</div>
            <div className="students-summary-sub">
              All records currently available
            </div>
          </div>
          <div className="students-summary-card">
            <div className="students-summary-label">Schools</div>
            <div className="students-summary-value">{Object.keys(groupedStudents).length}</div>
            <div className="students-summary-sub">
              Registered schools with students
            </div>
          </div>
          <div className="students-summary-card">
            <div className="students-summary-label">Search Results</div>
            <div className="students-summary-value">{filtered.length}</div>
            <div className="students-summary-sub">
              Matching the current filter
            </div>
          </div>
          <div className="students-summary-card">
            <div className="students-summary-label">Pending Review</div>
            <div className="students-summary-value">{pendingCount}</div>
            <div className="students-summary-sub">
              Students awaiting confirmation
            </div>
          </div>
        </div>

        {!students.length && (
          <div className="alert alert-warning">{emptyRemoteMessage}</div>
        )}

        <div className="students-toolbar">
          <div className="students-toolbar-copy">
            <div className="students-toolbar-title">{directoryTitle}</div>
            <div className="students-toolbar-sub">{directorySub}</div>
          </div>
          <div className="students-toolbar-actions">
            <input
              className="form-control students-search"
              placeholder="Search students..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {canEditStudents && (
              <button
                className="btn btn-outline"
                type="button"
                onClick={toggleArchivedStudents}
              >
                {showArchivedStudents ? "Hide" : "Archived accounts"}{" "}
                {!loadingArchivedStudents && `(${archivedStudents.length})`}
              </button>
            )}
            {showEnrollAction && (
              <button className="btn btn-blue" onClick={onEnroll}>
                <Ico name="enroll" size={16} color="#fff" /> Enroll Student
              </button>
            )}
          </div>
        </div>

        {canEditStudents && showArchivedStudents && (
          <section
            className="card card-padded"
            aria-label="Archived student accounts"
            style={{ marginBottom: 12, border: "1px solid #cbd5e1" }}
          >
            <div style={{ fontWeight: 800, marginBottom: 4 }}>
              Deleted student accounts
            </div>
            <div style={{ color: "#475569", fontSize: ".88rem", marginBottom: 12 }}>
              Accounts remain recoverable for 30 days. Associated student
              records are retained during this period, then permanently purged.
            </div>
            {loadingArchivedStudents ? (
              <div role="status">Loading archived accounts...</div>
            ) : archivedStudents.length === 0 ? (
              <div>No student accounts are currently archived.</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {archivedStudents.map((student) => {
                  const purgeDate = new Date(student.purge_at);
                  const daysRemaining = Math.max(
                    0,
                    Math.ceil((purgeDate.getTime() - Date.now()) / 86400000),
                  );
                  return (
                    <div
                      key={student.student_id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        flexWrap: "wrap",
                        border: "1px solid #e2e8f0",
                        borderRadius: 10,
                        padding: 12,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>
                          {student.full_name || "Unnamed student"}
                        </div>
                        <div style={{ color: "#64748b", fontSize: ".85rem" }}>
                          ID: {student.student_index || " "}
                          {student.student_class ? `   ${student.student_class}` : ""}
                        </div>
                        <div style={{ color: "#64748b", fontSize: ".82rem" }}>
                          Permanently deleted in {daysRemaining} day
                          {daysRemaining === 1 ? "" : "s"} (
                          {purgeDate.toLocaleDateString()})
                        </div>
                      </div>
                      <button
                        className="btn btn-outline"
                        type="button"
                        disabled={restoringId === student.student_id}
                        onClick={() => handleRestore(student.student_id)}
                      >
                        {restoringId === student.student_id
                          ? "Restoring..."
                          : "Restore"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {canEditStudents && (
          <div
            className="card card-padded"
            style={{
              marginBottom: 12,
              border: "1px solid #bfdbfe",
              background: "#eff6ff",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ fontWeight: 800 }}>Student portal logins</div>
              <div style={{ color: "#475569", fontSize: ".85rem", marginTop: 4 }}>
                Select student records below, then set up or retry their Student ID logins.
              </div>
            </div>
            <button
              className="btn btn-blue"
              type="button"
              disabled={provisioningLogins || selectedStudentIds.length === 0}
              onClick={provisionSelectedStudentLogins}
            >
              {provisioningLogins
                ? "Setting Up Logins..."
                : `Set Up Logins for ${selectedStudentIds.length} Selected`}
            </button>
          </div>
        )}

        <div className="card card-padded" style={{ marginBottom: 12, border: "1px solid #bfdbfe" }}>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>Filter students</div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label" htmlFor="student-location-filter">Location</label>
              <select id="student-location-filter" className="form-control" value={selectedLocation} onChange={(event) => setSelectedLocation(event.target.value)}>
                <option value="">All locations</option>
                {locations.map((location) => <option key={location} value={location}>{location}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="student-level-filter">Education level</label>
              <select id="student-level-filter" className="form-control" value={selectedEducationLevel} onChange={(event) => setSelectedEducationLevel(event.target.value)}>
                <option value="">All levels</option>
                {["JHS", "SHS", "University", "Other"].map((level) => <option key={level} value={level}>{level}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="student-exact-class-filter">Exact class</label>
              <select id="student-exact-class-filter" className="form-control" value={selectedExactClass} onChange={(event) => setSelectedExactClass(event.target.value)}>
                <option value="">All classes</option>
                {exactClasses.map((className) => <option key={className} value={className}>{className}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="student-status-filter">Status</label>
              <select id="student-status-filter" className="form-control" value={selectedStudentStatus} onChange={(event) => setSelectedStudentStatus(event.target.value)}>
                <option value="">All statuses</option>
                {["pending", "active", "confirmed", "suspended"].map((status) => <option key={status} value={status}>{status === "suspended" ? "Suspended" : status[0].toUpperCase() + status.slice(1)}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* School and Class Selection Filters */}
        <div
          className="card card-padded"
          style={{ marginBottom: 12, border: "1px solid #e2e8f0", background: "#f8fafc" }}
        >
          <div style={{ fontWeight: 700, marginBottom: 12 }}>
            Filter by School & Class
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Select School</label>
              <select
                className="form-control"
                value={selectedFilterSchoolId}
                onChange={(e) => {
                  setSelectedFilterSchoolId(e.target.value);
                  setSelectedFilterClassId(""); // Reset class when school changes
                }}
              >
                <option value="">-- View All Schools --</option>
                {Object.entries(groupedStudents).map(([schoolId, schoolData]) => (
                  <option key={schoolId} value={schoolId}>
                    {schoolData.name} ({schoolData.totalStudents} students)
                  </option>
                ))}
              </select>
              <div style={{ fontSize: "0.8rem", color: "#64748b", marginTop: "4px" }}>
                Start by selecting a school to filter students
              </div>
            </div>

            {selectedFilterSchoolId && (
              <div className="form-group">
                <label className="form-label">Select Class</label>
                <select
                  className="form-control"
                  value={selectedFilterClassId}
                  onChange={(e) => setSelectedFilterClassId(e.target.value)}
                >
                  <option value="">-- All Classes in {groupedStudents[selectedFilterSchoolId]?.name} --</option>
                  {availableClasses.map((className) => {
                    const studentCount = groupedStudents[selectedFilterSchoolId]?.classes[className]?.length || 0;
                    return (
                      <option key={className} value={className}>
                        {className} ({studentCount} students)
                      </option>
                    );
                  })}
                </select>
                <div style={{ fontSize: "0.8rem", color: "#64748b", marginTop: "4px" }}>
                  {selectedFilterClassId ? `Showing students in ${selectedFilterClassId}` : "Select a class or view all classes"}
                </div>
              </div>
            )}
          </div>

          {selectedFilterSchoolId && (
            <div style={{
              padding: "12px",
              background: "#dbeafe",
              borderRadius: "8px",
              marginTop: "12px",
              fontSize: "0.9rem",
              color: "#1e40af"
            }}>
              Currently showing <strong>{displayedStudents.length}</strong> student{displayedStudents.length !== 1 ? "s" : ""}
              {selectedFilterClassId ? ` from ${selectedFilterClassId}` : " from all classes"}
            </div>
          )}
        </div>

        {canEditStudents && (
          <div
            className="card card-padded"
            style={{ marginBottom: 12, border: "1px solid #dbeafe" }}
          >
            <div style={{ fontWeight: 700, marginBottom: 8 }}>
              Bulk School/Class Assignment
            </div>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Assign Class</label>
                <select
                  className="form-control"
                  value={bulkClass}
                  onChange={(e) => setBulkClass(e.target.value)}
                >
                  <option value="">No class change</option>
                  {classOptions.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
              {isSuperAdmin && (
                <div className="form-group">
                  <label className="form-label">Bulk Status</label>
                  <select
                    className="form-control"
                    value={bulkStatus}
                    onChange={(e) => setBulkStatus(e.target.value)}
                  >
                    <option value="">No status change</option>
                    <option value="pending">Pending</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              )}
              {canAssignRegisteredSchool && (
                <div className="form-group">
                  <label className="form-label">Assign School</label>
                  <select
                    className="form-control"
                    value={bulkSchoolId}
                    onChange={(e) => setBulkSchoolId(e.target.value)}
                  >
                    <option value="">No school change</option>
                    <option value="__UNASSIGN__">Unassign school</option>
                    {registeredSchools.map((school) => (
                      <option key={school.id} value={String(school.id)}>
                        {school.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                className="btn btn-outline"
                type="button"
                onClick={toggleSelectAllDisplayed}
              >
                {allDisplayedSelected ? "Clear Visible Selection" : "Select All Visible"}
              </button>
              <button
                className="btn btn-blue"
                type="button"
                disabled={applyingBulk}
                onClick={applyBulkAssignments}
              >
                {applyingBulk
                  ? "Applying..."
                  : `Apply to ${selectedStudentIds.length} selected`}
              </button>
            </div>
          </div>
        )}

        {isMobile ? (
          <div className="mobile-record-list">
            {selectedFilterSchoolId ? (
              // Filtered view: show only selected school/class students
              <div>
                {displayedStudents.length > 0 ? (
                  <div key={selectedFilterSchoolId} className="school-group">
                    <div className="school-header">
                      <h3 className="school-name">{groupedStudents[selectedFilterSchoolId]?.name}</h3>
                      <span className="school-count">{displayedStudents.length} students</span>
                    </div>
                    {selectedFilterClassId ? (
                      // Show single class
                      <div className="class-group">
                        <div className="class-header">
                          <h4 className="class-name">Class {selectedFilterClassId}</h4>
                          <span className="class-count">{displayedStudents.length} students</span>
                        </div>
                        {displayedStudents.map((s, i) => (
                          <div key={s.id} className="mobile-record-card">
                            <div className="mobile-record-head">
                              <div className="mobile-record-identity">
                                <div className="mobile-record-avatar">
                                  {s.photo_url ? (
                                    <img src={s.photo_url} alt={s.full_name} />
                                  ) : (
                                    initialsFor(s.full_name)
                                  )}
                                </div>
                                <div>
                                  <div className="mobile-record-title">
                                    {i + 1}. {s.full_name}
                                  </div>
                                  <div className="mobile-record-sub">
                                    Student ID: {s.index}
                                  </div>
                                  <button className="btn btn-outline btn-sm" type="button" onClick={() => openStudentProfile(s)}>
                                    View profile
                                  </button>
                                </div>
                              </div>
                            </div>
                            <div className="mobile-record-grid">
                              <div className="mobile-record-item">
                                <label>Class</label>
                                <span>{s.class}</span>
                              </div>
                              <div className="mobile-record-item">
                                <label>School</label>
                                <span>{schoolOf(s)}</span>
                              </div>
                              <div className="mobile-record-item">
                                <label>Parent Contact</label>
                                <span>{parentContactOf(s)}</span>
                              </div>
                            </div>
                            {canEditStudents && (
                              <div className="mobile-record-actions">
                                <button
                                  className="btn btn-outline"
                                  onClick={() => toggleStudentSelection(s)}
                                >
                                  {selectedStudentIds.includes(String(s.id)) ? "Deselect" : "Select"}
                                </button>
                                <button
                                  className="btn btn-outline btn-sm record-action-btn action-edit"
                                  onClick={() => openStudentEditor(s)}
                                >
                                  Edit
                                </button>
                                <button
                                  className="btn btn-sm record-action-btn"
                                  disabled={provisioningLogins}
                                  onClick={() => provisionSelectedStudentLogins([String(s.id)])}
                                >
                                  Set Up Login
                                </button>
                                {canAssignRegisteredSchool && (
                                  <button
                                    className="btn btn-sm record-action-btn"
                                    onClick={() => openMoveStudentModal(s)}
                                    style={{ background: "#f3f4f6", borderColor: "#d1d5db", color: "#374151" }}
                                  >
                                    Move School
                                  </button>
                                )}
                                <button
                                  className="btn btn-sm record-action-btn action-delete"
                                  disabled={archivingId === s.id}
                                  onClick={() => handleArchive(s)}
                                >
                                  {archivingId === s.id ? "Archiving..." : "Archive"}
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="students-empty-state">
                        No students in this class
                      </div>
                    )}
                  </div>
                ) : (
                  // Show all classes in the selected school
                  Object.entries(groupedStudents[selectedFilterSchoolId]?.classes || {}).map(([className, classData]) => (
                    <div key={className} className="class-group">
                      <div className="class-header">
                        <h4 className="class-name">Class {className}</h4>
                        <span className="class-count">{classData.length} students</span>
                      </div>
                      {classData.map((s, i) => (
                        <div key={s.id} className="mobile-record-card">
                          <div className="mobile-record-head">
                            <div className="mobile-record-identity">
                              <div className="mobile-record-avatar">
                                {s.photo_url ? (
                                  <img src={s.photo_url} alt={s.full_name} />
                                ) : (
                                  initialsFor(s.full_name)
                                )}
                              </div>
                              <div>
                                <div className="mobile-record-title">
                                  {i + 1}. {s.full_name}
                                </div>
                                <div className="mobile-record-sub">
                                  Student ID: {s.index}
                                </div>
                                <button className="btn btn-outline btn-sm" type="button" onClick={() => openStudentProfile(s)}>
                                  View profile
                                </button>
                              </div>
                            </div>
                          </div>
                          <div className="mobile-record-grid">
                            <div className="mobile-record-item">
                              <label>Class</label>
                              <span>{s.class}</span>
                            </div>
                            <div className="mobile-record-item">
                              <label>School</label>
                              <span>{schoolOf(s)}</span>
                            </div>
                            <div className="mobile-record-item">
                              <label>Parent Contact</label>
                              <span>{parentContactOf(s)}</span>
                            </div>
                          </div>
                          {canEditStudents && (
                            <div className="mobile-record-actions">
                              <button
                                className="btn btn-outline"
                                onClick={() => toggleStudentSelection(s)}
                              >
                                {selectedStudentIds.includes(String(s.id)) ? "Deselect" : "Select"}
                              </button>
                              <button
                                className="btn btn-outline btn-sm record-action-btn action-edit"
                                onClick={() => openStudentEditor(s)}
                              >
                                Edit
                              </button>
                              <button
                                className="btn btn-sm record-action-btn"
                                disabled={provisioningLogins}
                                onClick={() => provisionSelectedStudentLogins([String(s.id)])}
                              >
                                Set Up Login
                              </button>
                              {canAssignRegisteredSchool && (
                                <button
                                  className="btn btn-sm record-action-btn"
                                  onClick={() => openMoveStudentModal(s)}
                                  style={{ background: "#f3f4f6", borderColor: "#d1d5db", color: "#374151" }}
                                >
                                  Move School
                                </button>
                              )}
                              <button
                                className="btn btn-sm record-action-btn action-delete"
                                disabled={archivingId === s.id}
                                onClick={() => handleArchive(s)}
                              >
                                {archivingId === s.id ? "Archiving..." : "Archive"}
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            ) : (
              // Default view: show all schools grouped
              Object.entries(groupedStudents).map(([schoolId, schoolData]) => (
                <div key={schoolId} className="school-group">
                  <div className="school-header">
                    <h3 className="school-name">{schoolData.name}</h3>
                    <span className="school-count">{schoolData.totalStudents} students</span>
                  </div>
                  {Object.entries(schoolData.classes).map(([className, classData]) => (
                    <div key={className} className="class-group">
                      <div className="class-header">
                        <h4 className="class-name">Class {className}</h4>
                        <span className="class-count">{classData.length} students</span>
                      </div>
                      {classData.map((s, i) => (
                        <div key={s.id} className="mobile-record-card">
                          <div className="mobile-record-head">
                            <div className="mobile-record-identity">
                              <div className="mobile-record-avatar">
                                {s.photo_url ? (
                                  <img src={s.photo_url} alt={s.full_name} />
                                ) : (
                                  initialsFor(s.full_name)
                                )}
                              </div>
                              <div>
                                <div className="mobile-record-title">
                                  {i + 1}. {s.full_name}
                                </div>
                                <div className="mobile-record-sub">
                                  Student ID: {s.index}
                                </div>
                                <button className="btn btn-outline btn-sm" type="button" onClick={() => openStudentProfile(s)}>
                                  View profile
                                </button>
                              </div>
                            </div>
                          </div>
                          <div className="mobile-record-grid">
                            <div className="mobile-record-item">
                              <label>Class</label>
                              <span>{s.class}</span>
                            </div>
                            <div className="mobile-record-item">
                              <label>School</label>
                              <span>{schoolOf(s)}</span>
                            </div>
                            <div className="mobile-record-item">
                              <label>Parent Contact</label>
                              <span>{parentContactOf(s)}</span>
                            </div>
                          </div>
                          {canEditStudents && (
                            <div className="mobile-record-actions">
                              <button
                                className="btn btn-outline"
                                onClick={() => toggleStudentSelection(s)}
                              >
                                {selectedStudentIds.includes(String(s.id)) ? "Deselect" : "Select"}
                              </button>
                              <button
                                className="btn btn-outline btn-sm record-action-btn action-edit"
                                onClick={() => openStudentEditor(s)}
                              >
                                Edit
                              </button>
                              <button
                                className="btn btn-sm record-action-btn"
                                disabled={provisioningLogins}
                                onClick={() => provisionSelectedStudentLogins([String(s.id)])}
                              >
                                Set Up Login
                              </button>
                              {canAssignRegisteredSchool && (
                                <button
                                  className="btn btn-sm record-action-btn"
                                  onClick={() => openMoveStudentModal(s)}
                                  style={{ background: "#f3f4f6", borderColor: "#d1d5db", color: "#374151" }}
                                >
                                  Move School
                                </button>
                              )}
                              <button
                                className="btn btn-sm record-action-btn action-delete"
                                disabled={archivingId === s.id}
                                onClick={() => handleArchive(s)}
                              >
                                {archivingId === s.id ? "Archiving..." : "Archive"}
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))
            )}
            {!filtered.length && (
              <div className="students-empty-state">
                No students match the current search. Try a different name or
                student ID.
              </div>
            )}
          </div>
        ) : (
          <div className="card students-table-card">
            <div className="students-table-head">
              <div>
                <div className="students-table-title">Admissions ledger</div>
                <div className="students-table-sub">
                  {selectedFilterSchoolId
                    ? `${selectedFilterClassId ? `${selectedFilterClassId} - ` : ''}${groupedStudents[selectedFilterSchoolId]?.name} (${displayedStudents.length} visible record${displayedStudents.length === 1 ? "" : "s"})`
                    : `Students grouped by school and class (${filtered.length} visible record${filtered.length === 1 ? "" : "s"})`
                  }
                </div>
              </div>
              <div className="students-table-status">
                {pendingCount} pending review
              </div>
            </div>
            <div className="table-wrap">
              {selectedFilterSchoolId ? (
                // Filtered view: show only selected school/class
                <div key={selectedFilterSchoolId} className="school-group">
                  <div className="school-header">
                    <h3 className="school-name">{groupedStudents[selectedFilterSchoolId]?.name}</h3>
                    <span className="school-count">{displayedStudents.length} students</span>
                  </div>

                  {selectedFilterClassId ? (
                    // Show single class table
                    <div className="class-group">
                      <div className="class-header">
                        <h4 className="class-name">Class: {selectedFilterClassId}</h4>
                        <span className="class-count">{displayedStudents.length} students</span>
                      </div>

                      <table className="students-table">
                        <thead>
                          <tr>
                            {canEditStudents && (
                              <th>
                                <input
                                  type="checkbox"
                                  checked={displayedStudents.every(s => selectedStudentIds.includes(String(s.id)))}
                                  onChange={() => {
                                    const displayedIds = displayedStudents.map(s => String(s.id));
                                    const allSelected = displayedIds.every(id => selectedStudentIds.includes(id));
                                    if (allSelected) {
                                      setSelectedStudentIds(current => current.filter(id => !displayedIds.includes(id)));
                                    } else {
                                      setSelectedStudentIds(current => [
                                        ...current.filter(id => !displayedIds.includes(id)),
                                        ...displayedIds
                                      ]);
                                    }
                                  }}
                                />
                              </th>
                            )}
                            <th>#</th>
                            <th data-col="photo">
                              <span className="students-th-label">Photo</span>
                            </th>
                            <th data-col="name">
                              <span className="students-th-label">Name</span>
                            </th>
                            <th data-col="student-id">
                              <span className="students-th-label">Student ID</span>
                            </th>
                            <th data-col="parent-contact">
                              <span className="students-th-label">Parent Contact</span>
                            </th>
                            {canEditStudents && (
                              <th>
                                <span className="students-th-label">Actions</span>
                              </th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {displayedStudents.map((s, i) => (
                            <tr key={s.id}>
                              {canEditStudents && (
                                <td>
                                  <input
                                    type="checkbox"
                                    checked={selectedStudentIds.includes(String(s.id))}
                                    onChange={() => toggleStudentSelection(s)}
                                  />
                                </td>
                              )}
                              <td>{i + 1}</td>
                              <td>
                                {s.photo_url ? (
                                  <img
                                    src={s.photo_url}
                                    alt={s.full_name}
                                    className="students-avatar"
                                  />
                                ) : (
                                  <div className="students-avatar-placeholder">
                                    {initialsFor(s.full_name)}
                                  </div>
                                )}
                              </td>
                              <td className="students-name-cell">
                                <strong>{s.full_name}</strong>
                                <span>Status: {s.status || "pending"}</span>
                                <button className="btn btn-outline btn-sm" type="button" onClick={() => openStudentProfile(s)}>
                                  View profile
                                </button>
                              </td>
                              <td className="students-id-cell">{s.index}</td>
                              <td>{parentContactOf(s)}</td>
                              {canEditStudents && (
                                <td>
                                  <div className="record-action-group">
                                    <button
                                      className="btn btn-sm record-action-btn action-edit"
                                      onClick={() => openStudentEditor(s)}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      className="btn btn-sm record-action-btn"
                                      disabled={provisioningLogins}
                                      onClick={() => provisionSelectedStudentLogins([String(s.id)])}
                                    >
                                      Set Up Login
                                    </button>
                                    {canAssignRegisteredSchool && (
                                      <button
                                        className="btn btn-sm record-action-btn"
                                        onClick={() => openMoveStudentModal(s)}
                                        style={{ background: "#f3f4f6", borderColor: "#d1d5db", color: "#374151" }}
                                      >
                                        Move School
                                      </button>
                                    )}
                                    <button
                                      className="btn btn-sm record-action-btn action-delete"
                                      disabled={archivingId === s.id}
                                      onClick={() => handleArchive(s)}
                                    >
                                      {archivingId === s.id ? "Archiving..." : "Archive"}
                                    </button>
                                  </div>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    // Show all classes in selected school - stacked tables
                    Object.entries(groupedStudents[selectedFilterSchoolId]?.classes || {}).map(([className, classStudents]) => (
                      <div key={className} className="class-group">
                        <div className="class-header">
                          <h4 className="class-name">Class: {className}</h4>
                          <span className="class-count">{classStudents.length} students</span>
                        </div>

                        <table className="students-table">
                          <thead>
                            <tr>
                              {canEditStudents && (
                                <th>
                                  <input
                                    type="checkbox"
                                    checked={classStudents.every(s => selectedStudentIds.includes(String(s.id)))}
                                    onChange={() => {
                                      const classStudentIds = classStudents.map(s => String(s.id));
                                      const allSelected = classStudentIds.every(id => selectedStudentIds.includes(id));
                                      if (allSelected) {
                                        setSelectedStudentIds(current => current.filter(id => !classStudentIds.includes(id)));
                                      } else {
                                        setSelectedStudentIds(current => [
                                          ...current.filter(id => !classStudentIds.includes(id)),
                                          ...classStudentIds
                                        ]);
                                      }
                                    }}
                                  />
                                </th>
                              )}
                              <th>#</th>
                              <th data-col="photo">
                                <span className="students-th-label">Photo</span>
                              </th>
                              <th data-col="name">
                                <span className="students-th-label">Name</span>
                              </th>
                              <th data-col="student-id">
                                <span className="students-th-label">Student ID</span>
                              </th>
                              <th data-col="parent-contact">
                                <span className="students-th-label">Parent Contact</span>
                              </th>
                              {canEditStudents && (
                                <th>
                                  <span className="students-th-label">Actions</span>
                                </th>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {classStudents.map((s, i) => (
                              <tr key={s.id}>
                                {canEditStudents && (
                                  <td>
                                    <input
                                      type="checkbox"
                                      checked={selectedStudentIds.includes(String(s.id))}
                                      onChange={() => toggleStudentSelection(s)}
                                    />
                                  </td>
                                )}
                                <td>{i + 1}</td>
                                <td>
                                  {s.photo_url ? (
                                    <img
                                      src={s.photo_url}
                                      alt={s.full_name}
                                      className="students-avatar"
                                    />
                                  ) : (
                                    <div className="students-avatar-placeholder">
                                      {initialsFor(s.full_name)}
                                    </div>
                                  )}
                                </td>
                                <td className="students-name-cell">
                                  <strong>{s.full_name}</strong>
                                  <span>Status: {s.status || "pending"}</span>
                                  <button className="btn btn-outline btn-sm" type="button" onClick={() => openStudentProfile(s)}>
                                    View profile
                                  </button>
                                </td>
                                <td className="students-id-cell">{s.index}</td>
                                <td>{parentContactOf(s)}</td>
                                {canEditStudents && (
                                  <td>
                                    <div className="record-action-group">
                                      <button
                                        className="btn btn-sm record-action-btn action-edit"
                                        onClick={() => openStudentEditor(s)}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        className="btn btn-sm record-action-btn"
                                        disabled={provisioningLogins}
                                        onClick={() => provisionSelectedStudentLogins([String(s.id)])}
                                      >
                                        Set Up Login
                                      </button>
                                      {canAssignRegisteredSchool && (
                                        <button
                                          className="btn btn-sm record-action-btn"
                                          onClick={() => openMoveStudentModal(s)}
                                          style={{ background: "#f3f4f6", borderColor: "#d1d5db", color: "#374151" }}
                                        >
                                          Move School
                                        </button>
                                      )}
                                      <button
                                        className="btn btn-sm record-action-btn action-delete"
                                        disabled={archivingId === s.id}
                                        onClick={() => handleArchive(s)}
                                      >
                                        {archivingId === s.id ? "Archiving..." : "Archive"}
                                      </button>
                                    </div>
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                // Default view: show all schools and classes
                Object.entries(groupedStudents).map(([schoolId, schoolData]) => (
                  <div key={schoolId} className="school-group">
                    <div className="school-header">
                      <h3 className="school-name">{schoolData.name}</h3>
                      <span className="school-count">
                        {Object.values(schoolData.classes).reduce((total, classStudents) => total + classStudents.length, 0)} students
                      </span>
                    </div>

                    {Object.entries(schoolData.classes).map(([className, classStudents]) => (
                      <div key={className} className="class-group">
                        <div className="class-header">
                          <h4 className="class-name">Class: {className}</h4>
                          <span className="class-count">{classStudents.length} students</span>
                        </div>

                        <table className="students-table">
                          <thead>
                            <tr>
                              {canEditStudents && (
                                <th>
                                  <input
                                    type="checkbox"
                                    checked={classStudents.every(s => selectedStudentIds.includes(String(s.id)))}
                                    onChange={() => {
                                      const classStudentIds = classStudents.map(s => String(s.id));
                                      const allSelected = classStudentIds.every(id => selectedStudentIds.includes(id));
                                      if (allSelected) {
                                        setSelectedStudentIds(current => current.filter(id => !classStudentIds.includes(id)));
                                      } else {
                                        setSelectedStudentIds(current => [
                                          ...current.filter(id => !classStudentIds.includes(id)),
                                          ...classStudentIds
                                        ]);
                                      }
                                    }}
                                  />
                                </th>
                              )}
                              <th>#</th>
                              <th data-col="photo">
                                <span className="students-th-label">Photo</span>
                              </th>
                              <th data-col="name">
                                <span className="students-th-label">Name</span>
                              </th>
                              <th data-col="student-id">
                                <span className="students-th-label">Student ID</span>
                              </th>
                              <th data-col="parent-contact">
                                <span className="students-th-label">Parent Contact</span>
                              </th>
                              {canEditStudents && (
                                <th>
                                  <span className="students-th-label">Actions</span>
                                </th>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {classStudents.map((s, i) => (
                              <tr key={s.id}>
                                {canEditStudents && (
                                  <td>
                                    <input
                                      type="checkbox"
                                      checked={selectedStudentIds.includes(String(s.id))}
                                      onChange={() => toggleStudentSelection(s)}
                                    />
                                  </td>
                                )}
                                <td>{i + 1}</td>
                                <td>
                                  {s.photo_url ? (
                                    <img
                                      src={s.photo_url}
                                      alt={s.full_name}
                                      className="students-avatar"
                                    />
                                  ) : (
                                    <div className="students-avatar-placeholder">
                                      {initialsFor(s.full_name)}
                                    </div>
                                  )}
                                </td>
                                <td className="students-name-cell">
                                  <strong>{s.full_name}</strong>
                                  <span>Status: {s.status || "pending"}</span>
                                  <button className="btn btn-outline btn-sm" type="button" onClick={() => openStudentProfile(s)}>
                                    View profile
                                  </button>
                                </td>
                                <td className="students-id-cell">{s.index}</td>
                                <td>{parentContactOf(s)}</td>
                                {canEditStudents && (
                                  <td>
                                    <div className="record-action-group">
                                      <button
                                        className="btn btn-sm record-action-btn action-edit"
                                        onClick={() => openStudentEditor(s)}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        className="btn btn-sm record-action-btn"
                                        disabled={provisioningLogins}
                                        onClick={() => provisionSelectedStudentLogins([String(s.id)])}
                                      >
                                        Set Up Login
                                      </button>
                                      {canAssignRegisteredSchool && (
                                        <button
                                          className="btn btn-sm record-action-btn"
                                          onClick={() => openMoveStudentModal(s)}
                                          style={{ background: "#f3f4f6", borderColor: "#d1d5db", color: "#374151" }}
                                        >
                                          Move School
                                        </button>
                                      )}
                                      <button
                                        className="btn btn-sm record-action-btn action-delete"
                                        disabled={archivingId === s.id}
                                        onClick={() => handleArchive(s)}
                                      >
                                        {archivingId === s.id ? "Archiving..." : "Archive"}
                                      </button>
                                    </div>
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                ))
              )}

              {!filtered.length && (
                <div className="students-empty-state" style={{ margin: 16 }}>
                  No students match the current search. Try a different name or
                  student ID.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <StudentEditorModal
        open={!!editingStudent}
        title="Edit Student"
        draft={studentDraft}
        saving={savingStudent}
        onChange={(key, value) =>
          setStudentDraft((current) => ({ ...current, [key]: value }))
        }
        onClose={() => !savingStudent && setEditingStudent(null)}
        onSave={saveStudentEdit}
        registeredSchools={registeredSchools}
        canAssignRegisteredSchool={canAssignRegisteredSchool}
      />
      {canAssignRegisteredSchool && movingStudent && (
        <div className="modal-backdrop" onClick={() => !savingMove && setMovingStudent(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <div className="modal-title">Move Student to School</div>
                <div className="modal-sub">
                  Reassign {movingStudent?.full_name} to a registered school
                </div>
              </div>
              <button className="modal-close" onClick={() => !savingMove && setMovingStudent(null)}>
                X
              </button>
            </div>
            <div className="form-grid">
              <div className="form-group full">
                <label className="form-label">Registered School</label>
                <select
                  className="form-control"
                  value={movingSchoolId}
                  onChange={(e) => setMovingSchoolId(e.target.value)}
                  disabled={savingMove}
                >
                  <option value="">-- Unassign from all schools --</option>
                  {registeredSchools.map((school) => (
                    <option key={school.id} value={String(school.id)}>
                      {school.name}
                      {school.region ? ` (${school.region})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-outline"
                onClick={() => setMovingStudent(null)}
                disabled={savingMove}
              >
                Cancel
              </button>
              <button className="btn btn-blue" onClick={saveMoveStudent} disabled={savingMove}>
                {savingMove ? "Moving..." : "Move Student"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
