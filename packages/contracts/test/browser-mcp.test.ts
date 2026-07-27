import { describe, expect, it } from "vitest";

import {
  BrowserActivateInputSchema,
  BrowserMcpToolDescriptorSchema,
  BrowserPageSnapshotSchema,
  BrowserSetFieldInputSchema,
  BrowserSetFieldOutputSchema,
  BrowserSetFileInputSchema,
  BrowserSubmitInputSchema,
  BrowserTrustedAuthorizationRecordSchema,
  HttpOriginSchema,
  browserMcpToolCatalog,
  buildBrowserMcpWireTools,
  computeBrowserActionFingerprint,
  createValidatedBrowserMcpReadHandler,
  createValidatedBrowserMcpWriteHandler,
  parseBrowserMcpStructuredContent,
  validateBrowserPageSnapshot,
  validateBrowserSessionOpenRequest,
  validateBrowserWriteRequest,
  validateBrowserWriteResult,
  type BrowserPageSnapshot,
  type BrowserTrustedAuthorizationRecord,
  type BrowserTrustedArtifactRecord,
  type BrowserTrustedEvidenceRecord,
  type BrowserWriteValidationContext,
} from "../src/index.js";

const now = "2026-07-26T16:00:00-04:00";
const later = "2026-07-26T16:10:00-04:00";
const hash = "a".repeat(64);
const valueHash = "b".repeat(64);
const placeholderFingerprint = "e".repeat(64);
const policyNonceHash = "a7cbbfdfe39c7df7502aa43b785e40940817b89fbff7834b364d2e343c80c25c";

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const pageSnapshot: BrowserPageSnapshot = {
  snapshotId: "snapshot:1",
  applicationId: "application:1",
  runId: "run:1",
  browserSessionRef: "browser-session:1",
  pageGeneration: 1,
  url: "https://jobs.example.com/apply",
  origin: "https://jobs.example.com",
  title: "Apply",
  pageFingerprint: hash,
  frames: [
    {
      id: "frame:main",
      url: "https://jobs.example.com/apply",
      origin: "https://jobs.example.com",
      title: "Apply",
    },
  ],
  targets: [
    {
      id: "target:first-name",
      kind: "field",
      frameId: "frame:main",
      role: "textbox",
      accessibleName: "First name",
      question: "First name",
      controlType: "text",
      required: true,
      disabled: false,
      sensitivity: "pii",
      options: [],
      observedValue: { state: "empty", selectedOptionLabels: [] },
      isSubmitCandidate: false,
      locatorRecipes: [
        {
          id: "locator:first-name",
          sourceSnapshotId: "snapshot:1",
          strategy: "label",
          value: "First name",
          exact: true,
          framePath: ["frame:main"],
          priority: 0,
        },
      ],
    },
    {
      id: "target:next",
      kind: "control",
      frameId: "frame:main",
      role: "button",
      accessibleName: "Next",
      question: "",
      controlType: "button",
      controlIntent: "advance_step",
      required: false,
      disabled: false,
      sensitivity: "normal",
      options: [],
      observedValue: { state: "not_applicable", selectedOptionLabels: [] },
      isSubmitCandidate: false,
      locatorRecipes: [
        {
          id: "locator:next",
          sourceSnapshotId: "snapshot:1",
          strategy: "role",
          value: "button:Next",
          exact: true,
          framePath: ["frame:main"],
          priority: 0,
        },
      ],
    },
    {
      id: "target:file",
      kind: "file",
      frameId: "frame:main",
      role: "button",
      accessibleName: "Resume",
      question: "Upload resume",
      controlType: "file",
      required: true,
      disabled: false,
      sensitivity: "pii",
      options: [],
      observedValue: { state: "empty", selectedOptionLabels: [] },
      isSubmitCandidate: false,
      locatorRecipes: [
        {
          id: "locator:file",
          sourceSnapshotId: "snapshot:1",
          strategy: "label",
          value: "Resume",
          exact: true,
          framePath: ["frame:main"],
          priority: 0,
        },
      ],
    },
    {
      id: "target:submit",
      kind: "submit",
      frameId: "frame:main",
      role: "button",
      accessibleName: "Submit application",
      question: "",
      controlType: "button",
      required: false,
      disabled: false,
      sensitivity: "normal",
      options: [],
      observedValue: { state: "not_applicable", selectedOptionLabels: [] },
      isSubmitCandidate: true,
      locatorRecipes: [
        {
          id: "locator:submit",
          sourceSnapshotId: "snapshot:1",
          strategy: "role",
          value: "button:Submit application",
          exact: true,
          framePath: ["frame:main"],
          priority: 0,
        },
      ],
    },
  ],
  validationMessages: [],
  snapshotArtifactId: "artifact:snapshot-1",
  observedAt: now,
  leaseExpiresAt: later,
};

