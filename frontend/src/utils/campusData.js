import { getGrade } from "../config/campusConfig.js";

export function isProfilesTableMissingError(error) {
  if (!error) return false;
  const msg = String(error.message || "").toLowerCase();
  return error.status === 404 || error.code === "PGRST205" || error.code === "42P01" || msg.includes("profiles");
}

export function isMissingTableError(error, tableName = "") {
  if (!error) return false;
  const msg = String(error.message || "").toLowerCase();
  const target = String(tableName || "").toLowerCase();
  return error.status === 404
    || error.code === "PGRST205"
    || error.code === "42P01"
    || msg.includes("could not find the table")
    || (target && msg.includes(target));
}

export function isMissingColumnError(error) {
  if (!error) return false;
  const msg = String(error.message || "").toLowerCase();
  return error.code === "PGRST204" || error.code === "42703" || msg.includes("column");
}

export function normalizeSchoolRow(s, i = 0) {
  return {
    id: s?.id ?? i + 1,
    name: s?.name || s?.school_name || "Unnamed School",
    location: s?.location || s?.district || "",
    region: s?.region || "Unknown",
    category: String(s?.category || "C"),
    type: s?.type || s?.school_type || "Mixed",
    active: typeof s?.active === "boolean" ? s.active : true,
    cutoff: Number(s?.cutoff ?? s?.cut_off ?? 0),
    slots: Number(s?.slots ?? s?.capacity ?? 0),
  };
}

export function resolveStudentPhotoUrl(student) {
  if (!student || typeof student !== "object") return "";
  const candidates = [
    student.photo_url,
    student.profile_photo_url,
    student.avatar_url,
    student.image_url,
    student.profile_image,
    student.profile_picture,
    student.picture_url,
    student.photo,
    student.avatar,
  ];
  const selected = candidates.find((value) => typeof value === "string" && value.trim());
  return selected ? selected.trim() : "";
}

export function sortSchoolsByCategory(schools) {
  const order = { A: 0, B: 1, C: 2 };
  return [...schools].sort((left, right) => {
    const categoryDiff = (order[left?.category] ?? 99) - (order[right?.category] ?? 99);
    if (categoryDiff !== 0) return categoryDiff;
    return String(left?.name || "").localeCompare(String(right?.name || ""));
  });
}

export function sortStudentsByIndex(students) {
  return [...(students || [])].sort((left, right) => {
    const leftIndex = String(left?.index || left?.index_number || "").trim();
    const rightIndex = String(right?.index || right?.index_number || "").trim();
    const leftNumber = Number(leftIndex);
    const rightNumber = Number(rightIndex);
    const leftIsNumeric = Number.isFinite(leftNumber) && leftIndex !== "";
    const rightIsNumeric = Number.isFinite(rightNumber) && rightIndex !== "";

    if (leftIsNumeric && rightIsNumeric && leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }

    return leftIndex.localeCompare(rightIndex, undefined, { numeric: true, sensitivity: "base" });
  });
}

export function sortRecordsByStudentIndex(rows) {
  return [...(rows || [])].sort((left, right) => {
    const leftIndex = String(left?.index || left?.index_number || "").trim();
    const rightIndex = String(right?.index || right?.index_number || "").trim();
    const leftNumber = Number(leftIndex);
    const rightNumber = Number(rightIndex);
    const leftIsNumeric = Number.isFinite(leftNumber) && leftIndex !== "";
    const rightIsNumeric = Number.isFinite(rightNumber) && rightIndex !== "";

    if (leftIsNumeric && rightIsNumeric && leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }

    const byIndex = leftIndex.localeCompare(rightIndex, undefined, { numeric: true, sensitivity: "base" });
    if (byIndex !== 0) return byIndex;

    return String(left?.studentName || left?.full_name || left?.user_email || "").localeCompare(
      String(right?.studentName || right?.full_name || right?.user_email || ""),
    );
  });
}

