import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVerificationCallbackMessage,
  filterVerificationApplications,
} from "./verificationPayments.js";

test("shows safe gateway failure details and the matching payment reference", () => {
  const message = buildVerificationCallbackMessage(
    "not_completed",
    "Mobile money request expired",
    "CGV-0123456789abcdef0123456789abcdef",
  );

  assert.match(message, /Mobile money request expired/);
  assert.match(message, /CGV-0123456789abcdef0123456789abcdef/);
});

test("callback notices do not expose malformed references or control characters", () => {
  const message = buildVerificationCallbackMessage(
    "not_completed",
    "Payment declined\nPlease retry",
    "external-reference",
  );

  assert.match(message, /Payment declined Please retry/);
  assert.doesNotMatch(message, /external-reference/);
  assert.doesNotMatch(message, /\n/);
});

test("filters paid applications by status and searches identifying fields", () => {
  const applications = [
    {
      status: "pending_review",
      student_name: "Ama Mensah",
      student_index: "CG-101",
      school_name: "North School",
    },
    {
      status: "approved",
      student_name: "Kojo Owusu",
      student_index: "CG-102",
      school_name: "South School",
    },
  ];

  assert.deepEqual(
    filterVerificationApplications(applications, {
      status: "pending_review",
      search: "north",
    }),
    [applications[0]],
  );
  assert.deepEqual(
    filterVerificationApplications(applications, { search: "cg-102" }),
    [applications[1]],
  );
});
