import { z } from "zod";

import {
  ArtifactExportInputSchema,
  ArtifactExportOutputSchema,
  DocxApplyChangesetInputSchema,
  DocxApplyChangesetOutputSchema,
  DocxParseInputSchema,
  DocxParseOutputSchema,
  DocxPrivacyScrubInputSchema,
  DocxPrivacyScrubOutputSchema,
  DocxRenderPagesInputSchema,
  DocxRenderPagesOutputSchema,
  DocxStructureAuditInputSchema,
  DocxStructureAuditOutputSchema,
  DocxTextDiffInputSchema,
  DocxTextDiffOutputSchema,
  DocxVisualDiffInputSchema,
  DocxVisualDiffOutputSchema,
  DocumentArtifactRefSchema,
  DocumentBuildManifestSchema,
  DocumentContentBindingSchema,
  DocumentExportManifestSchema,
  DocumentFactSnapshotSchema,
  DocumentMcpToolNameSchema,
  DocumentPackageLimitsSchema,
  DocumentPrivacyReportSchema,
  DocumentPresentationPlanSchema,
  DocumentQaCheckKindSchema,
  DocumentQaReportSchema,
  DocumentRenderManifestSchema,
  DocumentRequirementSnapshotSchema,
  DocumentSnapshotSchema,
  DocumentTemplateProfileSchema,
  DocumentTextDiffHunkSchema,
  DocumentTextDiffReportSchema,
  DocumentTrustedAuthorizationRecordSchema,
  DocumentVisualDiffReportSchema,
  TemplateInspectInputSchema,
  TemplateInspectOutputSchema,
  type DocumentArtifactRef,
  type DocumentMcpToolName,
} from "./document-mcp.js";
import { EntityIdSchema, IsoDateTimeSchema, Sha256Schema } from "./common.js";
import {
  ResumeChangeReviewSchema,
  ResumeChangeSetSchema,
  ResumeContentApprovalSchema,
  ResumeVersionSchema,
} from "./resume.js";

export const documentReadInputSchemas = {
  docx_parse: DocxParseInputSchema,
  template_inspect: TemplateInspectInputSchema,
  docx_text_diff: DocxTextDiffInputSchema,
  docx_render_pages: DocxRenderPagesInputSchema,
  docx_visual_diff: DocxVisualDiffInputSchema,
  docx_structure_audit: DocxStructureAuditInputSchema,
} as const;

export const documentReadOutputSchemas = {
  docx_parse: DocxParseOutputSchema,
  template_inspect: TemplateInspectOutputSchema,
  docx_text_diff: DocxTextDiffOutputSchema,
  docx_render_pages: DocxRenderPagesOutputSchema,
  docx_visual_diff: DocxVisualDiffOutputSchema,
  docx_structure_audit: DocxStructureAuditOutputSchema,
} as const;

export const documentWriteInputSchemas = {
  docx_apply_changeset: DocxApplyChangesetInputSchema,
  docx_privacy_scrub: DocxPrivacyScrubInputSchema,
  artifact_export: ArtifactExportInputSchema,
} as const;

export const documentWriteOutputSchemas = {
  docx_apply_changeset: DocxApplyChangesetOutputSchema,
  docx_privacy_scrub: DocxPrivacyScrubOutputSchema,
  artifact_export: ArtifactExportOutputSchema,
} as const;

export type DocumentReadToolName = keyof typeof documentReadInputSchemas;
export type DocumentWriteToolName = keyof typeof documentWriteInputSchemas;

export interface DocumentSemanticIssue {
  code: string;
  path: string;
  message: string;
}

export interface DocumentSemanticValidation {
  success: boolean;
  issues: DocumentSemanticIssue[];
}

export const DocumentTrustedArtifactRecordSchema = DocumentArtifactRefSchema.extend({
  ownerProfileId: EntityIdSchema,
  resumeVersionId: EntityIdSchema.optional(),
  creatingOperationId: EntityIdSchema.optional(),
  actualByteHash: Sha256Schema,
  status: z.literal("available"),
  verifiedAt: IsoDateTimeSchema,
}).strict();

export const DocumentTrustedResumeRecordSchema = z
  .object({
    version: ResumeVersionSchema,
    revision: z.number().int().nonnegative(),
    documentArtifactId: EntityIdSchema.optional(),
    documentArtifactHash: Sha256Schema.optional(),
    documentSnapshotHash: Sha256Schema.optional(),
    contentBindings: z.array(DocumentContentBindingSchema).max(20_000).optional(),
  })
  .strict();

export const DocumentTrustedFactRecordSchema = z
  .object({
    factId: EntityIdSchema,
    profileId: EntityIdSchema,
    version: z.number().int().positive(),
    factHash: Sha256Schema,
    status: z.literal("verified"),
    sourceArtifactIds: z.array(EntityIdSchema).min(1).max(100),
  })
  .strict();

export const DocumentTrustedRequirementRecordSchema = z
  .object({
    requirementId: EntityIdSchema,
    jobId: EntityIdSchema,
    requirementHash: Sha256Schema,
  })
  .strict();

export const DocumentTrustedTemplateRecordSchema = z
  .object({
    templateId: EntityIdSchema,
    templateVersion: z.string().min(1).max(160),
    artifactId: EntityIdSchema,
    artifactHash: Sha256Schema,
    profileHash: Sha256Schema,
    status: z.literal("active"),
    verifiedAt: IsoDateTimeSchema,
  })
  .strict();

export const DocumentTrustedInspectorRecordSchema = z
  .object({
    inspectorType: z.enum(["user", "agent", "service"]),
    inspectorId: EntityIdSchema,
    status: z.literal("active"),
    canInspectRenderedPages: z.literal(true),
    verifiedAt: IsoDateTimeSchema,
  })
  .strict();

export const DocumentTrustedParserRecordSchema = z
  .object({
    purpose: z.enum(["docx_parse", "template_inspect"]),
    profileHash: Sha256Schema,
    workerName: z.string().min(1).max(160),
    workerVersion: z.string().min(1).max(160),
    packageLimits: DocumentPackageLimitsSchema,
    noNetwork: z.literal(true),
    status: z.literal("active"),
    verifiedAt: IsoDateTimeSchema,
  })
  .strict();

export const DocumentTrustedRendererRecordSchema = z
  .object({
    rendererName: z.string().min(1).max(160),
    rendererVersion: z.string().min(1).max(160),
    runtimeHash: Sha256Schema,
    configurationHash: Sha256Schema,
    fontPackHash: Sha256Schema,
    noNetwork: z.literal(true),
    status: z.literal("active"),
    verifiedAt: IsoDateTimeSchema,
  })
  .strict();

export const DocumentTrustedComparatorRecordSchema = z
  .object({
    comparatorName: z.string().min(1).max(160),
    comparatorVersion: z.string().min(1).max(160),
    runtimeHash: Sha256Schema,
    configurationHash: Sha256Schema,
    noNetwork: z.literal(true),
    status: z.literal("active"),
    verifiedAt: IsoDateTimeSchema,
  })
  .strict();

export const DocumentTrustedWorkerRecordSchema = z
  .object({
    purpose: z.enum([
      "docx_apply_changeset",
      "docx_text_diff",
      "docx_privacy_scrub",
      "docx_structure_audit",
    ]),
    profileHash: Sha256Schema,
    workerName: z.string().min(1).max(160),
    workerVersion: z.string().min(1).max(160),
    runtimeHash: Sha256Schema,
    configurationHash: Sha256Schema,
    noNetwork: z.literal(true),
    status: z.literal("active"),
    verifiedAt: IsoDateTimeSchema,
  })
  .strict();

export const DocumentTrustedQaEvidenceRecordSchema = z
  .object({
    artifactId: EntityIdSchema,
    contentHash: Sha256Schema,
    resumeVersionId: EntityIdSchema,
    profileId: EntityIdSchema,
    candidateArtifactId: EntityIdSchema,
    candidateArtifactHash: Sha256Schema,
    checkKind: DocumentQaCheckKindSchema,
    pageNumber: z.number().int().positive().max(1_000).optional(),
    evidenceKind: z.enum([
      "package_security_inspection",
      "ooxml_integrity_scan",
      "approved_text_diff",
      "ats_order_scan",
      "structure_scan",
      "styles_numbering_scan",
      "link_scan",
      "privacy_scan",
      "accessibility_scan",
      "render_manifest",
      "page_visual_inspection",
      "claim_provenance_audit",
    ]),
    verifiedAt: IsoDateTimeSchema,
  })
  .strict();

export const DocumentTrustedNonCreationEvidenceRecordSchema = z
  .object({
    proofKind: z.enum([
      "executor_not_invoked",
      "storage_transaction_not_started",
      "rollback_confirmed",
    ]),
    operationId: EntityIdSchema,
    actionFingerprint: Sha256Schema,
    executionReservationId: EntityIdSchema,
    evidenceArtifactIds: z.array(EntityIdSchema).min(1).max(100),
    verifiedAt: IsoDateTimeSchema,
    proofHash: Sha256Schema,
  })
  .strict();

export const DocumentValidationContextSchema = z
  .object({
    authenticatedProfileId: EntityIdSchema,
    now: IsoDateTimeSchema,
    artifactRecords: z.array(DocumentTrustedArtifactRecordSchema).max(20_000),
    snapshots: z.array(DocumentSnapshotSchema).max(1_000),
    templateProfiles: z.array(DocumentTemplateProfileSchema).max(100),
    buildManifests: z.array(DocumentBuildManifestSchema).max(1_000),
    textDiffReports: z.array(DocumentTextDiffReportSchema).max(1_000),
    renderManifests: z.array(DocumentRenderManifestSchema).max(1_000),
    visualDiffReports: z.array(DocumentVisualDiffReportSchema).max(1_000),
    privacyReports: z.array(DocumentPrivacyReportSchema).max(1_000),
    qaReports: z.array(DocumentQaReportSchema).max(1_000),
    exportManifests: z.array(DocumentExportManifestSchema).max(1_000),
    resumeRecord: DocumentTrustedResumeRecordSchema.optional(),
    baseResumeRecord: DocumentTrustedResumeRecordSchema.optional(),
    changeSet: ResumeChangeSetSchema.optional(),
    reviews: z.array(ResumeChangeReviewSchema).max(10_000),
    contentApproval: ResumeContentApprovalSchema.optional(),
    factSnapshot: DocumentFactSnapshotSchema.optional(),
    facts: z.array(DocumentTrustedFactRecordSchema).max(5_000),
    requirementSnapshot: DocumentRequirementSnapshotSchema.optional(),
    requirements: z.array(DocumentTrustedRequirementRecordSchema).max(2_000),
    templateRecord: DocumentTrustedTemplateRecordSchema.optional(),
    inspectors: z.array(DocumentTrustedInspectorRecordSchema).max(100),
    parserRecords: z.array(DocumentTrustedParserRecordSchema).max(100),
    rendererRecords: z.array(DocumentTrustedRendererRecordSchema).max(100),
    comparatorRecords: z.array(DocumentTrustedComparatorRecordSchema).max(100),
    workerRecords: z.array(DocumentTrustedWorkerRecordSchema).max(100),
    qaEvidenceRecords: z.array(DocumentTrustedQaEvidenceRecordSchema).max(10_000),
    nonCreationEvidenceRecords: z
      .array(DocumentTrustedNonCreationEvidenceRecordSchema)
      .max(100),
    authorizationRecord: DocumentTrustedAuthorizationRecordSchema.optional(),
  })
  .strict();

export type DocumentValidationContext = z.infer<typeof DocumentValidationContextSchema>;

function addIssue(
  issues: DocumentSemanticIssue[],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value.normalize("NFC"));
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object" && value) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Document action payload contains a non-JSON value.");
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Cross-worker canonical JSON hash used by approvals and immutable manifests. */
export async function computeDocumentCanonicalHash(value: unknown): Promise<string> {
  return sha256(canonicalize(value));
}

function canonicalDocumentActionPayload(
  tool: DocumentWriteToolName,
  request: Record<string, unknown>,
): unknown {
  const authorization = request.authorization as Record<string, unknown>;
  const payload = { ...request };
  delete payload.requestId;
  delete payload.deadlineAt;
  delete payload.authorization;
  return {
    tool,
    request: payload,
    authorization: {
      kind: authorization.kind,
      tool: authorization.tool,
      risk: authorization.risk,
      operationId: authorization.operationId,
      resumeVersionId: authorization.resumeVersionId,
      expectedResumeRevision: authorization.expectedResumeRevision,
      sourceArtifactId: authorization.sourceArtifactId,
      sourceArtifactHash: authorization.sourceArtifactHash,
      decisionId: authorization.decisionId,
      approvalId: authorization.approvalId,
      dispatchEffectId: authorization.dispatchEffectId,
      workerId: authorization.workerId,
      qaReportHash: authorization.qaReportHash,
      exportedArtifactHash: authorization.exportedArtifactHash,
    },
  };
}

export async function computeDocumentActionFingerprint(
  tool: DocumentWriteToolName,
  input: unknown,
): Promise<string> {
  const request = documentWriteInputSchemas[tool].parse(input) as unknown as Record<
    string,
    unknown
  >;
  return sha256(canonicalize(canonicalDocumentActionPayload(tool, request)));
}

function isExactRecord(left: unknown, right: unknown): boolean {
  return canonicalize(left) === canonicalize(right);
}

function verifyScope(
  request: Record<string, unknown>,
  context: DocumentValidationContext,
  issues: DocumentSemanticIssue[],
): void {
  if (
    request.profileId !== context.authenticatedProfileId ||
    (context.resumeRecord !== undefined &&
      context.resumeRecord.version.profileId !== context.authenticatedProfileId)
  ) {
    addIssue(
      issues,
      "AUTHENTICATED_PROFILE_MISMATCH",
      "profileId",
      "Operation scope and trusted resume must belong to the authenticated profile.",
    );
  }
  if (Date.parse(String(request.deadlineAt)) <= Date.parse(context.now)) {
    addIssue(issues, "REQUEST_EXPIRED", "deadlineAt", "Document operation deadline has expired.");
  }
  if (request.resumeVersionId && request.resumeVersionId !== context.resumeRecord?.version.id) {
    addIssue(
      issues,
      "SCOPE_RESUME_MISMATCH",
      "resumeVersionId",
      "Operation scope does not match the trusted resume version.",
    );
  }
  if (
    request.resumeVersionId !== undefined &&
    (request.expectedResumeRevision === undefined ||
      request.expectedResumeRevision !== context.resumeRecord?.revision)
  ) {
    addIssue(
      issues,
      "SCOPE_RESUME_REVISION_STALE",
      "expectedResumeRevision",
      "Operation scope must bind the current trusted resume revision.",
    );
  }
}

