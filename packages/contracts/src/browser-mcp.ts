import { z } from "zod";

import {
  ActionRiskSchema,
  ApplicationCheckpointSchema,
  FieldOptionSchema,
  FormControlTypeSchema,
  LocatorStrategySchema,
} from "./application.js";
import {
  CONTRACT_VERSION,
  DataSensitivitySchema,
  EntityIdSchema,
  IsoDateTimeSchema,
  JsonValueSchema,
  Sha256Schema,
} from "./common.js";

export const BrowserMcpToolNameSchema = z.enum([
  "browser_session_open",
  "browser_snapshot",
  "browser_navigate",
  "browser_set_field",
  "browser_activate",
  "browser_request_takeover",
  "browser_set_file",
  "browser_submit",
]);

export const HttpOriginSchema = z
  .string()
  .url()
  .regex(/^https?:\/\/(?![^/?#]*@)[^/?#]+\/?$/i)
  .meta({ description: "HTTP(S) origin only; credentials, paths, query strings, and fragments are forbidden." });

export const BrowserHttpUrlSchema = z
  .string()
  .url()
  .regex(/^https?:\/\/(?![^/?#]*@)/i)
  .meta({ description: "HTTP(S) browser URL without embedded credentials." });

export const BrowserScopeSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    requestId: EntityIdSchema,
    applicationId: EntityIdSchema,
    runId: EntityIdSchema,
    browserSessionRef: EntityIdSchema,
    expectedStateRevision: z.number().int().nonnegative(),
    allowedOrigins: z.array(HttpOriginSchema).min(1).max(20),
    deadlineAt: IsoDateTimeSchema,
  })
  .strict();

export const BrowserSnapshotScopeSchema = BrowserScopeSchema.extend({
  snapshotId: EntityIdSchema,
  expectedPageFingerprint: Sha256Schema,
  expectedPageGeneration: z.number().int().nonnegative(),
}).strict();

export const BrowserFrameSchema = z
  .object({
    id: EntityIdSchema,
    parentId: EntityIdSchema.optional(),
    url: BrowserHttpUrlSchema,
    origin: HttpOriginSchema,
    title: z.string().max(1_000),
  })
  .strict();

export const BrowserLocatorRecipeSchema = z
  .object({
    id: EntityIdSchema,
    sourceSnapshotId: EntityIdSchema,
    strategy: LocatorStrategySchema,
    value: z.string().min(1).max(1_000),
    exact: z.boolean(),
    framePath: z.array(EntityIdSchema).max(20),
    priority: z.number().int().min(0).max(100),
  })
  .strict();

export const BrowserTargetKindSchema = z.enum(["field", "control", "link", "file", "submit"]);
export const BrowserControlIntentSchema = z.enum([
  "expand",
  "advance_step",
  "previous_step",
  "add_repeated_item",
  "remove_repeated_item",
]);

export const BrowserObservedValueSchema = z
  .object({
    state: z.enum(["empty", "present", "redacted", "not_applicable"]),
    normalizedValueHash: Sha256Schema.optional(),
    checked: z.boolean().optional(),
    selectedOptionLabels: z.array(z.string().max(500)).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.state === "empty" || value.state === "not_applicable") &&
      value.normalizedValueHash
    ) {
      context.addIssue({
        code: "custom",
        path: ["normalizedValueHash"],
        message: "Empty or non-applicable controls cannot carry a value hash.",
      });
    }
    if (
      value.state === "not_applicable" &&
      (value.checked !== undefined || value.selectedOptionLabels.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Non-applicable controls cannot carry an observed value.",
      });
    }
  });

const BrowserSnapshotTargetBaseSchema = z
  .object({
    id: EntityIdSchema,
    frameId: EntityIdSchema,
    role: z.string().min(1).max(160),
    accessibleName: z.string().max(1_000),
    question: z.string().max(2_000),
    required: z.boolean(),
    disabled: z.boolean(),
    sensitivity: DataSensitivitySchema,
    options: z.array(FieldOptionSchema).max(500),
    observedValue: BrowserObservedValueSchema,
    locatorRecipes: z.array(BrowserLocatorRecipeSchema).min(1).max(10),
  })
  .strict();

export const BrowserSnapshotTargetSchema = z.discriminatedUnion("kind", [
  BrowserSnapshotTargetBaseSchema.extend({
    kind: z.literal("field"),
    controlType: FormControlTypeSchema.exclude(["button", "file", "link"]),
    isSubmitCandidate: z.literal(false),
  }).strict(),
  BrowserSnapshotTargetBaseSchema.extend({
    kind: z.literal("control"),
    controlType: z.literal("button"),
    controlIntent: BrowserControlIntentSchema,
    isSubmitCandidate: z.literal(false),
  }).strict(),
  BrowserSnapshotTargetBaseSchema.extend({
    kind: z.literal("link"),
    controlType: z.literal("link"),
    controlIntent: BrowserControlIntentSchema,
    isSubmitCandidate: z.literal(false),
  }).strict(),
  BrowserSnapshotTargetBaseSchema.extend({
    kind: z.literal("file"),
    controlType: z.literal("file"),
    isSubmitCandidate: z.literal(false),
  }).strict(),
  BrowserSnapshotTargetBaseSchema.extend({
    kind: z.literal("submit"),
    controlType: z.literal("button"),
    isSubmitCandidate: z.literal(true),
  }).strict(),
]);

export const BrowserPageSnapshotSchema = z
  .object({
    snapshotId: EntityIdSchema,
    applicationId: EntityIdSchema,
    runId: EntityIdSchema,
    browserSessionRef: EntityIdSchema,
    pageGeneration: z.number().int().nonnegative(),
    url: BrowserHttpUrlSchema,
    origin: HttpOriginSchema,
    title: z.string().max(1_000),
    pageFingerprint: Sha256Schema,
    frames: z.array(BrowserFrameSchema).min(1).max(100),
    targets: z.array(BrowserSnapshotTargetSchema).max(2_000),
    validationMessages: z.array(z.string().max(2_000)).max(500),
    snapshotArtifactId: EntityIdSchema,
    screenshotArtifactId: EntityIdSchema.optional(),
    observedAt: IsoDateTimeSchema,
    leaseExpiresAt: IsoDateTimeSchema,
  })
  .strict();

export const BrowserLivePageObservationSchema = z
  .object({
    applicationId: EntityIdSchema,
    runId: EntityIdSchema,
    browserSessionRef: EntityIdSchema,
    pageGeneration: z.number().int().nonnegative(),
    url: BrowserHttpUrlSchema,
    origin: HttpOriginSchema,
    pageFingerprint: Sha256Schema,
    observedAt: IsoDateTimeSchema,
  })
  .strict();

export const BrowserTrustedEvidenceRecordSchema = z
  .object({
    artifactId: EntityIdSchema,
    contentHash: Sha256Schema,
    applicationId: EntityIdSchema,
    runId: EntityIdSchema,
    browserSessionRef: EntityIdSchema,
    actionId: EntityIdSchema,
    actionFingerprint: Sha256Schema,
    tool: BrowserMcpToolNameSchema,
    executionReservationId: EntityIdSchema,
    dispatchEffectId: EntityIdSchema.optional(),
    sourceSnapshotId: EntityIdSchema,
    observedSnapshotId: EntityIdSchema,
    evidenceKind: z.enum([
      "receipt_signal",
      "snapshot_state_unchanged",
      "network_request_not_sent",
      "server_rejection_before_commit",
    ]),
    verifiedSignalHashes: z.array(Sha256Schema).max(20),
    verifiedAt: IsoDateTimeSchema,
  })
  .strict();

export const BrowserTrustedArtifactRecordSchema = z
  .object({
    artifactId: EntityIdSchema,
    applicationId: EntityIdSchema,
    runId: EntityIdSchema,
    contentHash: Sha256Schema,
    fileName: z.string().min(1).max(500),
    mediaType: z.string().min(1).max(200),
    byteSize: z.number().int().nonnegative().max(50 * 1024 * 1024),
    status: z.literal("available"),
    verifiedAt: IsoDateTimeSchema,
  })
  .strict();

const BrowserAuthorizationBindingShape = {
  applicationId: EntityIdSchema,
  runId: EntityIdSchema,
  browserSessionRef: EntityIdSchema,
  actionId: EntityIdSchema,
  actionFingerprint: Sha256Schema,
  sourceSnapshotId: EntityIdSchema,
  pageFingerprint: Sha256Schema,
  pageGeneration: z.number().int().nonnegative(),
  origin: HttpOriginSchema,
};

const BrowserPolicyGrantBaseSchema = z
  .object({
    kind: z.literal("policy_grant"),
    ...BrowserAuthorizationBindingShape,
    risk: z.literal("reversible"),
    decisionId: EntityIdSchema,
    policyVersion: z.string().min(1).max(160),
    grantHash: Sha256Schema,
    issuedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    executionReservationId: EntityIdSchema,
    executionNonce: z.string().min(32).max(512),
    executionLeaseExpiresAt: IsoDateTimeSchema,
  })
  .strict();

const BrowserEffectClaimBaseSchema = z
  .object({
    kind: z.literal("effect_claim"),
    ...BrowserAuthorizationBindingShape,
    risk: z.enum(["reversible", "consequential"]),
    approvalId: EntityIdSchema,
    dispatchEffectId: EntityIdSchema,
    workerId: EntityIdSchema,
    claimToken: z.string().min(32).max(512),
    claimedAt: IsoDateTimeSchema,
    executionReservationId: EntityIdSchema,
    executionNonce: z.string().min(32).max(512),
    executionLeaseExpiresAt: IsoDateTimeSchema,
  })
  .strict();

function policyGrantFor<const TTool extends "browser_navigate" | "browser_set_field" | "browser_activate">(
  tool: TTool,
) {
  return BrowserPolicyGrantBaseSchema.extend({ tool: z.literal(tool) }).strict();
}

function reversibleClaimFor<const TTool extends "browser_navigate" | "browser_set_field" | "browser_activate">(
  tool: TTool,
) {
  return BrowserEffectClaimBaseSchema.extend({
    tool: z.literal(tool),
    risk: z.literal("reversible"),
  }).strict();
}

export const BrowserNavigateAuthorizationSchema = z.union([
  policyGrantFor("browser_navigate"),
  reversibleClaimFor("browser_navigate"),
]);
export const BrowserSetFieldAuthorizationSchema = z.union([
  policyGrantFor("browser_set_field"),
  reversibleClaimFor("browser_set_field"),
]);
export const BrowserActivateAuthorizationSchema = z.union([
  policyGrantFor("browser_activate"),
  reversibleClaimFor("browser_activate"),
]);
export const BrowserSetFileAuthorizationSchema = BrowserEffectClaimBaseSchema.extend({
  tool: z.literal("browser_set_file"),
  risk: z.literal("consequential"),
  artifactContentHash: Sha256Schema,
}).strict();
export const BrowserSubmitAuthorizationSchema = BrowserEffectClaimBaseSchema.extend({
  tool: z.literal("browser_submit"),
  risk: z.literal("consequential"),
  reviewSnapshotHash: Sha256Schema,
}).strict();

export const BrowserPolicyGrantSchema = z.union([
  policyGrantFor("browser_navigate"),
  policyGrantFor("browser_set_field"),
  policyGrantFor("browser_activate"),
]);
export const BrowserEffectClaimSchema = z.union([
  reversibleClaimFor("browser_navigate"),
  reversibleClaimFor("browser_set_field"),
  reversibleClaimFor("browser_activate"),
  BrowserSetFileAuthorizationSchema,
  BrowserSubmitAuthorizationSchema,
]);
export const BrowserWriteAuthorizationSchema = z.union([
  BrowserPolicyGrantSchema,
  BrowserEffectClaimSchema,
]);

export const BrowserTargetReferenceSchema = z
  .object({
    targetId: EntityIdSchema,
    locatorRecipeId: EntityIdSchema,
  })
  .strict();

const postcondition = <const TKind extends string, T extends z.ZodRawShape>(
  kind: TKind,
  shape: T,
) => z.object({ id: EntityIdSchema, kind: z.literal(kind), ...shape }).strict();

export const BrowserPostconditionSchema = z.discriminatedUnion("kind", [
  postcondition("normalized_value_hash", { expectedHash: Sha256Schema }),
  postcondition("checked_state", { expectedBoolean: z.boolean() }),
  postcondition("selected_option", { expectedHash: Sha256Schema }),
  postcondition("attachment_hash", { expectedHash: Sha256Schema }),
  postcondition("url", { expectedHash: Sha256Schema }),
  postcondition("page_fingerprint_changed", { previousFingerprint: Sha256Schema }),
  postcondition("target_present", { targetId: EntityIdSchema }),
  postcondition("target_absent", { targetId: EntityIdSchema }),
  postcondition("receipt_signal", { expectedHash: Sha256Schema }),
]);

const BrowserWriteEnvelopeShape = {
  ...BrowserSnapshotScopeSchema.shape,
  checkpointId: EntityIdSchema,
  target: BrowserTargetReferenceSchema,
  authorization: BrowserWriteAuthorizationSchema,
  postconditions: z.array(BrowserPostconditionSchema).min(1).max(20),
};

export const BrowserSessionOpenInputSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    requestId: EntityIdSchema,
    applicationId: EntityIdSchema,
    runId: EntityIdSchema,
    targetUrl: BrowserHttpUrlSchema,
    allowedOrigins: z.array(HttpOriginSchema).min(1).max(20),
    expectedStateRevision: z.number().int().nonnegative(),
    headed: z.boolean(),
    deadlineAt: IsoDateTimeSchema,
  })
  .strict();

