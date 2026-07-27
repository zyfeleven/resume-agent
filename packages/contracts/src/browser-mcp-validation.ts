import { z } from "zod";

import { ApplicationCheckpointSchema, type ApplicationCheckpoint } from "./application.js";
import {
  BrowserActivateInputSchema,
  BrowserActivateOutputSchema,
  BrowserNavigateInputSchema,
  BrowserNavigateOutputSchema,
  BrowserLivePageObservationSchema,
  BrowserPageSnapshotSchema,
  BrowserSessionOpenInputSchema,
  BrowserSessionOpenOutputSchema,
  BrowserSetFieldInputSchema,
  BrowserSetFieldOutputSchema,
  BrowserSetFileInputSchema,
  BrowserSetFileOutputSchema,
  BrowserSubmitInputSchema,
  BrowserSubmitOutputSchema,
  BrowserSnapshotInputSchema,
  BrowserSnapshotOutputSchema,
  BrowserTrustedAuthorizationRecordSchema,
  BrowserTrustedArtifactRecordSchema,
  BrowserTrustedEvidenceRecordSchema,
  type BrowserPageSnapshot,
  type BrowserLivePageObservation,
  type BrowserSnapshotTarget,
  type BrowserTrustedAuthorizationRecord,
  type BrowserTrustedArtifactRecord,
  type BrowserTrustedEvidenceRecord,
} from "./browser-mcp.js";
import { IsoDateTimeSchema } from "./common.js";

export const browserWriteInputSchemas = {
  browser_navigate: BrowserNavigateInputSchema,
  browser_set_field: BrowserSetFieldInputSchema,
  browser_activate: BrowserActivateInputSchema,
  browser_set_file: BrowserSetFileInputSchema,
  browser_submit: BrowserSubmitInputSchema,
} as const;

export const browserReadInputSchemas = {
  browser_session_open: BrowserSessionOpenInputSchema,
  browser_snapshot: BrowserSnapshotInputSchema,
} as const;

export const browserReadOutputSchemas = {
  browser_session_open: BrowserSessionOpenOutputSchema,
  browser_snapshot: BrowserSnapshotOutputSchema,
} as const;

export type BrowserReadToolName = keyof typeof browserReadInputSchemas;

export const browserWriteOutputSchemas = {
  browser_navigate: BrowserNavigateOutputSchema,
  browser_set_field: BrowserSetFieldOutputSchema,
  browser_activate: BrowserActivateOutputSchema,
  browser_set_file: BrowserSetFileOutputSchema,
  browser_submit: BrowserSubmitOutputSchema,
} as const;

export type BrowserWriteToolName = keyof typeof browserWriteInputSchemas;
export type BrowserWriteRequest =
  | ReturnType<typeof BrowserNavigateInputSchema.parse>
  | ReturnType<typeof BrowserSetFieldInputSchema.parse>
  | ReturnType<typeof BrowserActivateInputSchema.parse>
  | ReturnType<typeof BrowserSetFileInputSchema.parse>
  | ReturnType<typeof BrowserSubmitInputSchema.parse>;

export interface BrowserSemanticIssue {
  code: string;
  message: string;
  path: string;
}

export interface BrowserSemanticValidation {
  success: boolean;
  issues: BrowserSemanticIssue[];
}

export const BrowserWriteValidationContextSchema = z
  .object({
    snapshot: BrowserPageSnapshotSchema,
    livePage: BrowserLivePageObservationSchema,
    checkpoint: ApplicationCheckpointSchema,
    authorizationRecord: BrowserTrustedAuthorizationRecordSchema,
    evidenceRecords: z.array(BrowserTrustedEvidenceRecordSchema).max(100),
    artifactRecords: z.array(BrowserTrustedArtifactRecordSchema).max(100),
    observedSnapshots: z.array(BrowserPageSnapshotSchema).min(1).max(100),
    now: IsoDateTimeSchema,
  })
  .strict();

export type BrowserWriteValidationContext = z.infer<
  typeof BrowserWriteValidationContextSchema
>;

function issue(
  issues: BrowserSemanticIssue[],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function normalizedOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:" || url.username || url.password) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (typeof value === "object" && value) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Browser action payload contains a non-JSON value.");
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalActionPayload(tool: BrowserWriteToolName, request: BrowserWriteRequest): unknown {
  const authorization = request.authorization;
  const common = {
    contractVersion: request.contractVersion,
    applicationId: request.applicationId,
    runId: request.runId,
    browserSessionRef: request.browserSessionRef,
    tool,
    risk: authorization.risk,
    actionId: authorization.actionId,
    sourceSnapshotId: request.snapshotId,
    pageFingerprint: request.expectedPageFingerprint,
    checkpointId: request.checkpointId,
    expectedStateRevision: request.expectedStateRevision,
    expectedPageGeneration: request.expectedPageGeneration,
    allowedOrigins: [...request.allowedOrigins].sort(),
    deadlineAt: request.deadlineAt,
  };

  switch (tool) {
    case "browser_navigate": {
      const value = BrowserNavigateInputSchema.parse(request);
      return {
        ...common,
        targetUrl: value.targetUrl,
        expectedUrlHash: value.expectedUrlHash,
        postconditions: value.postconditions,
      };
    }
    case "browser_set_field": {
      const value = BrowserSetFieldInputSchema.parse(request);
      return {
        ...common,
        target: value.target,
        valueHash: value.valueHash,
        normalizedValueHash: value.normalizedValueHash,
        valueSensitivity: value.valueSensitivity,
        postconditions: value.postconditions,
      };
    }
    case "browser_activate": {
      const value = BrowserActivateInputSchema.parse(request);
      return {
        ...common,
        target: value.target,
        intent: value.intent,
        postconditions: value.postconditions,
      };
    }
    case "browser_set_file": {
      const value = BrowserSetFileInputSchema.parse(request);
      return {
        ...common,
        target: value.target,
        artifact: value.artifact,
        postconditions: value.postconditions,
      };
    }
    case "browser_submit": {
      const value = BrowserSubmitInputSchema.parse(request);
      return {
        ...common,
        target: value.target,
        reviewSnapshotHash: value.reviewSnapshotHash,
        expectedReceiptSignals: value.expectedReceiptSignals,
        postconditions: value.postconditions,
      };
    }
  }
}

export async function computeBrowserActionFingerprint(
  tool: BrowserWriteToolName,
  input: unknown,
): Promise<string> {
  const request = browserWriteInputSchemas[tool].parse(input) as BrowserWriteRequest;
  return sha256(canonicalize(canonicalActionPayload(tool, request)));
}