export function sortTableRowsForDisplay(tableName, rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  if (tableName === "students") return sortStudentsByIndex(rows);

  const hasStudentIndex = rows.some((row) => row && (row.index_number != null || row.index != null));
  if (hasStudentIndex) return sortRecordsByStudentIndex(rows);

  return rows;
}

export function hasRealTableError(tableInfo) {
  return !!(tableInfo?.error && tableInfo.error !== "Not loaded yet");
}

export function normalizeSelectionList(row) {
  if (!row) return [];
  const rawCandidates = [
    row.selections,
    row.selected_schools,
    row.school_choices,
    row.choices,
    row.selection_details,
  ];

  let raw = rawCandidates.find((value) => value != null) ?? [];
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = [];
    }
  }
  if (!Array.isArray(raw)) {
    if (raw && typeof raw === "object") {
      const values = Object.values(raw);
      raw = values.every((entry) => entry && typeof entry === "object") ? values : [];
    } else {
      raw = [];
    }
  }

  return raw.map((x, i) => ({
    id: x.school_id || x.id || `${i + 1}`,
    name: x.school_name || x.name || "Unknown School",
    region: x.region || "Unknown",
    category: x.category || "C",
    cutoff: Number(x.cutoff ?? x.cut_off ?? 0),
    rank: Number(x.rank ?? i + 1),
  }));
}

export function normalizeTeacherRow(teacher, i = 0) {
  return {
    id: teacher?.id ?? i + 1,
    name: teacher?.name || teacher?.full_name || "Unknown Teacher",
    role: teacher?.role || teacher?.user_role || "teacher",
    subject: teacher?.subject || teacher?.department || "General",
    class: teacher?.class || teacher?.classes || teacher?.assigned_class || "-",
    phone: teacher?.phone || teacher?.contact || "-",
    email: teacher?.email || null,
    employee_id: teacher?.employee_id || null,
    gender: teacher?.gender || null,
    date_of_birth: teacher?.date_of_birth || null,
    qualification: teacher?.qualification || null,
    hire_date: teacher?.hire_date || null,
    address: teacher?.address || null,
  };
}

export function normalizeFeeRow(fee, i = 0) {
  return {
    id: fee?.id ?? i + 1,
    student_id: fee?.student_id || fee?.studentId || null,
    index_number: fee?.index_number || fee?.index || null,
    term: fee?.term || fee?.semester || `Term ${i + 1}`,
    amount: Number(fee?.amount ?? fee?.total ?? 0),
    paid: Number(fee?.paid ?? fee?.amount_paid ?? 0),
    status: fee?.status || (Number(fee?.paid ?? 0) >= Number(fee?.amount ?? 0) ? "paid" : Number(fee?.paid ?? 0) > 0 ? "partial" : "unpaid"),
    date: fee?.date || fee?.payment_date || fee?.updated_at || fee?.created_at || null,
    created_at: fee?.created_at || null,
    updated_at: fee?.updated_at || null,
  };
}

export function normalizeEventRow(event, i = 0) {
  return {
    id: event?.id ?? i + 1,
    title: event?.title || event?.name || "Untitled",
    date: event?.event_date || event?.date || event?.created_at || "",
    type: event?.type || "event",
    desc: event?.description || event?.desc || "",
  };
}

export function normalizeScoreRow(row, studentsMap, i = 0) {
  const student = studentsMap.get(String(row?.student_id || "")) || studentsMap.get(String(row?.index_number || "")) || null;
  return {
    id: row?.id ?? i + 1,
    studentName: student?.full_name || row?.student_name || "Student",
    index: row?.index_number || student?.index || student?.index_number || "-",
    className: student?.class || student?.class_name || "-",
    subject: row?.subject || "General",
    score: Number(row?.score ?? 0),
    examType: row?.exam_type || "test",
    term: row?.term || "-",
  };
}