export const BrowserSnapshotInputSchema = BrowserScopeSchema.extend({
  includeScreenshot: z.boolean(),
  maxTargets: z.number().int().min(1).max(2_000),
}).strict();

export const BrowserNavigateInputSchema = z
  .object({
    ...BrowserSnapshotScopeSchema.shape,
    checkpointId: EntityIdSchema,
    targetUrl: BrowserHttpUrlSchema,
    authorization: BrowserNavigateAuthorizationSchema,
    expectedUrlHash: Sha256Schema,
    postconditions: z.array(BrowserPostconditionSchema).min(1).max(20),
  })
  .strict();

export const BrowserSetFieldInputSchema = z
  .object({
    ...BrowserWriteEnvelopeShape,
    authorization: BrowserSetFieldAuthorizationSchema,
    value: JsonValueSchema,
    valueHash: Sha256Schema,
    valueSensitivity: DataSensitivitySchema,
    normalizedValueHash: Sha256Schema,
  })
  .strict();

export const BrowserActivateInputSchema = z
  .object({
    ...BrowserWriteEnvelopeShape,
    authorization: BrowserActivateAuthorizationSchema,
    intent: BrowserControlIntentSchema,
  })
  .strict();

export const BrowserTakeoverReasonSchema = z.enum([
  "login",
  "mfa",
  "captcha",
  "sensitive_field",
  "unfamiliar_widget",
  "unexpected_origin",
  "site_policy",
  "manual_reconciliation",
]);

