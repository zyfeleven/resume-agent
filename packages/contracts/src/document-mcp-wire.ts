import { toJSONSchema, z } from "zod";

import {
  DocumentMcpToolNameSchema,
  documentMcpToolCatalog,
  type DocumentMcpToolName,
} from "./document-mcp.js";
import { CONTRACT_VERSION, JsonValueSchema } from "./common.js";
import {
  documentReadInputSchemas,
  documentReadOutputSchemas,
  documentWriteInputSchemas,
  documentWriteOutputSchemas,
  validateDocumentReadRequest,
  validateDocumentReadResult,
  validateDocumentWriteRequest,
  validateDocumentWriteResult,
  type DocumentReadToolName,
  type DocumentSemanticIssue,
  type DocumentValidationContext,
  type DocumentWriteToolName,
} from "./document-mcp-validation.js";

export const DocumentMcpWireToolSchema = z
  .object({
    name: DocumentMcpToolNameSchema,
    title: z.string().min(1).max(160),
    description: z.string().min(1).max(2_000),
    inputSchema: z.record(z.string(), JsonValueSchema),
    outputSchema: z.record(z.string(), JsonValueSchema),
    annotations: z
      .object({
        readOnlyHint: z.boolean(),
        destructiveHint: z.boolean(),
        idempotentHint: z.boolean(),
        openWorldHint: z.literal(false),
      })
      .strict(),
    _meta: z
      .object({
        "resume-agent/contractVersion": z.literal(CONTRACT_VERSION),
        "resume-agent/risk": z.enum([
          "read_only",
          "reversible",
          "takeover",
          "consequential",
        ]),
      })
      .strict(),
  })
  .strict();

export type DocumentMcpWireTool = z.infer<typeof DocumentMcpWireToolSchema>;

