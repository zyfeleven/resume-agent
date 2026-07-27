import { z } from "zod";

import { BrowserControlIntentSchema, HttpOriginSchema } from "./browser-mcp.js";
import { DataSensitivitySchema, EntityIdSchema, IsoDateTimeSchema } from "./common.js";
import { AnswerReusePolicySchema, FactStatusSchema } from "./profile.js";

/**
 * The policy boundary deliberately carries references, metadata, and hashes only.
 * Candidate answers, secrets, and page text must never be sent to this evaluator.
 */
export const PolicyRouteSchema = z.enum([
  "automatic",
  "confirmation",
  "takeover",
  "prohibited",
]);

export const PolicyOperationSchema = z.enum([
  "read",
  "navigate",
  "field_write",
  "control",
  "upload",
  "submit",
  "takeover",
]);

export const PolicyAutomationModeSchema = z.enum(["standard", "review_all"]);

export const PolicyFieldTagSchema = z.enum([
  "protected_attribute",
  "work_authorization",
  "compensation",
  "relocation",
  "availability",
  "legal_declaration",
  "electronic_signature",
  "background_check",
]);

export const PolicySafetySignalSchema = z.enum([
  "login_required",
  "mfa_required",
  "captcha_present",
  "unfamiliar_widget",
  "untrusted_page_instruction",
  "security_bypass_requested",
  "unexpected_download",
]);

export const PolicyDecisionReasonSchema = z.enum([
  "tool_not_recognized",
  "tool_operation_mismatch",
  "submit_target_requires_submit_tool",
  "untrusted_page_instruction",
  "security_bypass_requested",
  "unexpected_download",
  "login_required",
  "mfa_required",
  "captcha_present",
  "unfamiliar_widget",
  "origin_not_allowlisted",
  "missing_current_origin",
  "cross_origin_action",
  "secret_field",
  "sensitive_field",
  "protected_or_legal_field",
  "field_context_required",
  "low_confidence",
  "unverified_provenance",
  "reused_answer_requires_confirmation",
  "user_review_preference",
  "destructive_control_requires_confirmation",
  "upload_requires_confirmation",
  "final_submission_requires_scoped_approval",
  "read_only_action",
  "same_origin_allowed_action",
  "high_confidence_verified_fact",
  "takeover_requested",
]);

export const PolicyApprovalScopeSchema = z.enum([
  "none",
  "field_confirmation",
  "upload_artifact",
  "final_submission",
]);

export const PolicyActionSchema = z
  .object({
    id: EntityIdSchema,
    tool: z.string().min(1).max(160),
    operation: PolicyOperationSchema,
    targetIsFinalSubmit: z.boolean(),
    controlIntent: BrowserControlIntentSchema.optional(),
  })
  .strict();

export const PolicyOriginContextSchema = z
  .object({
    targetOrigin: HttpOriginSchema,
    currentOrigin: HttpOriginSchema.optional(),
    allowedOrigins: z.array(HttpOriginSchema).min(1).max(20),
  })
  .strict();

export const PolicyFieldContextSchema = z
  .object({
    observationId: EntityIdSchema,
    canonicalField: z.string().min(1).max(240),
    sensitivity: DataSensitivitySchema,
    confidence: z.number().min(0).max(1),
    provenance: z.enum(["verified_fact", "answer_policy", "user_input", "none"]),
    factStatus: FactStatusSchema.optional(),
    sourceCount: z.number().int().min(0).max(100),
    answerReuse: AnswerReusePolicySchema.optional(),
    tags: z.array(PolicyFieldTagSchema).max(20),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.provenance === "verified_fact" && (value.factStatus !== "verified" || value.sourceCount < 1)) {
      context.addIssue({
        code: "custom",
        message: "Verified-fact provenance requires a verified fact with at least one source.",
      });
    }
    if (value.provenance === "answer_policy" && (value.factStatus !== "verified" || value.sourceCount < 1 || !value.answerReuse)) {
      context.addIssue({
        code: "custom",
        message: "Answer-policy provenance requires verified sourced facts and an explicit reuse policy.",
      });
    }
  });

export const PolicyEvaluationInputSchema = z
  .object({
    decisionId: EntityIdSchema,
    policyVersion: z.string().min(1).max(160),
    evaluatedAt: IsoDateTimeSchema,
    automationMode: PolicyAutomationModeSchema,
    action: PolicyActionSchema,
    origin: PolicyOriginContextSchema,
    field: PolicyFieldContextSchema.optional(),
    safetySignals: z.array(PolicySafetySignalSchema).max(20),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.action.operation !== "field_write" && value.field) {
      context.addIssue({
        code: "custom",
        path: ["field"],
        message: "Only field-write evaluations may carry field context.",
      });
    }
  });

const PolicyDecisionBaseSchema = z
  .object({
    id: EntityIdSchema,
    actionId: EntityIdSchema,
    policyVersion: z.string().min(1).max(160),
    evaluatedAt: IsoDateTimeSchema,
    reasons: z.array(PolicyDecisionReasonSchema).min(1).max(20),
  })
  .strict();

export const PolicyDecisionSchema = z.discriminatedUnion("route", [
  PolicyDecisionBaseSchema.extend({
    route: z.literal("automatic"),
    approvalScope: z.literal("none"),
  }).strict(),
  PolicyDecisionBaseSchema.extend({
    route: z.literal("confirmation"),
    approvalScope: z.enum(["field_confirmation", "upload_artifact", "final_submission"]),
  }).strict(),
  PolicyDecisionBaseSchema.extend({
    route: z.literal("takeover"),
    approvalScope: z.literal("none"),
  }).strict(),
  PolicyDecisionBaseSchema.extend({
    route: z.literal("prohibited"),
    approvalScope: z.literal("none"),
  }).strict(),
]);

export type PolicyAction = z.infer<typeof PolicyActionSchema>;
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
export type PolicyDecisionReason = z.infer<typeof PolicyDecisionReasonSchema>;
export type PolicyEvaluationInput = z.infer<typeof PolicyEvaluationInputSchema>;
export type PolicyFieldContext = z.infer<typeof PolicyFieldContextSchema>;
export type PolicyOriginContext = z.infer<typeof PolicyOriginContextSchema>;