export const BrowserRequestTakeoverInputSchema = BrowserSnapshotScopeSchema.extend({
  reason: BrowserTakeoverReasonSchema,
  checkpointId: EntityIdSchema,
  redactedMessage: z.string().min(1).max(2_000),
}).strict();

export const BrowserSetFileInputSchema = z
  .object({
    ...BrowserWriteEnvelopeShape,
    authorization: BrowserSetFileAuthorizationSchema,
    artifact: z
      .object({
        artifactId: EntityIdSchema,
        contentHash: Sha256Schema,
        fileName: z
          .string()
          .min(1)
          .max(500)
          .regex(/^(?!\.{1,2}$)[^/\\\u0000]+$/),
        mediaType: z.string().min(1).max(200),
        byteSize: z.number().int().nonnegative().max(50 * 1024 * 1024),
      })
      .strict(),
  })
  .strict();

export const BrowserSubmitInputSchema = z
  .object({
    ...BrowserWriteEnvelopeShape,
    authorization: BrowserSubmitAuthorizationSchema,
    reviewSnapshotHash: Sha256Schema,
    expectedReceiptSignals: z.array(z.string().min(1).max(500)).min(1).max(20),
  })
  .strict();

export const BrowserActionabilitySchema = z
  .object({
    locatorResolvedUniquely: z.literal(true),
    matchCount: z.literal(1),
    sourceSnapshotId: EntityIdSchema,
    resolvedTargetId: EntityIdSchema,
    locatorRecipeId: EntityIdSchema,
    resolvedFramePath: z.array(EntityIdSchema).max(20),
    pageFingerprintMatched: z.literal(true),
    originAllowed: z.literal(true),
    visible: z.literal(true),
    stable: z.literal(true),
    enabled: z.literal(true),
    receivesEvents: z.literal(true),
    editable: z.literal(true).optional(),
  })
  .strict();