export function buildDocumentMcpWireTools(): DocumentMcpWireTool[] {
  return Object.values(documentMcpToolCatalog).map((contract) =>
    DocumentMcpWireToolSchema.parse({
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

export function parseDocumentMcpStructuredContent(
  tool: DocumentMcpToolName,
  structuredContent: unknown,
): unknown {
  return documentMcpToolCatalog[tool].outputSchema.parse(structuredContent);
}

export class DocumentMcpSemanticValidationError extends Error {
  readonly phase: "request" | "result";
  readonly issues: readonly DocumentSemanticIssue[];

  constructor(phase: "request" | "result", issues: readonly DocumentSemanticIssue[]) {
    super(`Document MCP ${phase} failed trusted semantic validation.`);
    this.name = "DocumentMcpSemanticValidationError";
    this.phase = phase;
    this.issues = issues;
  }
}

export interface DocumentMcpReadHandlerDependencies {
  /** Loads detached, server-owned artifact and lineage records before the worker runs. */
  loadTrustedRequestContext: (
    tool: DocumentReadToolName,
    input: unknown,
  ) => Promise<DocumentValidationContext>;
  /** Runs only the validated request. The executor never receives trusted records. */
  executeValidatedRead: (tool: DocumentReadToolName, input: unknown) => Promise<unknown>;
  /** Reloads persisted artifacts and reports after execution; worker claims are not authority. */
  loadTrustedResultContext: (
    tool: DocumentReadToolName,
    input: unknown,
    output: unknown,
  ) => Promise<DocumentValidationContext>;
}

function trustedContextsAreDetached(
  before: DocumentValidationContext,
  after: DocumentValidationContext,
): boolean {
  const detachedOptional = (left: unknown, right: unknown) =>
    left === undefined || left !== right;
  return (
    before !== after &&
    Date.parse(after.now) >= Date.parse(before.now) &&
    before.artifactRecords !== after.artifactRecords &&
    before.snapshots !== after.snapshots &&
    before.templateProfiles !== after.templateProfiles &&
    before.buildManifests !== after.buildManifests &&
    before.textDiffReports !== after.textDiffReports &&
    before.renderManifests !== after.renderManifests &&
    before.visualDiffReports !== after.visualDiffReports &&
    before.privacyReports !== after.privacyReports &&
    before.qaReports !== after.qaReports &&
    before.exportManifests !== after.exportManifests &&
    before.reviews !== after.reviews &&
    before.facts !== after.facts &&
    before.requirements !== after.requirements &&
    before.inspectors !== after.inspectors &&
    before.parserRecords !== after.parserRecords &&
    before.rendererRecords !== after.rendererRecords &&
    before.comparatorRecords !== after.comparatorRecords &&
    before.workerRecords !== after.workerRecords &&
    before.qaEvidenceRecords !== after.qaEvidenceRecords &&
    before.nonCreationEvidenceRecords !== after.nonCreationEvidenceRecords &&
    detachedOptional(before.resumeRecord, after.resumeRecord) &&
    detachedOptional(before.baseResumeRecord, after.baseResumeRecord) &&
    detachedOptional(before.changeSet, after.changeSet) &&
    detachedOptional(before.contentApproval, after.contentApproval) &&
    detachedOptional(before.factSnapshot, after.factSnapshot) &&
    detachedOptional(before.requirementSnapshot, after.requirementSnapshot) &&
    detachedOptional(before.templateRecord, after.templateRecord) &&
    detachedOptional(before.authorizationRecord, after.authorizationRecord)
  );
}

export function createValidatedDocumentMcpReadHandler(
  tool: DocumentReadToolName,
  dependencies: DocumentMcpReadHandlerDependencies,
): (input: unknown) => Promise<unknown> {
  return async (input: unknown) => {
    const parsedInput = documentReadInputSchemas[tool].parse(input);
    const requestContext = await dependencies.loadTrustedRequestContext(tool, parsedInput);
    const requestValidation = validateDocumentReadRequest(tool, parsedInput, requestContext);
    if (!requestValidation.success) {
      throw new DocumentMcpSemanticValidationError("request", requestValidation.issues);
    }

    const output = await dependencies.executeValidatedRead(tool, parsedInput);
    const parsedOutput = documentReadOutputSchemas[tool].parse(output);
    const resultContext = await dependencies.loadTrustedResultContext(
      tool,
      parsedInput,
      parsedOutput,
    );
    if (!trustedContextsAreDetached(requestContext, resultContext)) {
      throw new DocumentMcpSemanticValidationError("result", [
        {
          code: "TRUSTED_RESULT_CONTEXT_NOT_DETACHED",
          path: "trustedResultContext",
          message: "Result validation must use independently reloaded trusted records.",
        },
      ]);
    }
    const resultValidation = await validateDocumentReadResult(
      tool,
      parsedInput,
      parsedOutput,
      resultContext,
    );
    if (!resultValidation.success) {
      throw new DocumentMcpSemanticValidationError("result", resultValidation.issues);
    }
    return parsedOutput;
  };
}

export interface DocumentMcpWriteHandlerDependencies {
  /**
   * Loads trusted records and atomically reserves the one-time grant or effect claim using CAS.
   * Client-supplied context is never accepted.
   */
  reserveTrustedExecutionContext: (
    tool: DocumentWriteToolName,
    input: unknown,
  ) => Promise<DocumentValidationContext>;
  /** Executes only already-validated structured input, without trusted validation context. */
  executeValidatedWrite: (tool: DocumentWriteToolName, input: unknown) => Promise<unknown>;
  /** Reloads detached output bytes, manifests, reports, and authorization after execution. */
  loadTrustedResultContext: (
    tool: DocumentWriteToolName,
    input: unknown,
    output: unknown,
  ) => Promise<DocumentValidationContext>;
  /** Atomically settles the exact trusted reservation on every exit path. */
  settleTrustedExecution: (settlement: {
    tool: DocumentWriteToolName;
    operationId: string;
    actionFingerprint: string;
    executionReservationId: string;
    disposition:
      | "rejected_before_execution"
      | "verified_created"
      | "verified_not_created"
      | "uncertain";
  }) => Promise<void>;
}

export function createValidatedDocumentMcpWriteHandler(
  tool: DocumentWriteToolName,
  dependencies: DocumentMcpWriteHandlerDependencies,
): (input: unknown) => Promise<unknown> {
  return async (input: unknown) => {
    const parsedInput = documentWriteInputSchemas[tool].parse(input);
    const executionContext = await dependencies.reserveTrustedExecutionContext(tool, parsedInput);
    const reservation = executionContext.authorizationRecord;
    if (!reservation) {
      throw new DocumentMcpSemanticValidationError("request", [
        {
          code: "AUTHORIZATION_RECORD_MISSING",
          path: "authorization",
          message: "CAS reservation did not return a trusted authorization record.",
        },
      ]);
    }
    let disposition:
      | "rejected_before_execution"
      | "verified_created"
      | "verified_not_created"
      | "uncertain" = "uncertain";

    try {
      const requestValidation = await validateDocumentWriteRequest(
        tool,
        parsedInput,
        executionContext,
      );
      if (!requestValidation.success) {
        disposition = "rejected_before_execution";
        throw new DocumentMcpSemanticValidationError("request", requestValidation.issues);
      }

      const output = await dependencies.executeValidatedWrite(tool, parsedInput);
      const parsedOutput = documentWriteOutputSchemas[tool].parse(output);
      const resultContext = await dependencies.loadTrustedResultContext(
        tool,
        parsedInput,
        parsedOutput,
      );
      if (!trustedContextsAreDetached(executionContext, resultContext)) {
        throw new DocumentMcpSemanticValidationError("result", [
          {
            code: "TRUSTED_RESULT_CONTEXT_NOT_DETACHED",
            path: "trustedResultContext",
            message: "Result validation must use independently reloaded trusted records.",
          },
        ]);
      }
      const resultValidation = await validateDocumentWriteResult(
        tool,
        parsedInput,
        parsedOutput,
        resultContext,
      );
      if (!resultValidation.success) {
        throw new DocumentMcpSemanticValidationError("result", resultValidation.issues);
      }

      const outcome = (parsedOutput as { result: { outcome: string } }).result.outcome;
      disposition =
        outcome === "verified_created"
          ? "verified_created"
          : outcome === "verified_not_created"
            ? "verified_not_created"
            : "uncertain";
      return parsedOutput;
    } finally {
      await dependencies.settleTrustedExecution({
        tool,
        operationId: reservation.operationId,
        actionFingerprint: reservation.actionFingerprint,
        executionReservationId: reservation.executionReservationId,
        disposition,
      });
    }
  };
}
