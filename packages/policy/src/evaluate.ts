import {
  PolicyDecisionSchema,
  PolicyEvaluationInputSchema,
  type PolicyDecision,
  type PolicyDecisionReason,
  type PolicyEvaluationInput,
} from "@resume-agent/contracts";

export const POLICY_VERSION = "policy-v1";

const expectedOperationByTool = {
  browser_session_open: "navigate",
  browser_snapshot: "read",
  browser_navigate: "navigate",
  browser_set_field: "field_write",
  browser_activate: "control",
  browser_request_takeover: "takeover",
  browser_set_file: "upload",
  browser_submit: "submit",
} as const;

type KnownTool = keyof typeof expectedOperationByTool;

function isKnownTool(tool: string): tool is KnownTool {
  return Object.hasOwn(expectedOperationByTool, tool);
}

function decision(
  input: PolicyEvaluationInput,
  route: PolicyDecision["route"],
  reasons: PolicyDecisionReason[],
  approvalScope: PolicyDecision["approvalScope"],
): PolicyDecision {
  return PolicyDecisionSchema.parse({
    id: input.decisionId,
    actionId: input.action.id,
    policyVersion: input.policyVersion,
    evaluatedAt: input.evaluatedAt,
    route,
    approvalScope,
    reasons,
  });
}

function hasSignal(input: PolicyEvaluationInput, signal: PolicyEvaluationInput["safetySignals"][number]): boolean {
  return input.safetySignals.includes(signal);
}

function isFieldSpecialCase(input: PolicyEvaluationInput): boolean {
  const field = input.field;
  return Boolean(
    field &&
      (field.tags.includes("protected_attribute") ||
        field.tags.includes("work_authorization") ||
        field.tags.includes("compensation") ||
        field.tags.includes("relocation") ||
        field.tags.includes("availability") ||
        field.tags.includes("legal_declaration") ||
        field.tags.includes("electronic_signature") ||
        field.tags.includes("background_check")),
  );
}

/**
 * Classify a prospective browser action without reading its value or page text.
 * This function is deterministic: it receives no clock, random source, network,
 * or storage dependency. Browser and orchestrator layers must honor the resulting
 * route and retain their separate, one-use authorization checks.
 */
export function evaluatePolicy(input: unknown): PolicyDecision {
  const value = PolicyEvaluationInputSchema.parse(input);
  const { action, origin } = value;

  if (!isKnownTool(action.tool)) {
    return decision(value, "prohibited", ["tool_not_recognized"], "none");
  }
  if (expectedOperationByTool[action.tool] !== action.operation) {
    return decision(value, "prohibited", ["tool_operation_mismatch"], "none");
  }
  if (action.targetIsFinalSubmit && action.tool !== "browser_submit") {
    return decision(value, "prohibited", ["submit_target_requires_submit_tool"], "none");
  }

  // Taking over is a safe stop action and must remain available even on an unsafe page.
  if (action.tool === "browser_request_takeover") {
    return decision(value, "automatic", ["takeover_requested"], "none");
  }

  if (hasSignal(value, "untrusted_page_instruction")) {
    return decision(value, "prohibited", ["untrusted_page_instruction"], "none");
  }
  if (hasSignal(value, "security_bypass_requested")) {
    return decision(value, "prohibited", ["security_bypass_requested"], "none");
  }
  if (hasSignal(value, "unexpected_download")) {
    return decision(value, "prohibited", ["unexpected_download"], "none");
  }

  if (hasSignal(value, "login_required")) {
    return decision(value, "takeover", ["login_required"], "none");
  }
  if (hasSignal(value, "mfa_required")) {
    return decision(value, "takeover", ["mfa_required"], "none");
  }
  if (hasSignal(value, "captcha_present")) {
    return decision(value, "takeover", ["captcha_present"], "none");
  }
  if (hasSignal(value, "unfamiliar_widget")) {
    return decision(value, "takeover", ["unfamiliar_widget"], "none");
  }

  if (!origin.allowedOrigins.includes(origin.targetOrigin)) {
    return decision(value, "takeover", ["origin_not_allowlisted"], "none");
  }
  if (action.tool !== "browser_session_open" && !origin.currentOrigin) {
    return decision(value, "takeover", ["missing_current_origin"], "none");
  }
  if (origin.currentOrigin && origin.currentOrigin !== origin.targetOrigin) {
    return decision(value, "takeover", ["cross_origin_action"], "none");
  }

  if (action.tool === "browser_submit") {
    return decision(value, "confirmation", ["final_submission_requires_scoped_approval"], "final_submission");
  }
  if (action.tool === "browser_set_file") {
    return decision(value, "confirmation", ["upload_requires_confirmation"], "upload_artifact");
  }

  if (action.tool === "browser_set_field") {
    const field = value.field;
    if (!field) {
      return decision(value, "confirmation", ["field_context_required"], "field_confirmation");
    }
    if (field.sensitivity === "secret") {
      return decision(value, "takeover", ["secret_field"], "none");
    }
    if (field.sensitivity === "sensitive") {
      return decision(value, "takeover", ["sensitive_field"], "none");
    }
    if (isFieldSpecialCase(value)) {
      return decision(value, "takeover", ["protected_or_legal_field"], "none");
    }
    if (value.automationMode === "review_all") {
      return decision(value, "confirmation", ["user_review_preference"], "field_confirmation");
    }
    if (field.confidence < 0.7) {
      return decision(value, "confirmation", ["low_confidence"], "field_confirmation");
    }
    if (
      field.provenance === "none" ||
      field.provenance === "user_input" ||
      field.factStatus !== "verified" ||
      field.sourceCount < 1
    ) {
      return decision(value, "confirmation", ["unverified_provenance"], "field_confirmation");
    }
    if (field.answerReuse && field.answerReuse !== "this_application_only") {
      return decision(value, "confirmation", ["reused_answer_requires_confirmation"], "field_confirmation");
    }
    if (field.confidence < 0.9) {
      return decision(value, "confirmation", ["low_confidence"], "field_confirmation");
    }
    return decision(value, "automatic", ["high_confidence_verified_fact"], "none");
  }

  if (action.tool === "browser_activate" && action.controlIntent === "remove_repeated_item") {
    return decision(value, "confirmation", ["destructive_control_requires_confirmation"], "field_confirmation");
  }
  if (value.automationMode === "review_all" && action.operation !== "read") {
    return decision(value, "confirmation", ["user_review_preference"], "field_confirmation");
  }
  if (action.operation === "read") {
    return decision(value, "automatic", ["read_only_action"], "none");
  }
  return decision(value, "automatic", ["same_origin_allowed_action"], "none");
}

export function canExecuteAutomatically(decisionValue: unknown): boolean {
  return PolicyDecisionSchema.parse(decisionValue).route === "automatic";
}
