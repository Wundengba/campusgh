import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-paystack-signature",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });

const getSupabaseSettings = () => {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error("Verification payments are not configured.");
  }
  return { url, anonKey, serviceRoleKey };
};

const getPaystackSecret = () => {
  const secret = Deno.env.get("PAYSTACK_SECRET_KEY")?.trim();
  if (!secret) throw new Error("Paystack is not configured.");
  return secret;
};

const getAppUrl = () => {
  const appUrl = new URL(
    Deno.env.get("CAMPUS_APP_URL") || "https://campus-ghana.vercel.app",
  );
  if (
    appUrl.protocol !== "https:" &&
    appUrl.hostname !== "localhost" &&
    appUrl.hostname !== "127.0.0.1"
  ) {
    throw new Error("The Campus Ghana return URL must use HTTPS.");
  }
  return appUrl;
};

const getServiceClient = () => {
  const { url, serviceRoleKey } = getSupabaseSettings();
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

const getAuthenticatedUser = async (request: Request) => {
  const { url, anonKey } = getSupabaseSettings();
  const authorization = request.headers.get("Authorization");
  if (!authorization) return null;

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
};

const isValidReference = (reference: string) =>
  /^CGV-[0-9a-f]{32}$/i.test(reference);

const getPaystackTransaction = async (secret: string, reference: string) => {
  const response = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${secret}` } },
  );
  const payload = await response.json();
  if (!response.ok || payload?.status !== true || !payload?.data) {
    throw new Error("Paystack could not verify this transaction.");
  }
  return payload.data;
};

const markPaymentSetupFailed = async (
  serviceClient: ReturnType<typeof createClient>,
  paymentIntentId: string,
) => {
  const { error } = await serviceClient
    .from("student_verification_payment_intents")
    .update({ status: "payment_failed", updated_at: new Date().toISOString() })
    .eq("id", paymentIntentId)
    .eq("status", "payment_pending");
  if (error) console.error("Could not mark the payment intent as failed:", error);
};

const confirmSuccessfulPayment = async (
  serviceClient: ReturnType<typeof createClient>,
  secret: string,
  reference: string,
  failureDetails?: { reason: string },
) => {
  if (!isValidReference(reference)) return false;
  const { data: application, error: applicationError } = await serviceClient
    .from("student_verification_applications")
    .select("id, status")
    .eq("payment_reference", reference)
    .maybeSingle();
  if (applicationError) throw new Error("Could not load the verification application.");
  if (application && ["pending_review", "approved", "declined"].includes(application.status)) {
    return true;
  }

  const { data: paymentIntent, error: intentError } = await serviceClient
    .from("student_verification_payment_intents")
    .select("id, user_id, student_id, amount_pesewas, currency, status")
    .eq("payment_reference", reference)
    .maybeSingle();
  if (intentError) throw new Error("Could not load the verification payment intent.");
  if (!paymentIntent || !["payment_pending", "payment_failed"].includes(paymentIntent.status)) {
    return false;
  }

  const transaction = await getPaystackTransaction(secret, reference);
  if (
    transaction.status !== "success" ||
    transaction.reference !== reference ||
    transaction.currency !== "GHS"
  ) {
    if (failureDetails && transaction.status !== "success") {
      const gatewayReason = String(
        transaction.gateway_response || transaction.message || "",
      )
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180);
      if (gatewayReason && !/^(approved|successful)$/i.test(gatewayReason)) {
        failureDetails.reason = gatewayReason;
      }
    }
    console.info("Paystack transaction was not successful:", {
      reference,
      status: transaction.status,
    });
    return false;
  }
  if (
    Number(transaction.amount) !== paymentIntent.amount_pesewas ||
    transaction.currency !== paymentIntent.currency
  ) {
    throw new Error("The Paystack payment amount does not match the application fee.");
  }

  const transactionId = Number(transaction.id);
  const paidAt = transaction.paid_at && Number.isFinite(Date.parse(transaction.paid_at))
    ? new Date(transaction.paid_at).toISOString()
    : new Date().toISOString();
  const { data: submitted, error: submitError } = await serviceClient.rpc(
    "submit_student_verification_application",
    {
      p_payment_reference: reference,
      p_paystack_transaction_id: Number.isSafeInteger(transactionId) ? transactionId : null,
      p_paid_at: paidAt,
    },
  );
  if (submitError) {
    throw new Error("Payment succeeded, but the application could not be submitted.");
  }
  return submitted === true;
};

const handlePaystackCallback = async (request: Request) => {
  const requestUrl = new URL(request.url);
  const reference = requestUrl.searchParams.get("reference") ||
    requestUrl.searchParams.get("trxref") || "";
  let result = "not_completed";
  const failureDetails = { reason: "" };

  try {
    if (reference) {
      const paid = await confirmSuccessfulPayment(
        getServiceClient(),
        getPaystackSecret(),
        reference,
        failureDetails,
      );
      if (paid) result = "success";
    }
  } catch (error) {
    console.error("Could not confirm the Paystack callback:", error);
    result = "check_status";
  }

  const appUrl = getAppUrl();
  appUrl.searchParams.set("verification", result);
  if (isValidReference(reference)) {
    appUrl.searchParams.set("verification_reference", reference);
    if (failureDetails.reason) {
      appUrl.searchParams.set("verification_reason", failureDetails.reason);
    }
  }
  return Response.redirect(appUrl, 303);
};

const isValidPaystackSignature = async (body: string, signature: string) => {
  const secret = getPaystackSecret();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  );
  const expected = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (signature.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= signature.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
};

const handlePaystackWebhook = async (request: Request) => {
  const signature = request.headers.get("x-paystack-signature") || "";
  const rawBody = await request.text();
  if (!signature || !(await isValidPaystackSignature(rawBody, signature))) {
    return respond({ error: "Invalid Paystack signature." }, 401);
  }

  let payload: { event?: string; data?: { reference?: string } };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return respond({ error: "Paystack sent an invalid event." }, 400);
  }
  if (payload.event !== "charge.success" || !payload.data?.reference) {
    return respond({ received: true });
  }

  const paid = await confirmSuccessfulPayment(
    getServiceClient(),
    getPaystackSecret(),
    payload.data.reference,
  );
  return respond({ received: true, payment_confirmed: paid });
};

const initializePayment = async (request: Request) => {
  const actor = await getAuthenticatedUser(request);
  if (!actor) return respond({ error: "Sign in to apply for verification." }, 401);

  const serviceClient = getServiceClient();
  const { data: student, error: studentError } = await serviceClient
    .from("students")
    .select("id, status, contact_email")
    .eq("auth_user_id", actor.id)
    .maybeSingle();
  if (studentError) return respond({ error: "Could not load your student record." }, 500);
  if (!student) return respond({ error: "Only student accounts can apply for verification." }, 403);

  const isValidPaymentEmail = (email: unknown) =>
    typeof email === "string" &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    !email.trim().toLowerCase().endsWith(".invalid");
  const paymentEmail = isValidPaymentEmail(student.contact_email)
    ? String(student.contact_email).trim().toLowerCase()
    : isValidPaymentEmail(actor.email)
      ? String(actor.email).trim().toLowerCase()
      : "";
  if (!paymentEmail) {
    return respond({
      error: "Add a valid email address to your student profile before applying.",
    }, 400);
  }

  const studentStatus = String(student.status || "pending").toLowerCase();
  if (studentStatus === "confirmed") {
    return respond({ error: "Your student profile is already verified." }, 409);
  }
  if (studentStatus === "suspended") {
    return respond({ error: "Suspended accounts cannot apply for verification." }, 403);
  }

  const { data: settings, error: settingsError } = await serviceClient
    .from("student_verification_payment_settings")
    .select("fee_pesewas, currency")
    .eq("id", 1)
    .maybeSingle();
  if (settingsError) return respond({ error: "Could not load the verification fee." }, 500);
  if (!settings || settings.fee_pesewas <= 0) {
    return respond({ error: "Verification applications are not open yet." }, 409);
  }

  const { data: existingApplication, error: existingError } = await serviceClient
    .from("student_verification_applications")
    .select("status")
    .eq("user_id", actor.id)
    .eq("status", "pending_review")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) {
    return respond({ error: "Could not check your existing applications." }, 500);
  }
  if (existingApplication?.status === "pending_review") {
    return respond({ status: "pending_review" });
  }
  const { data: existingIntent, error: intentError } = await serviceClient
    .from("student_verification_payment_intents")
    .select("id, status, authorization_url, payment_reference")
    .eq("user_id", actor.id)
    .eq("status", "payment_pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (intentError) {
    return respond({ error: "Could not check your existing payment session." }, 500);
  }
  if (existingIntent?.status === "payment_pending") {
    const paymentWasReceived = await confirmSuccessfulPayment(
      serviceClient,
      getPaystackSecret(),
      existingIntent.payment_reference,
    );
    if (paymentWasReceived) {
      return respond({ status: "pending_review" });
    }
    if (existingIntent.authorization_url) {
      return respond({ authorization_url: existingIntent.authorization_url });
    }
    return respond({ error: "Your payment session is being prepared. Try again shortly." }, 409);
  }

  const paymentReference = `CGV-${crypto.randomUUID().replace(/-/g, "")}`;
  const { data: paymentIntent, error: insertError } = await serviceClient
    .from("student_verification_payment_intents")
    .insert({
      user_id: actor.id,
      student_id: student.id,
      payment_reference: paymentReference,
      amount_pesewas: settings.fee_pesewas,
      currency: settings.currency,
      status: "payment_pending",
    })
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code === "23505") {
      return respond({ error: "A payment session is already being prepared. Try again shortly." }, 409);
    }
    console.error("Could not create a verification payment intent:", insertError);
    return respond({ error: "Could not start your verification payment." }, 500);
  }

  const { url } = getSupabaseSettings();
  let paystackResponse: Response;
  try {
    paystackResponse = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getPaystackSecret()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: paymentEmail,
        amount: settings.fee_pesewas,
        currency: settings.currency,
        reference: paymentReference,
        callback_url: `${url.replace(/\/+$/, "")}/functions/v1/verification-payments`,
        metadata: { payment_intent_id: paymentIntent.id },
      }),
    });
  } catch (error) {
    console.error("Could not reach Paystack:", error);
    await markPaymentSetupFailed(serviceClient, paymentIntent.id);
    return respond({ error: "Could not connect to Paystack. Please try again." }, 502);
  }

  let paystackPayload: {
    status?: boolean;
    message?: string;
    data?: { authorization_url?: string };
  };
  try {
    paystackPayload = await paystackResponse.json();
  } catch {
    await markPaymentSetupFailed(serviceClient, paymentIntent.id);
    return respond({ error: "Paystack returned an unreadable payment response." }, 502);
  }
  const authorizationUrl = paystackPayload?.data?.authorization_url;
  let isPaystackCheckoutUrl = false;
  try {
    const checkoutUrl = new URL(authorizationUrl);
    isPaystackCheckoutUrl = checkoutUrl.protocol === "https:" &&
      (checkoutUrl.hostname === "paystack.com" ||
        checkoutUrl.hostname.endsWith(".paystack.com"));
  } catch {
    isPaystackCheckoutUrl = false;
  }
  if (!paystackResponse.ok || paystackPayload?.status !== true || !isPaystackCheckoutUrl) {
    console.error("Paystack transaction initialization failed:", {
      status: paystackResponse.status,
      message: paystackPayload?.message,
    });
    await markPaymentSetupFailed(serviceClient, paymentIntent.id);
    const paystackMessage = String(paystackPayload?.message || "").trim();
    return respond({
      error: paystackMessage
        ? `Paystack could not start the payment: ${paystackMessage}`
        : "Paystack could not start the payment. Please try again.",
    }, paystackResponse.ok ? 502 : paystackResponse.status);
  }

  const { error: saveCheckoutError } = await serviceClient
    .from("student_verification_payment_intents")
    .update({
      authorization_url: authorizationUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", paymentIntent.id);
  if (saveCheckoutError) {
    console.error("Could not save the Paystack checkout link:", saveCheckoutError);
    await markPaymentSetupFailed(serviceClient, paymentIntent.id);
    return respond({ error: "The payment session could not be saved. Please contact an administrator." }, 500);
  }

  return respond({ authorization_url: authorizationUrl, reference: paymentReference });
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method === "GET") return handlePaystackCallback(request);

  if (request.method !== "POST") {
    return respond({ error: "Method not allowed." }, 405);
  }

  if (request.headers.has("x-paystack-signature")) {
    try {
      return await handlePaystackWebhook(request);
    } catch (error) {
      console.error("Could not process the Paystack webhook:", error);
      return respond({ error: "Could not process the Paystack event." }, 500);
    }
  }

  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return respond({ error: "Request body must be valid JSON." }, 400);
  }
  if (body.action !== "initialize") {
    return respond({ error: "Unsupported payment action." }, 400);
  }

  try {
    return await initializePayment(request);
  } catch (error) {
    console.error("Could not initialize a verification payment:", error);
    return respond({ error: "Could not initialize verification payment." }, 500);
  }
});
