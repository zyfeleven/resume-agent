import { describe, expect, it } from "vitest";

import { canExecuteAutomatically, evaluatePolicy } from "../src/index.js";

const now = "2026-07-27T16:00:00-04:00";
const origin = "https://jobs.example.com";

function evaluation(overrides: Record<string, unknown> = {}) {
  const base = {
    decisionId: "policy-decision:1",
    policyVersion: "policy-v1",
    evaluatedAt: now,
    automationMode: "standard",
    action: {
      id: "action:1",
      tool: "browser_set_field",
      operation: "field_write",
      targetIsFinalSubmit: false,
    },
    origin: {
      currentOrigin: origin,
      targetOrigin: origin,
      allowedOrigins: [origin],
    },
    field: {
      observationId: "field:1",
      canonicalField: "candidate.email",
      sensitivity: "pii",
      confidence: 0.95,
      provenance: "verified_fact",
      factStatus: "verified",
      sourceCount: 1,
      tags: [],
    },
    safetySignals: [],
  };
  return {
    ...base,
    ...overrides,
    action: { ...base.action, ...((overrides.action as Record<string, unknown> | undefined) ?? {}) },
    origin: { ...base.origin, ...((overrides.origin as Record<string, unknown> | undefined) ?? {}) },
    field: Object.hasOwn(overrides, "field")
      ? overrides.field === undefined
        ? undefined
        : { ...base.field, ...(overrides.field as Record<string, unknown>) }
      : base.field,
  };
}

describe("policy matrix", () => {
  it("automatically permits a high-confidence sourced verified normal/PII field", () => {
    const result = evaluatePolicy(evaluation());
    expect(result).toMatchObject({ route: "automatic", approvalScope: "none", reasons: ["high_confidence_verified_fact"] });
    expect(canExecuteAutomatically(result)).toBe(true);
  });

  it("routes medium confidence and missing provenance to confirmation", () => {
    expect(evaluatePolicy(evaluation({ field: { confidence: 0.7 } }))).toMatchObject({
      route: "confirmation",
      reasons: ["low_confidence"],
      approvalScope: "field_confirmation",
    });
    expect(
      evaluatePolicy(evaluation({ field: { provenance: "none", factStatus: undefined, sourceCount: 0 } })),
    ).toMatchObject({ route: "confirmation", reasons: ["unverified_provenance"] });
    expect(evaluatePolicy(evaluation({ field: undefined }))).toMatchObject({
      route: "confirmation",
      reasons: ["field_context_required"],
    });
  });

  it("honors reusable-answer and review-all preferences", () => {
    expect(
      evaluatePolicy(
        evaluation({ field: { provenance: "answer_policy", answerReuse: "reuse_with_confirmation" } }),
      ),
    ).toMatchObject({ route: "confirmation", reasons: ["reused_answer_requires_confirmation"] });
    expect(evaluatePolicy(evaluation({ automationMode: "review_all" }))).toMatchObject({
      route: "confirmation",
      reasons: ["user_review_preference"],
    });
  });

  it("requires takeover for secret, sensitive, protected, and legal fields", () => {
    expect(evaluatePolicy(evaluation({ field: { sensitivity: "secret" } }))).toMatchObject({
      route: "takeover",
      reasons: ["secret_field"],
    });
    expect(evaluatePolicy(evaluation({ field: { sensitivity: "sensitive" } }))).toMatchObject({
      route: "takeover",
      reasons: ["sensitive_field"],
    });
    expect(evaluatePolicy(evaluation({ field: { tags: ["electronic_signature"] } }))).toMatchObject({
      route: "takeover",
      reasons: ["protected_or_legal_field"],
    });
  });

  it("stops at login, MFA, CAPTCHA, unfamiliar widgets, and cross-origin actions", () => {
    for (const safetySignal of ["login_required", "mfa_required", "captcha_present", "unfamiliar_widget"] as const) {
      expect(evaluatePolicy(evaluation({ safetySignals: [safetySignal] }))).toMatchObject({ route: "takeover" });
    }
    expect(evaluatePolicy(evaluation({ origin: { targetOrigin: "https://auth.example.com" } }))).toMatchObject({
      route: "takeover",
      reasons: ["origin_not_allowlisted"],
    });
  });

  it("prohibits untrusted instructions, security bypasses, unknown tools, and disguised submit", () => {
    expect(evaluatePolicy(evaluation({ safetySignals: ["untrusted_page_instruction"] }))).toMatchObject({
      route: "prohibited",
      reasons: ["untrusted_page_instruction"],
    });
    expect(evaluatePolicy(evaluation({ safetySignals: ["security_bypass_requested"] }))).toMatchObject({
      route: "prohibited",
      reasons: ["security_bypass_requested"],
    });
    expect(evaluatePolicy(evaluation({ action: { tool: "browser_execute_javascript", operation: "read" }, field: undefined }))).toMatchObject({
      route: "prohibited",
      reasons: ["tool_not_recognized"],
    });
    expect(
      evaluatePolicy(
        evaluation({ action: { tool: "browser_activate", operation: "control", targetIsFinalSubmit: true }, field: undefined }),
      ),
    ).toMatchObject({ route: "prohibited", reasons: ["submit_target_requires_submit_tool"] });
  });

  it("requires a scoped confirmation for uploads and final submission", () => {
    expect(
      evaluatePolicy(
        evaluation({ action: { tool: "browser_set_file", operation: "upload" }, field: undefined }),
      ),
    ).toMatchObject({ route: "confirmation", approvalScope: "upload_artifact" });
    const submit = evaluatePolicy(
      evaluation({ action: { tool: "browser_submit", operation: "submit", targetIsFinalSubmit: true }, field: undefined }),
    );
    expect(submit).toMatchObject({
      route: "confirmation",
      approvalScope: "final_submission",
      reasons: ["final_submission_requires_scoped_approval"],
    });
    expect(canExecuteAutomatically(submit)).toBe(false);
  });

  it("permits safe same-origin reads and pauses", () => {
    expect(
      evaluatePolicy(
        evaluation({ action: { tool: "browser_snapshot", operation: "read" }, field: undefined }),
      ),
    ).toMatchObject({ route: "automatic", reasons: ["read_only_action"] });
    expect(
      evaluatePolicy(
        evaluation({
          action: { tool: "browser_request_takeover", operation: "takeover" },
          field: undefined,
          origin: { targetOrigin: "https://unknown.example.com" },
          safetySignals: ["untrusted_page_instruction"],
        }),
      ),
    ).toMatchObject({ route: "automatic", reasons: ["takeover_requested"] });
  });
});