function validateSnapshotIntegrity(
  snapshot: BrowserPageSnapshot,
  allowedOrigins: string[],
  issues: BrowserSemanticIssue[],
): void {
  const allowed = new Set(allowedOrigins.map(normalizedOrigin).filter(Boolean));
  const pageOrigin = normalizedOrigin(snapshot.url);
  if (!pageOrigin || pageOrigin !== normalizedOrigin(snapshot.origin) || !allowed.has(pageOrigin)) {
    issue(issues, "ORIGIN_MISMATCH", "snapshot.origin", "Page URL and origin must match the allowlist.");
  }

  const frameIds = new Set<string>();
  for (const frame of snapshot.frames) {
    if (frameIds.has(frame.id)) {
      issue(issues, "DUPLICATE_FRAME_ID", `snapshot.frames.${frame.id}`, "Frame IDs must be globally unique within a snapshot.");
    }
    frameIds.add(frame.id);
  }
  const roots = snapshot.frames.filter((frame) => !frame.parentId);
  if (roots.length !== 1) {
    issue(issues, "FRAME_ROOT_INVALID", "snapshot.frames", "A snapshot must contain exactly one root frame.");
  } else if (
    roots[0]!.url !== snapshot.url ||
    normalizedOrigin(roots[0]!.origin) !== normalizedOrigin(snapshot.origin)
  ) {
    issue(issues, "FRAME_ROOT_PAGE_MISMATCH", "snapshot.frames", "The root frame must represent the snapshot page URL and origin.");
  }

  const frames = new Map(snapshot.frames.map((frame) => [frame.id, frame]));
  for (const frame of snapshot.frames) {
    const frameOrigin = normalizedOrigin(frame.url);
    if (!frameOrigin || frameOrigin !== normalizedOrigin(frame.origin) || !allowed.has(frameOrigin)) {
      issue(issues, "FRAME_ORIGIN_MISMATCH", `snapshot.frames.${frame.id}`, "Every frame URL must match an allowlisted origin.");
    }
    if (frame.parentId && !frames.has(frame.parentId)) {
      issue(issues, "FRAME_PARENT_MISSING", `snapshot.frames.${frame.id}.parentId`, "Frame parent is missing from the snapshot.");
    }
    const visited = new Set<string>();
    let ancestor = frame;
    while (ancestor.parentId) {
      if (visited.has(ancestor.id)) {
        issue(issues, "FRAME_CYCLE", `snapshot.frames.${frame.id}`, "Frame ancestry contains a cycle.");
        break;
      }
      visited.add(ancestor.id);
      const parent = frames.get(ancestor.parentId);
      if (!parent) break;
      ancestor = parent;
    }
    if (!ancestor.parentId && roots.length === 1 && ancestor.id !== roots[0]?.id) {
      issue(issues, "FRAME_TREE_DISCONNECTED", `snapshot.frames.${frame.id}`, "Every frame must descend from the single root frame.");
    }
  }

  const targetIds = new Set<string>();
  const locatorIds = new Set<string>();
  for (const target of snapshot.targets) {
    if (targetIds.has(target.id)) {
      issue(issues, "DUPLICATE_TARGET_ID", `snapshot.targets.${target.id}`, "Target IDs must be globally unique within a snapshot.");
    }
    targetIds.add(target.id);
    if (!frames.has(target.frameId)) {
      issue(issues, "TARGET_FRAME_MISSING", `snapshot.targets.${target.id}.frameId`, "Target frame is missing.");
      continue;
    }
    const ancestry: string[] = [];
    const visited = new Set<string>();
    let frame = frames.get(target.frameId);
    while (frame) {
      if (visited.has(frame.id)) {
        issue(issues, "FRAME_CYCLE", `snapshot.targets.${target.id}`, "Frame ancestry contains a cycle.");
        break;
      }
      visited.add(frame.id);
      ancestry.unshift(frame.id);
      frame = frame.parentId ? frames.get(frame.parentId) : undefined;
    }
    for (const recipe of target.locatorRecipes) {
      if (locatorIds.has(recipe.id)) {
        issue(issues, "DUPLICATE_LOCATOR_ID", `snapshot.targets.${target.id}.locatorRecipes.${recipe.id}`, "Locator recipe IDs must be globally unique within a snapshot.");
      }
      locatorIds.add(recipe.id);
      if (recipe.sourceSnapshotId !== snapshot.snapshotId) {
        issue(issues, "LOCATOR_SNAPSHOT_MISMATCH", `snapshot.targets.${target.id}.locatorRecipes.${recipe.id}`, "Locator recipe belongs to a different snapshot.");
      }
      if (canonicalize(recipe.framePath) !== canonicalize(ancestry)) {
        issue(issues, "LOCATOR_FRAME_MISMATCH", `snapshot.targets.${target.id}.locatorRecipes.${recipe.id}.framePath`, "Locator frame path does not match frame ancestry.");
      }
    }
  }
}

export function validateBrowserPageSnapshot(
  snapshotInput: unknown,
  allowedOrigins: string[],
): BrowserSemanticValidation {
  const snapshot = BrowserPageSnapshotSchema.parse(snapshotInput);
  const issues: BrowserSemanticIssue[] = [];
  validateSnapshotIntegrity(snapshot, allowedOrigins, issues);
  return { success: issues.length === 0, issues };
}

export function validateBrowserSessionOpenRequest(
  input: unknown,
  now?: string,
): BrowserSemanticValidation {
  const request = BrowserSessionOpenInputSchema.parse(input);
  const allowed = new Set(request.allowedOrigins.map(normalizedOrigin));
  const issues: BrowserSemanticIssue[] = [];
  if (!allowed.has(normalizedOrigin(request.targetUrl))) {
    issue(issues, "SESSION_ORIGIN_BLOCKED", "targetUrl", "Initial browser target is outside the allowlist.");
  }
  if (now && Date.parse(request.deadlineAt) <= Date.parse(IsoDateTimeSchema.parse(now))) {
    issue(issues, "REQUEST_DEADLINE_EXPIRED", "deadlineAt", "Browser session request deadline has expired.");
  }
  return { success: issues.length === 0, issues };
}

export function validateBrowserReadRequest(
  tool: BrowserReadToolName,
  input: unknown,
  now: string,
): BrowserSemanticValidation {
  const trustedNow = IsoDateTimeSchema.parse(now);
  if (tool === "browser_session_open") {
    return validateBrowserSessionOpenRequest(input, trustedNow);
  }
  const request = BrowserSnapshotInputSchema.parse(input);
  const issues: BrowserSemanticIssue[] = [];
  if (Date.parse(request.deadlineAt) <= Date.parse(trustedNow)) {
    issue(issues, "REQUEST_DEADLINE_EXPIRED", "deadlineAt", "Browser snapshot request deadline has expired.");
  }
  if (new Set(request.allowedOrigins.map(normalizedOrigin)).size !== request.allowedOrigins.length) {
    issue(issues, "DUPLICATE_ALLOWED_ORIGIN", "allowedOrigins", "Allowed origins must be unique.");
  }
  return { success: issues.length === 0, issues };
}

export function validateBrowserReadResult(
  tool: BrowserReadToolName,
  input: unknown,
  output: unknown,
  now: string,
): BrowserSemanticValidation {
  const requestValidation = validateBrowserReadRequest(tool, input, now);
  const request = browserReadInputSchemas[tool].parse(input);
  const parsed = browserReadOutputSchemas[tool].parse(output) as {
    result: Record<string, unknown>;
  };
  const result = parsed.result;
  const issues = [...requestValidation.issues];
  if (
    result.requestId !== request.requestId ||
    result.applicationId !== request.applicationId ||
    result.runId !== request.runId ||
    result.tool !== tool ||
    Date.parse(String(result.startedAt)) > Date.parse(String(result.completedAt)) ||
    Date.parse(String(result.completedAt)) > Date.parse(request.deadlineAt)
  ) {
    issue(issues, "READ_RESULT_SCOPE_MISMATCH", "result", "Read result must match the request scope and deadline.");
  }
  if (tool === "browser_snapshot") {
    const snapshotRequest = BrowserSnapshotInputSchema.parse(input);
    if (result.browserSessionRef !== snapshotRequest.browserSessionRef) {
      issue(issues, "READ_RESULT_SESSION_MISMATCH", "result.browserSessionRef", "Snapshot result belongs to a different browser session.");
    }
  }
  if (result.outcome === "success") {
    const snapshot = BrowserPageSnapshotSchema.parse(result.pageSnapshot);
    validateSnapshotIntegrity(snapshot, request.allowedOrigins, issues);
    if (
      snapshot.applicationId !== request.applicationId ||
      snapshot.runId !== request.runId ||
      snapshot.browserSessionRef !== result.browserSessionRef ||
      Date.parse(snapshot.observedAt) < Date.parse(String(result.startedAt)) ||
      Date.parse(snapshot.observedAt) > Date.parse(String(result.completedAt)) ||
      Date.parse(snapshot.leaseExpiresAt) <= Date.parse(String(result.completedAt))
    ) {
      issue(issues, "READ_SNAPSHOT_SCOPE_MISMATCH", "result.pageSnapshot", "Returned snapshot must be fresh and owned by the exact read result scope.");
    }
  }
  return { success: issues.length === 0, issues };
}