function verifyArtifact(
  ref: DocumentArtifactRef,
  context: DocumentValidationContext,
  issues: DocumentSemanticIssue[],
  path: string,
): void {
  const matches = context.artifactRecords.filter(
    (record) => record.artifactId === ref.artifactId,
  );
  if (
    matches.length !== 1 ||
    matches[0]?.ownerProfileId !== context.authenticatedProfileId ||
    matches[0]?.actualByteHash !== ref.contentHash ||
    !isExactRecord(
      ref,
      matches[0]
        ? {
            artifactId: matches[0].artifactId,
            kind: matches[0].kind,
            fileName: matches[0].fileName,
            mediaType: matches[0].mediaType,
            contentHash: matches[0].contentHash,
            byteSize: matches[0].byteSize,
          }
        : undefined,
    )
  ) {
    addIssue(
      issues,
      "ARTIFACT_TRUST_MISMATCH",
      path,
      "Artifact identity, metadata, and trusted byte hash must match exactly.",
    );
  }
}

function verifyResumeBinding(
  binding: Record<string, unknown>,
  context: DocumentValidationContext,
  issues: DocumentSemanticIssue[],
  path: string,
  trustedRecord = context.resumeRecord,
): void {
  const trusted = trustedRecord;
  if (
    !trusted ||
    binding.resumeVersionId !== trusted.version.id ||
    binding.profileId !== trusted.version.profileId ||
    binding.expectedResumeRevision !== trusted.revision ||
    binding.expectedResumeStatus !== trusted.version.status ||
    binding.sourceContentHash !== trusted.version.contentHash
  ) {
    addIssue(
      issues,
      "RESUME_BINDING_MISMATCH",
      path,
      "Resume ID, profile, revision, status, and content hash must match trusted state.",
    );
  }
}

function idsAreUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function findTrustedWorker(
  context: DocumentValidationContext,
  purpose: z.infer<typeof DocumentTrustedWorkerRecordSchema>["purpose"],
  profileHash: unknown,
) {
  return context.workerRecords.find(
    (record) => record.purpose === purpose && record.profileHash === profileHash,
  );
}

function renderManifestIsComplete(manifest: z.infer<typeof DocumentRenderManifestSchema>): boolean {
  const expectedPages = Array.from({ length: manifest.pageCount }, (_, index) => index + 1);
  return (
    manifest.pages.length === manifest.pageCount &&
    isExactRecord(
      manifest.pages.map((page) => page.pageNumber),
      expectedPages,
    ) &&
    idsAreUnique(manifest.pages.map((page) => page.artifact.artifactId))
  );
}

function verifyRenderArtifacts(
  manifest: z.infer<typeof DocumentRenderManifestSchema>,
  context: DocumentValidationContext,
  issues: DocumentSemanticIssue[],
  path: string,
): void {
  verifyArtifact(manifest.sourceDocument, context, issues, `${path}.sourceDocument`);
  verifyArtifact(manifest.manifestArtifact, context, issues, `${path}.manifestArtifact`);
  manifest.pages.forEach((page, index) =>
    verifyArtifact(page.artifact, context, issues, `${path}.pages.${index}.artifact`),
  );
}

function packageMetricsWithinLimits(
  snapshot: z.infer<typeof DocumentSnapshotSchema>,
): boolean {
  const metrics = snapshot.securityInspection.packageMetrics;
  const limits = snapshot.packageLimits;
  return (
    metrics.compressedBytes <= limits.maxCompressedBytes &&
    metrics.expandedBytes <= limits.maxExpandedBytes &&
    metrics.largestEntryBytes <= limits.maxEntryBytes &&
    metrics.entryCount <= limits.maxEntries &&
    metrics.maximumCompressionRatio <= limits.maxCompressionRatio
  );
}

async function snapshotContentIsConsistent(
  snapshot: z.infer<typeof DocumentSnapshotSchema>,
): Promise<boolean> {
  if (
    !packageMetricsWithinLimits(snapshot) ||
    !idsAreUnique(snapshot.blocks.map((block) => block.id)) ||
    !isExactRecord(
      snapshot.blocks.map((block) => block.ordinal),
      snapshot.blocks.map((_, index) => index),
    )
  ) {
    return false;
  }
  for (const block of snapshot.blocks) {
    if ((await sha256(block.text.normalize("NFC"))) !== block.textHash) return false;
  }
  return (
    (await computeDocumentSemanticTextHash(snapshot.blocks)) ===
    snapshot.semanticTextHash
  );
}

export async function computeDocumentSemanticTextHash(
  blocks: z.infer<typeof DocumentSnapshotSchema>["blocks"],
): Promise<string> {
  return sha256(
    canonicalize(
      blocks.map((block) => ({
        ordinal: block.ordinal,
        story: block.story,
        kind: block.kind,
        text: block.text,
      })),
    ),
  );
}

const requiredQaChecks = DocumentQaCheckKindSchema.options;
const qaEvidenceKindByCheck: Record<
  z.infer<typeof DocumentQaCheckKindSchema>,
  z.infer<typeof DocumentTrustedQaEvidenceRecordSchema>["evidenceKind"]
> = {
  package_security: "package_security_inspection",
  ooxml_integrity: "ooxml_integrity_scan",
  approved_text_diff: "approved_text_diff",
  ats_text_order: "ats_order_scan",
  structure: "structure_scan",
  styles_numbering: "styles_numbering_scan",
  links: "link_scan",
  privacy_metadata: "privacy_scan",
  accessibility: "accessibility_scan",
  render_complete: "render_manifest",
  visual_page_review: "page_visual_inspection",
  claim_provenance: "claim_provenance_audit",
};

function privacyReportIsClean(report: z.infer<typeof DocumentPrivacyReportSchema>): boolean {
  return (
    report.sourceDocument.artifactId !== report.outputDocument.artifactId &&
    report.semanticTextHashBefore === report.semanticTextHashAfter &&
    report.securityInspection.status === "clean" &&
    Object.values(report.remaining).every((value) => value === 0)
  );
}

function qaReportIsInternallyConsistent(
  report: z.infer<typeof DocumentQaReportSchema>,
  renderManifest: z.infer<typeof DocumentRenderManifestSchema> | undefined,
  context: DocumentValidationContext,
): boolean {
  const declaredChecks = report.requiredCheckKinds;
  const checks = report.checks.map((check) => check.kind);
  const pages = report.pageInspections.map((page) => page.pageNumber);
  const expectedPages = renderManifest
    ? Array.from({ length: renderManifest.pageCount }, (_, index) => index + 1)
    : [];
  const allPassed =
    report.checks.every((check) => check.status === "passed") &&
    report.pageInspections.every((page) => page.status === "passed") &&
    report.findings.every((finding) => finding.severity !== "blocking");
  const evidenceArtifactIds = [
    ...report.checks.flatMap((check) => check.evidenceArtifactIds),
    ...report.pageInspections.flatMap((page) => page.evidenceArtifactIds),
    ...report.findings.flatMap((finding) => finding.evidenceArtifactIds),
  ];
  const evidenceMatches = (
    artifactId: string,
    checkKind: z.infer<typeof DocumentQaCheckKindSchema>,
    pageNumber?: number,
  ) => {
    const evidence = context.qaEvidenceRecords.find(
      (record) => record.artifactId === artifactId,
    );
    const artifact = context.artifactRecords.find(
      (record) => record.artifactId === artifactId,
    );
    return Boolean(
        evidence &&
        artifact &&
        evidence.contentHash === artifact.contentHash &&
        artifact.actualByteHash === artifact.contentHash &&
        artifact.ownerProfileId === report.profileId &&
        evidence.resumeVersionId === report.resumeVersionId &&
        evidence.profileId === report.profileId &&
        evidence.candidateArtifactId === report.candidateDocument.artifactId &&
        evidence.candidateArtifactHash === report.candidateDocument.contentHash &&
        evidence.checkKind === checkKind &&
        evidence.evidenceKind === qaEvidenceKindByCheck[checkKind] &&
        evidence.pageNumber === pageNumber &&
        Date.parse(artifact.verifiedAt) <= Date.parse(evidence.verifiedAt) &&
        Date.parse(evidence.verifiedAt) >= Date.parse(renderManifest?.renderedAt ?? "") &&
        Date.parse(evidence.verifiedAt) <= Date.parse(report.completedAt) &&
        Date.parse(evidence.verifiedAt) <= Date.parse(context.now),
    );
  };
  const pageDefectFlags = (page: (typeof report.pageInspections)[number]) => [
    page.clipping,
    page.overlap,
    page.missingGlyph,
    page.fontFallback,
    page.tableOverflow,
    page.bulletMisalignment,
    page.headerFooterCollision,
    page.unexpectedPageBreak,
    page.orphanHeading,
    page.unexpectedBlankPage,
  ];
  return (
    idsAreUnique(declaredChecks) &&
    idsAreUnique(checks) &&
    requiredQaChecks.every((kind) => declaredChecks.includes(kind)) &&
    requiredQaChecks.every((kind) => checks.includes(kind)) &&
    Boolean(renderManifest) &&
    report.renderSetHash === renderManifest?.renderSetHash &&
    Date.parse(report.completedAt) >= Date.parse(renderManifest?.renderedAt ?? "") &&
    Date.parse(report.completedAt) <= Date.parse(context.now) &&
    isExactRecord(pages, expectedPages) &&
    report.pageInspections.every((page, index) =>
      isExactRecord(page.pageArtifact, renderManifest?.pages[index]?.artifact),
    ) &&
    report.pageInspections.every((page) =>
      page.status === "passed"
        ? pageDefectFlags(page).every((value) => value === false)
        : page.status === "failed"
          ? pageDefectFlags(page).some((value) => value === true)
          : true,
    ) &&
    idsAreUnique(report.findings.map((finding) => finding.id)) &&
    report.checks.every((check) =>
      check.findingIds.every((id) =>
        report.findings.some(
          (finding) => finding.id === id && finding.check === check.kind,
        ),
      ),
    ) &&
    report.findings.every((finding) =>
      report.checks.some(
        (check) => check.kind === finding.check && check.findingIds.includes(finding.id),
      ),
    ) &&
    idsAreUnique(evidenceArtifactIds) &&
    report.checks.every((check) =>
      check.evidenceArtifactIds.every((artifactId) =>
        evidenceMatches(artifactId, check.kind),
      ),
    ) &&
    report.pageInspections.every((page) =>
      page.evidenceArtifactIds.every((artifactId) =>
        evidenceMatches(artifactId, "visual_page_review", page.pageNumber),
      ),
    ) &&
    report.findings.every((finding) =>
      finding.evidenceArtifactIds.every((artifactId) =>
        evidenceMatches(artifactId, finding.check, finding.pageNumber),
      ),
    ) &&
    report.pageInspections.every((page) =>
      context.inspectors.some(
        (inspector) =>
          inspector.inspectorType === page.inspectorType &&
          inspector.inspectorId === page.inspectorId &&
          Date.parse(inspector.verifiedAt) <= Date.parse(page.inspectedAt),
      ),
    ) &&
    report.pageInspections.every(
      (page) =>
        Date.parse(page.inspectedAt) >=
          Date.parse(renderManifest?.renderedAt ?? "") &&
        Date.parse(page.inspectedAt) <= Date.parse(report.completedAt) &&
        Date.parse(page.inspectedAt) <= Date.parse(context.now),
    ) &&
    (report.overallStatus === "passed" ? allPassed : !allPassed)
  );
}

