import { toJSONSchema, z } from "zod";

import {
  BrowserMcpToolNameSchema,
  browserMcpToolCatalog,
  type BrowserMcpToolName,
} from "./browser-mcp.js";
import { CONTRACT_VERSION, JsonValueSchema } from "./common.js";
import {
  browserWriteInputSchemas,
  browserWriteOutputSchemas,
  browserReadInputSchemas,
  browserReadOutputSchemas,
  validateBrowserReadRequest,
  validateBrowserReadResult,
  validateBrowserWriteRequest,
  validateBrowserWriteResult,
  type BrowserSemanticIssue,
  type BrowserWriteToolName,
  type BrowserWriteValidationContext,
  type BrowserReadToolName,
} from "./browser-mcp-validation.js";

export const BrowserMcpWireToolSchema = z
  .object({
    name: BrowserMcpToolNameSchema,
    title: z.string().min(1).max(160),
    description: z.string().min(1).max(2_000),
    inputSchema: z.record(z.string(), JsonValueSchema),
    outputSchema: z.record(z.string(), JsonValueSchema),
    annotations: z
      .object({
        readOnlyHint: z.boolean(),
        destructiveHint: z.boolean(),
        idempotentHint: z.boolean(),
        openWorldHint: z.boolean(),
      })
      .strict(),
    _meta: z
      .object({
        "resume-agent/contractVersion": z.literal(CONTRACT_VERSION),
        "resume-agent/risk": z.enum(["read_only", "reversible", "takeover", "consequential"]),
      })
      .strict(),
  })
  .strict();

export type BrowserMcpWireTool = z.infer<typeof BrowserMcpWireToolSchema>;

export function buildBrowserMcpWireTools(): BrowserMcpWireTool[] {
  return Object.values(browserMcpToolCatalog).map((contract) =>
    BrowserMcpWireToolSchema.parse({
      name: contract.descriptor.name,
      title: contract.descriptor.title,
      description: contract.descriptor.description,
      inputSchema: toJSONSchema(contract.inputSchema, { target: "draft-2020-12" }),
      outputSchema: toJSONSchema(contract.outputSchema, { target: "draft-2020-12" }),
      annotations: contract.descriptor.annotations,
      _meta: {
        "resume-agent/contractVersion": CONTRACT_VERSION,
        "resume-agent/risk": contract.descriptor.risk,
      },
    }),
  );
}

export function parseBrowserMcpStructuredContent(
  tool: BrowserMcpToolName,
  structuredContent: unknown,
): unknown {
  return browserMcpToolCatalog[tool].outputSchema.parse(structuredContent);
}

export class BrowserMcpSemanticValidationError extends Error {
  readonly phase: "request" | "result";
  readonly issues: readonly BrowserSemanticIssue[];

  constructor(phase: "request" | "result", issues: readonly BrowserSemanticIssue[]) {
    super(`Browser MCP ${phase} failed trusted semantic validation.`);
    this.name = "BrowserMcpSemanticValidationError";
    this.phase = phase;
    this.issues = issues;
  }
}

export interface BrowserMcpWriteHandlerDependencies {
  /**
   * Loads server-owned records immediately before execution and atomically reserves the action.
   * This must be a compare-and-set from an unreserved grant/claim to its one-time `executing`
   * reservation for every write tool; client-supplied context is never accepted.
   */
  reserveTrustedExecutionContext: (
    tool: BrowserWriteToolName,
    input: unknown,
  ) => Promise<BrowserWriteValidationContext>;
  /** Executes only the already-validated input. Trusted validation context is never exposed. */
  executeValidatedWrite: (
    tool: BrowserWriteToolName,
    input: unknown,
  ) => Promise<unknown>;
  /** Reloads detached snapshots, authorization, and newly persisted evidence after execution. */
  loadTrustedResultContext: (
    tool: BrowserWriteToolName,
    input: unknown,
    output: unknown,
  ) => Promise<BrowserWriteValidationContext>;
  /** Atomically settles the exact reservation. This callback is awaited on every exit path. */
  settleTrustedExecution: (settlement: {
    tool: BrowserWriteToolName;
    actionId: string;
    actionFingerprint: string;
    executionReservationId: string;
    disposition:
      | "rejected_before_execution"
      | "verified_applied"
      | "verified_not_applied"
      | "not_attempted"
      | "uncertain";
  }) => Promise<void>;
}