const MAX_LIVE_PAGE_OBSERVATION_AGE_MS = 5_000;

function validateTrustedContextIntegrity(
  context: BrowserWriteValidationContext,
  issues: BrowserSemanticIssue[],
): void {
  const collections: Array<[string, readonly string[]]> = [
    ["evidenceRecords", context.evidenceRecords.map((record) => record.artifactId)],
    ["artifactRecords", context.artifactRecords.map((record) => record.artifactId)],
    ["observedSnapshots", context.observedSnapshots.map((snapshot) => snapshot.snapshotId)],
  ];
  for (const [path, ids] of collections) {
    if (new Set(ids).size !== ids.length) {
      issue(issues, "TRUSTED_CONTEXT_DUPLICATE_ID", path, "Trusted context collections must use unique identifiers.");
    }
  }
}

function findTarget(
  request: Exclude<BrowserWriteRequest, ReturnType<typeof BrowserNavigateInputSchema.parse>>,
  snapshot: BrowserPageSnapshot,
  issues: BrowserSemanticIssue[],
): BrowserSnapshotTarget | undefined {
  const target = snapshot.targets.find((candidate) => candidate.id === request.target.targetId);
  if (!target) {
    issue(issues, "TARGET_NOT_FOUND", "target.targetId", "Target is not present in the bound snapshot.");
    return undefined;
  }
  if (!target.locatorRecipes.some((recipe) => recipe.id === request.target.locatorRecipeId)) {
    issue(issues, "LOCATOR_NOT_FOUND", "target.locatorRecipeId", "Locator recipe is not owned by the target.");
  }
  return target;
}

function validateCheckpointScope(
  request: BrowserWriteRequest,
  checkpoint: ApplicationCheckpoint,
  snapshot: BrowserPageSnapshot,
  issues: BrowserSemanticIssue[],
): void {
  const authorization = request.authorization;
  if (
    checkpoint.id !== request.checkpointId ||
    checkpoint.applicationId !== request.applicationId ||
    checkpoint.runId !== request.runId ||
    checkpoint.browserSessionRef !== request.browserSessionRef
  ) {
    issue(issues, "CHECKPOINT_SCOPE_MISMATCH", "checkpoint", "Checkpoint does not match the request scope.");
  }
  if (
    checkpoint.url !== snapshot.url ||
    checkpoint.pageFingerprint !== snapshot.pageFingerprint ||
    normalizedOrigin(checkpoint.allowedOrigin) !== normalizedOrigin(snapshot.origin)
  ) {
    issue(issues, "CHECKPOINT_PAGE_MISMATCH", "checkpoint", "Checkpoint does not match the bound page snapshot.");
  }
  if (checkpoint.stateRevision !== request.expectedStateRevision) {
    issue(issues, "CHECKPOINT_REVISION_MISMATCH", "checkpoint.stateRevision", "Checkpoint revision is stale.");
  }
  if (checkpoint.completedActionIds.includes(authorization.actionId)) {
    issue(issues, "CHECKPOINT_ACTION_ALREADY_COMPLETED", "checkpoint.completedActionIds", "Pre-action checkpoint already contains this action.");
  }
}

async function validateAuthorizationBinding(
  tool: BrowserWriteToolName,
  request: BrowserWriteRequest,
  snapshot: BrowserPageSnapshot,
  trustedRecordInput: BrowserTrustedAuthorizationRecord,
  now: string,
  issues: BrowserSemanticIssue[],
): Promise<void> {
  const authorization = request.authorization;
  const trustedRecord = BrowserTrustedAuthorizationRecordSchema.parse(trustedRecordInput);
  const expectedRisk = tool === "browser_set_file" || tool === "browser_submit"
    ? "consequential"
    : "reversible";
  if (
    authorization.applicationId !== request.applicationId ||
    authorization.runId !== request.runId ||
    authorization.browserSessionRef !== request.browserSessionRef ||
    authorization.tool !== tool ||
    authorization.risk !== expectedRisk ||
    authorization.sourceSnapshotId !== request.snapshotId ||
    authorization.pageFingerprint !== request.expectedPageFingerprint ||
    authorization.pageGeneration !== request.expectedPageGeneration ||
    normalizedOrigin(authorization.origin) !== normalizedOrigin(snapshot.origin)
  ) {
    issue(issues, "AUTHORIZATION_SCOPE_MISMATCH", "authorization", "Authorization is not bound to this exact browser action scope.");
  }
  if (
    authorization.kind === "policy_grant" &&
    (Date.parse(authorization.expiresAt) <= Date.parse(now) ||
      Date.parse(request.deadlineAt) > Date.parse(authorization.expiresAt))
  ) {
    issue(issues, "AUTHORIZATION_EXPIRED", "authorization.expiresAt", "Policy grant must remain active through the request deadline.");
  }
  const commonRecordMismatch =
    trustedRecord.kind !== authorization.kind ||
    trustedRecord.applicationId !== authorization.applicationId ||
    trustedRecord.runId !== authorization.runId ||
    trustedRecord.browserSessionRef !== authorization.browserSessionRef ||
    trustedRecord.actionId !== authorization.actionId ||
    trustedRecord.actionFingerprint !== authorization.actionFingerprint ||
    trustedRecord.sourceSnapshotId !== authorization.sourceSnapshotId ||
    trustedRecord.pageFingerprint !== authorization.pageFingerprint ||
    trustedRecord.pageGeneration !== authorization.pageGeneration ||
    normalizedOrigin(trustedRecord.origin) !== normalizedOrigin(authorization.origin) ||
    trustedRecord.tool !== authorization.tool ||
    trustedRecord.risk !== authorization.risk;
  if (commonRecordMismatch) {
    issue(issues, "TRUSTED_AUTHORIZATION_MISMATCH", "authorization", "Authorization does not match the trusted persisted record.");
    return;
  }
  if (authorization.kind === "policy_grant" && trustedRecord.kind === "policy_grant") {
    const executionNonceHash = await sha256(authorization.executionNonce);
    if (
      trustedRecord.status !== "executing" ||
      trustedRecord.decisionId !== authorization.decisionId ||
      trustedRecord.policyVersion !== authorization.policyVersion ||
      trustedRecord.grantHash !== authorization.grantHash ||
      trustedRecord.issuedAt !== authorization.issuedAt ||
      trustedRecord.expiresAt !== authorization.expiresAt ||
      trustedRecord.executionReservationId !== authorization.executionReservationId ||
      trustedRecord.executionNonceHash !== executionNonceHash ||
      trustedRecord.executionLeaseExpiresAt !== authorization.executionLeaseExpiresAt ||
      Date.parse(trustedRecord.expiresAt) <= Date.parse(now) ||
      Date.parse(trustedRecord.issuedAt) > Date.parse(now) ||
      Date.parse(trustedRecord.issuedAt) >= Date.parse(trustedRecord.expiresAt) ||
      Date.parse(trustedRecord.issuedAt) > Date.parse(trustedRecord.executingAt) ||
      Date.parse(trustedRecord.executingAt) > Date.parse(now) ||
      Date.parse(trustedRecord.executionLeaseExpiresAt) <= Date.parse(now) ||
      Date.parse(request.deadlineAt) > Date.parse(trustedRecord.executionLeaseExpiresAt)
    ) {
      issue(issues, "TRUSTED_POLICY_GRANT_INVALID", "authorization", "Policy execution requires the exact live one-time reservation.");
    }
  }
  if (authorization.kind === "effect_claim" && trustedRecord.kind === "effect_claim") {
    const claimTokenHash = await sha256(authorization.claimToken);
    const executionNonceHash = await sha256(authorization.executionNonce);
    if (
      trustedRecord.status !== "executing" ||
      trustedRecord.approvalId !== authorization.approvalId ||
      trustedRecord.dispatchEffectId !== authorization.dispatchEffectId ||
      trustedRecord.workerId !== authorization.workerId ||
      trustedRecord.claimedAt !== authorization.claimedAt ||
      trustedRecord.claimTokenHash !== claimTokenHash ||
      trustedRecord.executionReservationId !== authorization.executionReservationId ||
      trustedRecord.executionNonceHash !== executionNonceHash ||
      trustedRecord.executionLeaseExpiresAt !== authorization.executionLeaseExpiresAt ||
      Date.parse(trustedRecord.approvalConsumedAt) > Date.parse(trustedRecord.claimedAt) ||
      Date.parse(trustedRecord.claimedAt) > Date.parse(trustedRecord.executingAt) ||
      Date.parse(trustedRecord.executingAt) > Date.parse(now) ||
      Date.parse(trustedRecord.executionLeaseExpiresAt) <= Date.parse(now) ||
      Date.parse(request.deadlineAt) > Date.parse(trustedRecord.executionLeaseExpiresAt)
    ) {
      issue(issues, "TRUSTED_EFFECT_CLAIM_INVALID", "authorization", "Effect execution requires the exact live reservation created by an atomic claimed-to-executing transition.");
    }
  }
}