function verifyReadRequestByTool(
  tool: DocumentReadToolName,
  request: Record<string, unknown>,
  context: DocumentValidationContext,
  issues: DocumentSemanticIssue[],
): void {
  switch (tool) {
    case "docx_parse": {
      verifyArtifact(request.sourceDocument as DocumentArtifactRef, context, issues, "sourceDocument");
      if (
        !context.parserRecords.some(
          (record) =>
            record.purpose === "docx_parse" &&
            record.profileHash === request.parserProfileHash &&
            isExactRecord(record.packageLimits, request.packageLimits),
        )
      ) {
        addIssue(
          issues,
          "PARSER_PROFILE_UNTRUSTED",
          "parserProfileHash",
          "Parser profile and package limits must be selected from the active trusted toolchain.",
        );
      }
      break;
    }
    case "template_inspect": {
      verifyArtifact(
        request.templateDocument as DocumentArtifactRef,
        context,
        issues,
        "templateDocument",
      );
      if (
        !context.parserRecords.some(
          (record) =>
            record.purpose === "template_inspect" &&
            record.profileHash === request.inspectionProfileHash &&
            isExactRecord(record.packageLimits, request.packageLimits),
        )
      ) {
        addIssue(
          issues,
          "INSPECTION_PROFILE_UNTRUSTED",
          "inspectionProfileHash",
          "Template inspection must use an active trusted no-network toolchain.",
        );
      }
      break;
    }
    case "docx_text_diff": {
      const base = request.baseDocument as DocumentArtifactRef;
      const candidate = request.candidateDocument as DocumentArtifactRef;
      verifyArtifact(base, context, issues, "baseDocument");
      verifyArtifact(candidate, context, issues, "candidateDocument");
      if (base.artifactId === candidate.artifactId) {
        addIssue(issues, "DIFF_IDENTICAL_ARTIFACT", "candidateDocument", "Diff sides must be different immutable artifacts.");
      }
      if (
        !context.snapshots.some(
          (snapshot) =>
            snapshot.snapshotHash === request.baseSnapshotHash &&
            snapshot.sourceArtifact.artifactId === base.artifactId,
        ) ||
        !context.snapshots.some(
          (snapshot) =>
            snapshot.snapshotHash === request.candidateSnapshotHash &&
            snapshot.sourceArtifact.artifactId === candidate.artifactId,
        )
      ) {
        addIssue(issues, "DIFF_SNAPSHOT_MISMATCH", "baseSnapshotHash", "Diff snapshots must be trusted and bound to each side.");
      }
      if (
        context.changeSet?.id !== request.changeSetId ||
        context.changeSet?.contentHash !== request.changeSetHash
      ) {
        addIssue(issues, "DIFF_CHANGESET_MISMATCH", "changeSetHash", "Diff must use the trusted change set.");
      }
      const build = context.buildManifests.find(
        (manifest) => manifest.manifestHash === request.buildManifestHash,
      );
      const trustedScrub = build
        ? context.privacyReports.find(
            (report) =>
              isExactRecord(report.sourceDocument, build.outputDocument) &&
              isExactRecord(report.outputDocument, candidate) &&
              privacyReportIsClean(report),
          )
        : undefined;
      if (
        !build ||
        build.changeSetId !== request.changeSetId ||
        build.changeSetHash !== request.changeSetHash ||
        !isExactRecord(build.sourceDocument, base) ||
        (!isExactRecord(build.outputDocument, candidate) && !trustedScrub)
      ) {
        addIssue(
          issues,
          "DIFF_BUILD_LINEAGE_MISMATCH",
          "buildManifestHash",
          "Text diff must bind the exact trusted build operations and any clean scrub derivative.",
        );
      }
      if (!findTrustedWorker(context, "docx_text_diff", request.differProfileHash)) {
        addIssue(
          issues,
          "DIFFER_PROFILE_UNTRUSTED",
          "differProfileHash",
          "Text diff must use an active trusted no-network worker profile.",
        );
      }
      break;
    }
    case "docx_render_pages": {
      const source = request.sourceDocument as DocumentArtifactRef;
      verifyArtifact(source, context, issues, "sourceDocument");
      const snapshot = context.snapshots.find(
        (value) => value.snapshotHash === request.sourceSnapshotHash,
      );
      if (
        !snapshot ||
        snapshot.sourceArtifact.artifactId !== source.artifactId ||
        snapshot.sourceArtifact.contentHash !== source.contentHash ||
        !packageMetricsWithinLimits(snapshot)
      ) {
        addIssue(
          issues,
          "RENDER_SOURCE_NOT_INSPECTED",
          "sourceSnapshotHash",
          "Renderer accepts only the exact DOCX bytes from a trusted clean snapshot.",
        );
      }
      if (
        !context.rendererRecords.some(
          (record) =>
            record.rendererName === request.rendererName &&
            record.rendererVersion === request.rendererVersion &&
            record.runtimeHash === request.runtimeHash &&
            record.configurationHash === request.configurationHash &&
            record.fontPackHash === request.fontPackHash,
        )
      ) {
        addIssue(
          issues,
          "RENDERER_TOOLCHAIN_UNTRUSTED",
          "rendererName",
          "Renderer, runtime, configuration, and font pack must be server-owned and pinned.",
        );
      }
      break;
    }
    case "docx_visual_diff": {
      const base = request.baseRenderManifest as z.infer<typeof DocumentRenderManifestSchema>;
      const candidate = request.candidateRenderManifest as z.infer<typeof DocumentRenderManifestSchema>;
      if (
        !context.renderManifests.some((manifest) => isExactRecord(manifest, base)) ||
        !context.renderManifests.some((manifest) => isExactRecord(manifest, candidate)) ||
        base.renderSetHash === candidate.renderSetHash ||
        !renderManifestIsComplete(base) ||
        !renderManifestIsComplete(candidate)
      ) {
        addIssue(issues, "VISUAL_DIFF_RENDER_MISMATCH", "baseRenderManifest", "Visual diff requires complete trusted render manifests.");
      }
      if (
        !context.comparatorRecords.some(
          (record) =>
            record.comparatorName === request.comparatorName &&
            record.comparatorVersion === request.comparatorVersion &&
            record.runtimeHash === request.runtimeHash &&
            record.configurationHash === request.configurationHash,
        )
      ) {
        addIssue(
          issues,
          "COMPARATOR_TOOLCHAIN_UNTRUSTED",
          "comparatorName",
          "Visual comparator configuration must be selected from trusted active records.",
        );
      }
      verifyRenderArtifacts(base, context, issues, "baseRenderManifest");
      verifyRenderArtifacts(candidate, context, issues, "candidateRenderManifest");
      break;
    }
    case "docx_structure_audit": {
      verifyResumeBinding(request.resume as Record<string, unknown>, context, issues, "resume");
      const candidate = request.candidateDocument as DocumentArtifactRef;
      verifyArtifact(candidate, context, issues, "candidateDocument");
      const build = request.buildManifest as z.infer<typeof DocumentBuildManifestSchema>;
      const text = request.textDiffReport as z.infer<typeof DocumentTextDiffReportSchema>;
      const render = request.renderManifest as z.infer<typeof DocumentRenderManifestSchema>;
      const visual = request.visualDiffReport as z.infer<typeof DocumentVisualDiffReportSchema>;
      const privacy = request.privacyReport as z.infer<typeof DocumentPrivacyReportSchema>;
      const visualBaseRender = context.renderManifests.find(
        (value) => value.renderSetHash === visual.baseRenderSetHash,
      );
      const requestedChecks = request.requiredCheckKinds as z.infer<
        typeof DocumentQaCheckKindSchema
      >[];
      if (
        !context.buildManifests.some((value) => isExactRecord(value, build)) ||
        !context.textDiffReports.some((value) => isExactRecord(value, text)) ||
        !context.renderManifests.some((value) => isExactRecord(value, render)) ||
        !context.visualDiffReports.some((value) => isExactRecord(value, visual)) ||
        !context.privacyReports.some((value) => isExactRecord(value, privacy)) ||
        text.buildManifestHash !== build.manifestHash ||
        text.changeSetId !== build.changeSetId ||
        text.changeSetHash !== build.changeSetHash ||
        build.resumeVersionId !==
          (request.resume as Record<string, unknown>).resumeVersionId ||
        build.profileId !== request.profileId ||
        !isExactRecord(build.outputDocument, privacy.sourceDocument) ||
        !isExactRecord(text.candidateDocument, candidate) ||
        !isExactRecord(render.sourceDocument, candidate) ||
        !isExactRecord(privacy.outputDocument, candidate) ||
        visual.candidateRenderSetHash !== render.renderSetHash ||
        !visualBaseRender ||
        !isExactRecord(visualBaseRender.sourceDocument, text.baseDocument) ||
        !isExactRecord(render.sourceDocument, text.candidateDocument) ||
        !renderManifestIsComplete(render) ||
        !privacyReportIsClean(privacy)
      ) {
        addIssue(issues, "AUDIT_LINEAGE_MISMATCH", "buildManifest", "Audit inputs must form one exact, complete, privacy-clean lineage.");
      }
      if (
        !idsAreUnique(requestedChecks) ||
        !requiredQaChecks.every((kind) => requestedChecks.includes(kind))
      ) {
        addIssue(
          issues,
          "AUDIT_REQUIRED_CHECKS_INVALID",
          "requiredCheckKinds",
          "All twelve fixed QA checks must be requested exactly once.",
        );
      }
      if (!findTrustedWorker(context, "docx_structure_audit", request.auditProfileHash)) {
        addIssue(
          issues,
          "AUDITOR_PROFILE_UNTRUSTED",
          "auditProfileHash",
          "Structure audit must use an active trusted no-network worker profile.",
        );
      }
      verifyArtifact(build.sourceDocument, context, issues, "buildManifest.sourceDocument");
      verifyArtifact(build.outputDocument, context, issues, "buildManifest.outputDocument");
      verifyArtifact(build.manifestArtifact, context, issues, "buildManifest.manifestArtifact");
      verifyArtifact(
        build.presentationPlanArtifact,
        context,
        issues,
        "buildManifest.presentationPlanArtifact",
      );
      verifyArtifact(text.baseDocument, context, issues, "textDiffReport.baseDocument");
      verifyArtifact(text.candidateDocument, context, issues, "textDiffReport.candidateDocument");
      verifyArtifact(text.reportArtifact, context, issues, "textDiffReport.reportArtifact");
      verifyRenderArtifacts(render, context, issues, "renderManifest");
      verifyArtifact(visual.reportArtifact, context, issues, "visualDiffReport.reportArtifact");
      visual.pages.forEach((page, index) => {
        if (page.basePage) {
          verifyArtifact(page.basePage, context, issues, `visualDiffReport.pages.${index}.basePage`);
        }
        verifyArtifact(page.candidatePage, context, issues, `visualDiffReport.pages.${index}.candidatePage`);
        verifyArtifact(page.diffImage, context, issues, `visualDiffReport.pages.${index}.diffImage`);
      });
      verifyArtifact(privacy.sourceDocument, context, issues, "privacyReport.sourceDocument");
      verifyArtifact(privacy.outputDocument, context, issues, "privacyReport.outputDocument");
      verifyArtifact(privacy.reportArtifact, context, issues, "privacyReport.reportArtifact");
      break;
    }
  }
}

export function validateDocumentReadRequest(
  tool: DocumentReadToolName,
  input: unknown,
  rawContext: unknown,
): DocumentSemanticValidation {
  const context = DocumentValidationContextSchema.parse(rawContext);
  const request = documentReadInputSchemas[tool].parse(input) as unknown as Record<string, unknown>;
  const issues: DocumentSemanticIssue[] = [];
  verifyScope(request, context, issues);
  verifyReadRequestByTool(tool, request, context, issues);
  return { success: issues.length === 0, issues };
}

function verifyResultScope(
  tool: DocumentMcpToolName,
  request: Record<string, unknown>,
  result: Record<string, unknown>,
  context: DocumentValidationContext,
  issues: DocumentSemanticIssue[],
): void {
  if (
    result.tool !== tool ||
    result.requestId !== request.requestId ||
    result.operationId !== request.operationId ||
    result.profileId !== request.profileId
  ) {
    addIssue(issues, "RESULT_SCOPE_MISMATCH", "result", "Result must match the exact request scope and tool.");
  }
  if (
    Date.parse(String(result.startedAt)) > Date.parse(String(result.completedAt)) ||
    Date.parse(String(result.completedAt)) > Date.parse(context.now)
  ) {
    addIssue(issues, "RESULT_TIME_MISMATCH", "result.completedAt", "Result timestamps must be ordered and no later than trusted time.");
  }
}