export function normalizeResultRow(row, studentsMap, i = 0) {
  const student = studentsMap.get(String(row?.student_id || "")) || studentsMap.get(String(row?.index_number || "")) || null;
  return {
    id: row?.id ?? i + 1,
    studentName: student?.full_name || row?.student_name || "Student",
    index: row?.index_number || student?.index || student?.index_number || "-",
    averageScore: Number(row?.average_score ?? 0),
    aggregate: Number(row?.aggregate ?? student?.aggregate ?? 0),
    grade: row?.grade || getGrade(Number(row?.average_score ?? 0)).grade,
    rank: Number(row?.rank ?? i + 1),
    term: row?.term || "-",
    remarks: row?.remarks || "",
  };
}

export function summarizeSelectionRecord(row, studentsMap) {
  const picks = normalizeSelectionList(row);
  const student = studentsMap.get(String(row?.student_id || "")) || studentsMap.get(String(row?.index_number || "")) || null;
  const first = picks[0] || null;
  const second = picks[1] || null;
  const isApproved = !!row?.approved || String(row?.status || "").toLowerCase() === "confirmed";
  const normalizedStatus = isApproved ? "confirmed" : String(row?.status || "pending").toLowerCase();
  const hasStudentId = row?.student_id != null && String(row.student_id).trim() !== "";
  const hasIndexNumber = row?.index_number != null && String(row.index_number).trim() !== "";
  const hasEmail = row?.user_email != null && String(row.user_email).trim() !== "";
  const hasStudentName = row?.student_name != null && String(row.student_name).trim() !== "";
  const matchSource = hasStudentId
    ? "student_id"
    : hasIndexNumber
      ? "index_number"
      : hasEmail
        ? "user_email"
        : hasStudentName
          ? "student_name"
          : "unknown";
  const parseStatus = picks.length > 0 ? "ok" : "no_picks";
  return {
    id: row?.id,
    studentName: student?.full_name || student?.name || row?.student_name || row?.user_email || "Student",
    user_email: row?.user_email || student?.email || ((student?.full_name || student?.name) && student?.index ? `${student?.full_name || student?.name} (${student?.index})` : "Student"),
    index_number: row?.index_number || student?.index || student?.index_number || "-",
    aggregate: row?.aggregate ?? student?.aggregate ?? "-",
    first: first?.name || "-",
    second: second?.name || "-",
    placedAt: first?.name || "-",
    category: first?.category || "C",
    reviewedAt: row?.reviewed_at || row?.updated_at || row?.created_at || null,
    status: normalizedStatus,
    approved: isApproved,
    selection_count: picks.length,
    match_source: matchSource,
    parse_status: parseStatus,
    rawRow: row,
  };
}

export function resolveActivityTimestamp(...values) {
  for (const value of values) {
    if (!value) continue;
    const time = new Date(value).getTime();
    if (Number.isFinite(time)) return time;
  }
  return null;
}