function validatePostconditionRequest(
  tool: BrowserWriteToolName,
  request: BrowserWriteRequest,
  issues: BrowserSemanticIssue[],
): void {
  const ids = new Set<string>();
  for (const condition of request.postconditions) {
    if (ids.has(condition.id)) {
      issue(issues, "DUPLICATE_POSTCONDITION", "postconditions", "Postcondition IDs must be unique.");
    }
    ids.add(condition.id);
  }
  if (tool === "browser_navigate") {
    const value = BrowserNavigateInputSchema.parse(request);
    if (
      !value.postconditions.some(
        (condition) => condition.kind === "url" && condition.expectedHash === value.expectedUrlHash,
      )
    ) {
      issue(issues, "NAVIGATION_BINDING_MISMATCH", "expectedUrlHash", "Navigation must verify the exact expected URL hash.");
    }
  }
  if (tool === "browser_set_field") {
    const value = BrowserSetFieldInputSchema.parse(request);
    if (
      !value.postconditions.some(
        (condition) =>
          condition.kind === "normalized_value_hash" &&
          condition.expectedHash === value.normalizedValueHash,
      )
    ) {
      issue(issues, "FIELD_VALUE_BINDING_MISMATCH", "normalizedValueHash", "Field writes must verify the exact normalized value hash.");
    }
  }
  if (tool === "browser_set_file") {
    const value = BrowserSetFileInputSchema.parse(request);
    if (
      value.authorization.artifactContentHash !== value.artifact.contentHash ||
      !value.postconditions.some(
        (condition) =>
          condition.kind === "attachment_hash" && condition.expectedHash === value.artifact.contentHash,
      )
    ) {
      issue(issues, "ARTIFACT_BINDING_MISMATCH", "artifact", "Upload authorization and postcondition must bind the exact artifact hash.");
    }
  }
  if (tool === "browser_submit") {
    const value = BrowserSubmitInputSchema.parse(request);
    if (
      value.authorization.reviewSnapshotHash !== value.reviewSnapshotHash ||
      !value.postconditions.some((condition) => condition.kind === "receipt_signal")
    ) {
      issue(issues, "SUBMIT_BINDING_MISMATCH", "reviewSnapshotHash", "Submit claim and receipt postcondition must bind the reviewed snapshot.");
    }
  }
}

