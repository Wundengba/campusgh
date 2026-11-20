const cleanDisplayText = (value, maxLength) =>
  String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

export const buildVerificationCallbackMessage = (result, reason, reference) => {
  const safeReason = cleanDisplayText(reason, 180);
  const safeReference = /^CGV-[0-9a-f]{32}$/i.test(String(reference || ""))
    ? String(reference)
    : "";
  const referenceText = safeReference ? ` Reference: ${safeReference}.` : "";

  if (result === "success") {
    return `Payment received. Your application is awaiting admin review.${referenceText}`;
  }
  if (result === "check_status") {
    return `We could not confirm the payment yet. Refresh your application status shortly.${referenceText}`;
  }

  return `Payment was not completed.${safeReason ? ` Paystack reported: ${safeReason}.` : " You can continue the same payment from this page."}${referenceText}`;
};

export const filterVerificationApplications = (
  applications,
  { status = "all", search = "" } = {},
) => {
  const normalizedSearch = String(search).trim().toLowerCase();
  return applications.filter((application) => {
    if (status !== "all" && application.status !== status) return false;
    if (!normalizedSearch) return true;

    return [
      application.student_name,
      application.student_index,
      application.school_name,
      application.payment_reference,
    ].some((value) => String(value || "").toLowerCase().includes(normalizedSearch));
  });
};