export interface BrowserMcpReadHandlerDependencies {
  trustedNow: () => string;
  executeValidatedRead: (tool: BrowserReadToolName, input: unknown) => Promise<unknown>;
}

/** Fail-closed handler boundary for session-open and snapshot reads. */
export function createValidatedBrowserMcpReadHandler(
  tool: BrowserReadToolName,
  dependencies: BrowserMcpReadHandlerDependencies,
): (input: unknown) => Promise<unknown> {
  return async (input: unknown) => {
    const parsedInput = browserReadInputSchemas[tool].parse(input);
    const now = dependencies.trustedNow();
    const requestValidation = validateBrowserReadRequest(tool, parsedInput, now);
    if (!requestValidation.success) {
      throw new BrowserMcpSemanticValidationError("request", requestValidation.issues);
    }
    const output = await dependencies.executeValidatedRead(tool, parsedInput);
    const parsedOutput = browserReadOutputSchemas[tool].parse(output);
    const resultValidation = validateBrowserReadResult(
      tool,
      parsedInput,
      parsedOutput,
      now,
    );
    if (!resultValidation.success) {
      throw new BrowserMcpSemanticValidationError("result", resultValidation.issues);
    }
    return parsedOutput;
  };
}

/**
 * The only supported write-handler boundary for an MCP server. It validates trusted state before
 * calling the browser and validates structured evidence afterwards, failing closed in both phases.
 */
export function createValidatedBrowserMcpWriteHandler(
  tool: BrowserWriteToolName,
  dependencies: BrowserMcpWriteHandlerDependencies,
): (input: unknown) => Promise<unknown> {
  return async (input: unknown) => {
    const parsedInput = browserWriteInputSchemas[tool].parse(input);
    const executionContext = await dependencies.reserveTrustedExecutionContext(tool, parsedInput);
    const reservedAuthorization = executionContext.authorizationRecord;
    let disposition:
      | "rejected_before_execution"
      | "verified_applied"
      | "verified_not_applied"
      | "not_attempted"
      | "uncertain" = "uncertain";

    try {
      const requestValidation = await validateBrowserWriteRequest(
        tool,
        parsedInput,
        executionContext,
      );
      if (!requestValidation.success) {
        disposition = "rejected_before_execution";
        throw new BrowserMcpSemanticValidationError("request", requestValidation.issues);
      }

      const output = await dependencies.executeValidatedWrite(tool, parsedInput);
      const parsedOutput = browserWriteOutputSchemas[tool].parse(output);
      const resultContext = await dependencies.loadTrustedResultContext(
        tool,
        parsedInput,
        parsedOutput,
      );
      if (
        resultContext === executionContext ||
        resultContext.evidenceRecords === executionContext.evidenceRecords ||
        resultContext.artifactRecords === executionContext.artifactRecords ||
        resultContext.observedSnapshots === executionContext.observedSnapshots
      ) {
        throw new BrowserMcpSemanticValidationError("result", [
          {
            code: "TRUSTED_RESULT_CONTEXT_NOT_RELOADED",
            path: "resultContext",
            message: "Result validation requires detached records reloaded after execution.",
          },
        ]);
      }
      const resultValidation = await validateBrowserWriteResult(
        tool,
        parsedInput,
        parsedOutput,
        resultContext,
      );
      if (!resultValidation.success) {
        throw new BrowserMcpSemanticValidationError("result", resultValidation.issues);
      }
      const result = parsedOutput.result;
      disposition = result.outcome === "verified_applied"
        ? "verified_applied"
        : result.outcome === "verified_not_applied"
          ? "verified_not_applied"
          : result.actionAttempted === false
            ? "not_attempted"
            : "uncertain";
      return parsedOutput;
    } finally {
      await dependencies.settleTrustedExecution({
        tool,
        actionId: reservedAuthorization.actionId,
        actionFingerprint: reservedAuthorization.actionFingerprint,
        executionReservationId: reservedAuthorization.executionReservationId,
        disposition,
      });
    }
  };
}