export async function validateBrowserWriteRequest(
  tool: BrowserWriteToolName,
  input: unknown,
  context: BrowserWriteValidationContext,
): Promise<BrowserSemanticValidation> {
  context = BrowserWriteValidationContextSchema.parse(context);
  const request = browserWriteInputSchemas[tool].parse(input) as BrowserWriteRequest;
  const issues: BrowserSemanticIssue[] = [];
  const nowMs = Date.parse(context.now);
  validateTrustedContextIntegrity(context, issues);
  validateSnapshotIntegrity(context.snapshot, request.allowedOrigins, issues);
  if (
    !context.observedSnapshots.some(
      (snapshot) => canonicalize(snapshot) === canonicalize(context.snapshot),
    )
  ) {
    issue(issues, "TRUSTED_SNAPSHOT_MISSING", "snapshot", "The execution snapshot must be loaded from trusted snapshot storage.");
  }
  if (
    request.snapshotId !== context.snapshot.snapshotId ||
    request.expectedPageFingerprint !== context.snapshot.pageFingerprint ||
    request.expectedPageGeneration !== context.snapshot.pageGeneration ||
    request.applicationId !== context.snapshot.applicationId ||
    request.runId !== context.snapshot.runId ||
    request.browserSessionRef !== context.snapshot.browserSessionRef
  ) {
    issue(issues, "STALE_SNAPSHOT", "snapshotId", "Write is not bound to the supplied current snapshot.");
  }
  if (Date.parse(request.deadlineAt) <= nowMs) {
    issue(issues, "REQUEST_DEADLINE_EXPIRED", "deadlineAt", "Write request deadline has expired.");
  }
  if (Date.parse(context.snapshot.observedAt) > nowMs || Date.parse(context.snapshot.leaseExpiresAt) <= nowMs) {
    issue(issues, "SNAPSHOT_LEASE_EXPIRED", "snapshot.leaseExpiresAt", "The bound snapshot is not within its execution lease.");
  }
  const liveObservedAt = Date.parse(context.livePage.observedAt);
  if (
    context.livePage.applicationId !== request.applicationId ||
    context.livePage.runId !== request.runId ||
    context.livePage.browserSessionRef !== request.browserSessionRef ||
    context.livePage.pageGeneration !== context.snapshot.pageGeneration ||
    context.livePage.pageFingerprint !== context.snapshot.pageFingerprint ||
    context.livePage.url !== context.snapshot.url ||
    normalizedOrigin(context.livePage.origin) !== normalizedOrigin(context.snapshot.origin) ||
    liveObservedAt < Date.parse(context.snapshot.observedAt) ||
    liveObservedAt > nowMs ||
    nowMs - liveObservedAt > MAX_LIVE_PAGE_OBSERVATION_AGE_MS
  ) {
    issue(issues, "LIVE_PAGE_MISMATCH", "livePage", "Execution requires a matching page generation and fingerprint observed within five seconds.");
  }
  validateCheckpointScope(request, context.checkpoint, context.snapshot, issues);
  await validateAuthorizationBinding(
    tool,
    request,
    context.snapshot,
    context.authorizationRecord,
    context.now,
    issues,
  );
  validatePostconditionRequest(tool, request, issues);

  if (tool === "browser_set_file") {
    const value = BrowserSetFileInputSchema.parse(request);
    const trustedArtifact = context.artifactRecords.find(
      (record) => record.artifactId === value.artifact.artifactId,
    );
    if (
      !trustedArtifact ||
      trustedArtifact.status !== "available" ||
      trustedArtifact.applicationId !== value.applicationId ||
      trustedArtifact.runId !== value.runId ||
      trustedArtifact.contentHash !== value.artifact.contentHash ||
      trustedArtifact.fileName !== value.artifact.fileName ||
      trustedArtifact.mediaType !== value.artifact.mediaType ||
      trustedArtifact.byteSize !== value.artifact.byteSize ||
      Date.parse(trustedArtifact.verifiedAt) > nowMs
    ) {
      issue(issues, "TRUSTED_ARTIFACT_MISMATCH", "artifact", "Upload input must match a server-held, verified artifact record byte for byte.");
    }
  }

  if (tool === "browser_set_field") {
    const value = BrowserSetFieldInputSchema.parse(request);
    const computedValueHash = await sha256(canonicalize(value.value));
    if (value.valueHash !== computedValueHash) {
      issue(issues, "VALUE_HASH_MISMATCH", "valueHash", "Field value hash does not match the canonical raw JSON value.");
    }
  }
  if (tool === "browser_submit") {
    const value = BrowserSubmitInputSchema.parse(request);
    const approvedSignalHashes = new Set(
      await Promise.all(value.expectedReceiptSignals.map((signal) => sha256(signal))),
    );
    if (
      !value.postconditions.some(
        (condition) =>
          condition.kind === "receipt_signal" &&
          approvedSignalHashes.has(condition.expectedHash),
      )
    ) {
      issue(issues, "RECEIPT_SIGNAL_BINDING_MISMATCH", "expectedReceiptSignals", "Receipt postconditions must hash an exact approved receipt signal.");
    }
  }

  if (tool === "browser_navigate") {
    const value = BrowserNavigateInputSchema.parse(request);
    if (!new Set(value.allowedOrigins.map(normalizedOrigin)).has(normalizedOrigin(value.targetUrl))) {
      issue(issues, "NAVIGATION_ORIGIN_BLOCKED", "targetUrl", "Navigation target is outside the allowlist.");
    }
  } else {
    const target = findTarget(request as Exclude<BrowserWriteRequest, ReturnType<typeof BrowserNavigateInputSchema.parse>>, context.snapshot, issues);
    if (target) {
      if (tool === "browser_set_field" && target.kind !== "field") {
        issue(issues, "TARGET_KIND_MISMATCH", "target", "Field writes require a field target.");
      }
      if (tool === "browser_activate") {
        const value = BrowserActivateInputSchema.parse(request);
        if (
          (target.kind !== "control" && target.kind !== "link") ||
          target.controlIntent !== value.intent ||
          target.isSubmitCandidate
        ) {
          issue(issues, "ACTIVATE_TARGET_UNSAFE", "target", "Activation target must be a matching non-submit control.");
        }
        const hasFingerprintTransition = value.postconditions.some(
          (condition) =>
            condition.kind === "page_fingerprint_changed" &&
            condition.previousFingerprint === context.snapshot.pageFingerprint,
        );
        const hasNewTarget = value.postconditions.some(
          (condition) =>
            condition.kind === "target_present" &&
            !context.snapshot.targets.some((candidate) => candidate.id === condition.targetId),
        );
        const hasRemovedTarget = value.postconditions.some(
          (condition) =>
            condition.kind === "target_absent" &&
            context.snapshot.targets.some((candidate) => candidate.id === condition.targetId),
        );
        const intentVerified =
          ((value.intent === "expand" ||
            value.intent === "advance_step" ||
            value.intent === "previous_step") &&
            hasFingerprintTransition) ||
          (value.intent === "add_repeated_item" && hasNewTarget) ||
          (value.intent === "remove_repeated_item" && hasRemovedTarget);
        if (!intentVerified) {
          issue(issues, "ACTIVATE_POSTCONDITION_INSUFFICIENT", "postconditions", "Activation requires an intent-specific state transition that was not already true in the predecessor snapshot.");
        }
      }
      if (tool === "browser_set_file" && target.kind !== "file") {
        issue(issues, "TARGET_KIND_MISMATCH", "target", "Artifact upload requires a file target.");
      }
      if (tool === "browser_submit" && target.kind !== "submit") {
        issue(issues, "TARGET_KIND_MISMATCH", "target", "Final submission requires a submit target.");
      }
    }
  }

  const computedFingerprint = await computeBrowserActionFingerprint(tool, request);
  if (request.authorization.actionFingerprint !== computedFingerprint) {
    issue(issues, "ACTION_FINGERPRINT_MISMATCH", "authorization.actionFingerprint", "Authorization does not bind the canonical action payload.");
  }
  return { success: issues.length === 0, issues };
}

