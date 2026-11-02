import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const findAuthUserByEmail = async (serviceClient: ReturnType<typeof createClient>, email: string) => {
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await serviceClient.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw new Error("Could not check for an existing login.");
    const existingUser = data.users.find(
      (user) => user.email?.toLowerCase() === email.toLowerCase(),
    );
    if (existingUser) return existingUser;
    if (data.users.length < 1000) break;
  }
  return null;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return respond({ error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) {
    return respond({ error: "Student login provisioning is not configured." }, 500);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user: actor },
    error: actorError,
  } = await userClient.auth.getUser();
  if (actorError || !actor) {
    return respond({ error: "Sign in with an authorized staff account." }, 401);
  }

  const { data: actorProfile, error: actorProfileError } = await serviceClient
    .from("profiles")
    .select("role, registered_school_id")
    .eq("id", actor.id)
    .maybeSingle();
  if (actorProfileError) {
    return respond({ error: "Could not verify staff permissions." }, 500);
  }
  if (!actorProfile || !["admin", "school_admin"].includes(actorProfile.role)) {
    return respond({ error: "Only administrators can provision student logins." }, 403);
  }

  let body: { student_id?: unknown; student_ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return respond({ error: "Request body must be valid JSON." }, 400);
  }

  const requestedIds = Array.isArray(body.student_ids)
    ? body.student_ids
    : [body.student_id];
  const studentIds = [...new Set(
    requestedIds
      .filter((id): id is string => typeof id === "string")
      .map((id) => id.trim())
      .filter(Boolean),
  )];
  if (!studentIds.length || studentIds.length > 100) {
    return respond({ error: "Provide between 1 and 100 student record IDs." }, 400);
  }

  const results: Array<{ student_id: string; status: string; message?: string }> = [];
  for (const studentId of studentIds) {
    try {
      const { data: student, error: studentError } = await serviceClient
        .from("students")
        .select(
          "id, index_number, index, full_name, parent_contact, registered_school_id, auth_user_id",
        )
        .eq("id", studentId)
        .maybeSingle();
      if (studentError) throw new Error("Could not load student record.");
      if (!student) throw new Error("Student record was not found.");
      if (
        actorProfile.role === "school_admin" &&
        String(student.registered_school_id) !==
          String(actorProfile.registered_school_id)
      ) {
        throw new Error("Student is outside your school.");
      }

      const index = String(student.index_number || student.index || "").trim();
      if (!/^\d{12}$/.test(index)) {
        throw new Error("Student ID must be exactly 12 digits.");
      }
      const initialPassword = String(student.parent_contact || "");
      if (initialPassword.length < 6) {
        throw new Error("A parent or guardian contact of at least 6 characters is required.");
      }
      const email = `student-${index}@students.campusghana.invalid`;

      let authUserId = student.auth_user_id;
      let authUserEmail: string | null = null;
      let authUserMetadata: Record<string, unknown> = {};
      if (authUserId) {
        const { data, error } = await serviceClient.auth.admin.getUserById(authUserId);
        if (error || !data.user) {
          throw new Error("The linked Supabase Auth user could not be found.");
        }
        authUserEmail = data.user.email || null;
        authUserMetadata = data.user.user_metadata || {};
      } else {
        const { data, error } = await serviceClient.auth.admin.createUser({
          email,
          password: initialPassword,
          email_confirm: true,
          user_metadata: {
            portal_role: "student",
            campus_student_password_changed: false,
          },
        });
        if (!error && data.user) {
          authUserId = data.user.id;
          authUserEmail = data.user.email || email;
          authUserMetadata = data.user.user_metadata || {};
        } else {
          const existingUser = await findAuthUserByEmail(serviceClient, email);
          if (!existingUser) {
            throw new Error(error?.message || "Supabase Auth user could not be created.");
          }
          authUserId = existingUser.id;
          authUserEmail = existingUser.email || null;
          authUserMetadata = existingUser.user_metadata || {};
        }
      }

      const { data: linkedStudent, error: linkedStudentError } = await serviceClient
        .from("students")
        .select("id")
        .eq("auth_user_id", authUserId)
        .maybeSingle();
      if (linkedStudentError) throw new Error("Could not verify the student account link.");
      if (linkedStudent && linkedStudent.id !== student.id) {
        throw new Error("This login is already linked to a different student.");
      }
      const { data: profile, error: profileReadError } = await serviceClient
        .from("profiles")
        .select("role")
        .eq("id", authUserId)
        .maybeSingle();
      if (profileReadError) throw new Error("Could not verify the student profile.");
      if (profile && profile.role !== "student") {
        throw new Error("The linked Auth account already has a different portal role.");
      }

      const passwordChangedByStudent =
        authUserMetadata.campus_student_password_changed === true;
      if (!passwordChangedByStudent || authUserEmail?.toLowerCase() !== email.toLowerCase()) {
        const { error } = await serviceClient.auth.admin.updateUserById(authUserId, {
          email,
          email_confirm: true,
          ...(!passwordChangedByStudent ? { password: initialPassword } : {}),
          user_metadata: {
            ...authUserMetadata,
            ...(!passwordChangedByStudent
              ? { campus_student_password_changed: false }
              : {}),
          },
        });
        if (error) {
          throw new Error("The student login alias or password status could not be updated.");
        }
      }

      const { error: linkError } = await serviceClient
        .from("students")
        .update({ auth_user_id: authUserId })
        .eq("id", student.id);
      if (linkError) throw new Error("The student Auth account could not be linked.");

      const { error: profileError } = await serviceClient.from("profiles").upsert(
        {
          id: authUserId,
          email,
          full_name: student.full_name || "",
          role: "student",
        },
        { onConflict: "id" },
      );
      if (profileError) throw new Error("The student portal profile could not be saved.");

      results.push({
        student_id: student.id,
        status: "ready",
        message: passwordChangedByStudent
          ? "Student login is ready. The changed password was preserved."
          : "Student login is ready. The parent/guardian contact is the initial password.",
      });
    } catch (error) {
      results.push({
        student_id: studentId,
        status: "error",
        message: error instanceof Error ? error.message : "Login provisioning failed.",
      });
    }
  }

  return respond({
    results,
    ready: results.filter((result) => result.status === "ready").length,
    failed: results.filter((result) => result.status === "error").length,
  });
});