export async function validateDocumentReadResult(
  tool: DocumentReadToolName,
  input: unknown,
  output: unknown,
  rawContext: unknown,
): Promise<DocumentSemanticValidation> {
  const context = DocumentValidationContextSchema.parse(rawContext);
  const requestValidation = validateDocumentReadRequest(tool, input, context);
  const request = documentReadInputSchemas[tool].parse(input) as unknown as Record<string, unknown>;
  const parsed = documentReadOutputSchemas[tool].parse(output) as unknown as {
    result: Record<string, unknown>;
  };
  const result = parsed.result;
  const issues = [...requestValidation.issues];
  verifyResultScope(tool, request, result, context, issues);
  if (result.outcome !== "success") {
    const evidenceArtifactIds = Array.isArray(result.evidenceArtifactIds)
      ? result.evidenceArtifactIds.map(String)
      : [];
    if (
      !idsAreUnique(evidenceArtifactIds) ||
      evidenceArtifactIds.some(
        (artifactId) =>
          !context.artifactRecords.some(
            (record) =>
              record.artifactId === artifactId &&
              record.ownerProfileId === context.authenticatedProfileId &&
              record.actualByteHash === record.contentHash &&
              record.creatingOperationId === request.operationId,
          ),
      )
    ) {
      addIssue(
        issues,
        "READ_FAILURE_EVIDENCE_UNTRUSTED",
        "result.evidenceArtifactIds",
        "Read failure evidence must be unique and reloaded from trusted storage.",
      );
    }
    return { success: issues.length === 0, issues };
  }

  switch (tool) {
    case "docx_parse": {
      const snapshot = result.snapshot as z.infer<typeof DocumentSnapshotSchema>;
      const parserRecord = context.parserRecords.find(
        (record) =>
          record.purpose === "docx_parse" &&
          record.profileHash === request.parserProfileHash &&
          isExactRecord(record.packageLimits, request.packageLimits),
      );
      if (
        !isExactRecord(snapshot.sourceArtifact, request.sourceDocument) ||
        snapshot.parserProfileHash !== request.parserProfileHash ||
        !isExactRecord(snapshot.packageLimits, request.packageLimits) ||
        snapshot.parserName !== parserRecord?.workerName ||
        snapshot.parserVersion !== parserRecord?.workerVersion ||
        !(await snapshotContentIsConsistent(snapshot)) ||
        !context.snapshots.some((value) => isExactRecord(value, snapshot))
      ) {
        addIssue(issues, "PARSE_RESULT_UNTRUSTED", "result.snapshot", "Parsed snapshot must be reloaded from trusted storage and bind the source bytes.");
      }
      verifyArtifact(snapshot.snapshotArtifact, context, issues, "result.snapshot.snapshotArtifact");
      break;
    }
    case "template_inspect": {
      const profile = result.template as z.infer<typeof DocumentTemplateProfileSchema>;
      const sourceSnapshot = context.snapshots.find(
        (snapshot) => snapshot.snapshotHash === profile.sourceSnapshotHash,
      );
      const inspectorRecord = context.parserRecords.find(
        (record) =>
          record.purpose === "template_inspect" &&
          record.profileHash === request.inspectionProfileHash &&
          isExactRecord(record.packageLimits, request.packageLimits),
      );
      const dynamicBlockIds = profile.slots.flatMap(
        (slot) => slot.targetBlockIds,
      );
      const classifiedBlockIds = [
        ...dynamicBlockIds,
        ...profile.staticBlockIds,
      ];
      if (
        !isExactRecord(profile.templateArtifact, request.templateDocument) ||
        profile.inspectionProfileHash !== request.inspectionProfileHash ||
        !isExactRecord(profile.packageLimits, request.packageLimits) ||
        profile.inspectorName !== inspectorRecord?.workerName ||
        profile.inspectorVersion !== inspectorRecord?.workerVersion ||
        !sourceSnapshot ||
        sourceSnapshot.sourceArtifact.artifactId !== profile.templateArtifact.artifactId ||
        !(await snapshotContentIsConsistent(sourceSnapshot)) ||
        !idsAreUnique(profile.slots.map((slot) => slot.slotId)) ||
        !idsAreUnique(dynamicBlockIds) ||
        !idsAreUnique(profile.staticBlockIds) ||
        !idsAreUnique(classifiedBlockIds) ||
        !isExactRecord(
          [...classifiedBlockIds].sort(),
          sourceSnapshot.blocks.map((block) => block.id).sort(),
        ) ||
        profile.slots.some((slot) =>
          slot.targetBlockIds.some(
            (blockId) => !sourceSnapshot.blocks.some((block) => block.id === blockId),
          ),
        ) ||
        !context.templateProfiles.some((value) => isExactRecord(value, profile))
      ) {
        addIssue(issues, "TEMPLATE_RESULT_UNTRUSTED", "result.template", "Template profile must be trusted and bind the inspected bytes.");
      }
      verifyArtifact(profile.profileArtifact, context, issues, "result.template.profileArtifact");
      break;
    }
    case "docx_text_diff": {
      const report = result.report as z.infer<typeof DocumentTextDiffReportSchema>;
      const expectedChangeIds = context.changeSet?.changes
        .filter((change) => change.intent !== "keep")
        .map((change) => change.id) ?? [];
      const baseSnapshot = context.snapshots.find(
        (snapshot) => snapshot.snapshotHash === request.baseSnapshotHash,
      );
      const candidateSnapshot = context.snapshots.find(
        (snapshot) => snapshot.snapshotHash === request.candidateSnapshotHash,
      );
      const differRecord = findTrustedWorker(
        context,
        "docx_text_diff",
        request.differProfileHash,
      );
      const build = context.buildManifests.find(
        (manifest) => manifest.manifestHash === request.buildManifestHash,
      );
      const actualChangedBlockIds = new Set<string>();
      if (baseSnapshot && candidateSnapshot) {
        const allBlockIds = new Set([
          ...baseSnapshot.blocks.map((block) => block.id),
          ...candidateSnapshot.blocks.map((block) => block.id),
        ]);
        for (const blockId of allBlockIds) {
          const before = baseSnapshot.blocks.find((block) => block.id === blockId);
          const after = candidateSnapshot.blocks.find((block) => block.id === blockId);
          if (
            !before ||
            !after ||
            before.textHash !== after.textHash ||
            before.story !== after.story ||
            before.kind !== after.kind
          ) {
            actualChangedBlockIds.add(blockId);
          }
        }
      }
      const hunkMatchesSnapshots = (hunk: z.infer<typeof DocumentTextDiffHunkSchema>) => {
        const operation = build?.operations.find((value) => {
          const changedBlockId =
            value.kind === "insert_block_after"
              ? value.insertedBlockId
              : value.targetBlockId;
          return value.changeId === hunk.changeId && changedBlockId === hunk.blockId;
        });
        const expectedKind =
          operation?.kind === "replace_block"
            ? "replace"
            : operation?.kind === "remove_block"
              ? "delete"
              : operation?.kind === "insert_block_after"
                ? "insert"
                : undefined;
        if (!operation || hunk.kind !== expectedKind) return false;
        const before = baseSnapshot?.blocks.find((block) => block.id === hunk.blockId);
        const after = candidateSnapshot?.blocks.find((block) => block.id === hunk.blockId);
        if (hunk.kind === "insert") {
          return !before && Boolean(after) && !hunk.beforeTextHash && hunk.afterTextHash === after?.textHash;
        }
        if (hunk.kind === "delete") {
          return Boolean(before) && !after && hunk.beforeTextHash === before?.textHash && !hunk.afterTextHash;
        }
        if (hunk.kind === "replace") {
          return (
            Boolean(before && after) &&
            before?.textHash !== after?.textHash &&
            hunk.beforeTextHash === before?.textHash &&
            hunk.afterTextHash === after?.textHash
          );
        }
        return (
          Boolean(before && after) &&
          before?.textHash === after?.textHash &&
          before?.ordinal !== after?.ordinal &&
          hunk.beforeTextHash === before?.textHash &&
          hunk.afterTextHash === after?.textHash
        );
      };
      if (
        !isExactRecord(report.baseDocument, request.baseDocument) ||
        !isExactRecord(report.candidateDocument, request.candidateDocument) ||
        report.changeSetId !== request.changeSetId ||
        report.changeSetHash !== request.changeSetHash ||
        report.buildManifestHash !== request.buildManifestHash ||
        report.differName !== differRecord?.workerName ||
        report.differVersion !== differRecord?.workerVersion ||
        report.runtimeHash !== differRecord?.runtimeHash ||
        report.configurationHash !== differRecord?.configurationHash ||
        report.unexpectedHunkCount !== 0 ||
        report.hiddenContentChangeCount !== 0 ||
        report.relationshipChangeCount !== 0 ||
        report.baseSemanticTextHash !== baseSnapshot?.semanticTextHash ||
        report.candidateSemanticTextHash !== candidateSnapshot?.semanticTextHash ||
        report.hunks.some((hunk) => !hunk.approved) ||
        !idsAreUnique(report.hunks.map((hunk) => hunk.id)) ||
        !idsAreUnique(report.hunks.map((hunk) => hunk.blockId)) ||
        report.hunks.some((hunk) => !hunkMatchesSnapshots(hunk)) ||
        [...actualChangedBlockIds].some(
          (blockId) => !report.hunks.some((hunk) => hunk.blockId === blockId),
        ) ||
        report.hunks.some((hunk) => !actualChangedBlockIds.has(hunk.blockId)) ||
        build?.operations.some((operation) => {
          const changedBlockId =
            operation.kind === "insert_block_after"
              ? operation.insertedBlockId
              : operation.targetBlockId;
          return !report.hunks.some(
            (hunk) =>
              hunk.changeId === operation.changeId && hunk.blockId === changedBlockId,
          );
        }) ||
        !idsAreUnique(report.expectedChangeIds) ||
        !isExactRecord(report.expectedChangeIds, expectedChangeIds) ||
        report.hunks.some((hunk) => !expectedChangeIds.includes(hunk.changeId)) ||
        expectedChangeIds.some(
          (changeId) => !report.hunks.some((hunk) => hunk.changeId === changeId),
        ) ||
        !context.textDiffReports.some((value) => isExactRecord(value, report))
      ) {
        addIssue(issues, "TEXT_DIFF_RESULT_INVALID", "result.report", "Text diff must be trusted and contain only approved, visible changes.");
      }
      verifyArtifact(report.reportArtifact, context, issues, "result.report.reportArtifact");
      break;
    }
    case "docx_render_pages": {
      const manifest = result.manifest as z.infer<typeof DocumentRenderManifestSchema>;
      if (
        !isExactRecord(manifest.sourceDocument, request.sourceDocument) ||
        manifest.rendererName !== request.rendererName ||
        manifest.rendererVersion !== request.rendererVersion ||
        manifest.runtimeHash !== request.runtimeHash ||
        manifest.configurationHash !== request.configurationHash ||
        manifest.fontPackHash !== request.fontPackHash ||
        manifest.revisionView !== request.revisionView ||
        manifest.pages.some((page) => page.dpi !== request.dpi) ||
        !renderManifestIsComplete(manifest) ||
        !context.renderManifests.some((value) => isExactRecord(value, manifest))
      ) {
        addIssue(issues, "RENDER_RESULT_INVALID", "result.manifest", "Render must be complete, trusted, and use the pinned runtime and font pack.");
      }
      verifyArtifact(manifest.manifestArtifact, context, issues, "result.manifest.manifestArtifact");
      manifest.pages.forEach((page, index) =>
        verifyArtifact(page.artifact, context, issues, `result.manifest.pages.${index}.artifact`),
      );
      break;
    }
    case "docx_visual_diff": {
      const report = result.report as z.infer<typeof DocumentVisualDiffReportSchema>;
      const base = request.baseRenderManifest as z.infer<typeof DocumentRenderManifestSchema>;
      const candidate = request.candidateRenderManifest as z.infer<typeof DocumentRenderManifestSchema>;
      if (
        report.baseRenderSetHash !== base.renderSetHash ||
        report.candidateRenderSetHash !== candidate.renderSetHash ||
        report.comparatorName !== request.comparatorName ||
        report.comparatorVersion !== request.comparatorVersion ||
        report.runtimeHash !== request.runtimeHash ||
        report.configurationHash !== request.configurationHash ||
        report.pages.length !== candidate.pageCount ||
        !isExactRecord(
          report.pages.map((page) => page.pageNumber),
          Array.from({ length: candidate.pageCount }, (_, index) => index + 1),
        ) ||
        report.addedPageCount !== report.pages.filter((page) => !page.basePage).length ||
        report.removedPageCount !== Math.max(0, base.pageCount - candidate.pageCount) ||
        report.pages.some((page, index) => {
          const expectedBasePage = base.pages[index]?.artifact;
          const baseDimensions = base.pages[index];
          const candidateDimensions = candidate.pages[index];
          const dimensionsMatch = Boolean(
            baseDimensions &&
              candidateDimensions &&
              baseDimensions.widthPixels === candidateDimensions.widthPixels &&
              baseDimensions.heightPixels === candidateDimensions.heightPixels,
          );
          return (
            !isExactRecord(page.candidatePage, candidate.pages[index]?.artifact) ||
            page.dimensionsMatch !== dimensionsMatch ||
            (expectedBasePage !== undefined &&
              (page.basePage === undefined ||
                !isExactRecord(page.basePage, expectedBasePage))) ||
            (expectedBasePage === undefined && page.basePage !== undefined)
          );
        }) ||
        !context.visualDiffReports.some((value) => isExactRecord(value, report))
      ) {
        addIssue(issues, "VISUAL_DIFF_RESULT_INVALID", "result.report", "Visual diff must cover every candidate page and bind both render sets.");
      }
      verifyArtifact(report.reportArtifact, context, issues, "result.report.reportArtifact");
      report.pages.forEach((page, index) => {
        verifyArtifact(page.candidatePage, context, issues, `result.report.pages.${index}.candidatePage`);
        verifyArtifact(page.diffImage, context, issues, `result.report.pages.${index}.diffImage`);
      });
      break;
    }
    case "docx_structure_audit": {
      const report = result.report as z.infer<typeof DocumentQaReportSchema>;
      const build = request.buildManifest as z.infer<typeof DocumentBuildManifestSchema>;
      const text = request.textDiffReport as z.infer<typeof DocumentTextDiffReportSchema>;
      const render = request.renderManifest as z.infer<typeof DocumentRenderManifestSchema>;
      const visual = request.visualDiffReport as z.infer<typeof DocumentVisualDiffReportSchema>;
      const privacy = request.privacyReport as z.infer<typeof DocumentPrivacyReportSchema>;
      const resume = request.resume as Record<string, unknown>;
      const candidate = request.candidateDocument as DocumentArtifactRef;
      const auditorRecord = findTrustedWorker(
        context,
        "docx_structure_audit",
        request.auditProfileHash,
      );
      if (
        !context.qaReports.some((value) => isExactRecord(value, report)) ||
        report.resumeVersionId !== resume.resumeVersionId ||
        report.profileId !== resume.profileId ||
        !isExactRecord(report.candidateDocument, candidate) ||
        report.buildManifestHash !== build.manifestHash ||
        report.textDiffReportHash !== text.reportHash ||
        report.renderSetHash !== render.renderSetHash ||
        report.visualDiffReportHash !== visual.reportHash ||
        report.privacyReportHash !== privacy.reportHash ||
        report.auditorName !== auditorRecord?.workerName ||
        report.auditorVersion !== auditorRecord?.workerVersion ||
        report.runtimeHash !== auditorRecord?.runtimeHash ||
        report.configurationHash !== auditorRecord?.configurationHash ||
        [
          build.createdAt,
          text.createdAt,
          render.renderedAt,
          visual.createdAt,
          privacy.createdAt,
        ].some(
          (timestamp) =>
            Date.parse(timestamp) > Date.parse(report.completedAt) ||
            Date.parse(timestamp) > Date.parse(context.now),
        ) ||
        !isExactRecord(report.requiredCheckKinds, request.requiredCheckKinds) ||
        !qaReportIsInternallyConsistent(report, render, context)
      ) {
        addIssue(issues, "QA_RESULT_INVALID", "result.report", "QA status must be re-derived from all fixed checks and every rendered page.");
      }
      verifyArtifact(report.reportArtifact, context, issues, "result.report.reportArtifact");
      break;
    }
  }
  return { success: issues.length === 0, issues };
}

function verifyAuthorization(
  tool: DocumentWriteToolName,
  request: Record<string, unknown>,
  context: DocumentValidationContext,
  issues: DocumentSemanticIssue[],
  expectedFingerprint: string,
): Promise<void> {
  return (async () => {
    const authorization = request.authorization as Record<string, unknown>;
    const trusted = context.authorizationRecord;
    const nonceHash = await sha256(String(authorization.executionNonce));
    const claimTokenHash = authorization.claimToken
      ? await sha256(String(authorization.claimToken))
      : undefined;
    if (
      !trusted ||
      trusted.tool !== tool ||
      trusted.resumeVersionId !== context.resumeRecord?.version.id ||
      trusted.expectedResumeRevision !== context.resumeRecord?.revision ||
      authorization.tool !== tool ||
      authorization.actionFingerprint !== expectedFingerprint ||
      trusted.actionFingerprint !== expectedFingerprint ||
      authorization.operationId !== request.operationId ||
      trusted.operationId !== request.operationId ||
      authorization.resumeVersionId !== context.resumeRecord?.version.id ||
      authorization.expectedResumeRevision !== context.resumeRecord?.revision ||
      authorization.executionReservationId !== trusted.executionReservationId ||
      nonceHash !== trusted.executionNonceHash ||
      authorization.executionLeaseExpiresAt !== trusted.executionLeaseExpiresAt ||
      Date.parse(String(authorization.expiresAt ?? authorization.executionLeaseExpiresAt)) <=
        Date.parse(context.now) ||
      Date.parse(trusted.expiresAt) <= Date.parse(context.now) ||
      Date.parse(String(authorization.executionLeaseExpiresAt)) <= Date.parse(context.now) ||
      Date.parse(trusted.executionLeaseExpiresAt) <= Date.parse(context.now) ||
      Date.parse(String(request.deadlineAt)) > Date.parse(String(authorization.expiresAt)) ||
      Date.parse(String(request.deadlineAt)) >
        Date.parse(String(authorization.executionLeaseExpiresAt)) ||
      authorization.kind !== trusted.kind ||
      authorization.risk !== trusted.risk ||
      authorization.sourceArtifactId !== trusted.sourceArtifactId ||
      authorization.sourceArtifactHash !== trusted.sourceArtifactHash ||
      (authorization.kind === "policy_grant" &&
        (trusted.kind !== "policy_grant" ||
          authorization.decisionId !== trusted.decisionId ||
          authorization.grantHash !== trusted.grantHash ||
          authorization.policyVersion !== trusted.policyVersion ||
          authorization.issuedAt !== trusted.issuedAt ||
          authorization.expiresAt !== trusted.expiresAt)) ||
      (authorization.kind === "effect_claim" &&
        (trusted.kind !== "effect_claim" ||
          authorization.approvalId !== trusted.approvalId ||
          authorization.dispatchEffectId !== trusted.dispatchEffectId ||
          authorization.workerId !== trusted.workerId ||
          authorization.claimedAt !== trusted.claimedAt ||
          authorization.expiresAt !== trusted.expiresAt ||
          claimTokenHash !== trusted.claimTokenHash ||
          authorization.qaReportHash !== trusted.qaReportHash ||
          authorization.exportedArtifactHash !== trusted.exportedArtifactHash))
    ) {
      addIssue(issues, "AUTHORIZATION_MISMATCH", "authorization", "Write requires the exact live, one-time trusted reservation and canonical fingerprint.");
    }
  })();
}