async function comparePostconditions(
  request: BrowserWriteRequest,
  observed: Array<Record<string, unknown>>,
  before: BrowserPageSnapshot,
  after: BrowserPageSnapshot,
  evidenceRecords: readonly BrowserTrustedEvidenceRecord[],
  resultEvidenceArtifactIds: readonly string[],
  completedAt: string,
  issues: BrowserSemanticIssue[],
): Promise<void> {
  const requested = request.postconditions;
  const byId = new Map(observed.map((condition) => [condition.postconditionId, condition]));
  if (byId.size !== requested.length || observed.length !== requested.length) {
    issue(issues, "POSTCONDITION_SET_MISMATCH", "result.verification.postconditions", "Result must contain each requested postcondition exactly once.");
  }
  for (const expected of requested) {
    const actual = byId.get(expected.id);
    if (!actual || actual.kind !== expected.kind || actual.passed !== true) {
      issue(issues, "POSTCONDITION_MISMATCH", `postconditions.${expected.id}`, "Observed postcondition does not match the request.");
      continue;
    }
    if ("expectedHash" in expected && actual.observedHash !== expected.expectedHash) {
      issue(issues, "POSTCONDITION_HASH_MISMATCH", `postconditions.${expected.id}`, "Observed hash differs from the expected hash.");
    }
    const actionTargetId = "target" in request ? request.target.targetId : undefined;
    const actionTarget = actionTargetId
      ? after.targets.find((target) => target.id === actionTargetId)
      : undefined;
    if (
      (expected.kind === "normalized_value_hash" ||
        expected.kind === "selected_option" ||
        expected.kind === "attachment_hash") &&
      (actionTarget?.observedValue.normalizedValueHash !== expected.expectedHash ||
        (actionTarget.observedValue.state !== "present" &&
          actionTarget.observedValue.state !== "redacted"))
    ) {
      issue(issues, "POSTCONDITION_SNAPSHOT_HASH_MISMATCH", `postconditions.${expected.id}`, "The after snapshot does not contain the expected target value hash.");
    }
    if (expected.kind === "checked_state" && actual.observedBoolean !== expected.expectedBoolean) {
      issue(issues, "POSTCONDITION_BOOLEAN_MISMATCH", `postconditions.${expected.id}`, "Observed boolean differs from the expected value.");
    }
    if (
      expected.kind === "checked_state" &&
      actionTarget?.observedValue.checked !== expected.expectedBoolean
    ) {
      issue(issues, "POSTCONDITION_SNAPSHOT_BOOLEAN_MISMATCH", `postconditions.${expected.id}`, "The after snapshot does not contain the expected checked state.");
    }
    if (expected.kind === "url") {
      const afterUrlHash = await sha256(after.url);
      if (actual.observedHash !== afterUrlHash || expected.expectedHash !== afterUrlHash) {
        issue(issues, "POSTCONDITION_URL_EVIDENCE_MISMATCH", `postconditions.${expected.id}`, "URL verification must be derived from the after snapshot URL.");
      }
    }
    if (expected.kind === "page_fingerprint_changed") {
      if (
        actual.beforeFingerprint !== expected.previousFingerprint ||
        actual.afterFingerprint === expected.previousFingerprint ||
        actual.beforeFingerprint !== before.pageFingerprint ||
        actual.afterFingerprint !== after.pageFingerprint
      ) {
        issue(issues, "POSTCONDITION_FINGERPRINT_MISMATCH", `postconditions.${expected.id}`, "Page fingerprint did not change from the expected predecessor.");
      }
    }
    if (
      (expected.kind === "target_present" || expected.kind === "target_absent") &&
      actual.targetId !== expected.targetId
    ) {
      issue(issues, "POSTCONDITION_TARGET_MISMATCH", `postconditions.${expected.id}`, "Observed target differs from the request.");
    }
    if (expected.kind === "target_present" && !after.targets.some((target) => target.id === expected.targetId)) {
      issue(issues, "POSTCONDITION_TARGET_STATE_MISMATCH", `postconditions.${expected.id}`, "The target is not present in the after snapshot.");
    }
    if (expected.kind === "target_absent" && after.targets.some((target) => target.id === expected.targetId)) {
      issue(issues, "POSTCONDITION_TARGET_STATE_MISMATCH", `postconditions.${expected.id}`, "The target is still present in the after snapshot.");
    }
    if (expected.kind === "receipt_signal") {
      const evidenceArtifactId = String(actual.evidenceArtifactId ?? "");
      const evidence = evidenceRecords.find((record) => record.artifactId === evidenceArtifactId);
      if (
        !evidence ||
        evidence.evidenceKind !== "receipt_signal" ||
        evidence.applicationId !== request.applicationId ||
        evidence.runId !== request.runId ||
        evidence.browserSessionRef !== request.browserSessionRef ||
        evidence.actionId !== request.authorization.actionId ||
        evidence.actionFingerprint !== request.authorization.actionFingerprint ||
        evidence.tool !== request.authorization.tool ||
        evidence.executionReservationId !== request.authorization.executionReservationId ||
        evidence.dispatchEffectId !==
          (request.authorization.kind === "effect_claim"
            ? request.authorization.dispatchEffectId
            : undefined) ||
        evidence.sourceSnapshotId !== before.snapshotId ||
        evidence.observedSnapshotId !== after.snapshotId ||
        evidence.contentHash !== actual.evidenceHash ||
        !evidence.verifiedSignalHashes.includes(expected.expectedHash) ||
        Date.parse(evidence.verifiedAt) < Date.parse(before.observedAt) ||
        Date.parse(evidence.verifiedAt) > Date.parse(completedAt) ||
        actual.observedHash !== expected.expectedHash ||
        !resultEvidenceArtifactIds.includes(evidenceArtifactId)
      ) {
        issue(issues, "RECEIPT_EVIDENCE_MISMATCH", `postconditions.${expected.id}`, "Receipt verification must be backed by a trusted, scoped evidence artifact.");
      }
    }
  }
}

function localActionStateUnchanged(
  tool: BrowserWriteToolName,
  request: BrowserWriteRequest,
  before: BrowserPageSnapshot,
  after: BrowserPageSnapshot,
): boolean {
  if (tool === "browser_submit") return true;
  if (tool === "browser_navigate" || tool === "browser_activate") {
    return before.url === after.url && before.pageFingerprint === after.pageFingerprint;
  }
  if (!("target" in request)) return false;
  const beforeTarget = before.targets.find((target) => target.id === request.target.targetId);
  const afterTarget = after.targets.find((target) => target.id === request.target.targetId);
  return Boolean(
    beforeTarget &&
      afterTarget &&
      canonicalize(beforeTarget.observedValue) === canonicalize(afterTarget.observedValue),
  );
}