export function formatActivityTime(value) {
  const time = resolveActivityTimestamp(value);
  if (time == null) return "";

  const diffMs = Date.now() - time;
  const absDiffMs = Math.abs(diffMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (absDiffMs < hour) {
    const minutes = Math.max(1, Math.round(absDiffMs / minute));
    return diffMs >= 0 ? `${minutes}m ago` : `in ${minutes}m`;
  }
  if (absDiffMs < day) {
    const hours = Math.max(1, Math.round(absDiffMs / hour));
    return diffMs >= 0 ? `${hours}h ago` : `in ${hours}h`;
  }
  if (absDiffMs < 7 * day) {
    const days = Math.max(1, Math.round(absDiffMs / day));
    return diffMs >= 0 ? `${days}d ago` : `in ${days}d`;
  }
  return new Date(time).toLocaleDateString();
}

export function buildRecentActivity({ students, selections, fees, events }) {
  const items = [];

  (students || []).forEach((student) => {
    const timestamp = resolveActivityTimestamp(student?.created_at, student?.updated_at);
    if (timestamp == null) return;
    items.push({
      id: `student-${student?.id || student?.index || Math.random()}`,
      text: `New student enrolled: ${student?.full_name || student?.name || "Student"}`,
      time: timestamp,
      dot: "#1d4ed8",
    });
  });

  (selections || []).forEach((selection) => {
    const timestamp = resolveActivityTimestamp(selection?.reviewedAt, selection?.reviewed_at, selection?.updated_at, selection?.created_at);
    if (timestamp == null) return;
    const approved = String(selection?.status || "").toLowerCase() === "confirmed" || !!selection?.approved;
    items.push({
      id: `selection-${selection?.id || selection?.index_number || Math.random()}`,
      text: approved
        ? `${selection?.studentName || "Student"} placement confirmed`
        : `${selection?.studentName || "Student"} submitted school selection`,
      time: timestamp,
      dot: approved ? "#16a34a" : "#d97706",
    });
  });

  (fees || []).forEach((fee) => {
    const timestamp = resolveActivityTimestamp(fee?.date, fee?.updated_at, fee?.created_at);
    if (timestamp == null || Number(fee?.paid || 0) <= 0) return;
    items.push({
      id: `fee-${fee?.id || fee?.index_number || Math.random()}`,
      text: `Fee payment recorded for ${fee?.index_number || fee?.term || "student"}`,
      time: timestamp,
      dot: "#0f9f6e",
    });
  });

  (events || []).forEach((event) => {
    const timestamp = resolveActivityTimestamp(event?.updated_at, event?.created_at);
    if (timestamp == null) return;
    items.push({
      id: `event-${event?.id || Math.random()}`,
      text: `Event updated: ${event?.title || event?.name || "Untitled event"}`,
      time: timestamp,
      dot: "#7c3aed",
    });
  });

  return items
    .sort((left, right) => right.time - left.time)
    .slice(0, 4)
    .map((item) => ({ ...item, timeLabel: formatActivityTime(item.time) }));
}

export async function fetchStudentSelection({ supabase, userEmail, studentData }) {
  if (!supabase) return null;

  const runLatestSelection = async (builder) => {
    const { data, error } = await builder.limit(1);
    if (error) return { data: null, error };
    if (Array.isArray(data)) return { data: data[0] || null, error: null };
    return { data: data || null, error: null };
  };

  const normalizedEmail = String(userEmail || "").trim().toLowerCase();
  const normalizedIndex = String(studentData?.index_number || studentData?.index || "").trim();
  const normalizedName = String(studentData?.full_name || studentData?.name || "").trim();
  const tries = [];
  if (studentData?.id) {
    tries.push(() => runLatestSelection(supabase.from("school_selections").select("*").eq("student_id", studentData.id).order("created_at", { ascending: false })));
    tries.push(() => runLatestSelection(supabase.from("school_selections").select("*").eq("student_id", String(studentData.id)).order("created_at", { ascending: false })));
  }
  if (normalizedIndex) {
    tries.push(() => runLatestSelection(supabase.from("school_selections").select("*").eq("index_number", normalizedIndex).order("created_at", { ascending: false })));
    // Some datasets keep index in different column names.
    tries.push(() => runLatestSelection(supabase.from("school_selections").select("*").eq("index", normalizedIndex).order("created_at", { ascending: false })));
    tries.push(() => runLatestSelection(supabase.from("school_selections").select("*").eq("index_no", normalizedIndex).order("created_at", { ascending: false })));
  }
  if (normalizedEmail) {
    tries.push(() => runLatestSelection(supabase.from("school_selections").select("*").eq("user_email", normalizedEmail).order("created_at", { ascending: false })));
    tries.push(() => runLatestSelection(supabase.from("school_selections").select("*").ilike("user_email", normalizedEmail).order("created_at", { ascending: false })));
  }
  if (normalizedName) {
    tries.push(() => runLatestSelection(supabase.from("school_selections").select("*").eq("student_name", normalizedName).order("created_at", { ascending: false })));
    tries.push(() => runLatestSelection(supabase.from("school_selections").select("*").ilike("student_name", normalizedName).order("created_at", { ascending: false })));
  }

  for (const run of tries) {
    const { data, error } = await run();
    if (error) {
      if (isMissingColumnError(error)) continue;
      continue;
    }
    if (data) return data;
  }
  return null;
}