const checkpoint = {
  id: "checkpoint:1",
  applicationId: "application:1",
  runId: "run:1",
  sequence: 1,
  stateRevision: 2,
  status: "running" as const,
  browserSessionRef: "browser-session:1",
  allowedOrigin: "https://jobs.example.com",
  url: "https://jobs.example.com/apply",
  pageFingerprint: hash,
  completedActionIds: [],
  fieldDecisionIds: [],
  artifactIds: [],
  lastAuditEventHash: "c".repeat(64),
  createdAt: now,
};

const scope = {
  contractVersion: "1.0.0" as const,
  requestId: "request:1",
  applicationId: "application:1",
  runId: "run:1",
  browserSessionRef: "browser-session:1",
  expectedStateRevision: 2,
  allowedOrigins: ["https://jobs.example.com"],
  deadlineAt: later,
};

const snapshotScope = {
  ...scope,
  snapshotId: "snapshot:1",
  expectedPageFingerprint: hash,
  expectedPageGeneration: 1,
  checkpointId: "checkpoint:1",
};

function policyGrant(
  tool: "browser_navigate" | "browser_set_field" | "browser_activate",
  actionId: string,
) {
  return {
    kind: "policy_grant" as const,
    applicationId: "application:1",
    runId: "run:1",
    browserSessionRef: "browser-session:1",
    actionId,
    actionFingerprint: placeholderFingerprint,
    sourceSnapshotId: "snapshot:1",
    pageFingerprint: hash,
    pageGeneration: 1,
    origin: "https://jobs.example.com",
    tool,
    risk: "reversible" as const,
    decisionId: "decision:1",
    policyVersion: "policy-v1",
    grantHash: "d".repeat(64),
    issuedAt: now,
    expiresAt: later,
    executionReservationId: "reservation:policy-1",
    executionNonce: "p".repeat(32),
    executionLeaseExpiresAt: later,
  };
}

function trustedPolicyRecord(authorization: ReturnType<typeof policyGrant>) {
  const { executionNonce: _executionNonce, ...persisted } = authorization;
  return {
    ...persisted,
    executionNonceHash: policyNonceHash,
    status: "executing" as const,
    executingAt: now,
  };
}

function effectClaim(
  tool: "browser_set_file" | "browser_submit",
  actionId: string,
) {
  return {
    kind: "effect_claim" as const,
    applicationId: "application:1",
    runId: "run:1",
    browserSessionRef: "browser-session:1",
    actionId,
    actionFingerprint: placeholderFingerprint,
    sourceSnapshotId: "snapshot:1",
    pageFingerprint: hash,
    pageGeneration: 1,
    origin: "https://jobs.example.com",
    tool,
    risk: "consequential" as const,
    approvalId: "approval:1",
    dispatchEffectId: "effect:1",
    workerId: "worker:1",
    claimToken: "x".repeat(32),
    claimedAt: now,
    executionReservationId: "reservation:1",
    executionNonce: "n".repeat(32),
    executionLeaseExpiresAt: later,
  };
}

async function validSetFieldRequest() {
  const request = {
    ...snapshotScope,
    target: {
      targetId: "target:first-name",
      locatorRecipeId: "locator:first-name",
    },
    authorization: policyGrant("browser_set_field", "action:fill"),
    postconditions: [
      { id: "postcondition:1", kind: "normalized_value_hash" as const, expectedHash: valueHash },
    ],
    value: "Ada",
    valueHash: await sha256(JSON.stringify("Ada")),
    valueSensitivity: "pii" as const,
    normalizedValueHash: valueHash,
  };
  request.authorization.actionFingerprint = await computeBrowserActionFingerprint(
    "browser_set_field",
    request,
  );
  return request;
}

function afterSnapshot(): BrowserPageSnapshot {
  return {
    ...pageSnapshot,
    snapshotId: "snapshot:2",
    pageGeneration: 2,
    pageFingerprint: "f".repeat(64),
    snapshotArtifactId: "artifact:snapshot-2",
    observedAt: later,
    targets: pageSnapshot.targets.map((target) => ({
      ...target,
      observedValue:
        target.id === "target:first-name"
          ? { state: "redacted" as const, normalizedValueHash: valueHash, selectedOptionLabels: [] }
          : target.observedValue,
      locatorRecipes: target.locatorRecipes.map((recipe) => ({
        ...recipe,
        sourceSnapshotId: "snapshot:2",
      })),
    })),
  };
}