function verifyApplyRequest(
  request: ReturnType<typeof DocxApplyChangesetInputSchema.parse>,
  context: DocumentValidationContext,
  issues: DocumentSemanticIssue[],
): void {
  verifyResumeBinding(request.resume, context, issues, "resume");
  verifyResumeBinding(
    request.baseResume,
    context,
    issues,
    "baseResume",
    context.baseResumeRecord,
  );
  verifyArtifact(request.sourceDocument, context, issues, "sourceDocument");
  const baseVersion = context.baseResumeRecord?.version;
  const targetVersion = context.resumeRecord?.version;
  if (
    !baseVersion ||
    !targetVersion ||
    baseVersion.profileId !== request.profileId ||
    targetVersion.profileId !== request.profileId ||
    targetVersion.parentVersionId !== baseVersion.id ||
    targetVersion.changeSetId !== request.changeSet.id ||
    targetVersion.jobId !== request.changeSet.jobId ||
    targetVersion.templateId !== request.template.templateId ||
    !isExactRecord(targetVersion.resume, request.resultResume)
  ) {
    addIssue(
      issues,
      "RESUME_VERSION_LINEAGE_MISMATCH",
      "resume",
      "Tailored resume must be the exact trusted child of the bound base version for this job, change set, and template.",
    );
  }
  if (
    context.baseResumeRecord?.documentArtifactId !== request.sourceDocument.artifactId ||
    context.baseResumeRecord?.documentArtifactHash !== request.sourceDocument.contentHash
  ) {
    addIssue(
      issues,
      "BASE_RESUME_ARTIFACT_MISMATCH",
      "sourceDocument",
      "The source DOCX must be the trusted artifact for the exact base resume version.",
    );
  }
  const trustedSnapshot = context.snapshots.find(
    (snapshot) => snapshot.snapshotHash === request.sourceSnapshotHash,
  );
  if (
    !trustedSnapshot ||
    trustedSnapshot.sourceArtifact.artifactId !== request.sourceDocument.artifactId ||
    trustedSnapshot.sourceArtifact.contentHash !== request.sourceDocument.contentHash
  ) {
    addIssue(issues, "SOURCE_SNAPSHOT_MISMATCH", "sourceSnapshotHash", "Apply source snapshot is not trusted or does not bind the source document.");
  }
  const baseResume = context.baseResumeRecord?.version.resume;
  const baseItems = baseResume
    ? [
        ...baseResume.summary,
        ...baseResume.skills,
        ...baseResume.experience.flatMap((experience) => experience.bullets),
        ...baseResume.projects,
        ...baseResume.education,
      ]
    : [];
  const baseBindings = context.baseResumeRecord?.contentBindings;
  if (
    context.baseResumeRecord?.documentSnapshotHash !== request.sourceSnapshotHash ||
    !trustedSnapshot ||
    !baseBindings ||
    baseBindings.length !== baseItems.length ||
    !idsAreUnique(baseBindings.map((binding) => binding.contentItemId)) ||
    !idsAreUnique(baseBindings.map((binding) => binding.outputBlockId)) ||
    baseBindings.some((binding) => {
      const item = baseItems.find((value) => value.id === binding.contentItemId);
      const block = trustedSnapshot?.blocks.find(
        (value) => value.id === binding.outputBlockId,
      );
      return (
        !item ||
        !block ||
        block.text !== item.text ||
        block.textHash !== binding.outputTextHash
      );
    })
  ) {
    addIssue(
      issues,
      "BASE_CONTENT_BINDING_MISMATCH",
      "baseResume",
      "Every base ResumeIR content item must be bound to its exact trusted source DOCX block.",
    );
  }
  if (!context.changeSet || !isExactRecord(request.changeSet, context.changeSet)) {
    addIssue(issues, "CHANGESET_MISMATCH", "changeSet", "Apply must use the exact trusted change set.");
  }
  if (
    request.changeSet.baseResumeVersionId !== request.baseResume.resumeVersionId ||
    request.changeSet.baseContentHash !== request.baseResume.sourceContentHash ||
    request.changeSet.resultContentHash !== request.contentApproval.approvedContentHash ||
    request.changeSet.resultContentHash !== request.resume.sourceContentHash ||
    request.changeSet.factSnapshotHash !== request.factSnapshot.snapshotHash ||
    request.changeSet.requirementSnapshotHash !== request.requirementSnapshot?.snapshotHash
  ) {
    addIssue(issues, "CHANGESET_LINEAGE_MISMATCH", "changeSet", "Change set hashes must bind the exact resume, approved result, facts, and requirements.");
  }
  if (!context.contentApproval || !isExactRecord(request.contentApproval, context.contentApproval)) {
    addIssue(issues, "CONTENT_APPROVAL_MISMATCH", "contentApproval", "Aggregate content approval must come from trusted state.");
  }
  if (
    request.contentApproval.resumeVersionId !== request.resume.resumeVersionId ||
    request.contentApproval.profileId !== request.profileId ||
    request.contentApproval.jobId !== request.changeSet.jobId ||
    request.contentApproval.changeSetId !== request.changeSet.id ||
    request.contentApproval.changeSetHash !== request.changeSet.contentHash
  ) {
    addIssue(issues, "CONTENT_APPROVAL_SCOPE_MISMATCH", "contentApproval", "Approval must bind this profile, job, resume version, and change set.");
  }
  if (!context.factSnapshot || !isExactRecord(request.factSnapshot, context.factSnapshot)) {
    addIssue(issues, "FACT_SNAPSHOT_MISMATCH", "factSnapshot", "Fact snapshot must be trusted and current.");
  }
  const factsById = new Map(context.facts.map((fact) => [fact.factId, fact]));
  for (const change of request.changeSet.changes) {
    for (const factId of change.factIds) {
      const fact = factsById.get(factId);
      const snapshotFact = request.factSnapshot.facts.find((value) => value.factId === factId);
      if (!fact || fact.profileId !== request.profileId || snapshotFact?.version !== fact.version) {
        addIssue(issues, "UNVERIFIED_FACT_BINDING", `changeSet.changes.${change.id}`, "Every changed claim must bind a current verified fact from this profile.");
      }
    }
  }
  const resultItems = [
    ...request.resultResume.summary,
    ...request.resultResume.skills,
    ...request.resultResume.experience.flatMap((experience) => experience.bullets),
    ...request.resultResume.projects,
    ...request.resultResume.education,
  ];
  const transformationIsExhaustive =
    resultItems.every((item) =>
      baseItems.some((baseItem) => baseItem.id === item.id),
    ) &&
    baseItems.every((baseItem) => {
      const resultItem = resultItems.find((item) => item.id === baseItem.id);
      const effectiveChanges = request.changeSet.changes.filter(
        (change) =>
          change.intent !== "keep" &&
          (change.targetItemId === baseItem.id ||
            (change.intent === "combine" &&
              change.sourceItemIds.includes(baseItem.id))),
      );
      if (resultItem?.text === baseItem.text) return effectiveChanges.length === 0;
      if (resultItem) {
        return (
          effectiveChanges.length === 1 &&
          effectiveChanges[0]?.targetItemId === baseItem.id &&
          (effectiveChanges[0]?.intent === "rewrite" ||
            effectiveChanges[0]?.intent === "combine") &&
          effectiveChanges[0].after === resultItem.text
        );
      }
      return (
        effectiveChanges.length === 1 &&
        (effectiveChanges[0]?.intent === "remove" ||
          (effectiveChanges[0]?.intent === "combine" &&
            effectiveChanges[0].targetItemId !== baseItem.id))
      );
    });
  if (!transformationIsExhaustive) {
    addIssue(
      issues,
      "CHANGESET_TRANSFORMATION_INCOMPLETE",
      "changeSet.changes",
      "The change set must exhaustively explain every difference between base and approved final ResumeIR content.",
    );
  }
  const resultFactIds = [
    ...request.resultResume.headerFactIds,
    ...request.resultResume.experience.flatMap((experience) => [
      experience.organizationFactId,
      experience.roleFactId,
      ...experience.dateFactIds,
    ]),
    ...resultItems.flatMap((item) => item.factIds),
  ];
  if (
    request.resultResume.profileId !== request.profileId ||
    request.factSnapshot.profileId !== request.profileId ||
    !idsAreUnique(request.factSnapshot.facts.map((fact) => fact.factId)) ||
    resultFactIds.some((factId) => {
      const trustedFact = factsById.get(factId);
      const snapshotFact = request.factSnapshot.facts.find(
        (fact) => fact.factId === factId,
      );
      return (
        !trustedFact ||
        trustedFact.profileId !== request.profileId ||
        snapshotFact?.version !== trustedFact.version ||
        trustedFact.sourceArtifactIds.some(
          (artifactId) =>
            !context.artifactRecords.some(
              (artifact) => artifact.artifactId === artifactId,
            ),
        )
      );
    })
  ) {
    addIssue(
      issues,
      "RESULT_RESUME_FACT_SCOPE_MISMATCH",
      "resultResume",
      "Every final ResumeIR fact must be verified in the exact frozen snapshot for this profile.",
    );
  }
  const resultRequirementIds = resultItems.flatMap((item) => item.requirementIds);
  if (resultRequirementIds.length > 0 && !request.requirementSnapshot) {
    addIssue(
      issues,
      "RESULT_REQUIREMENT_SNAPSHOT_MISSING",
      "requirementSnapshot",
      "Final ResumeIR requirements require an exact frozen JD snapshot.",
    );
  }
  if (request.requirementSnapshot) {
    if (!context.requirementSnapshot || !isExactRecord(request.requirementSnapshot, context.requirementSnapshot)) {
      addIssue(issues, "REQUIREMENT_SNAPSHOT_MISMATCH", "requirementSnapshot", "Requirement snapshot must be trusted and current.");
    }
    const frozenRequirementIds = new Set(request.requirementSnapshot.requirementIds);
    const trustedRequirementIds = new Set(
      context.requirements
        .filter((value) => value.jobId === request.changeSet.jobId)
        .map((value) => value.requirementId),
    );
    const referencedRequirementIds = [
      ...request.changeSet.changes.flatMap((change) => change.requirementIds),
      ...resultRequirementIds,
    ];
    if (
      request.requirementSnapshot.jobId !== request.changeSet.jobId ||
      !idsAreUnique(request.requirementSnapshot.requirementIds) ||
      referencedRequirementIds.some(
        (id) => !frozenRequirementIds.has(id) || !trustedRequirementIds.has(id),
      )
    ) {
      addIssue(issues, "REQUIREMENT_BINDING_MISMATCH", "changeSet.changes", "Requirement IDs must belong to the exact job snapshot.");
    }
  }
  const expectedReviews = request.changeSet.changes.filter((change) => change.intent !== "keep");
  if (
    request.reviews.length !== expectedReviews.length ||
    !idsAreUnique(request.reviews.map((review) => review.changeId)) ||
    request.reviews.some(
      (review) =>
        review.changeSetId !== request.changeSet.id ||
        review.decision !== "approved" ||
        !expectedReviews.some((change) => change.id === review.changeId),
    ) ||
    expectedReviews.some(
      (change) => !request.reviews.some((review) => review.changeId === change.id),
    ) ||
    request.reviews.some((review) =>
      !context.reviews.some((trusted) => isExactRecord(trusted, review)),
    )
  ) {
    addIssue(issues, "CHANGE_REVIEW_MISMATCH", "reviews", "Every effective change requires an exact trusted approval review.");
  }
  const trustedTemplate = context.templateRecord;
  if (
    !trustedTemplate ||
    request.template.templateId !== trustedTemplate.templateId ||
    request.template.templateVersion !== trustedTemplate.templateVersion ||
    request.template.templateArtifact.artifactId !== trustedTemplate.artifactId ||
    request.template.templateArtifact.contentHash !== trustedTemplate.artifactHash ||
    request.template.profileHash !== trustedTemplate.profileHash ||
    !context.templateProfiles.some((profile) => isExactRecord(profile, request.template))
  ) {
    addIssue(issues, "TEMPLATE_TRUST_MISMATCH", "template", "Apply requires an active immutable trusted template profile.");
  }
}