const postconditionResult = <const TKind extends string, T extends z.ZodRawShape>(
  kind: TKind,
  shape: T,
) =>
  z
    .object({
      postconditionId: EntityIdSchema,
      kind: z.literal(kind),
      passed: z.literal(true),
      redactedSummary: z.string().min(1).max(2_000),
      ...shape,
    })
    .strict();

export const BrowserPostconditionResultSchema = z.discriminatedUnion("kind", [
  postconditionResult("normalized_value_hash", { observedHash: Sha256Schema }),
  postconditionResult("checked_state", { observedBoolean: z.boolean() }),
  postconditionResult("selected_option", { observedHash: Sha256Schema }),
  postconditionResult("attachment_hash", { observedHash: Sha256Schema }),
  postconditionResult("url", { observedHash: Sha256Schema }),
  postconditionResult("page_fingerprint_changed", {
    beforeFingerprint: Sha256Schema,
    afterFingerprint: Sha256Schema,
  }),
  postconditionResult("target_present", { targetId: EntityIdSchema }),
  postconditionResult("target_absent", { targetId: EntityIdSchema }),
  postconditionResult("receipt_signal", {
    observedHash: Sha256Schema,
    evidenceArtifactId: EntityIdSchema,
    evidenceHash: Sha256Schema,
  }),
]);

export const BrowserAuthorizationReceiptSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("policy_grant"),
      ...BrowserAuthorizationBindingShape,
      tool: z.enum(["browser_navigate", "browser_set_field", "browser_activate"]),
      risk: z.literal("reversible"),
      decisionId: EntityIdSchema,
      grantHash: Sha256Schema,
      executionReservationId: EntityIdSchema,
      executionNonceHash: Sha256Schema,
      executionLeaseExpiresAt: IsoDateTimeSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("effect_claim"),
      ...BrowserAuthorizationBindingShape,
      tool: z.enum([
        "browser_navigate",
        "browser_set_field",
        "browser_activate",
        "browser_set_file",
        "browser_submit",
      ]),
      risk: z.enum(["reversible", "consequential"]),
      approvalId: EntityIdSchema,
      dispatchEffectId: EntityIdSchema,
      workerId: EntityIdSchema,
      claimTokenHash: Sha256Schema,
      executionReservationId: EntityIdSchema,
      executionNonceHash: Sha256Schema,
      executionLeaseExpiresAt: IsoDateTimeSchema,
    })
    .strict(),
]);

export const BrowserTrustedAuthorizationRecordSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("policy_grant"),
      ...BrowserAuthorizationBindingShape,
      tool: z.enum(["browser_navigate", "browser_set_field", "browser_activate"]),
      risk: z.literal("reversible"),
      decisionId: EntityIdSchema,
      policyVersion: z.string().min(1).max(160),
      grantHash: Sha256Schema,
      executionReservationId: EntityIdSchema,
      executionNonceHash: Sha256Schema,
      executionLeaseExpiresAt: IsoDateTimeSchema,
      status: z.literal("executing"),
      issuedAt: IsoDateTimeSchema,
      expiresAt: IsoDateTimeSchema,
      executingAt: IsoDateTimeSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("effect_claim"),
      ...BrowserAuthorizationBindingShape,
      tool: z.enum([
        "browser_navigate",
        "browser_set_field",
        "browser_activate",
        "browser_set_file",
        "browser_submit",
      ]),
      risk: z.enum(["reversible", "consequential"]),
      approvalId: EntityIdSchema,
      dispatchEffectId: EntityIdSchema,
      workerId: EntityIdSchema,
      claimTokenHash: Sha256Schema,
      executionReservationId: EntityIdSchema,
      executionNonceHash: Sha256Schema,
      executionLeaseExpiresAt: IsoDateTimeSchema,
      status: z.literal("executing"),
      claimedAt: IsoDateTimeSchema,
      approvalConsumedAt: IsoDateTimeSchema,
      executingAt: IsoDateTimeSchema,
    })
    .strict(),
]);