function contextFor(
  authorizationRecord: BrowserTrustedAuthorizationRecord,
  evidenceRecords: BrowserTrustedEvidenceRecord[] = [],
  artifactRecords: BrowserTrustedArtifactRecord[] = [],
  observedSnapshots: BrowserPageSnapshot[] = [pageSnapshot],
): BrowserWriteValidationContext {
  return {
    snapshot: pageSnapshot,
    livePage: {
      applicationId: pageSnapshot.applicationId,
      runId: pageSnapshot.runId,
      browserSessionRef: pageSnapshot.browserSessionRef,
      pageGeneration: pageSnapshot.pageGeneration,
      url: pageSnapshot.url,
      origin: pageSnapshot.origin,
      pageFingerprint: pageSnapshot.pageFingerprint,
      observedAt: now,
    },
    checkpoint,
    authorizationRecord,
    evidenceRecords,
    artifactRecords,
    observedSnapshots,
    now,
  };
}

describe("Browser MCP contracts", () => {
  it("builds actual MCP wire tools with object input/output schemas", () => {
    const tools = buildBrowserMcpWireTools();
    expect(tools).toHaveLength(8);
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);

    for (const tool of tools) {
      const contract = browserMcpToolCatalog[tool.name];
      expect(BrowserMcpToolDescriptorSchema.parse(contract.descriptor).name).toBe(tool.name);
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.outputSchema.type).toBe("object");
      if (contract.descriptor.risk === "read_only") {
        expect(tool.annotations.readOnlyHint).toBe(true);
      }
      if (contract.descriptor.risk === "consequential") {
        expect(tool.annotations.destructiveHint).toBe(true);
      }
    }
  });

  it("forces session and snapshot reads through semantic validation", async () => {
    const input = {
      contractVersion: "1.0.0" as const,
      requestId: "request:open",
      applicationId: "application:1",
      runId: "run:1",
      targetUrl: pageSnapshot.url,
      allowedOrigins: [pageSnapshot.origin],
      expectedStateRevision: 0,
      headed: true,
      deadlineAt: later,
    };
    const output = {
      result: {
        contractVersion: "1.0.0" as const,
        requestId: input.requestId,
        applicationId: input.applicationId,
        runId: input.runId,
        browserSessionRef: pageSnapshot.browserSessionRef,
        startedAt: now,
        completedAt: now,
        tool: "browser_session_open" as const,
        outcome: "success" as const,
        pageSnapshot,
      },
    };
    const handler = createValidatedBrowserMcpReadHandler("browser_session_open", {
      trustedNow: () => now,
      executeValidatedRead: async () => output,
    });
    await expect(handler(input)).resolves.toEqual(output);

    let executed = false;
    const blockedHandler = createValidatedBrowserMcpReadHandler("browser_session_open", {
      trustedNow: () => now,
      executeValidatedRead: async () => {
        executed = true;
        return output;
      },
    });
    await expect(
      blockedHandler({ ...input, targetUrl: "https://evil.example/apply" }),
    ).rejects.toMatchObject({ phase: "request" });
    expect(executed).toBe(false);

    const poisonedHandler = createValidatedBrowserMcpReadHandler("browser_session_open", {
      trustedNow: () => now,
      executeValidatedRead: async () => ({
        result: {
          ...output.result,
          pageSnapshot: {
            ...pageSnapshot,
            targets: [...pageSnapshot.targets, pageSnapshot.targets[0]!],
          },
        },
      }),
    });
    await expect(poisonedHandler(input)).rejects.toMatchObject({ phase: "result" });
  });

  it("validates canonical action, authorization, snapshot, locator, origin, and checkpoint binding", async () => {
    const request = await validSetFieldRequest();
    expect(BrowserSetFieldInputSchema.safeParse(request).success).toBe(true);
    const result = await validateBrowserWriteRequest(
      "browser_set_field",
      request,
      contextFor(
        trustedPolicyRecord(request.authorization),
        [],
        [],
        [pageSnapshot, afterSnapshot()],
      ),
    );
    expect(result).toEqual({ success: true, issues: [] });

    const tampered = { ...request, normalizedValueHash: "9".repeat(64) };
    const tamperedResult = await validateBrowserWriteRequest(
      "browser_set_field",
      tampered,
      contextFor(
        trustedPolicyRecord(request.authorization),
        [],
        [],
        [pageSnapshot, afterSnapshot()],
      ),
    );
    expect(tamperedResult.success).toBe(false);
    expect(tamperedResult.issues.some((entry) => entry.code === "ACTION_FINGERPRINT_MISMATCH")).toBe(true);

    const swappedValue = { ...request, value: "Grace" };
    const swappedValueResult = await validateBrowserWriteRequest(
      "browser_set_field",
      swappedValue,
      contextFor(trustedPolicyRecord(request.authorization)),
    );
    expect(swappedValueResult.success).toBe(false);
    expect(swappedValueResult.issues.some((entry) => entry.code === "VALUE_HASH_MISMATCH")).toBe(true);

    const forgedRecord = await validateBrowserWriteRequest(
      "browser_set_field",
      request,
      contextFor({
        ...trustedPolicyRecord(request.authorization),
        runId: "run:other",
      }),
    );
    expect(forgedRecord.success).toBe(false);
    expect(
      forgedRecord.issues.some((entry) => entry.code === "TRUSTED_AUTHORIZATION_MISMATCH"),
    ).toBe(true);
  });

  it("rejects stale live pages, expired deadlines, and ambiguous snapshot identifiers", async () => {
    const request = await validSetFieldRequest();
    const staleContext = contextFor(trustedPolicyRecord(request.authorization));
    staleContext.livePage.pageGeneration += 1;
    const stale = await validateBrowserWriteRequest("browser_set_field", request, staleContext);
    expect(stale.success).toBe(false);
    expect(stale.issues.some((entry) => entry.code === "LIVE_PAGE_MISMATCH")).toBe(true);

    const invalidContext = { ...contextFor(trustedPolicyRecord(request.authorization)), now: "not-a-time" };
    await expect(
      validateBrowserWriteRequest("browser_set_field", request, invalidContext as never),
    ).rejects.toThrow();

    const expiredRequest = { ...request, deadlineAt: now };
    const expired = await validateBrowserWriteRequest(
      "browser_set_field",
      expiredRequest,
      contextFor(trustedPolicyRecord(request.authorization)),
    );
    expect(expired.issues.some((entry) => entry.code === "REQUEST_DEADLINE_EXPIRED")).toBe(true);

    const duplicateTargets = {
      ...pageSnapshot,
      targets: [...pageSnapshot.targets, pageSnapshot.targets[0]!],
    };
    const duplicateResult = validateBrowserPageSnapshot(
      duplicateTargets,
      ["https://jobs.example.com"],
    );
    expect(duplicateResult.issues.some((entry) => entry.code === "DUPLICATE_TARGET_ID")).toBe(true);

    const multipleRoots = {
      ...pageSnapshot,
      frames: [
        ...pageSnapshot.frames,
        {
          id: "frame:other-root",
          url: pageSnapshot.url,
          origin: pageSnapshot.origin,
          title: "Other root",
        },
      ],
    };
    const rootResult = validateBrowserPageSnapshot(multipleRoots, ["https://jobs.example.com"]);
    expect(rootResult.issues.some((entry) => entry.code === "FRAME_ROOT_INVALID")).toBe(true);

    const wrongRootPage = {
      ...pageSnapshot,
      frames: pageSnapshot.frames.map((frame) => ({
        ...frame,
        url: "https://jobs.example.com/other",
      })),
    };
    const rootPageResult = validateBrowserPageSnapshot(
      wrongRootPage,
      ["https://jobs.example.com"],
    );
    expect(
      rootPageResult.issues.some((entry) => entry.code === "FRAME_ROOT_PAGE_MISMATCH"),
    ).toBe(true);

    const contradictoryValue = structuredClone(pageSnapshot);
    contradictoryValue.targets[0]!.observedValue.normalizedValueHash = valueHash;
    expect(BrowserPageSnapshotSchema.safeParse(contradictoryValue).success).toBe(false);
  });

  it("rejects arbitrary selectors, JavaScript, local paths, and hollow postconditions", async () => {
    const request = await validSetFieldRequest();
    expect(BrowserSetFieldInputSchema.safeParse({ ...request, locator: "body >> script" }).success).toBe(false);
    expect(
      BrowserSetFieldInputSchema.safeParse({
        ...request,
        postconditions: [{ id: "postcondition:1", kind: "normalized_value_hash" }],
      }).success,
    ).toBe(false);

    const claim = {
      ...effectClaim("browser_set_file", "action:upload"),
      artifactContentHash: valueHash,
    };
    expect(
      BrowserSetFileInputSchema.safeParse({
        ...snapshotScope,
        target: { targetId: "target:file", locatorRecipeId: "locator:file" },
        authorization: claim,
        postconditions: [
          { id: "postcondition:file", kind: "attachment_hash", expectedHash: valueHash },
        ],
        artifact: {
          artifactId: "artifact:resume",
          contentHash: valueHash,
          fileName: "../resume.docx",
          mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          byteSize: 1_024,
          path: "C:\\Users\\person\\resume.docx",
        },
      }).success,
    ).toBe(false);
  });

  it("prevents activate from targeting submit or contradicting snapshot intent", async () => {
    const request = {
      ...snapshotScope,
      target: { targetId: "target:submit", locatorRecipeId: "locator:submit" },
      authorization: policyGrant("browser_activate", "action:activate"),
      postconditions: [
        {
          id: "postcondition:page",
          kind: "page_fingerprint_changed" as const,
          previousFingerprint: hash,
        },
      ],
      intent: "advance_step" as const,
    };
    request.authorization.actionFingerprint = await computeBrowserActionFingerprint(
      "browser_activate",
      request,
    );
    expect(BrowserActivateInputSchema.safeParse(request).success).toBe(true);
    const result = await validateBrowserWriteRequest(
      "browser_activate",
      request,
      contextFor(trustedPolicyRecord(request.authorization)),
    );
    expect(result.success).toBe(false);
    expect(result.issues.some((entry) => entry.code === "ACTIVATE_TARGET_UNSAFE")).toBe(true);
  });

  it("blocks cross-origin navigation even when its shape is valid", async () => {
    const request = {
      ...snapshotScope,
      targetUrl: "https://evil.example/apply",
      authorization: policyGrant("browser_navigate", "action:navigate"),
      expectedUrlHash: "7".repeat(64),
      postconditions: [
        { id: "postcondition:url", kind: "url" as const, expectedHash: "7".repeat(64) },
      ],
    };
    request.authorization.actionFingerprint = await computeBrowserActionFingerprint(
      "browser_navigate",
      request,
    );
    const result = await validateBrowserWriteRequest(
      "browser_navigate",
      request,
      contextFor(trustedPolicyRecord(request.authorization)),
    );
    expect(result.success).toBe(false);
    expect(result.issues.some((entry) => entry.code === "NAVIGATION_ORIGIN_BLOCKED")).toBe(true);

    expect(
      validateBrowserSessionOpenRequest({
        contractVersion: "1.0.0",
        requestId: "request:open",
        applicationId: "application:1",
        runId: "run:1",
        targetUrl: "https://evil.example/apply",
        allowedOrigins: ["https://jobs.example.com"],
        expectedStateRevision: 0,
        headed: true,
        deadlineAt: later,
      }).success,
    ).toBe(false);

    const poisonedSnapshot = {
      ...pageSnapshot,
      frames: [
        ...pageSnapshot.frames,
        {
          id: "frame:evil",
          parentId: "frame:main",
          url: "https://evil.example/widget",
          origin: "https://evil.example",
          title: "Unexpected frame",
        },
      ],
    };
    expect(
      validateBrowserPageSnapshot(poisonedSnapshot, ["https://jobs.example.com"]).success,
    ).toBe(false);
  });

  it("requires exact consequential claim bindings for artifact and reviewed submit", () => {
    const uploadClaim = {
      ...effectClaim("browser_set_file", "action:upload"),
      artifactContentHash: valueHash,
    };
    expect(
      BrowserSetFileInputSchema.safeParse({
        ...snapshotScope,
        target: { targetId: "target:file", locatorRecipeId: "locator:file" },
        authorization: { ...uploadClaim, tool: "browser_submit" },
        postconditions: [
          { id: "postcondition:file", kind: "attachment_hash", expectedHash: valueHash },
        ],
        artifact: {
          artifactId: "artifact:resume",
          contentHash: valueHash,
          fileName: "resume.docx",
          mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          byteSize: 1_024,
        },
      }).success,
    ).toBe(false);

    expect(
      BrowserSubmitInputSchema.safeParse({
        ...snapshotScope,
        target: { targetId: "target:submit", locatorRecipeId: "locator:submit" },
        authorization: effectClaim("browser_submit", "action:submit"),
        postconditions: [
          { id: "postcondition:receipt", kind: "receipt_signal", expectedHash: "8".repeat(64) },
        ],
        reviewSnapshotHash: hash,
        expectedReceiptSignals: ["Application received"],
      }).success,
    ).toBe(false);
  });

  it("verifies a consequential claim against the trusted persisted worker claim", async () => {
    const authorization = {
      ...effectClaim("browser_set_file", "action:upload"),
      artifactContentHash: valueHash,
    };
    const request = {
      ...snapshotScope,
      target: { targetId: "target:file", locatorRecipeId: "locator:file" },
      authorization,
      postconditions: [
        { id: "postcondition:file", kind: "attachment_hash" as const, expectedHash: valueHash },
      ],
      artifact: {
        artifactId: "artifact:resume",
        contentHash: valueHash,
        fileName: "resume.docx",
        mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        byteSize: 1_024,
      },
    };
    authorization.actionFingerprint = await computeBrowserActionFingerprint(
      "browser_set_file",
      request,
    );
    const trustedRecord = {
      kind: "effect_claim" as const,
      applicationId: authorization.applicationId,
      runId: authorization.runId,
      browserSessionRef: authorization.browserSessionRef,
      actionId: authorization.actionId,
      actionFingerprint: authorization.actionFingerprint,
      sourceSnapshotId: authorization.sourceSnapshotId,
      pageFingerprint: authorization.pageFingerprint,
      pageGeneration: authorization.pageGeneration,
      origin: authorization.origin,
      tool: authorization.tool,
      risk: authorization.risk,
      approvalId: authorization.approvalId,
      dispatchEffectId: authorization.dispatchEffectId,
      workerId: authorization.workerId,
      claimTokenHash: await sha256(authorization.claimToken),
      executionReservationId: authorization.executionReservationId,
      executionNonceHash: await sha256(authorization.executionNonce),
      executionLeaseExpiresAt: authorization.executionLeaseExpiresAt,
      status: "executing" as const,
      claimedAt: authorization.claimedAt,
      approvalConsumedAt: now,
      executingAt: now,
    };
    const artifactRecord = {
      ...request.artifact,
      applicationId: request.applicationId,
      runId: request.runId,
      status: "available" as const,
      verifiedAt: now,
    };
    const valid = await validateBrowserWriteRequest(
      "browser_set_file",
      request,
      contextFor(trustedRecord, [], [artifactRecord]),
    );
    expect(valid).toEqual({ success: true, issues: [] });

    const wrongToken = {
      ...request,
      authorization: { ...request.authorization, claimToken: "y".repeat(32) },
    };
    const invalid = await validateBrowserWriteRequest(
      "browser_set_file",
      wrongToken,
      contextFor(trustedRecord, [], [artifactRecord]),
    );
    expect(invalid.success).toBe(false);
    expect(
      invalid.issues.some((entry) => entry.code === "TRUSTED_EFFECT_CLAIM_INVALID"),
    ).toBe(true);

    const wrongNonce = {
      ...request,
      authorization: { ...request.authorization, executionNonce: "z".repeat(32) },
    };
    const nonceReplay = await validateBrowserWriteRequest(
      "browser_set_file",
      wrongNonce,
      contextFor(trustedRecord, [], [artifactRecord]),
    );
    expect(
      nonceReplay.issues.some((entry) => entry.code === "TRUSTED_EFFECT_CLAIM_INVALID"),
    ).toBe(true);
    expect(
      BrowserTrustedAuthorizationRecordSchema.safeParse({
        ...trustedRecord,
        status: "claimed",
      }).success,
    ).toBe(false);
  });

  it("accepts only a fully verified write result bound to the request and newer checkpoint", async () => {
    const request = await validSetFieldRequest();
    const after = afterSnapshot();
    const receipt = {
      kind: "policy_grant" as const,
      applicationId: "application:1",
      runId: "run:1",
      browserSessionRef: "browser-session:1",
      actionId: "action:fill",
      actionFingerprint: request.authorization.actionFingerprint,
      sourceSnapshotId: "snapshot:1",
      pageFingerprint: hash,
      pageGeneration: 1,
      origin: "https://jobs.example.com",
      tool: "browser_set_field" as const,
      risk: "reversible" as const,
      decisionId: "decision:1",
      grantHash: "d".repeat(64),
      executionReservationId: request.authorization.executionReservationId,
      executionNonceHash: policyNonceHash,
      executionLeaseExpiresAt: request.authorization.executionLeaseExpiresAt,
    };
    const result = {
      result: {
        contractVersion: "1.0.0",
        requestId: "request:1",
        applicationId: "application:1",
        runId: "run:1",
        browserSessionRef: "browser-session:1",
        startedAt: now,
        completedAt: later,
        tool: "browser_set_field",
        outcome: "verified_applied",
        actionId: "action:fill",
        actionFingerprint: request.authorization.actionFingerprint,
        authorizationReceipt: receipt,
        beforeSnapshot: pageSnapshot,
        afterSnapshot: after,
        verification: {
          actionability: {
            locatorResolvedUniquely: true,
            matchCount: 1,
            sourceSnapshotId: "snapshot:1",
            resolvedTargetId: "target:first-name",
            locatorRecipeId: "locator:first-name",
            resolvedFramePath: ["frame:main"],
            pageFingerprintMatched: true,
            originAllowed: true,
            visible: true,
            stable: true,
            enabled: true,
            receivesEvents: true,
            editable: true,
          },
          postconditions: [
            {
              postconditionId: "postcondition:1",
              kind: "normalized_value_hash",
              passed: true,
              observedHash: valueHash,
              redactedSummary: "Normalized value hash matched.",
            },
          ],
          verifiedAt: later,
        },
        checkpoint: {
          ...checkpoint,
          id: "checkpoint:2",
          sequence: 2,
          pageFingerprint: after.pageFingerprint,
          completedActionIds: ["action:fill"],
          artifactIds: ["artifact:snapshot-2"],
          createdAt: later,
        },
        evidenceArtifactIds: ["artifact:snapshot-2"],
      },
    };

    expect(BrowserSetFieldOutputSchema.safeParse(result).success).toBe(true);
    const validation = await validateBrowserWriteResult(
      "browser_set_field",
      request,
      result,
      contextFor(
        trustedPolicyRecord(request.authorization),
        [],
        [],
        [pageSnapshot, afterSnapshot()],
      ),
    );
    expect(validation).toEqual({ success: true, issues: [] });
    expect(() => parseBrowserMcpStructuredContent("browser_set_field", result)).not.toThrow();

    const reusedSnapshotResult = structuredClone(result);
    reusedSnapshotResult.result.afterSnapshot = structuredClone(pageSnapshot);
    reusedSnapshotResult.result.checkpoint.pageFingerprint = pageSnapshot.pageFingerprint;
    const reusedSnapshot = await validateBrowserWriteResult(
      "browser_set_field",
      request,
      reusedSnapshotResult,
      contextFor(trustedPolicyRecord(request.authorization)),
    );
    expect(
      reusedSnapshot.issues.some((entry) => entry.code === "RESULT_AFTER_SNAPSHOT_MISMATCH"),
    ).toBe(true);

    const settlements: string[] = [];
    const handler = createValidatedBrowserMcpWriteHandler("browser_set_field", {
      reserveTrustedExecutionContext: async () =>
        contextFor(trustedPolicyRecord(request.authorization)),
      executeValidatedWrite: async () => result,
      loadTrustedResultContext: async () =>
        contextFor(
          trustedPolicyRecord(request.authorization),
          [],
          [],
          [pageSnapshot, afterSnapshot()],
        ),
      settleTrustedExecution: async (settlement) => {
        settlements.push(settlement.disposition);
      },
    });
    await expect(handler(request)).resolves.toEqual(result);
    expect(settlements).toEqual(["verified_applied"]);

    result.result.afterSnapshot.targets[0]!.observedValue.normalizedValueHash = "0".repeat(64);
    const fabricatedSnapshotEvidence = await validateBrowserWriteResult(
      "browser_set_field",
      request,
      result,
      contextFor(
        trustedPolicyRecord(request.authorization),
        [],
        [],
        [pageSnapshot, afterSnapshot()],
      ),
    );
    expect(fabricatedSnapshotEvidence.success).toBe(false);
    expect(
      fabricatedSnapshotEvidence.issues.some(
        (entry) => entry.code === "POSTCONDITION_SNAPSHOT_HASH_MISMATCH",
      ),
    ).toBe(true);
    result.result.afterSnapshot.targets[0]!.observedValue.normalizedValueHash = valueHash;

    result.result.verification.postconditions[0]!.observedHash = "0".repeat(64);
    const tampered = await validateBrowserWriteResult(
      "browser_set_field",
      request,
      result,
      contextFor(
        trustedPolicyRecord(request.authorization),
        [],
        [],
        [pageSnapshot, afterSnapshot()],
      ),
    );
    expect(tampered.success).toBe(false);
    expect(tampered.issues.some((entry) => entry.code === "POSTCONDITION_HASH_MISMATCH")).toBe(true);
    await expect(handler(request)).rejects.toMatchObject({ phase: "result" });
    expect(settlements).toEqual(["verified_applied", "uncertain"]);
  });

  it("fails closed before browser execution when semantic request validation fails", async () => {
    const request = await validSetFieldRequest();
    let executed = false;
    let settledReservationId = "";
    const handler = createValidatedBrowserMcpWriteHandler("browser_set_field", {
      reserveTrustedExecutionContext: async () =>
        contextFor(trustedPolicyRecord(request.authorization)),
      executeValidatedWrite: async () => {
        executed = true;
        throw new Error("must not execute");
      },
      loadTrustedResultContext: async () => {
        throw new Error("must not load result context");
      },
      settleTrustedExecution: async (settlement) => {
        settledReservationId = settlement.executionReservationId;
      },
    });

    await expect(
      handler({
        ...request,
        value: "Grace",
        authorization: {
          ...request.authorization,
          executionReservationId: "reservation:forged",
        },
      }),
    ).rejects.toMatchObject({ phase: "request" });
    expect(executed).toBe(false);
    expect(settledReservationId).toBe(request.authorization.executionReservationId);
  });

  it("requires trusted transport proof before an attempted action can be retried", async () => {
    const request = await validSetFieldRequest();
    const observedAfter = {
      ...afterSnapshot(),
      targets: afterSnapshot().targets.map((target) =>
        target.id === "target:first-name"
          ? {
              ...target,
              observedValue: { state: "empty" as const, selectedOptionLabels: [] },
            }
          : target,
      ),
    };
    const evidenceHash = "6".repeat(64);
    const receipt = {
      kind: "policy_grant" as const,
      applicationId: request.applicationId,
      runId: request.runId,
      browserSessionRef: request.browserSessionRef,
      actionId: request.authorization.actionId,
      actionFingerprint: request.authorization.actionFingerprint,
      sourceSnapshotId: request.snapshotId,
      pageFingerprint: request.expectedPageFingerprint,
      pageGeneration: request.expectedPageGeneration,
      origin: "https://jobs.example.com",
      tool: "browser_set_field" as const,
      risk: "reversible" as const,
      decisionId: request.authorization.decisionId,
      grantHash: request.authorization.grantHash,
      executionReservationId: request.authorization.executionReservationId,
      executionNonceHash: policyNonceHash,
      executionLeaseExpiresAt: request.authorization.executionLeaseExpiresAt,
    };
    const failure = {
      result: {
        contractVersion: "1.0.0",
        requestId: request.requestId,
        applicationId: request.applicationId,
        runId: request.runId,
        browserSessionRef: request.browserSessionRef,
        startedAt: now,
        completedAt: later,
        tool: "browser_set_field",
        outcome: "verified_not_applied",
        actionId: request.authorization.actionId,
        actionFingerprint: request.authorization.actionFingerprint,
        authorizationReceipt: receipt,
        actionAttempted: true,
        outcomeCertain: true,
        beforeSnapshot: pageSnapshot,
        afterSnapshot: observedAfter,
        checkpoint: {
          ...checkpoint,
          id: "checkpoint:2",
          sequence: 2,
          pageFingerprint: observedAfter.pageFingerprint,
          createdAt: later,
        },
        evidenceArtifactIds: ["artifact:network-proof"],
        nonApplicationProof: {
          proofKind: "snapshot_state_unchanged",
          predecessorSnapshotId: pageSnapshot.snapshotId,
          observedSnapshotId: observedAfter.snapshotId,
          evidenceArtifactIds: ["artifact:network-proof"],
          evidenceHash,
          verifiedAt: later,
        },
        error: {
          code: "NOT_APPLIED",
          message: "The action did not reach the site.",
          redacted: true,
        },
      },
    };
    const evidenceRecord = {
      artifactId: "artifact:network-proof",
      contentHash: evidenceHash,
      applicationId: request.applicationId,
      runId: request.runId,
      browserSessionRef: request.browserSessionRef,
      actionId: request.authorization.actionId,
      actionFingerprint: request.authorization.actionFingerprint,
      tool: request.authorization.tool,
      executionReservationId: request.authorization.executionReservationId,
      sourceSnapshotId: pageSnapshot.snapshotId,
      observedSnapshotId: observedAfter.snapshotId,
      evidenceKind: "snapshot_state_unchanged" as const,
      verifiedSignalHashes: [],
      verifiedAt: later,
    };
    const weak = await validateBrowserWriteResult(
      "browser_set_field",
      request,
      failure,
      contextFor(
        trustedPolicyRecord(request.authorization),
        [evidenceRecord],
        [],
        [pageSnapshot, structuredClone(observedAfter)],
      ),
    );
    expect(weak.issues.some((entry) => entry.code === "NON_APPLICATION_PROOF_TOO_WEAK")).toBe(true);

    failure.result.nonApplicationProof.proofKind = "network_request_not_sent";
    const strongEvidence = {
      ...evidenceRecord,
      evidenceKind: "network_request_not_sent" as const,
    };
    const strong = await validateBrowserWriteResult(
      "browser_set_field",
      request,
      failure,
      contextFor(
        trustedPolicyRecord(request.authorization),
        [strongEvidence],
        [],
        [pageSnapshot, structuredClone(observedAfter)],
      ),
    );
    expect(strong).toEqual({ success: true, issues: [] });
  });

  it("never labels an attempted write as retryable", async () => {
    const request = await validSetFieldRequest();
    const failure = {
      result: {
        contractVersion: "1.0.0",
        requestId: "request:1",
        applicationId: "application:1",
        runId: "run:1",
        browserSessionRef: "browser-session:1",
        startedAt: now,
        completedAt: later,
        tool: "browser_set_field",
        outcome: "retryable_failure",
        actionId: "action:fill",
        actionFingerprint: request.authorization.actionFingerprint,
        authorizationReceipt: {
          kind: "policy_grant",
          applicationId: "application:1",
          runId: "run:1",
          browserSessionRef: "browser-session:1",
          actionId: "action:fill",
          actionFingerprint: request.authorization.actionFingerprint,
          sourceSnapshotId: "snapshot:1",
          pageFingerprint: hash,
          pageGeneration: 1,
          origin: "https://jobs.example.com",
          tool: "browser_set_field",
          risk: "reversible",
          decisionId: "decision:1",
          grantHash: "d".repeat(64),
          executionReservationId: request.authorization.executionReservationId,
          executionNonceHash: policyNonceHash,
          executionLeaseExpiresAt: request.authorization.executionLeaseExpiresAt,
        },
        actionAttempted: true,
        outcomeCertain: true,
        beforeSnapshot: pageSnapshot,
        checkpoint,
        evidenceArtifactIds: [],
        error: {
          code: "TIMEOUT",
          message: "Timed out before verification.",
          redacted: true,
        },
      },
    };
    expect(BrowserSetFieldOutputSchema.safeParse(failure).success).toBe(false);
  });

  it("accepts origins only, never credentialed or path-bearing URLs", () => {
    expect(HttpOriginSchema.safeParse("https://jobs.example.com").success).toBe(true);
    expect(HttpOriginSchema.safeParse("https://jobs.example.com/apply").success).toBe(false);
    expect(HttpOriginSchema.safeParse("https://user@jobs.example.com").success).toBe(false);
  });
});