export async function validateDocumentWriteRequest(
  tool: DocumentWriteToolName,
  input: unknown,
  rawContext: unknown,
): Promise<DocumentSemanticValidation> {
  const context = DocumentValidationContextSchema.parse(rawContext);
  const request = documentWriteInputSchemas[tool].parse(input) as unknown as Record<string, unknown>;
  const issues: DocumentSemanticIssue[] = [];
  verifyScope(request, context, issues);
  const expectedFingerprint = await computeDocumentActionFingerprint(tool, request);
  await verifyAuthorization(tool, request, context, issues, expectedFingerprint);
  const authorization = request.authorization as Record<string, unknown>;
  const source = (request.sourceDocument ?? request.candidateDocument) as DocumentArtifactRef;
  if (
    authorization.sourceArtifactId !== source.artifactId ||
    authorization.sourceArtifactHash !== source.contentHash
  ) {
    addIssue(issues, "AUTHORIZATION_SOURCE_MISMATCH", "authorization", "Authorization must bind the exact source artifact bytes.");
  }
  if (tool === "docx_apply_changeset") {
    const parsed = DocxApplyChangesetInputSchema.parse(request);
    verifyApplyRequest(parsed, context, issues);
    const templateSnapshot = context.snapshots.find(
      (snapshot) => snapshot.snapshotHash === parsed.template.sourceSnapshotHash,
    );
    if (
      !templateSnapshot ||
      !isExactRecord(
        templateSnapshot?.sourceArtifact,
        parsed.template.templateArtifact,
      ) ||
      !(await snapshotContentIsConsistent(templateSnapshot)) ||
      !isExactRecord(
        [...parsed.template.staticBlockIds].sort(),
        (templateSnapshot?.blocks ?? [])
          .filter((block) => parsed.template.staticBlockIds.includes(block.id))
          .map((block) => block.id)
          .sort(),
      )
    ) {
      addIssue(
        issues,
        "APPLY_TEMPLATE_SNAPSHOT_INVALID",
        "template.sourceSnapshotHash",
        "Apply requires the exact trusted, internally consistent template snapshot and static-block partition.",
      );
    }
    if (!findTrustedWorker(context, "docx_apply_changeset", parsed.builderProfileHash)) {
      addIssue(
        issues,
        "BUILDER_PROFILE_UNTRUSTED",
        "builderProfileHash",
        "DOCX construction must use an active trusted no-network worker profile.",
      );
    }
    if (parsed.authorization.approvalId !== parsed.contentApproval.id) {
      addIssue(
        issues,
        "APPLY_EFFECT_APPROVAL_MISMATCH",
        "authorization.approvalId",
        "Apply effect claim must be issued from the exact aggregate content approval.",
      );
    }
    const canonicalResultHash = await sha256(canonicalize(parsed.resultResume));
    if (canonicalResultHash !== parsed.changeSet.resultContentHash) {
      addIssue(
        issues,
        "RESULT_RESUME_HASH_MISMATCH",
        "resultResume",
        "Canonical approved ResumeIR hash must equal the change set result hash.",
      );
    }
    const expectedPresentationPlanHash = await computeDocumentCanonicalHash(
      parsed.presentationPlan.items,
    );
    verifyArtifact(
      parsed.presentationPlan.planArtifact,
      context,
      issues,
      "presentationPlan.planArtifact",
    );
    const contentItemsBySlot = [
      ...parsed.resultResume.summary.map((item) => ({ item, slotKind: "summary" as const })),
      ...parsed.resultResume.skills.map((item) => ({ item, slotKind: "skills" as const })),
      ...parsed.resultResume.experience.flatMap((experience) =>
        experience.bullets.map((item) => ({ item, slotKind: "experience" as const })),
      ),
      ...parsed.resultResume.projects.map((item) => ({ item, slotKind: "projects" as const })),
      ...parsed.resultResume.education.map((item) => ({ item, slotKind: "education" as const })),
    ];
    const contentPresentationItems = parsed.presentationPlan.items.filter(
      (item) => item.source.kind === "content_item",
    );
    const factPresentationItems = parsed.presentationPlan.items.filter(
      (item) => item.source.kind === "facts",
    );
    const sortedIds = (values: readonly string[]) => [...values].sort();
    const headerPresentedFactIds = factPresentationItems
      .filter(
        (item) =>
          item.source.kind === "facts" &&
          item.source.presentationKind === "header",
      )
      .flatMap((item) =>
        item.source.kind === "facts" ? item.source.factIds : [],
      );
    const planItemHashes = await Promise.all(
      parsed.presentationPlan.items.map((item) => sha256(item.text.normalize("NFC"))),
    );
    const slotOrdinalsAreContiguous = parsed.template.slots.every((slot) => {
      const ordinals = parsed.presentationPlan.items
        .filter((item) => item.slotId === slot.slotId)
        .map((item) => item.ordinalInSlot);
      return isExactRecord(
        ordinals,
        Array.from({ length: ordinals.length }, (_, index) => index),
      );
    });
    const presentationPlanIsComplete =
      parsed.presentationPlan.planHash === expectedPresentationPlanHash &&
      parsed.presentationPlan.planArtifact.contentHash ===
        expectedPresentationPlanHash &&
      parsed.contentApproval.approvedPresentationHash === expectedPresentationPlanHash &&
      idsAreUnique(
        parsed.presentationPlan.items.map((item) => item.presentationItemId),
      ) &&
      idsAreUnique(
        parsed.presentationPlan.items.map(
          (item) => `${item.slotId}:${item.ordinalInSlot}`,
        ),
      ) &&
      slotOrdinalsAreContiguous &&
      planItemHashes.every(
        (hash, index) => hash === parsed.presentationPlan.items[index]?.textHash,
      ) &&
      contentPresentationItems.length === contentItemsBySlot.length &&
      idsAreUnique(
        contentPresentationItems.flatMap((item) =>
          item.source.kind === "content_item" ? [item.source.contentItemId] : [],
        ),
      ) &&
      contentItemsBySlot.every(({ item, slotKind }) =>
        contentPresentationItems.some((presentation) => {
          const slot = parsed.template.slots.find(
            (value) => value.slotId === presentation.slotId,
          );
          return (
            presentation.source.kind === "content_item" &&
            presentation.source.contentItemId === item.id &&
            presentation.text === item.text &&
            slot?.kind === slotKind
          );
        }),
      ) &&
      isExactRecord(
        sortedIds(headerPresentedFactIds),
        sortedIds(parsed.resultResume.headerFactIds),
      ) &&
      parsed.resultResume.experience.every((experience) => {
        const presented = factPresentationItems
          .filter(
            (item) =>
              item.source.kind === "facts" &&
              item.source.presentationKind === "experience_heading" &&
              item.source.experienceId === experience.id,
          )
          .flatMap((item) =>
            item.source.kind === "facts" ? item.source.factIds : [],
          );
        return isExactRecord(
          sortedIds(presented),
          sortedIds([
            experience.organizationFactId,
            experience.roleFactId,
            ...experience.dateFactIds,
          ]),
        );
      }) &&
      factPresentationItems.every((item) => {
        if (item.source.kind !== "facts" || !idsAreUnique(item.source.factIds)) {
          return false;
        }
        const source = item.source;
        const slot = parsed.template.slots.find(
          (value) => value.slotId === item.slotId,
        );
        if (source.presentationKind === "header") {
          return source.experienceId === undefined && slot?.kind === "header";
        }
        return (
          source.experienceId !== undefined &&
          slot?.kind === "experience" &&
          parsed.resultResume.experience.some(
            (experience) => experience.id === source.experienceId,
          )
        );
      });
    if (!presentationPlanIsComplete) {
      addIssue(
        issues,
        "PRESENTATION_PLAN_INVALID",
        "presentationPlan",
        "The approved presentation plan must cover every final content item and fact-backed header or experience field in the correct template slot and order.",
      );
    }
    const resumeItemIds = [
      ...parsed.resultResume.summary.map((item) => item.id),
      ...parsed.resultResume.skills.map((item) => item.id),
      ...parsed.resultResume.projects.map((item) => item.id),
      ...parsed.resultResume.education.map((item) => item.id),
      ...parsed.resultResume.experience.flatMap((experience) => [
        experience.id,
        ...experience.bullets.map((item) => item.id),
      ]),
    ];
    const changeIds = parsed.changeSet.changes.map((change) => change.id);
    const targetIds = parsed.changeSet.changes
      .filter((change) => change.intent !== "keep")
      .map((change) => change.targetItemId);
    if (
      !idsAreUnique(resumeItemIds) ||
      !idsAreUnique(changeIds) ||
      !idsAreUnique(targetIds)
    ) {
      addIssue(
        issues,
        "DUPLICATE_DOCUMENT_ID",
        "changeSet.changes",
        "Resume item, change, and effective target IDs must be unique.",
      );
    }
    const baseResume = context.baseResumeRecord?.version.resume;
    const baseContentItems = baseResume
      ? [
          ...baseResume.summary,
          ...baseResume.skills,
          ...baseResume.experience.flatMap((experience) => experience.bullets),
          ...baseResume.projects,
          ...baseResume.education,
        ]
      : [];
    for (const change of parsed.changeSet.changes) {
      const target = baseContentItems.find((item) => item.id === change.targetItemId);
      if (!target) {
        addIssue(
          issues,
          "CHANGE_TARGET_MISSING",
          `changeSet.changes.${change.id}`,
          "Every change target must exist in the trusted base ResumeIR.",
        );
        continue;
      }
      const targetSourceIndex =
        change.intent === "combine"
          ? change.sourceItemIds.indexOf(change.targetItemId)
          : -1;
      const expectedBefore =
        change.intent === "combine"
          ? change.before[targetSourceIndex]
          : change.before;
      if (change.intent === "combine" && targetSourceIndex < 0) {
        addIssue(
          issues,
          "COMBINE_TARGET_NOT_SOURCE",
          `changeSet.changes.${change.id}.targetItemId`,
          "A combine target must be one of its explicitly ordered source items.",
        );
      }
      if (expectedBefore !== target.text) {
        addIssue(
          issues,
          "CHANGE_BEFORE_STALE",
          `changeSet.changes.${change.id}.before`,
          "Change before-text must exactly match the trusted base ResumeIR item.",
        );
      }
      if (
        change.intent === "combine" &&
        (change.sourceItemIds.some(
          (id, index) =>
            baseContentItems.find((item) => item.id === id)?.text !== change.before[index],
        ) ||
          !idsAreUnique(change.sourceItemIds))
      ) {
        addIssue(
          issues,
          "COMBINE_SOURCE_STALE",
          `changeSet.changes.${change.id}.sourceItemIds`,
          "Every combine source and before-text must exactly match the trusted base ResumeIR.",
        );
      }
      const matchingReviews = parsed.reviews.filter(
        (review) => review.changeId === change.id,
      );
      const trustedReview = matchingReviews[0];
      if (
        change.intent !== "keep" &&
        (matchingReviews.length !== 1 ||
          trustedReview?.changeSetId !== parsed.changeSet.id ||
          trustedReview?.decision !== "approved" ||
          trustedReview?.reviewedChangeHash !==
            (await sha256(canonicalize(change))))
      ) {
        addIssue(
          issues,
          "CHANGE_REVIEW_HASH_MISMATCH",
          `reviews.${change.id}`,
          "Each approval review must bind the canonical bytes of the exact change.",
        );
      }
    }
  } else if (tool === "docx_privacy_scrub") {
    const parsed = DocxPrivacyScrubInputSchema.parse(request);
    verifyResumeBinding(parsed.resume, context, issues, "resume");
    verifyArtifact(parsed.sourceDocument, context, issues, "sourceDocument");
    if (
      !context.snapshots.some(
        (snapshot) =>
          snapshot.snapshotHash === parsed.sourceSnapshotHash &&
          snapshot.sourceArtifact.artifactId === parsed.sourceDocument.artifactId &&
          snapshot.sourceArtifact.contentHash === parsed.sourceDocument.contentHash,
      )
    ) {
      addIssue(
        issues,
        "SCRUB_SOURCE_SNAPSHOT_MISMATCH",
        "sourceSnapshotHash",
        "Privacy scrub must bind a trusted parse of the exact source bytes.",
      );
    }
    if (
      !context.buildManifests.some(
        (manifest) =>
          manifest.manifestHash === parsed.buildManifestHash &&
          manifest.outputDocument.contentHash === parsed.sourceDocument.contentHash,
      )
    ) {
      addIssue(issues, "SCRUB_BUILD_MISMATCH", "buildManifestHash", "Privacy scrub must bind the trusted build output.");
    }
    if (!findTrustedWorker(context, "docx_privacy_scrub", parsed.scrubberProfileHash)) {
      addIssue(
        issues,
        "SCRUBBER_PROFILE_UNTRUSTED",
        "scrubberProfileHash",
        "Privacy scrub must use an active trusted no-network worker profile.",
      );
    }
  } else {
    const parsed = ArtifactExportInputSchema.parse(request);
    const contentApprovalHash = await computeDocumentCanonicalHash(
      parsed.contentApproval,
    );
    verifyResumeBinding(parsed.resume, context, issues, "resume");
    verifyArtifact(parsed.sourceDocument, context, issues, "sourceDocument");
    if (!context.contentApproval || !isExactRecord(parsed.contentApproval, context.contentApproval)) {
      addIssue(issues, "EXPORT_APPROVAL_MISMATCH", "contentApproval", "Export requires the exact trusted aggregate content approval.");
    }
    if (
      parsed.contentApproval.resumeVersionId !== parsed.resume.resumeVersionId ||
      parsed.contentApproval.profileId !== parsed.profileId ||
      parsed.contentApproval.jobId !== context.resumeRecord?.version.jobId ||
      parsed.contentApproval.changeSetId !== context.resumeRecord?.version.changeSetId ||
      parsed.contentApproval.approvedContentHash !== parsed.resume.sourceContentHash
    ) {
      addIssue(
        issues,
        "EXPORT_APPROVAL_SCOPE_MISMATCH",
        "contentApproval",
        "Export approval must bind the exact QA-passed resume version, profile, job, change set, and content hash.",
      );
    }
    const trustedQa = context.qaReports.find((report) => report.reportHash === parsed.qaReport.reportHash);
    const trustedRender = context.renderManifests.find(
      (manifest) => manifest.renderSetHash === parsed.renderSetHash,
    );
    const trustedBuild = context.buildManifests.find(
      (manifest) => manifest.manifestHash === parsed.buildManifestHash,
    );
    const trustedPrivacy = context.privacyReports.find(
      (report) => report.reportHash === parsed.privacyReportHash,
    );
    if (
      !trustedBuild ||
      trustedBuild.resumeVersionId !== parsed.resume.resumeVersionId ||
      trustedBuild.resultContentHash !== parsed.resume.sourceContentHash ||
      trustedBuild.contentApprovalId !== parsed.contentApproval.id ||
      trustedBuild.contentApprovalHash !== contentApprovalHash ||
      trustedBuild.presentationPlanHash !==
        parsed.contentApproval.approvedPresentationHash ||
      !trustedPrivacy ||
      !isExactRecord(trustedPrivacy.outputDocument, parsed.sourceDocument) ||
      !privacyReportIsClean(trustedPrivacy) ||
      !trustedRender ||
      !isExactRecord(trustedRender.sourceDocument, parsed.sourceDocument) ||
      !trustedQa ||
      !isExactRecord(parsed.qaReport, trustedQa) ||
      parsed.qaReport.overallStatus !== "passed" ||
      parsed.qaReport.candidateDocument.contentHash !== parsed.sourceDocument.contentHash ||
      parsed.qaReport.buildManifestHash !== parsed.buildManifestHash ||
      parsed.qaReport.privacyReportHash !== parsed.privacyReportHash ||
      parsed.qaReport.renderSetHash !== parsed.renderSetHash ||
      !qaReportIsInternallyConsistent(parsed.qaReport, trustedRender, context) ||
      parsed.authorization.qaReportHash !== parsed.qaReport.reportHash ||
      parsed.authorization.exportedArtifactHash !== parsed.sourceDocument.contentHash
    ) {
      addIssue(issues, "EXPORT_QA_MISMATCH", "qaReport", "Export requires complete trusted QA for the exact source bytes and authorization.");
    }
  }
  return { success: issues.length === 0, issues };
}

