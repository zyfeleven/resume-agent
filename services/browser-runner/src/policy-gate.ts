import type {
  BrowserMcpToolName,
  PolicyAutomationMode,
  PolicyDecision,
  PolicySafetySignal,
} from "@resume-agent/contracts";
import { POLICY_VERSION, evaluatePolicy } from "@resume-agent/policy";

import { BrowserRunnerError } from "./errors.js";

/** Operation each tool is permitted to claim. The policy engine rejects any mismatch. */
const OPERATION_BY_TOOL = {
  browser_session_open: "navigate",
  browser_snapshot: "read",
  browser_navigate: "navigate",
  browser_set_field: "field_write",
  browser_activate: "control",
  browser_request_takeover: "takeover",
  browser_set_file: "upload",
  browser_submit: "submit",
} as const;

export interface PolicyGateInput {
  tool: BrowserMcpToolName;
  actionId: string;
  decisionId: string;
  evaluatedAt: string;
  targetOrigin: string;
  currentOrigin?: string;
  allowedOrigins: readonly string[];
  safetySignals: readonly PolicySafetySignal[];
  automationMode: PolicyAutomationMode;
}

/**
 * Every browser tool call passes through here before the browser is touched.
 *
 * The policy engine is the only thing that decides whether an action may proceed
 * automatically; an absent or non-automatic decision is a refusal, never a default
 * allow. The decision travels with the refusal so the dashboard can show which rule
 * stopped the run rather than a generic error.
 */
export function requireAutomaticDecision(input: PolicyGateInput): PolicyDecision {
  const decision = evaluatePolicy({
    decisionId: input.decisionId,
    policyVersion: POLICY_VERSION,
    evaluatedAt: input.evaluatedAt,
    automationMode: input.automationMode,
    action: {
      id: input.actionId,
      tool: input.tool,
      operation: OPERATION_BY_TOOL[input.tool],
      targetIsFinalSubmit: false,
    },
    origin: {
      targetOrigin: input.targetOrigin,
      ...(input.currentOrigin === undefined ? {} : { currentOrigin: input.currentOrigin }),
      allowedOrigins: [...input.allowedOrigins],
    },
    safetySignals: [...input.safetySignals],
  });

  if (decision.route !== "automatic") {
    throw new BrowserRunnerError(
      "POLICY_REFUSED",
      `Policy routed ${input.tool} to ${decision.route}: ${decision.reasons.join(", ")}.`,
      decision,
    );
  }

  return decision;
}
