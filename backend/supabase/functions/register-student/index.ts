import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const allowedRegions = new Set([
  "Ahafo",
  "Ashanti",
  "Bono",
  "Bono East",
  "Central",
  "Eastern",
  "Greater Accra",
  "North East",
  "Northern",
  "Oti",
  "Savannah",
  "Upper East",
  "Upper West",
  "Volta",
  "Western",
  "Western North",
]);

const allowedClasses = new Set([
  "JHS 1",
  "JHS 2",
  "JHS 3",
  "SHS 1",
  "SHS 2",
  "SHS 3",
  "University Level 100",
  "University Level 200",
  "University Level 300",
  "University Level 400",
  "University Level 500",
  "University Level 600",
]);

const cleanText = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const logRollbackError = (action: string, error: unknown) => {
  if (error) console.error(`Student signup rollback failed (${action}):`, error);
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return respond({ error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return respond({ error: "Student account creation is not configured." }, 500);
  }

  let payload: Record<string, unknown>;
  try {
    const body = await request.text();
    if (body.length > 1_600_000) {
      return respond({ error: "The submitted photo is too large." }, 413);
    }
    payload = JSON.parse(body);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return respond({ error: "Request body must be a JSON object." }, 400);
    }
  } catch {
    return respond({ error: "Request body must be valid JSON." }, 400);
  }

  const fullName = cleanText(payload.fullName);
  const displayName = cleanText(payload.displayName);
  const institution = cleanText(payload.institution);
  const studentClass = cleanText(payload.studentClass);
  const gender = cleanText(payload.gender);
  const dateOfBirth = cleanText(payload.dateOfBirth);
  const region = cleanText(payload.region);
  const district = cleanText(payload.district);
  const contactEmail = cleanText(payload.email).toLowerCase();
  const password = typeof payload.password === "string" ? payload.password : "";
  const rawPhone = cleanText(payload.phone).replace(/[\s()-]/g, "");

  if (fullName.length < 2 || fullName.length > 120) {
    return respond({ error: "Enter a full name between 2 and 120 characters." }, 400);
  }
  if (displayName.length < 2 || displayName.length > 32) {
    return respond({ error: "Enter a display name between 2 and 32 characters." }, 400);
  }
  if (gender !== "Male" && gender !== "Female") {
    return respond({ error: "Choose Male or Female for gender." }, 400);
  }
  const parsedDateOfBirth = new Date(`${dateOfBirth}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) ||
    Number.isNaN(parsedDateOfBirth.getTime()) ||
    parsedDateOfBirth.toISOString().slice(0, 10) !== dateOfBirth ||
    dateOfBirth > new Date().toISOString().slice(0, 10)
  ) {
    return respond({ error: "Enter a valid date of birth that is not in the future." }, 400);
  }
  if (institution.length < 2 || institution.length > 180) {
    return respond({ error: "Enter an institution or school between 2 and 180 characters." }, 400);
  }
  if (!allowedClasses.has(studentClass)) {
    return respond({ error: "Choose a valid level or class." }, 400);
  }
  if (!allowedRegions.has(region) || district.length < 2 || district.length > 150) {
    return respond({ error: "Choose a valid Ghana region and district." }, 400);
  }
  if (contactEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    return respond({ error: "Enter a valid email address." }, 400);
  }
  if (!/^(?:0\d{9}|\+?233\d{9})$/.test(rawPhone)) {
    return respond({ error: "Enter a valid Ghanaian phone number." }, 400);
  }
  if (password.length < 10 || password.length > 128) {
    return respond({ error: "Choose a password with at least 10 characters." }, 400);
  }
  if (
    typeof payload.photoDataUrl !== "string" ||
    payload.photoDataUrl.length > 1_500_000
  ) {
    return respond({ error: "Choose a display photo smaller than 1 MB." }, 400);
  }

  const photoMatch = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    payload.photoDataUrl,
  );
  if (!photoMatch) {
    return respond({ error: "The display photo must be a valid JPEG image." }, 400);
  }
  let photoBytes: Uint8Array;
  try {
    const decoded = atob(photoMatch[1]);
    photoBytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return respond({ error: "The display photo could not be read." }, 400);
  }
  if (photoBytes.length === 0 || photoBytes.length > 1_048_576) {
    return respond({ error: "Choose a display photo smaller than 1 MB." }, 400);
  }
  if (photoBytes[0] !== 0xff || photoBytes[1] !== 0xd8 || photoBytes[2] !== 0xff) {
    return respond({ error: "The display photo must be a valid JPEG image." }, 400);
  }

  const normalizedPhoneDigits = rawPhone.replace(/\D/g, "");
  const phone = normalizedPhoneDigits.startsWith("0")
    ? `+233${normalizedPhoneDigits.slice(1)}`
    : `+${normalizedPhoneDigits}`;
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existingContact, error: contactLookupError } = await serviceClient
    .from("students")
    .select("id")
    .eq("contact_email", contactEmail)
    .limit(1);
  if (contactLookupError) {
    console.error("Could not check the student contact email:", contactLookupError);
    return respond({ error: "Account details could not be checked. Please try again." }, 500);
  }
  if (existingContact?.length) {
    return respond({ error: "An account already uses this email address." }, 409);
  }

  let studentIndex = "";
  let authUserId = "";
  const aliasEmailForIndex = (index: string) =>
    `student-${index}@students.campusghana.invalid`;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { data: allocatedIndex, error: allocationError } = await serviceClient.rpc(
      "allocate_student_registration_id",
      { p_region: region },
    );
    if (allocationError || typeof allocatedIndex !== "string") {
      console.error("Could not allocate a student ID:", allocationError);
      return respond({ error: "A Student ID could not be generated. Please try again." }, 500);
    }
    studentIndex = allocatedIndex;
    const { data: existingStudent, error: indexLookupError } = await serviceClient
      .from("students")
      .select("id")
      .or(`index_number.eq.${studentIndex},index.eq.${studentIndex}`)
      .limit(1);
    if (indexLookupError) {
      console.error("Could not allocate a student ID:", indexLookupError);
      return respond({ error: "A Student ID could not be generated. Please try again." }, 500);
    }
    if (existingStudent?.length) continue;

    const { data, error } = await serviceClient.auth.admin.createUser({
      email: aliasEmailForIndex(studentIndex),
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        display_name: displayName,
        portal_role: "student",
        campus_student_password_changed: true,
      },
    });
    if (!error && data.user) {
      authUserId = data.user.id;
      break;
    }
    if (error?.code === "email_exists") continue;
    console.error("Could not create the student Auth account:", error);
    return respond({
      error: error.message || "The student account could not be created. Please try again.",
    }, error.status || 500);
  }
  if (!authUserId) {
    return respond({ error: "A unique Student ID could not be generated. Please try again." }, 503);
  }

  const photoPath = `${studentIndex}/profile.jpg`;
  let photoUploaded = false;
  let profileCreated = false;
  try {
    const { error: photoError } = await serviceClient.storage
      .from("student-photos")
      .upload(photoPath, photoBytes, {
        contentType: "image/jpeg",
        upsert: false,
      });
    if (photoError) throw new Error("The display photo could not be uploaded.");
    photoUploaded = true;
    const { data: photoUrlData } = serviceClient.storage
      .from("student-photos")
      .getPublicUrl(photoPath);

    const { error: profileError } = await serviceClient.from("profiles").insert({
      id: authUserId,
      email: aliasEmailForIndex(studentIndex),
      full_name: fullName,
      display_name: displayName,
      role: "student",
    });
    if (profileError) throw new Error("The student profile could not be saved.");
    profileCreated = true;

    const { data: student, error: studentError } = await serviceClient
      .from("students")
      .insert({
        auth_user_id: authUserId,
        index_number: studentIndex,
        full_name: fullName,
        display_name: displayName,
        gender,
        date_of_birth: dateOfBirth,
        institution,
        class: studentClass,
        region,
        district,
        contact_email: contactEmail,
        personal_contact: phone,
        photo_url: photoUrlData.publicUrl,
        status: "active",
        enrolled: true,
      })
      .select("id")
      .single();
    if (studentError || !student) throw new Error("The student record could not be saved.");
    if (!student.id) throw new Error("The student record could not be saved.");
  } catch (error) {
    console.error("Student signup failed:", error);
    const { error: studentCleanupError } = await serviceClient
      .from("students")
      .delete()
      .eq("auth_user_id", authUserId);
    logRollbackError("student record", studentCleanupError);
    if (profileCreated) {
      const { error: cleanupError } = await serviceClient
        .from("profiles")
        .delete()
        .eq("id", authUserId);
      logRollbackError("profile", cleanupError);
    }
    if (photoUploaded) {
      const { error: cleanupError } = await serviceClient.storage
        .from("student-photos")
        .remove([photoPath]);
      logRollbackError("display photo", cleanupError);
    }
    const { error: authCleanupError } = await serviceClient.auth.admin.deleteUser(authUserId);
    logRollbackError("Auth account", authCleanupError);
    const message = error instanceof Error ? error.message : "The student account could not be completed.";
    return respond({ error: message }, 500);
  }

  return respond({ student_id: studentIndex }, 201);
});