function verifyAuthorizationReceipt(
  request: Record<string, unknown>,
  result: Record<string, unknown>,
  issues: DocumentSemanticIssue[],
): Promise<void> {
  return (async () => {
    const authorization = request.authorization as Record<string, unknown>;
    const receipt = result.authorizationReceipt as Record<string, unknown>;
    const expected = { ...authorization };
    delete expected.executionNonce;
    delete expected.claimToken;
    const safeExpected = {
      ...expected,
      executionNonceHash: await sha256(String(authorization.executionNonce)),
      ...(authorization.claimToken
        ? { claimTokenHash: await sha256(String(authorization.claimToken)) }
        : {}),
    };
    if (!isExactRecord(receipt, safeExpected)) {
      addIssue(issues, "AUTHORIZATION_RECEIPT_MISMATCH", "result.authorizationReceipt", "Receipt must match the exact reservation while excluding bearer secrets.");
    }
  })();
}

export async function validateDocumentWriteResult(
  tool: DocumentWriteToolName,
  input: unknown,
  output: unknown,
  rawContext: unknown,
): Promise<DocumentSemanticValidation> {
  const context = DocumentValidationContextSchema.parse(rawContext);
  const requestValidation = await validateDocumentWriteRequest(tool, input, context);
  const request = documentWriteInputSchemas[tool].parse(input) as unknown as Record<string, unknown>;
  const parsed = documentWriteOutputSchemas[tool].parse(output) as unknown as {
    result: Record<string, unknown>;
  };
  const result = parsed.result;
  const issues = [...requestValidation.issues];
  verifyResultScope(tool, request, result, context, issues);
  if (result.actionFingerprint !== (request.authorization as Record<string, unknown>).actionFingerprint) {
    addIssue(issues, "RESULT_FINGERPRINT_MISMATCH", "result.actionFingerprint", "Result must bind the canonical action fingerprint.");
  }
  await verifyAuthorizationReceipt(request, result, issues);
  const evidenceArtifactIds = Array.isArray(result.evidenceArtifactIds)
    ? result.evidenceArtifactIds.map(String)
    : [];
  if (
    !idsAreUnique(evidenceArtifactIds) ||
    evidenceArtifactIds.some(
      (artifactId) =>
        !context.artifactRecords.some(
          (record) =>
            record.artifactId === artifactId &&
            record.ownerProfileId === context.authenticatedProfileId &&
            record.actualByteHash === record.contentHash &&
            record.creatingOperationId === request.operationId,
        ),
    )
  ) {
    addIssue(
      issues,
      "RESULT_EVIDENCE_UNTRUSTED",
      "result.evidenceArtifactIds",
      "All result evidence must be unique and reloaded from trusted artifact storage.",
    );
  }
  if (result.outcome !== "verified_created") {
    if (result.outcome === "verified_not_created") {
      const proof = result.nonCreationProof as z.infer<
        typeof DocumentTrustedNonCreationEvidenceRecordSchema
      >;
      const authorization = request.authorization as Record<string, unknown>;
      if (
        !context.nonCreationEvidenceRecords.some((record) =>
          isExactRecord(record, proof),
        ) ||
        proof.operationId !== request.operationId ||
        proof.actionFingerprint !== authorization.actionFingerprint ||
        proof.executionReservationId !== authorization.executionReservationId ||
        !isExactRecord(proof.evidenceArtifactIds, evidenceArtifactIds) ||
        (proof.proofKind === "rollback_confirmed") !==
          Boolean(result.actionAttempted) ||
        Date.parse(proof.verifiedAt) > Date.parse(context.now)
      ) {
        addIssue(
          issues,
          "NON_CREATION_PROOF_MISMATCH",
          "result.nonCreationProof",
          "Verified non-creation requires exact trusted proof bound to this reservation and evidence.",
        );
      }
    }
    return { success: issues.length === 0, issues };
  }

  if (tool === "docx_apply_changeset") {
    const parsedRequest = DocxApplyChangesetInputSchema.parse(request);
    const outputDocument = result.outputDocument as DocumentArtifactRef;
    const outputSnapshot = result.outputSnapshot as z.infer<typeof DocumentSnapshotSchema>;
    const manifest = result.buildManifest as z.infer<typeof DocumentBuildManifestSchema>;
    const outputRecord = context.artifactRecords.find(
      (record) => record.artifactId === outputDocument.artifactId,
    );
    const outputSnapshotRecord = context.artifactRecords.find(
      (record) => record.artifactId === outputSnapshot.snapshotArtifact.artifactId,
    );
    const manifestRecord = context.artifactRecords.find(
      (record) => record.artifactId === manifest.manifestArtifact.artifactId,
    );
    const contentApprovalHash = await sha256(canonicalize(parsedRequest.contentApproval));
    verifyArtifact(outputDocument, context, issues, "result.outputDocument");
    verifyArtifact(outputSnapshot.snapshotArtifact, context, issues, "result.outputSnapshot.snapshotArtifact");
    verifyArtifact(manifest.manifestArtifact, context, issues, "result.buildManifest.manifestArtifact");
    verifyArtifact(
      parsedRequest.presentationPlan.planArtifact,
      context,
      issues,
      "presentationPlan.planArtifact",
    );
    const changedIds = parsedRequest.changeSet.changes.filter((change) => change.intent !== "keep").map((change) => change.id);
    const claimChangeIds = parsedRequest.changeSet.changes
      .filter(
        (change) =>
          change.intent === "rewrite" || change.intent === "combine",
      )
      .map((change) => change.id);
    const resultContentItems = [
      ...parsedRequest.resultResume.summary,
      ...parsedRequest.resultResume.skills,
      ...parsedRequest.resultResume.experience.flatMap((experience) => experience.bullets),
      ...parsedRequest.resultResume.projects,
      ...parsedRequest.resultResume.education,
    ];
    const sourceSnapshot = context.snapshots.find(
      (snapshot) => snapshot.snapshotHash === parsedRequest.sourceSnapshotHash,
    );
    const templateSnapshot = context.snapshots.find(
      (snapshot) => snapshot.snapshotHash === parsedRequest.template.sourceSnapshotHash,
    );
    const builderRecord = findTrustedWorker(
      context,
      "docx_apply_changeset",
      parsedRequest.builderProfileHash,
    );
    const baseBindings = context.baseResumeRecord?.contentBindings ?? [];
    const baseBindingFor = (contentItemId: string) =>
      baseBindings.find((binding) => binding.contentItemId === contentItemId);
    let operationsMatchChanges = true;
    for (const change of parsedRequest.changeSet.changes) {
      const operations = manifest.operations.filter(
        (operation) => operation.changeId === change.id,
      );
      if (change.intent === "keep") {
        if (operations.length !== 0) operationsMatchChanges = false;
        continue;
      }
      if (change.intent === "remove") {
        const baseBinding = baseBindingFor(change.targetItemId);
        if (
          operations.length !== 1 ||
          operations[0]?.kind !== "remove_block" ||
          operations[0]?.contentItemId !== change.targetItemId ||
          operations[0]?.targetBlockId !== baseBinding?.outputBlockId ||
          operations[0]?.expectedTextHash !== baseBinding?.outputTextHash
        ) {
          operationsMatchChanges = false;
        }
        continue;
      }
      const afterHash = await sha256(change.after.normalize("NFC"));
      const replacement = operations.find(
        (operation) => operation.kind === "replace_block",
      );
      const targetBinding = baseBindingFor(change.targetItemId);
      if (
        replacement?.contentItemId !== change.targetItemId ||
        replacement?.targetBlockId !== targetBinding?.outputBlockId ||
        replacement?.expectedTextHash !== targetBinding?.outputTextHash ||
        replacement?.replacementTextHash !== afterHash ||
        !resultContentItems.some(
          (item) => item.id === change.targetItemId && item.text === change.after,
        )
      ) {
        operationsMatchChanges = false;
      }
      if (change.intent === "rewrite" && operations.length !== 1) {
        operationsMatchChanges = false;
      }
      if (change.intent === "combine") {
        const removalIds = change.sourceItemIds.filter(
          (id) => id !== change.targetItemId,
        );
        const removals = operations.filter(
          (operation) => operation.kind === "remove_block",
        );
        if (
          operations.length !== 1 + removalIds.length ||
          removals.length !== removalIds.length ||
          removalIds.some(
            (id) =>
              !removals.some(
                (operation) => {
                  const sourceBinding = baseBindingFor(id);
                  return (
                  operation.contentItemId === id &&
                    operation.targetBlockId === sourceBinding?.outputBlockId &&
                    operation.expectedTextHash === sourceBinding?.outputTextHash &&
                    change.before[change.sourceItemIds.indexOf(id)] !== undefined
                  );
                },
              ),
          )
        ) {
          operationsMatchChanges = false;
        }
      }
    }
    const expectedPresentationPlanHash = await computeDocumentCanonicalHash(
      parsedRequest.presentationPlan.items,
    );
    const globalPresentationBlockOrdinals = parsedRequest.presentationPlan.items.map(
      (item) => {
        const binding = manifest.presentationBindings.find(
          (value) => value.presentationItemId === item.presentationItemId,
        );
        return outputSnapshot.blocks.find(
          (block) => block.id === binding?.outputBlockId,
        )?.ordinal;
      },
    );
    const presentationBindingsAreComplete =
      manifest.presentationPlanHash === expectedPresentationPlanHash &&
      manifest.presentationPlanHash === parsedRequest.presentationPlan.planHash &&
      isExactRecord(
        manifest.presentationPlanArtifact,
        parsedRequest.presentationPlan.planArtifact,
      ) &&
      manifest.presentationBindings.length ===
        parsedRequest.presentationPlan.items.length &&
      idsAreUnique(
        manifest.presentationBindings.map((binding) => binding.presentationItemId),
      ) &&
      idsAreUnique(
        manifest.presentationBindings.map((binding) => binding.outputBlockId),
      ) &&
      parsedRequest.presentationPlan.items.every((item) => {
        const binding = manifest.presentationBindings.find(
          (value) => value.presentationItemId === item.presentationItemId,
        );
        const outputBlock = outputSnapshot.blocks.find(
          (block) => block.id === binding?.outputBlockId,
        );
        const slot = parsedRequest.template.slots.find(
          (value) => value.slotId === item.slotId,
        );
        return Boolean(
          binding &&
            outputBlock &&
            slot?.targetBlockIds.includes(binding.outputBlockId) &&
            outputBlock.styleId === slot.styleId &&
            outputBlock.text === item.text &&
            outputBlock.textHash === item.textHash &&
            outputBlock.textHash === binding.outputTextHash,
        );
      }) &&
      globalPresentationBlockOrdinals.every(
        (ordinal, index) =>
          ordinal !== undefined &&
          (index === 0 ||
            ordinal > (globalPresentationBlockOrdinals[index - 1] ?? ordinal)),
      ) &&
      parsedRequest.template.slots.every((slot) => {
        const orderedItems = parsedRequest.presentationPlan.items
          .filter((item) => item.slotId === slot.slotId)
          .sort((left, right) => left.ordinalInSlot - right.ordinalInSlot);
        const blockOrdinals = orderedItems.map((item) => {
          const binding = manifest.presentationBindings.find(
            (value) => value.presentationItemId === item.presentationItemId,
          );
          return outputSnapshot.blocks.find(
            (block) => block.id === binding?.outputBlockId,
          )?.ordinal;
        });
        return blockOrdinals.every(
          (ordinal, index) =>
            ordinal !== undefined &&
            (index === 0 || ordinal > (blockOrdinals[index - 1] ?? ordinal)),
        );
      });
    const staticTemplateBlocks = (templateSnapshot?.blocks ?? []).filter(
      (block) => parsedRequest.template.staticBlockIds.includes(block.id),
    );
    const outputContainsOnlyAccountedBlocks = outputSnapshot.blocks.every(
      (block) =>
        manifest.presentationBindings.some(
          (binding) =>
            binding.outputBlockId === block.id &&
            binding.outputTextHash === block.textHash,
        ) ||
        staticTemplateBlocks.some(
          (templateBlock) =>
            templateBlock.id === block.id &&
            templateBlock.textHash === block.textHash &&
            templateBlock.text === block.text,
        ),
    );
    const allStaticTemplateBlocksArePreserved = staticTemplateBlocks.every(
      (templateBlock) =>
        outputSnapshot.blocks.some(
          (block) =>
            block.id === templateBlock.id &&
            block.textHash === templateBlock.textHash &&
            block.text === templateBlock.text,
        ),
    );
    const accountedOutputBlockIds = new Set([
      ...manifest.presentationBindings.map((binding) => binding.outputBlockId),
      ...staticTemplateBlocks.map((block) => block.id),
    ]);
    const templateOrderIsPreserved = isExactRecord(
      (templateSnapshot?.blocks ?? [])
        .filter((block) => accountedOutputBlockIds.has(block.id))
        .sort((left, right) => left.ordinal - right.ordinal)
        .map((block) => block.id),
      outputSnapshot.blocks
        .filter((block) => accountedOutputBlockIds.has(block.id))
        .sort((left, right) => left.ordinal - right.ordinal)
        .map((block) => block.id),
    );
    const removedContentItemIds = parsedRequest.changeSet.changes.flatMap(
      (change) =>
        change.intent === "remove"
          ? [change.targetItemId]
          : change.intent === "combine"
            ? change.sourceItemIds.filter((id) => id !== change.targetItemId)
            : [],
    );
    const removedSourceBlocksAreAbsent = removedContentItemIds.every((itemId) => {
      const binding = baseBindingFor(itemId);
      return (
        binding !== undefined &&
        !outputSnapshot.blocks.some((block) => block.id === binding.outputBlockId)
      );
    });
    if (
      outputDocument.artifactId === parsedRequest.sourceDocument.artifactId ||
      outputDocument.contentHash === parsedRequest.sourceDocument.contentHash ||
      outputRecord?.creatingOperationId !== parsedRequest.operationId ||
      outputRecord?.resumeVersionId !== parsedRequest.resume.resumeVersionId ||
      outputSnapshotRecord?.creatingOperationId !== parsedRequest.operationId ||
      outputSnapshotRecord?.resumeVersionId !== parsedRequest.resume.resumeVersionId ||
      manifestRecord?.creatingOperationId !== parsedRequest.operationId ||
      manifestRecord?.resumeVersionId !== parsedRequest.resume.resumeVersionId ||
      !isExactRecord(outputSnapshot.sourceArtifact, outputDocument) ||
      !(await snapshotContentIsConsistent(outputSnapshot)) ||
      !operationsMatchChanges ||
      !presentationBindingsAreComplete ||
      !outputContainsOnlyAccountedBlocks ||
      !allStaticTemplateBlocksArePreserved ||
      !templateOrderIsPreserved ||
      !removedSourceBlocksAreAbsent ||
      !context.snapshots.some((value) => isExactRecord(value, outputSnapshot)) ||
      !context.buildManifests.some((value) => isExactRecord(value, manifest)) ||
      !isExactRecord(manifest.outputDocument, outputDocument) ||
      !isExactRecord(manifest.sourceDocument, parsedRequest.sourceDocument) ||
      manifest.operationId !== parsedRequest.operationId ||
      manifest.resumeVersionId !== parsedRequest.resume.resumeVersionId ||
      manifest.profileId !== parsedRequest.profileId ||
      manifest.jobId !== parsedRequest.changeSet.jobId ||
      manifest.sourceContentHash !== parsedRequest.changeSet.baseContentHash ||
      manifest.changeSetId !== parsedRequest.changeSet.id ||
      manifest.changeSetHash !== parsedRequest.changeSet.contentHash ||
      manifest.resultContentHash !== parsedRequest.changeSet.resultContentHash ||
      manifest.contentApprovalId !== parsedRequest.contentApproval.id ||
      manifest.contentApprovalHash !== contentApprovalHash ||
      manifest.factSnapshotHash !== parsedRequest.factSnapshot.snapshotHash ||
      manifest.requirementSnapshotHash !== parsedRequest.requirementSnapshot?.snapshotHash ||
      manifest.templateHash !== parsedRequest.template.templateArtifact.contentHash ||
      manifest.templateId !== parsedRequest.template.templateId ||
      manifest.templateVersion !== parsedRequest.template.templateVersion ||
      manifest.templateProfileHash !== parsedRequest.template.profileHash ||
      manifest.sourceSnapshotHash !== parsedRequest.sourceSnapshotHash ||
      manifest.outputSnapshotHash !== outputSnapshot.snapshotHash ||
      manifest.presentation !== parsedRequest.presentation ||
      manifest.builderName !== builderRecord?.workerName ||
      manifest.builderVersion !== builderRecord?.workerVersion ||
      manifest.runtimeHash !== builderRecord?.runtimeHash ||
      manifest.configurationHash !== builderRecord?.configurationHash ||
      !changedIds.every((id) => manifest.operations.some((operation) => operation.changeId === id)) ||
      !idsAreUnique(manifest.operations.map((operation) => operation.id)) ||
      manifest.operations.some((operation) => !changedIds.includes(operation.changeId)) ||
      !idsAreUnique(manifest.operations.map((operation) => operation.targetBlockId)) ||
      manifest.operations.some(
        (operation) =>
          !parsedRequest.template.slots.some((slot) =>
            slot.targetBlockIds.includes(operation.targetBlockId),
          ),
      ) ||
      manifest.operations.some((operation) => {
        const sourceBlock = sourceSnapshot?.blocks.find(
          (block) =>
            block.id === operation.targetBlockId &&
            block.textHash === operation.expectedTextHash,
        );
        const outputTarget = outputSnapshot.blocks.find(
          (block) => block.id === operation.targetBlockId,
        );
        if (!sourceBlock) return true;
        if (operation.kind === "remove_block") return outputTarget !== undefined;
        if (operation.kind === "replace_block") {
          return outputTarget?.textHash !== operation.replacementTextHash;
        }
        return !outputSnapshot.blocks.some(
          (block) =>
            block.id === operation.insertedBlockId &&
            block.textHash === operation.insertedTextHash,
        );
      }) ||
      !claimChangeIds.every((id) =>
        manifest.claimProvenance.some((claim) => claim.resumeChangeId === id),
      ) ||
      manifest.claimProvenance.some((claim) => {
        const change = parsedRequest.changeSet.changes.find(
          (value) => value.id === claim.resumeChangeId,
        );
        const reviewIds = parsedRequest.reviews
          .filter((review) => review.changeId === claim.resumeChangeId)
          .map((review) => review.id);
        const contentItem = resultContentItems.find(
          (item) => item.id === claim.contentItemId,
        );
        const outputBlock = outputSnapshot.blocks.find(
          (block) => block.id === claim.outputBlockId,
        );
        const boundFactIds = claim.factBindings.map((fact) => fact.factId);
        const presentationItem = parsedRequest.presentationPlan.items.find(
          (item) =>
            item.source.kind === "content_item" &&
            item.source.contentItemId === claim.contentItemId,
        );
        const presentationBinding = manifest.presentationBindings.find(
          (binding) =>
            binding.presentationItemId === presentationItem?.presentationItemId,
        );
        const replacement = manifest.operations.find(
          (operation) =>
            operation.changeId === claim.resumeChangeId &&
            operation.kind === "replace_block",
        );
        return (
          !change ||
          !contentItem ||
          !outputBlock ||
          claim.contentItemId !== change.targetItemId ||
          claim.outputBlockId !== presentationBinding?.outputBlockId ||
          claim.outputBlockId !== replacement?.targetBlockId ||
          outputBlock.text !== contentItem.text ||
          outputBlock.textHash !== claim.outputTextHash ||
          !change.factIds.every((factId) => boundFactIds.includes(factId)) ||
          !boundFactIds.every((factId) => change.factIds.includes(factId)) ||
          !isExactRecord(contentItem.factIds, boundFactIds) ||
          !isExactRecord(contentItem.requirementIds, claim.requirementIds) ||
          !isExactRecord(change.requirementIds, claim.requirementIds) ||
          !claimChangeIds.includes(claim.resumeChangeId) ||
          claim.factBindings.some(
            (fact) =>
              !change.factIds.includes(fact.factId) ||
              !context.facts.some(
                (trusted) =>
                  trusted.factId === fact.factId &&
                  trusted.version === fact.factVersion &&
                  trusted.factHash === fact.factHash &&
                  isExactRecord(trusted.sourceArtifactIds, fact.sourceArtifactIds),
              ),
          ) ||
          !isExactRecord(
            [...claim.reviewDecisionIds].sort(),
            [...reviewIds].sort(),
          )
        );
      })
    ) {
      addIssue(issues, "APPLY_RESULT_LINEAGE_MISMATCH", "result.buildManifest", "Apply output must be a new trusted artifact with complete approved lineage.");
    }
  } else if (tool === "docx_privacy_scrub") {
    const parsedRequest = DocxPrivacyScrubInputSchema.parse(request);
    const outputDocument = result.outputDocument as DocumentArtifactRef;
    const report = result.report as z.infer<typeof DocumentPrivacyReportSchema>;
    const sourceSnapshot = context.snapshots.find(
      (snapshot) => snapshot.snapshotHash === parsedRequest.sourceSnapshotHash,
    );
    const outputSnapshot = context.snapshots.find(
      (snapshot) => snapshot.snapshotHash === report.outputSnapshotHash,
    );
    const scrubberRecord = findTrustedWorker(
      context,
      "docx_privacy_scrub",
      parsedRequest.scrubberProfileHash,
    );
    const outputRecord = context.artifactRecords.find(
      (record) => record.artifactId === outputDocument.artifactId,
    );
    const reportRecord = context.artifactRecords.find(
      (record) => record.artifactId === report.reportArtifact.artifactId,
    );
    const outputSnapshotRecord = outputSnapshot
      ? context.artifactRecords.find(
          (record) => record.artifactId === outputSnapshot.snapshotArtifact.artifactId,
        )
      : undefined;
    verifyArtifact(outputDocument, context, issues, "result.outputDocument");
    verifyArtifact(report.reportArtifact, context, issues, "result.report.reportArtifact");
    if (outputSnapshot) {
      verifyArtifact(
        outputSnapshot.snapshotArtifact,
        context,
        issues,
        "result.report.outputSnapshotArtifact",
      );
    }
    if (
      !context.privacyReports.some((value) => isExactRecord(value, report)) ||
      !isExactRecord(report.sourceDocument, parsedRequest.sourceDocument) ||
      !isExactRecord(report.outputDocument, outputDocument) ||
      outputRecord?.creatingOperationId !== parsedRequest.operationId ||
      outputRecord?.resumeVersionId !== parsedRequest.resume.resumeVersionId ||
      reportRecord?.creatingOperationId !== parsedRequest.operationId ||
      reportRecord?.resumeVersionId !== parsedRequest.resume.resumeVersionId ||
      outputSnapshotRecord?.creatingOperationId !== parsedRequest.operationId ||
      outputSnapshotRecord?.resumeVersionId !== parsedRequest.resume.resumeVersionId ||
      report.sourceSnapshotHash !== parsedRequest.sourceSnapshotHash ||
      !sourceSnapshot ||
      !outputSnapshot ||
      (sourceSnapshot !== undefined && !(await snapshotContentIsConsistent(sourceSnapshot))) ||
      !isExactRecord(outputSnapshot.sourceArtifact, outputDocument) ||
      !(await snapshotContentIsConsistent(outputSnapshot)) ||
      report.semanticTextHashBefore !== sourceSnapshot.semanticTextHash ||
      report.semanticTextHashAfter !== outputSnapshot.semanticTextHash ||
      !isExactRecord(report.securityInspection, outputSnapshot.securityInspection) ||
      outputSnapshot.hasComments ||
      outputSnapshot.hasTrackedChanges ||
      outputSnapshot.hasHiddenText ||
      outputSnapshot.hasCustomProperties ||
      report.policyVersion !== parsedRequest.policyVersion ||
      report.policyHash !== parsedRequest.policyHash ||
      report.scrubberName !== scrubberRecord?.workerName ||
      report.scrubberVersion !== scrubberRecord?.workerVersion ||
      report.runtimeHash !== scrubberRecord?.runtimeHash ||
      report.configurationHash !== scrubberRecord?.configurationHash ||
      !privacyReportIsClean(report)
    ) {
      addIssue(issues, "SCRUB_RESULT_INVALID", "result.report", "Scrub must create a trusted derivative with unchanged visible text and zero forbidden residue.");
    }
  } else {
    const parsedRequest = ArtifactExportInputSchema.parse(request);
    const exported = result.exportedDocument as DocumentArtifactRef;
    const manifest = result.manifest as z.infer<typeof DocumentExportManifestSchema>;
    const exportedRecord = context.artifactRecords.find(
      (record) => record.artifactId === exported.artifactId,
    );
    const manifestRecord = context.artifactRecords.find(
      (record) => record.artifactId === manifest.manifestArtifact.artifactId,
    );
    const contentApprovalHash = await sha256(canonicalize(parsedRequest.contentApproval));
    verifyArtifact(exported, context, issues, "result.exportedDocument");
    verifyArtifact(manifest.manifestArtifact, context, issues, "result.manifest.manifestArtifact");
    if (
      exported.artifactId === parsedRequest.sourceDocument.artifactId ||
      exported.contentHash !== parsedRequest.sourceDocument.contentHash ||
      exported.byteSize !== parsedRequest.sourceDocument.byteSize ||
      exported.fileName !== parsedRequest.exportFileName ||
      exportedRecord?.creatingOperationId !== parsedRequest.operationId ||
      exportedRecord?.resumeVersionId !== parsedRequest.resume.resumeVersionId ||
      manifestRecord?.creatingOperationId !== parsedRequest.operationId ||
      manifestRecord?.resumeVersionId !== parsedRequest.resume.resumeVersionId ||
      !context.exportManifests.some((value) => isExactRecord(value, manifest)) ||
      !isExactRecord(manifest.sourceDocument, parsedRequest.sourceDocument) ||
      !isExactRecord(manifest.exportedDocument, exported) ||
      manifest.operationId !== parsedRequest.operationId ||
      manifest.resumeVersionId !== parsedRequest.resume.resumeVersionId ||
      manifest.profileId !== parsedRequest.profileId ||
      manifest.qaReportHash !== parsedRequest.qaReport.reportHash ||
      manifest.contentApprovalId !== parsedRequest.contentApproval.id ||
      manifest.contentApprovalHash !== contentApprovalHash ||
      manifest.buildManifestHash !== parsedRequest.buildManifestHash ||
      manifest.privacyReportHash !== parsedRequest.privacyReportHash ||
      manifest.renderSetHash !== parsedRequest.renderSetHash ||
      manifest.format !== parsedRequest.format ||
      manifest.destination !== parsedRequest.destination ||
      manifest.exactBytePromotion !== true
    ) {
      addIssue(issues, "EXPORT_RESULT_SUBSTITUTION", "result.manifest", "Export may only promote the exact QA-approved bytes under a new immutable artifact ID.");
    }
  }
  return { success: issues.length === 0, issues };
}

export const DocumentMcpToolMapSchema = z.record(
  DocumentMcpToolNameSchema,
  z.object({ input: z.string(), output: z.string() }).strict(),
);