export const BrowserWriteVerificationSchema = z
  .object({
    actionability: BrowserActionabilitySchema,
    postconditions: z.array(BrowserPostconditionResultSchema).min(1).max(20),
    verifiedAt: IsoDateTimeSchema,
  })
  .strict();

export const BrowserNavigationVerificationSchema = z
  .object({
    sourceSnapshotId: EntityIdSchema,
    pageFingerprintMatched: z.literal(true),
    redirectChain: z
      .array(
        z
          .object({
            url: BrowserHttpUrlSchema,
            origin: HttpOriginSchema,
            originAllowed: z.literal(true),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    postconditions: z.array(BrowserPostconditionResultSchema).min(1).max(20),
    verifiedAt: IsoDateTimeSchema,
  })
  .strict();

export const BrowserToolErrorSchema = z
  .object({
    code: z.string().min(1).max(160),
    message: z.string().min(1).max(2_000),
    redacted: z.literal(true),
    diagnosticHash: Sha256Schema.optional(),
  })
  .strict();

const BrowserResultBaseShape = {
  contractVersion: z.literal(CONTRACT_VERSION),
  requestId: EntityIdSchema,
  applicationId: EntityIdSchema,
  runId: EntityIdSchema,
  browserSessionRef: EntityIdSchema,
  startedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema,
};

const BrowserReadFailureSchema = z
  .object({
    ...BrowserResultBaseShape,
    outcome: z.enum(["blocked", "needs_takeover", "retryable_failure", "fatal_failure"]),
    error: BrowserToolErrorSchema,
  })
  .strict();

const BrowserWriteFailureBaseShape = {
  ...BrowserResultBaseShape,
  actionId: EntityIdSchema,
  actionFingerprint: Sha256Schema,
  authorizationReceipt: BrowserAuthorizationReceiptSchema,
  beforeSnapshot: BrowserPageSnapshotSchema,
  afterSnapshot: BrowserPageSnapshotSchema.optional(),
  checkpoint: ApplicationCheckpointSchema,
  evidenceArtifactIds: z.array(EntityIdSchema).max(20),
  error: BrowserToolErrorSchema,
};

const BrowserWriteNotAttemptedFailureSchema = z
  .object({
    ...BrowserWriteFailureBaseShape,
    outcome: z.enum([
      "blocked",
      "needs_takeover",
      "retryable_failure",
      "fatal_failure",
    ]),
    actionAttempted: z.literal(false),
    outcomeCertain: z.literal(true),
  })
  .strict();

const BrowserWriteVerifiedNotAppliedSchema = z
  .object({
    ...BrowserWriteFailureBaseShape,
    outcome: z.literal("verified_not_applied"),
    actionAttempted: z.boolean(),
    outcomeCertain: z.literal(true),
    afterSnapshot: BrowserPageSnapshotSchema,
    nonApplicationProof: z
      .object({
        proofKind: z.enum([
          "snapshot_state_unchanged",
          "network_request_not_sent",
          "server_rejection_before_commit",
        ]),
        predecessorSnapshotId: EntityIdSchema,
        observedSnapshotId: EntityIdSchema,
        evidenceArtifactIds: z.array(EntityIdSchema).min(1).max(20),
        evidenceHash: Sha256Schema,
        verifiedAt: IsoDateTimeSchema,
      })
      .strict(),
  })
  .strict();

const BrowserWriteUncertainFailureSchema = z
  .object({
    ...BrowserWriteFailureBaseShape,
    outcome: z.enum(["uncertain", "manual_reconciliation"]),
    actionAttempted: z.literal(true),
    outcomeCertain: z.literal(false),
  })
  .strict();

function readOutputSchema<const TName extends z.infer<typeof BrowserMcpToolNameSchema>, T extends z.ZodRawShape>(
  tool: TName,
  successShape: T,
) {
  return z
    .object({
      result: z.union([
        z.object({
          ...BrowserResultBaseShape,
          tool: z.literal(tool),
          outcome: z.literal("success"),
          ...successShape,
        }).strict(),
        BrowserReadFailureSchema.extend({ tool: z.literal(tool) }).strict(),
      ]),
    })
    .strict();
}

function writeOutputSchema<const TName extends z.infer<typeof BrowserMcpToolNameSchema>, T extends z.ZodRawShape>(
  tool: TName,
  verificationSchema: z.ZodType,
  successShape: T,
) {
  return z
    .object({
      result: z.union([
        z.object({
          ...BrowserResultBaseShape,
          tool: z.literal(tool),
          outcome: z.literal("verified_applied"),
          actionId: EntityIdSchema,
          actionFingerprint: Sha256Schema,
          authorizationReceipt: BrowserAuthorizationReceiptSchema,
          beforeSnapshot: BrowserPageSnapshotSchema,
          afterSnapshot: BrowserPageSnapshotSchema,
          verification: verificationSchema,
          checkpoint: ApplicationCheckpointSchema,
          evidenceArtifactIds: z.array(EntityIdSchema).max(20),
          ...successShape,
        }).strict(),
        BrowserWriteNotAttemptedFailureSchema.extend({ tool: z.literal(tool) }).strict(),
        BrowserWriteVerifiedNotAppliedSchema.extend({ tool: z.literal(tool) }).strict(),
        BrowserWriteUncertainFailureSchema.extend({ tool: z.literal(tool) }).strict(),
      ]),
    })
    .strict();
}

export const BrowserSessionOpenOutputSchema = readOutputSchema("browser_session_open", {
  pageSnapshot: BrowserPageSnapshotSchema,
});
export const BrowserSnapshotOutputSchema = readOutputSchema("browser_snapshot", {
  pageSnapshot: BrowserPageSnapshotSchema,
});
export const BrowserNavigateOutputSchema = writeOutputSchema(
  "browser_navigate",
  BrowserNavigationVerificationSchema,
  {},
);
export const BrowserSetFieldOutputSchema = writeOutputSchema(
  "browser_set_field",
  BrowserWriteVerificationSchema,
  {},
);
export const BrowserActivateOutputSchema = writeOutputSchema(
  "browser_activate",
  BrowserWriteVerificationSchema,
  {},
);
export const BrowserRequestTakeoverOutputSchema = readOutputSchema("browser_request_takeover", {
  takeoverRequestId: EntityIdSchema,
  checkpoint: ApplicationCheckpointSchema,
});
export const BrowserSetFileOutputSchema = writeOutputSchema("browser_set_file", BrowserWriteVerificationSchema, {
  attachedArtifactHash: Sha256Schema,
});
export const BrowserSubmitOutputSchema = writeOutputSchema("browser_submit", BrowserWriteVerificationSchema, {
  reviewSnapshotHash: Sha256Schema,
  receiptArtifactId: EntityIdSchema,
});

export const BrowserMcpToolDescriptorSchema = z
  .object({
    name: BrowserMcpToolNameSchema,
    title: z.string().min(1).max(160),
    description: z.string().min(1).max(2_000),
    risk: ActionRiskSchema,
    inputSchemaName: z.string().min(1).max(160),
    outputSchemaName: z.string().min(1).max(160),
    annotations: z
      .object({
        readOnlyHint: z.boolean(),
        destructiveHint: z.boolean(),
        idempotentHint: z.boolean(),
        openWorldHint: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type BrowserMcpToolName = z.infer<typeof BrowserMcpToolNameSchema>;
export type BrowserPageSnapshot = z.infer<typeof BrowserPageSnapshotSchema>;
export type BrowserLivePageObservation = z.infer<typeof BrowserLivePageObservationSchema>;
export type BrowserTrustedEvidenceRecord = z.infer<typeof BrowserTrustedEvidenceRecordSchema>;
export type BrowserTrustedArtifactRecord = z.infer<typeof BrowserTrustedArtifactRecordSchema>;
export type BrowserSnapshotTarget = z.infer<typeof BrowserSnapshotTargetSchema>;
export type BrowserWriteAuthorization = z.infer<typeof BrowserWriteAuthorizationSchema>;
export type BrowserTrustedAuthorizationRecord = z.infer<
  typeof BrowserTrustedAuthorizationRecordSchema
>;
export type BrowserMcpToolDescriptor = z.infer<typeof BrowserMcpToolDescriptorSchema>;

export interface BrowserMcpToolContract {
  descriptor: BrowserMcpToolDescriptor;
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
}

export const browserMcpToolCatalog = {
  browser_session_open: {
    descriptor: {
      name: "browser_session_open",
      title: "Open browser session",
      description: "Open an isolated Playwright session on an allowlisted HTTP(S) origin.",
      risk: "read_only",
      inputSchemaName: "BrowserSessionOpenInput",
      outputSchemaName: "BrowserSessionOpenOutput",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    inputSchema: BrowserSessionOpenInputSchema,
    outputSchema: BrowserSessionOpenOutputSchema,
  },
  browser_snapshot: {
    descriptor: {
      name: "browser_snapshot",
      title: "Observe current page",
      description: "Return an accessibility-first, redacted page and form snapshot with server-owned locator recipes.",
      risk: "read_only",
      inputSchemaName: "BrowserSnapshotInput",
      outputSchemaName: "BrowserSnapshotOutput",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    inputSchema: BrowserSnapshotInputSchema,
    outputSchema: BrowserSnapshotOutputSchema,
  },
  browser_navigate: {
    descriptor: {
      name: "browser_navigate",
      title: "Navigate within allowed origins",
      description: "Navigate to an allowlisted URL and verify the resulting URL and fresh page snapshot.",
      risk: "reversible",
      inputSchemaName: "BrowserNavigateInput",
      outputSchemaName: "BrowserNavigateOutput",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    inputSchema: BrowserNavigateInputSchema,
    outputSchema: BrowserNavigateOutputSchema,
  },
  browser_set_field: {
    descriptor: {
      name: "browser_set_field",
      title: "Set form field",
      description: "Set one snapshotted form control and verify its normalized postcondition without logging the value.",
      risk: "reversible",
      inputSchemaName: "BrowserSetFieldInput",
      outputSchemaName: "BrowserSetFieldOutput",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    inputSchema: BrowserSetFieldInputSchema,
    outputSchema: BrowserSetFieldOutputSchema,
  },
  browser_activate: {
    descriptor: {
      name: "browser_activate",
      title: "Activate non-submit control",
      description: "Activate only a snapshotted continue, expand, previous, add, or remove control; submit candidates are rejected.",
      risk: "reversible",
      inputSchemaName: "BrowserActivateInput",
      outputSchemaName: "BrowserActivateOutput",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    inputSchema: BrowserActivateInputSchema,
    outputSchema: BrowserActivateOutputSchema,
  },
  browser_request_takeover: {
    descriptor: {
      name: "browser_request_takeover",
      title: "Request human takeover",
      description: "Stop agent writes at a durable checkpoint for login, MFA, CAPTCHA, sensitive, or unfamiliar interactions.",
      risk: "takeover",
      inputSchemaName: "BrowserRequestTakeoverInput",
      outputSchemaName: "BrowserRequestTakeoverOutput",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    inputSchema: BrowserRequestTakeoverInputSchema,
    outputSchema: BrowserRequestTakeoverOutputSchema,
  },
  browser_set_file: {
    descriptor: {
      name: "browser_set_file",
      title: "Upload approved artifact",
      description: "Attach an approved artifact by immutable ID and hash; local filesystem paths are never accepted.",
      risk: "consequential",
      inputSchemaName: "BrowserSetFileInput",
      outputSchemaName: "BrowserSetFileOutput",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    inputSchema: BrowserSetFileInputSchema,
    outputSchema: BrowserSetFileOutputSchema,
  },
  browser_submit: {
    descriptor: {
      name: "browser_submit",
      title: "Submit application",
      description: "Execute the exact approval-bound final submit action once and capture a verifiable receipt or manual-reconciliation result.",
      risk: "consequential",
      inputSchemaName: "BrowserSubmitInput",
      outputSchemaName: "BrowserSubmitOutput",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    inputSchema: BrowserSubmitInputSchema,
    outputSchema: BrowserSubmitOutputSchema,
  },
} as const satisfies Record<BrowserMcpToolName, BrowserMcpToolContract>;