export async function validateBrowserWriteResult(
  tool: BrowserWriteToolName,
  input: unknown,
  output: unknown,
  context: BrowserWriteValidationContext,
): Promise<BrowserSemanticValidation> {
  context = BrowserWriteValidationContextSchema.parse(context);
  const requestValidation = await validateBrowserWriteRequest(tool, input, context);
  const request = browserWriteInputSchemas[tool].parse(input) as BrowserWriteRequest;
  const parsed = browserWriteOutputSchemas[tool].parse(output) as { result: Record<string, unknown> };
  const result = parsed.result;
  const issues = [...requestValidation.issues];
  const authorization = request.authorization;

  if (
    result.requestId !== request.requestId ||
    result.applicationId !== request.applicationId ||
    result.runId !== request.runId ||
    result.browserSessionRef !== request.browserSessionRef ||
    result.tool !== tool ||
    result.actionId !== authorization.actionId ||
    result.actionFingerprint !== authorization.actionFingerprint
  ) {
    issue(issues, "RESULT_SCOPE_MISMATCH", "result", "Result does not match the exact request and action.");
  }

  const resultBeforeSnapshot = result.beforeSnapshot as BrowserPageSnapshot;
  validateSnapshotIntegrity(resultBeforeSnapshot, request.allowedOrigins, issues);
  if (
    canonicalize(resultBeforeSnapshot) !== canonicalize(context.snapshot)
  ) {
    issue(issues, "RESULT_BEFORE_SNAPSHOT_MISMATCH", "result.beforeSnapshot", "Every write result must use the request-bound predecessor snapshot.");
  }

  if (result.outcome === "verified_applied") {
    const before = result.beforeSnapshot as BrowserPageSnapshot;
    const after = result.afterSnapshot as BrowserPageSnapshot;
    validateSnapshotIntegrity(before, request.allowedOrigins, issues);
    validateSnapshotIntegrity(after, request.allowedOrigins, issues);
    const trustedAfterSnapshots = context.observedSnapshots.filter(
      (snapshot) => snapshot.snapshotId === after.snapshotId,
    );
    if (
      after.applicationId !== request.applicationId ||
      after.runId !== request.runId ||
      after.browserSessionRef !== request.browserSessionRef ||
      after.snapshotId === before.snapshotId ||
      after.snapshotArtifactId === before.snapshotArtifactId ||
      after.pageGeneration <= before.pageGeneration ||
      Date.parse(after.observedAt) <= Date.parse(before.observedAt) ||
      Date.parse(after.observedAt) > Date.parse(String(result.completedAt)) ||
      trustedAfterSnapshots.length !== 1 ||
      canonicalize(trustedAfterSnapshots[0]) !== canonicalize(after)
    ) {
      issue(issues, "RESULT_AFTER_SNAPSHOT_MISMATCH", "result.afterSnapshot", "After snapshot must be a newer observation from the same application, run, and browser session.");
    }
    const resultCheckpoint = result.checkpoint as ApplicationCheckpoint;
    if (
      resultCheckpoint.applicationId !== request.applicationId ||
      resultCheckpoint.runId !== request.runId ||
      resultCheckpoint.browserSessionRef !== request.browserSessionRef ||
      resultCheckpoint.sequence <= context.checkpoint.sequence ||
      resultCheckpoint.stateRevision < request.expectedStateRevision ||
      resultCheckpoint.url !== after.url ||
      resultCheckpoint.pageFingerprint !== after.pageFingerprint ||
      normalizedOrigin(resultCheckpoint.allowedOrigin) !== normalizedOrigin(after.origin) ||
      !resultCheckpoint.completedActionIds.includes(authorization.actionId)
    ) {
      issue(issues, "RESULT_CHECKPOINT_MISMATCH", "result.checkpoint", "Result checkpoint must be a newer matching checkpoint containing the completed action.");
    }
    const verification = result.verification as { postconditions: Array<Record<string, unknown>> };
    await comparePostconditions(
      request,
      verification.postconditions,
      before,
      after,
      context.evidenceRecords,
      result.evidenceArtifactIds as string[],
      String(result.completedAt),
      issues,
    );
    const verifiedAt = String((result.verification as Record<string, unknown>).verifiedAt ?? "");
    if (
      Date.parse(verifiedAt) < Date.parse(after.observedAt) ||
      Date.parse(verifiedAt) > Date.parse(String(result.completedAt))
    ) {
      issue(issues, "VERIFICATION_TIME_MISMATCH", "result.verification.verifiedAt", "Verification must occur after the trusted after snapshot and before completion.");
    }
    if (tool === "browser_navigate") {
      const navigation = result.verification as {
        sourceSnapshotId: unknown;
        redirectChain: Array<Record<string, unknown>>;
      };
      const allowed = new Set(request.allowedOrigins.map(normalizedOrigin));
      if (navigation.sourceSnapshotId !== request.snapshotId) {
        issue(issues, "NAVIGATION_SNAPSHOT_MISMATCH", "result.verification.sourceSnapshotId", "Navigation verification uses a different predecessor snapshot.");
      }
      const navigateRequest = BrowserNavigateInputSchema.parse(request);
      if (
        navigation.redirectChain[0]?.url !== navigateRequest.targetUrl ||
        navigation.redirectChain.at(-1)?.url !== after.url
      ) {
        issue(issues, "REDIRECT_CHAIN_MISMATCH", "result.verification.redirectChain", "Redirect evidence must start at the requested URL and end at the after-snapshot URL.");
      }
      for (const [index, redirect] of navigation.redirectChain.entries()) {
        const urlOrigin = typeof redirect.url === "string" ? normalizedOrigin(redirect.url) : null;
        const declaredOrigin = typeof redirect.origin === "string"
          ? normalizedOrigin(redirect.origin)
          : null;
        if (!urlOrigin || urlOrigin !== declaredOrigin || !allowed.has(urlOrigin)) {
          issue(issues, "REDIRECT_ORIGIN_BLOCKED", `result.verification.redirectChain.${index}`, "Redirect URL and origin must remain allowlisted.");
        }
      }
    } else {
      const actionability = (result.verification as { actionability: Record<string, unknown> }).actionability;
      const targetRequest = request as Exclude<BrowserWriteRequest, ReturnType<typeof BrowserNavigateInputSchema.parse>>;
      const sourceTarget = context.snapshot.targets.find(
        (candidate) => candidate.id === targetRequest.target.targetId,
      );
      const sourceRecipe = sourceTarget?.locatorRecipes.find(
        (candidate) => candidate.id === targetRequest.target.locatorRecipeId,
      );
      if (
        actionability.matchCount !== 1 ||
        actionability.sourceSnapshotId !== request.snapshotId ||
        actionability.resolvedTargetId !== targetRequest.target.targetId ||
        actionability.locatorRecipeId !== targetRequest.target.locatorRecipeId ||
        !sourceRecipe ||
        canonicalize(actionability.resolvedFramePath) !== canonicalize(sourceRecipe.framePath)
      ) {
        issue(issues, "LOCATOR_EVIDENCE_MISMATCH", "result.verification.actionability", "Locator evidence does not prove the exact snapshot target.");
      }
    }
    if (tool === "browser_set_file") {
      const uploadRequest = BrowserSetFileInputSchema.parse(request);
      if (result.attachedArtifactHash !== uploadRequest.artifact.contentHash) {
        issue(issues, "UPLOAD_RESULT_HASH_MISMATCH", "result.attachedArtifactHash", "Upload result must bind the approved artifact hash.");
      }
    }
    if (tool === "browser_submit") {
      const submitRequest = BrowserSubmitInputSchema.parse(request);
      const receiptArtifactId = String(result.receiptArtifactId ?? "");
      const verifiedPostconditions = (
        result.verification as { postconditions: Array<Record<string, unknown>> }
      ).postconditions;
      if (
        result.reviewSnapshotHash !== submitRequest.reviewSnapshotHash ||
        !(result.evidenceArtifactIds as string[]).includes(receiptArtifactId) ||
        !verifiedPostconditions.some(
          (condition) =>
            condition.kind === "receipt_signal" &&
            condition.evidenceArtifactId === receiptArtifactId,
        ) ||
        !context.evidenceRecords.some(
          (record) =>
            record.artifactId === receiptArtifactId &&
            record.evidenceKind === "receipt_signal" &&
            record.actionId === authorization.actionId &&
            record.observedSnapshotId === after.snapshotId,
        )
      ) {
        issue(issues, "SUBMIT_RESULT_EVIDENCE_MISMATCH", "result", "Submit result must preserve the reviewed snapshot and trusted receipt evidence.");
      }
    }
  } else {
    const failureCheckpoint = result.checkpoint as ApplicationCheckpoint;
    const actionAttempted = result.actionAttempted === true;
    const failureAfter = result.afterSnapshot as BrowserPageSnapshot | undefined;
    if (failureAfter) {
      validateSnapshotIntegrity(failureAfter, request.allowedOrigins, issues);
      const trustedFailureSnapshots = context.observedSnapshots.filter(
        (snapshot) => snapshot.snapshotId === failureAfter.snapshotId,
      );
      if (
        failureAfter.applicationId !== request.applicationId ||
        failureAfter.runId !== request.runId ||
        failureAfter.browserSessionRef !== request.browserSessionRef ||
        failureAfter.snapshotId === context.snapshot.snapshotId ||
        failureAfter.snapshotArtifactId === context.snapshot.snapshotArtifactId ||
        failureAfter.pageGeneration <= context.snapshot.pageGeneration ||
        Date.parse(failureAfter.observedAt) <= Date.parse(context.snapshot.observedAt) ||
        trustedFailureSnapshots.length !== 1 ||
        canonicalize(trustedFailureSnapshots[0]) !== canonicalize(failureAfter) ||
        failureCheckpoint.url !== failureAfter.url ||
        failureCheckpoint.pageFingerprint !== failureAfter.pageFingerprint ||
        normalizedOrigin(failureCheckpoint.allowedOrigin) !== normalizedOrigin(failureAfter.origin)
      ) {
        issue(issues, "FAILURE_AFTER_SNAPSHOT_MISMATCH", "result.afterSnapshot", "Failure evidence and checkpoint must refer to the same newer browser observation.");
      }
    } else if (
      failureCheckpoint.url !== context.snapshot.url ||
      failureCheckpoint.pageFingerprint !== context.snapshot.pageFingerprint ||
      normalizedOrigin(failureCheckpoint.allowedOrigin) !== normalizedOrigin(context.snapshot.origin)
    ) {
      issue(issues, "FAILURE_PAGE_MISMATCH", "result.checkpoint", "A failure without an after snapshot must retain the predecessor page state.");
    }
    if (
      failureCheckpoint.applicationId !== request.applicationId ||
      failureCheckpoint.runId !== request.runId ||
      failureCheckpoint.browserSessionRef !== request.browserSessionRef ||
      failureCheckpoint.sequence < context.checkpoint.sequence ||
      failureCheckpoint.stateRevision < request.expectedStateRevision ||
      failureCheckpoint.completedActionIds.includes(authorization.actionId)
    ) {
      issue(issues, "FAILURE_CHECKPOINT_MISMATCH", "result.checkpoint", "Failure checkpoint must remain scoped and must not mark the action complete.");
    }
    if (
      !actionAttempted &&
      canonicalize(failureCheckpoint) !== canonicalize(context.checkpoint)
    ) {
      issue(issues, "NOT_ATTEMPTED_CHECKPOINT_CHANGED", "result.checkpoint", "A non-attempted action must retain the predecessor checkpoint.");
    }
    if (actionAttempted && result.outcome === "retryable_failure") {
      issue(issues, "ATTEMPTED_ACTION_RETRYABLE", "result.outcome", "An attempted action can never be marked retryable.");
    }
    if (result.outcome === "verified_not_applied") {
      const proof = result.nonApplicationProof as Record<string, unknown>;
      const proofKind = String(proof.proofKind ?? "");
      const artifactIds = Array.isArray(proof.evidenceArtifactIds)
        ? proof.evidenceArtifactIds.map(String)
        : [];
      const matchingEvidence = context.evidenceRecords.filter((record) =>
        artifactIds.includes(record.artifactId),
      );
      if (
        proof.predecessorSnapshotId !== context.snapshot.snapshotId ||
        proof.observedSnapshotId !== failureAfter?.snapshotId ||
        artifactIds.length === 0 ||
        matchingEvidence.length !== artifactIds.length ||
        !matchingEvidence.some((record) => record.contentHash === proof.evidenceHash) ||
        matchingEvidence.some(
          (record) =>
            record.evidenceKind !== proofKind ||
            record.applicationId !== request.applicationId ||
            record.runId !== request.runId ||
            record.browserSessionRef !== request.browserSessionRef ||
            record.actionId !== authorization.actionId ||
            record.actionFingerprint !== authorization.actionFingerprint ||
            record.tool !== authorization.tool ||
            record.executionReservationId !== authorization.executionReservationId ||
            record.dispatchEffectId !==
              (authorization.kind === "effect_claim"
                ? authorization.dispatchEffectId
                : undefined) ||
            record.sourceSnapshotId !== context.snapshot.snapshotId ||
            record.observedSnapshotId !== failureAfter?.snapshotId ||
            record.verifiedAt !== proof.verifiedAt,
        ) ||
        artifactIds.some((artifactId) => !(result.evidenceArtifactIds as string[]).includes(artifactId))
      ) {
        issue(issues, "NON_APPLICATION_EVIDENCE_MISMATCH", "result.nonApplicationProof", "Verified non-application requires trusted evidence bound to both snapshots and the exact action.");
      }
      if (
        Date.parse(String(proof.verifiedAt)) < Date.parse(context.snapshot.observedAt) ||
        Date.parse(String(proof.verifiedAt)) > Date.parse(String(result.completedAt))
      ) {
        issue(issues, "NON_APPLICATION_TIME_MISMATCH", "result.nonApplicationProof.verifiedAt", "Non-application proof must be created during this exact execution attempt.");
      }
      if (
        actionAttempted &&
        proofKind !== "network_request_not_sent" &&
        proofKind !== "server_rejection_before_commit"
      ) {
        issue(issues, "NON_APPLICATION_PROOF_TOO_WEAK", "result.nonApplicationProof.proofKind", "An attempted action needs transport or server proof before it can be retried safely.");
      }
      if (
        actionAttempted &&
        failureAfter &&
        !localActionStateUnchanged(tool, request, context.snapshot, failureAfter)
      ) {
        issue(issues, "NON_APPLICATION_LOCAL_STATE_CHANGED", "result.afterSnapshot", "Verified non-application also requires the action's local browser state to remain unchanged.");
      }
    }
  }

  const receipt = result.authorizationReceipt as Record<string, unknown> | undefined;
  if (receipt) {
    const safeClaimTokenHash = authorization.kind === "effect_claim"
      ? await sha256(authorization.claimToken)
      : undefined;
    const safeExecutionNonceHash = await sha256(authorization.executionNonce);
    if (
      receipt.kind !== authorization.kind ||
      receipt.applicationId !== authorization.applicationId ||
      receipt.runId !== authorization.runId ||
      receipt.browserSessionRef !== authorization.browserSessionRef ||
      receipt.actionId !== authorization.actionId ||
      receipt.actionFingerprint !== authorization.actionFingerprint ||
      receipt.tool !== authorization.tool ||
      receipt.risk !== authorization.risk ||
      receipt.sourceSnapshotId !== authorization.sourceSnapshotId ||
      receipt.pageFingerprint !== authorization.pageFingerprint ||
      receipt.pageGeneration !== authorization.pageGeneration ||
      normalizedOrigin(String(receipt.origin)) !== normalizedOrigin(authorization.origin) ||
      (authorization.kind === "policy_grant" &&
        (receipt.decisionId !== authorization.decisionId ||
          receipt.grantHash !== authorization.grantHash ||
          receipt.executionReservationId !== authorization.executionReservationId ||
          receipt.executionNonceHash !== safeExecutionNonceHash ||
          receipt.executionLeaseExpiresAt !== authorization.executionLeaseExpiresAt)) ||
      (authorization.kind === "effect_claim" &&
        (receipt.approvalId !== authorization.approvalId ||
          receipt.dispatchEffectId !== authorization.dispatchEffectId ||
          receipt.workerId !== authorization.workerId ||
          receipt.claimTokenHash !== safeClaimTokenHash ||
          receipt.executionReservationId !== authorization.executionReservationId ||
          receipt.executionNonceHash !== safeExecutionNonceHash ||
          receipt.executionLeaseExpiresAt !== authorization.executionLeaseExpiresAt))
    ) {
      issue(issues, "AUTHORIZATION_RECEIPT_MISMATCH", "result.authorizationReceipt", "Result authorization receipt does not match the execution grant.");
    }
  } else {
    issue(issues, "AUTHORIZATION_RECEIPT_MISSING", "result.authorizationReceipt", "Write result must contain an authorization receipt.");
  }

  return { success: issues.length === 0, issues };
}
