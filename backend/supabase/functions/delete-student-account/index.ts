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
    return respond({ error: "Student account deletion is not configured." }, 500);
  }

  let body: { student_id?: unknown; self_delete?: unknown; mode?: unknown };
  try {
    body = await request.json();
  } catch {
    return respond({ error: "Request body must be valid JSON." }, 400);
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
    return respond({ error: "Sign in to continue." }, 401);
  }

  const { data: actorProfile, error: actorProfileError } = await serviceClient
    .from("profiles")
    .select("role, registered_school_id")
    .eq("id", actor.id)
    .maybeSingle();

  if (actorProfileError) {
    return respond({ error: "Could not verify access permissions." }, 500);
  }

  const requestedStudentId = typeof body.student_id === "string" ? body.student_id.trim() : "";
  const selfDeleteRequested = body.self_delete === true || body.mode === "self";
  const isAdmin = ["admin", "school_admin"].includes(actorProfile?.role || "");

  const resolveStudentId = async () => {
    if (!selfDeleteRequested && requestedStudentId) {
      return requestedStudentId;
    }
    const { data: student, error: studentError } = await serviceClient
      .from("students")
      .select("id")
      .eq("auth_user_id", actor.id)
      .maybeSingle();
    if (studentError) throw new Error("Could not find your linked student record.");
    if (!student) throw new Error("No linked student account was found.");
    return student.id;
  };

  let studentId: string;
  try {
    studentId = await resolveStudentId();
  } catch (error) {
    return respond({ error: error instanceof Error ? error.message : "Your student account could not be resolved." }, 400);
  }

  if (!selfDeleteRequested && !isAdmin) {
    return respond({ error: "Only administrators can delete other student accounts." }, 403);
  }

  const { data: student, error: studentFetchError } = await serviceClient
    .from("students")
    .select("id, auth_user_id, registered_school_id, full_name, index_number, index")
    .eq("id", studentId)
    .maybeSingle();
  if (studentFetchError) {
    return respond({ error: "The student record could not be loaded for deletion." }, 500);
  }
  if (!student) {
    return respond({ error: "The requested student was not found." }, 404);
  }

  if (actorProfile && actorProfile.role === "school_admin") {
    if (String(student.registered_school_id) !== String(actorProfile.registered_school_id)) {
      return respond({ error: "You can only delete students from your assigned school." }, 403);
    }
  }

  if (selfDeleteRequested && student.auth_user_id && student.auth_user_id !== actor.id) {
    return respond({ error: "This student record is not linked to your current account." }, 403);
  }

  const targetAuthUserId = student.auth_user_id || actor.id;

  try {
    if (targetAuthUserId) {
      const { error: authDeleteError } = await serviceClient.auth.admin.deleteUser(targetAuthUserId);
      if (authDeleteError) {
        console.warn("Could not delete auth user for student delete flow:", authDeleteError);
      }
    }
  } catch (error) {
    console.warn("Auth user cleanup warning during student account delete:", error);
  }

  const { error: profileDeleteError } = await serviceClient
    .from("profiles")
    .delete()
    .eq("id", targetAuthUserId);

  if (profileDeleteError) {
    console.warn("Profile cleanup warning during student account deletion:", profileDeleteError);
  }

  const { error: studentDeleteError } = await serviceClient
    .from("students")
    .delete()
    .eq("id", student.id);

  if (studentDeleteError) {
    return respond({ error: studentDeleteError.message || "The student record could not be deleted." }, 500);
  }

  return respond({
    status: "deleted",
    student_id: student.id,
    auth_user_id: targetAuthUserId,
  }, 200);
});
