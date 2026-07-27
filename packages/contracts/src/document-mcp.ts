import { z } from "zod";

import { ActionRiskSchema } from "./application.js";
import { ArtifactKindSchema } from "./audit.js";
import {
  CONTRACT_VERSION,
  DataSensitivitySchema,
  EntityIdSchema,
  IsoDateTimeSchema,
  Sha256Schema,
} from "./common.js";
import {
  ResumeChangeReviewSchema,
  ResumeChangeSetSchema,
  ResumeContentApprovalSchema,
  ResumeIRSchema,
  ResumeVersionStatusSchema,
} from "./resume.js";

export const DocumentMcpToolNameSchema = z.enum([
  "docx_parse",
  "template_inspect",
  "docx_apply_changeset",
  "docx_text_diff",
  "docx_render_pages",
  "docx_visual_diff",
  "docx_structure_audit",
  "docx_privacy_scrub",
  "artifact_export",
]);

export const DocxMediaTypeSchema = z.literal(
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
);
export const PngMediaTypeSchema = z.literal("image/png");
export const JsonMediaTypeSchema = z.literal("application/json");

const SafeFileNameSchema = z
  .string()
  .min(1)
  .max(500)
  .regex(/^(?!\.{1,2}$)[^/\\\u0000]+$/);

export const DocumentArtifactRefSchema = z
  .object({
    artifactId: EntityIdSchema,
    kind: ArtifactKindSchema,
    fileName: SafeFileNameSchema,
    mediaType: z.string().min(1).max(200),
    contentHash: Sha256Schema,
    byteSize: z.number().int().nonnegative().max(250 * 1024 * 1024),
  })
  .strict();

export const DocumentDocxArtifactRefSchema = DocumentArtifactRefSchema.extend({
  kind: z.enum(["source_resume", "tailored_resume", "privacy_scrubbed_document", "other"]),
  mediaType: DocxMediaTypeSchema,
  fileName: SafeFileNameSchema.regex(/\.docx$/i),
  byteSize: z.number().int().positive().max(25 * 1024 * 1024),
}).strict();

export const DocumentJsonArtifactRefSchema = DocumentArtifactRefSchema.extend({
  kind: z.enum(["document_ir", "document_inspection", "document_manifest", "document_qa_report", "document_diff", "privacy_report", "manifest", "other"]),
  mediaType: JsonMediaTypeSchema,
  fileName: SafeFileNameSchema.regex(/\.json$/i),
  byteSize: z.number().int().positive().max(50 * 1024 * 1024),
}).strict();

export const DocumentPngArtifactRefSchema = DocumentArtifactRefSchema.extend({
  kind: z.enum(["document_render", "document_render_page", "other"]),
  mediaType: PngMediaTypeSchema,
  fileName: SafeFileNameSchema.regex(/\.png$/i),
  byteSize: z.number().int().positive().max(50 * 1024 * 1024),
}).strict();

export const DocumentOperationScopeSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    requestId: EntityIdSchema,
    operationId: EntityIdSchema,
    profileId: EntityIdSchema,
    resumeVersionId: EntityIdSchema.optional(),
    expectedResumeRevision: z.number().int().nonnegative().optional(),
    deadlineAt: IsoDateTimeSchema,
  })
  .strict();

export const DocumentResumeBindingSchema = z
  .object({
    resumeVersionId: EntityIdSchema,
    profileId: EntityIdSchema,
    expectedResumeRevision: z.number().int().nonnegative(),
    expectedResumeStatus: ResumeVersionStatusSchema,
    sourceContentHash: Sha256Schema,
  })
  .strict();

export const DocumentFactSnapshotSchema = z
  .object({
    profileId: EntityIdSchema,
    facts: z
      .array(
        z.object({ factId: EntityIdSchema, version: z.number().int().positive() }).strict(),
      )
      .min(1)
      .max(5_000),
    snapshotHash: Sha256Schema,
  })
  .strict();

export const DocumentRequirementSnapshotSchema = z
  .object({
    jobId: EntityIdSchema,
    descriptionHash: Sha256Schema,
    requirementIds: z.array(EntityIdSchema).max(2_000),
    snapshotHash: Sha256Schema,
  })
  .strict();

export const DocumentPackageLimitsSchema = z
  .object({
    maxCompressedBytes: z.number().int().positive().max(25 * 1024 * 1024),
    maxExpandedBytes: z.number().int().positive().max(200 * 1024 * 1024),
    maxEntryBytes: z.number().int().positive().max(50 * 1024 * 1024),
    maxEntries: z.number().int().positive().max(5_000),
    maxCompressionRatio: z.number().positive().max(100),
    maxNestedArchiveDepth: z.literal(0),
    timeoutMs: z.number().int().positive().max(120_000),
  })
  .strict();

export const DocumentSecurityFindingSchema = z
  .object({
    id: EntityIdSchema,
    code: z.enum([
      "path_traversal",
      "duplicate_entry",
      "unicode_path_collision",
      "archive_limit_exceeded",
      "invalid_crc_or_size",
      "symlink_or_device_entry",
      "macro",
      "activex",
      "ole_or_embedded_package",
      "alt_chunk",
      "external_relationship",
      "unsafe_field_code",
      "invalid_ooxml_content_type",
    ]),
    severity: z.enum(["high", "critical"]),
    partNameHash: Sha256Schema.optional(),
    redactedSummary: z.string().min(1).max(2_000),
  })
  .strict();

export const DocumentPackageMetricsSchema = z
  .object({
    compressedBytes: z.number().int().nonnegative(),
    expandedBytes: z.number().int().nonnegative(),
    largestEntryBytes: z.number().int().nonnegative(),
    entryCount: z.number().int().nonnegative(),
    maximumCompressionRatio: z.number().nonnegative(),
  })
  .strict();

export const CleanDocumentSecurityInspectionSchema = z
  .object({
    status: z.literal("clean"),
    detectedFormat: z.literal("docx_ooxml"),
    packageMetrics: DocumentPackageMetricsSchema,
    normalizedEntryNamesUnique: z.literal(true),
    crcAndSizesVerified: z.literal(true),
    hasMacros: z.literal(false),
    hasEncryptedPackage: z.literal(false),
    hasActiveX: z.literal(false),
    hasOleOrEmbeddedPackages: z.literal(false),
    hasAltChunk: z.literal(false),
    externalRelationshipCount: z.literal(0),
    unsafeFieldCodeCount: z.literal(0),
    unsafePackagePathCount: z.literal(0),
    networkAccessAttempted: z.literal(false),
    findings: z.array(DocumentSecurityFindingSchema).max(0),
    inspectedAt: IsoDateTimeSchema,
    inspectionHash: Sha256Schema,
  })
  .strict();

export const DocumentStorySchema = z.enum([
  "body",
  "header",
  "footer",
  "footnote",
  "endnote",
  "text_box",
]);

export const DocumentBlockSchema = z
  .object({
    id: EntityIdSchema,
    ordinal: z.number().int().nonnegative(),
    story: DocumentStorySchema,
    kind: z.enum(["paragraph", "list_item", "table", "image", "section_break", "unknown"]),
    text: z.string().max(20_000),
    textHash: Sha256Schema,
    styleId: z.string().min(1).max(240).optional(),
    listLevel: z.number().int().min(0).max(8).optional(),
    rowCount: z.number().int().nonnegative().optional(),
    columnCount: z.number().int().nonnegative().optional(),
    sensitivity: DataSensitivitySchema,
  })
  .strict();

export const DocumentSnapshotSchema = z
  .object({
    snapshotId: EntityIdSchema,
    sourceArtifact: DocumentDocxArtifactRefSchema,
    parserName: z.string().min(1).max(160),
    parserVersion: z.string().min(1).max(160),
    parserProfileHash: Sha256Schema,
    packageLimits: DocumentPackageLimitsSchema,
    semanticTextHash: Sha256Schema,
    packagePartSetHash: Sha256Schema,
    documentModelHash: Sha256Schema,
    blocks: z.array(DocumentBlockSchema).max(20_000),
    sectionCount: z.number().int().positive().max(100),
    hasComments: z.boolean(),
    hasTrackedChanges: z.boolean(),
    hasHiddenText: z.boolean(),
    hasCustomProperties: z.boolean(),
    securityInspection: CleanDocumentSecurityInspectionSchema,
    snapshotArtifact: DocumentJsonArtifactRefSchema.extend({
      kind: z.literal("document_ir"),
    }).strict(),
    createdAt: IsoDateTimeSchema,
    snapshotHash: Sha256Schema,
  })
  .strict();

export const DocumentTemplateSlotSchema = z
  .object({
    slotId: EntityIdSchema,
    kind: z.enum(["header", "summary", "skills", "experience", "projects", "education"]),
    targetBlockIds: z.array(EntityIdSchema).min(1).max(500),
    styleId: z.string().min(1).max(240),
    maxCharacters: z.number().int().positive().max(20_000).optional(),
    maxItems: z.number().int().positive().max(500).optional(),
  })
  .strict();

export const DocumentTemplateProfileSchema = z
  .object({
    templateId: EntityIdSchema,
    templateVersion: z.string().min(1).max(160),
    templateArtifact: DocumentDocxArtifactRefSchema,
    sourceSnapshotHash: Sha256Schema,
    inspectorName: z.string().min(1).max(160),
    inspectorVersion: z.string().min(1).max(160),
    slots: z.array(DocumentTemplateSlotSchema).min(1).max(2_000),
    staticBlockIds: z.array(EntityIdSchema).max(20_000),
    immutablePartHashes: z.record(z.string().min(1).max(500), Sha256Schema),
    pageWidthDxa: z.number().int().positive(),
    pageHeightDxa: z.number().int().positive(),
    marginTopDxa: z.number().int().nonnegative(),
    marginRightDxa: z.number().int().nonnegative(),
    marginBottomDxa: z.number().int().nonnegative(),
    marginLeftDxa: z.number().int().nonnegative(),
    requiredFontNames: z.array(z.string().min(1).max(240)).max(100),
    inspectionProfileHash: Sha256Schema,
    packageLimits: DocumentPackageLimitsSchema,
    profileArtifact: DocumentJsonArtifactRefSchema.extend({
      kind: z.literal("document_inspection"),
    }).strict(),
    inspectedAt: IsoDateTimeSchema,
    profileHash: Sha256Schema,
  })
  .strict();

export const DocumentVerifiedFactBindingSchema = z
  .object({
    factId: EntityIdSchema,
    factVersion: z.number().int().positive(),
    factHash: Sha256Schema,
    status: z.literal("verified"),
    sourceArtifactIds: z.array(EntityIdSchema).min(1).max(100),
  })
  .strict();

export const DocumentPresentationSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("content_item"),
      contentItemId: EntityIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("facts"),
      presentationKind: z.enum(["header", "experience_heading"]),
      experienceId: EntityIdSchema.optional(),
      factIds: z.array(EntityIdSchema).min(1).max(100),
    })
    .strict(),
]);

export const DocumentPresentationItemSchema = z
  .object({
    presentationItemId: EntityIdSchema,
    slotId: EntityIdSchema,
    ordinalInSlot: z.number().int().nonnegative().max(10_000),
    source: DocumentPresentationSourceSchema,
    text: z.string().min(1).max(20_000),
    textHash: Sha256Schema,
  })
  .strict();

export const DocumentPresentationPlanSchema = z
  .object({
    items: z.array(DocumentPresentationItemSchema).min(1).max(20_000),
    planArtifact: DocumentJsonArtifactRefSchema.extend({
      kind: z.literal("document_ir"),
    }).strict(),
    planHash: Sha256Schema,
  })
  .strict();

export const DocumentPresentationBindingSchema = z
  .object({
    presentationItemId: EntityIdSchema,
    outputBlockId: EntityIdSchema,
    outputTextHash: Sha256Schema,
  })
  .strict();

export const DocumentClaimProvenanceSchema = z
  .object({
    contentItemId: EntityIdSchema,
    outputBlockId: EntityIdSchema,
    outputTextHash: Sha256Schema,
    resumeChangeId: EntityIdSchema,
    factBindings: z.array(DocumentVerifiedFactBindingSchema).min(1).max(100),
    requirementIds: z.array(EntityIdSchema).max(100),
    reviewDecisionIds: z.array(EntityIdSchema).min(1).max(100),
  })
  .strict();

export const DocumentChangeOperationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: EntityIdSchema,
      changeId: EntityIdSchema,
      contentItemId: EntityIdSchema,
      kind: z.literal("replace_block"),
      targetBlockId: EntityIdSchema,
      expectedTextHash: Sha256Schema,
      replacementTextHash: Sha256Schema,
    })
    .strict(),
  z
    .object({
      id: EntityIdSchema,
      changeId: EntityIdSchema,
      contentItemId: EntityIdSchema,
      kind: z.literal("insert_block_after"),
      targetBlockId: EntityIdSchema,
      expectedTextHash: Sha256Schema,
      insertedBlockId: EntityIdSchema,
      insertedTextHash: Sha256Schema,
    })
    .strict(),
  z
    .object({
      id: EntityIdSchema,
      changeId: EntityIdSchema,
      contentItemId: EntityIdSchema,
      kind: z.literal("remove_block"),
      targetBlockId: EntityIdSchema,
      expectedTextHash: Sha256Schema,
    })
    .strict(),
]);

export const DocumentContentBindingSchema = z
  .object({
    contentItemId: EntityIdSchema,
    outputBlockId: EntityIdSchema,
    outputTextHash: Sha256Schema,
  })
  .strict();

export const DocumentBuildManifestSchema = z
  .object({
    manifestId: EntityIdSchema,
    operationId: EntityIdSchema,
    resumeVersionId: EntityIdSchema,
    profileId: EntityIdSchema,
    jobId: EntityIdSchema.optional(),
    sourceContentHash: Sha256Schema,
    resultContentHash: Sha256Schema,
    changeSetId: EntityIdSchema,
    changeSetHash: Sha256Schema,
    factSnapshotHash: Sha256Schema,
    requirementSnapshotHash: Sha256Schema.optional(),
    contentApprovalId: EntityIdSchema,
    contentApprovalHash: Sha256Schema,
    templateId: EntityIdSchema,
    templateVersion: z.string().min(1).max(160),
    templateHash: Sha256Schema,
    templateProfileHash: Sha256Schema,
    sourceDocument: DocumentDocxArtifactRefSchema,
    outputDocument: DocumentDocxArtifactRefSchema,
    sourceSnapshotHash: Sha256Schema,
    outputSnapshotHash: Sha256Schema,
    operations: z.array(DocumentChangeOperationSchema).max(10_000),
    presentationPlanHash: Sha256Schema,
    presentationPlanArtifact: DocumentJsonArtifactRefSchema.extend({
      kind: z.literal("document_ir"),
    }).strict(),
    presentationBindings: z
      .array(DocumentPresentationBindingSchema)
      .min(1)
      .max(20_000),
    claimProvenance: z.array(DocumentClaimProvenanceSchema).max(10_000),
    presentation: z.enum(["clean", "tracked_changes", "tracked_changes_with_comments"]),
    builderName: z.string().min(1).max(160),
    builderVersion: z.string().min(1).max(160),
    runtimeHash: Sha256Schema,
    configurationHash: Sha256Schema,
    preservedPackagePartSetHash: Sha256Schema,
    manifestArtifact: DocumentJsonArtifactRefSchema.extend({
      kind: z.literal("document_manifest"),
    }).strict(),
    createdAt: IsoDateTimeSchema,
    manifestHash: Sha256Schema,
  })
  .strict();

export const DocumentTextDiffHunkSchema = z
  .object({
    id: EntityIdSchema,
    changeId: EntityIdSchema,
    story: DocumentStorySchema,
    blockId: EntityIdSchema,
    kind: z.enum(["insert", "delete", "replace", "move"]),
    beforeTextHash: Sha256Schema.optional(),
    afterTextHash: Sha256Schema.optional(),
    approved: z.boolean(),
  })
  .strict();

export const DocumentTextDiffReportSchema = z
  .object({
    reportId: EntityIdSchema,
    baseDocument: DocumentDocxArtifactRefSchema,
    candidateDocument: DocumentDocxArtifactRefSchema,
    baseSemanticTextHash: Sha256Schema,
    candidateSemanticTextHash: Sha256Schema,
    changeSetId: EntityIdSchema,
    changeSetHash: Sha256Schema,
    buildManifestHash: Sha256Schema,
    differName: z.string().min(1).max(160),
    differVersion: z.string().min(1).max(160),
    runtimeHash: Sha256Schema,
    configurationHash: Sha256Schema,
    hunks: z.array(DocumentTextDiffHunkSchema).max(20_000),
    expectedChangeIds: z.array(EntityIdSchema).max(10_000),
    unexpectedHunkCount: z.number().int().nonnegative(),
    hiddenContentChangeCount: z.number().int().nonnegative(),
    relationshipChangeCount: z.number().int().nonnegative(),
    reportArtifact: DocumentJsonArtifactRefSchema.extend({
      kind: z.literal("document_diff"),
    }).strict(),
    createdAt: IsoDateTimeSchema,
    reportHash: Sha256Schema,
  })
  .strict();

export const DocumentRenderPageSchema = z
  .object({
    pageNumber: z.number().int().positive().max(1_000),
    artifact: DocumentPngArtifactRefSchema,
    widthPixels: z.number().int().positive().max(20_000),
    heightPixels: z.number().int().positive().max(20_000),
    dpi: z.number().int().min(72).max(600),
  })
  .strict();

export const DocumentRenderManifestSchema = z
  .object({
    manifestId: EntityIdSchema,
    sourceDocument: DocumentDocxArtifactRefSchema,
    rendererName: z.string().min(1).max(160),
    rendererVersion: z.string().min(1).max(160),
    runtimeHash: Sha256Schema,
    configurationHash: Sha256Schema,
    fontPackHash: Sha256Schema,
    revisionView: z.enum(["clean", "final_showing_markup"]),
    pageCount: z.number().int().positive().max(1_000),
    pages: z.array(DocumentRenderPageSchema).min(1).max(1_000),
    qaStatus: z.literal("pending"),
    manifestArtifact: DocumentJsonArtifactRefSchema.extend({
      kind: z.literal("document_manifest"),
    }).strict(),
    renderedAt: IsoDateTimeSchema,
    renderSetHash: Sha256Schema,
  })
  .strict();

export const DocumentVisualDiffPageSchema = z
  .object({
    pageNumber: z.number().int().positive().max(1_000),
    basePage: DocumentPngArtifactRefSchema.optional(),
    candidatePage: DocumentPngArtifactRefSchema,
    diffImage: DocumentPngArtifactRefSchema.extend({
      kind: z.literal("document_render"),
    }).strict(),
    changedPixelRatio: z.number().min(0).max(1),
    dimensionsMatch: z.boolean(),
  })
  .strict();

export const DocumentVisualDiffReportSchema = z
  .object({
    reportId: EntityIdSchema,
    baseRenderSetHash: Sha256Schema,
    candidateRenderSetHash: Sha256Schema,
    comparatorName: z.string().min(1).max(160),
    comparatorVersion: z.string().min(1).max(160),
    runtimeHash: Sha256Schema,
    configurationHash: Sha256Schema,
    pages: z.array(DocumentVisualDiffPageSchema).min(1).max(1_000),
    addedPageCount: z.number().int().nonnegative(),
    removedPageCount: z.number().int().nonnegative(),
    reportArtifact: DocumentJsonArtifactRefSchema.extend({
      kind: z.literal("document_diff"),
    }).strict(),
    createdAt: IsoDateTimeSchema,
    reportHash: Sha256Schema,
  })
  .strict();

export const DocumentPrivacyResidueSchema = z
  .object({
    coreProperties: z.number().int().nonnegative(),
    appProperties: z.number().int().nonnegative(),
    customProperties: z.number().int().nonnegative(),
    commentAuthors: z.number().int().nonnegative(),
    comments: z.number().int().nonnegative(),
    trackedDeletions: z.number().int().nonnegative(),
    revisionAuthors: z.number().int().nonnegative(),
    hiddenTextRuns: z.number().int().nonnegative(),
    documentVariables: z.number().int().nonnegative(),
    customXmlParts: z.number().int().nonnegative(),
    thumbnails: z.number().int().nonnegative(),
    imageMetadataRecords: z.number().int().nonnegative(),
    externalRelationships: z.number().int().nonnegative(),
    embeddedPackages: z.number().int().nonnegative(),
  })
  .strict();

export const DocumentPrivacyReportSchema = z
  .object({
    reportId: EntityIdSchema,
    sourceDocument: DocumentDocxArtifactRefSchema,
    outputDocument: DocumentDocxArtifactRefSchema,
    policyVersion: z.string().min(1).max(160),
    policyHash: Sha256Schema,
    scrubberName: z.string().min(1).max(160),
    scrubberVersion: z.string().min(1).max(160),
    runtimeHash: Sha256Schema,
    configurationHash: Sha256Schema,
    visibleContentPolicy: z.literal("preserve_exactly"),
    sourceSnapshotHash: Sha256Schema,
    outputSnapshotHash: Sha256Schema,
    semanticTextHashBefore: Sha256Schema,
    semanticTextHashAfter: Sha256Schema,
    removed: DocumentPrivacyResidueSchema,
    remaining: DocumentPrivacyResidueSchema,
    packageSecurityRevalidated: z.literal(true),
    securityInspection: CleanDocumentSecurityInspectionSchema,
    reportArtifact: DocumentJsonArtifactRefSchema.extend({
      kind: z.literal("privacy_report"),
    }).strict(),
    createdAt: IsoDateTimeSchema,
    reportHash: Sha256Schema,
  })
  .strict();

export const DocumentQaCheckKindSchema = z.enum([
  "package_security",
  "ooxml_integrity",
  "approved_text_diff",
  "ats_text_order",
  "structure",
  "styles_numbering",
  "links",
  "privacy_metadata",
  "accessibility",
  "render_complete",
  "visual_page_review",
  "claim_provenance",
]);

export const DocumentQaFindingSchema = z
  .object({
    id: EntityIdSchema,
    check: DocumentQaCheckKindSchema,
    severity: z.enum(["info", "warning", "blocking"]),
    code: z.string().min(1).max(160),
    redactedSummary: z.string().min(1).max(2_000),
    pageNumber: z.number().int().positive().max(1_000).optional(),
    evidenceArtifactIds: z.array(EntityIdSchema).min(1).max(100),
  })
  .strict();

export const DocumentQaCheckSchema = z
  .object({
    kind: DocumentQaCheckKindSchema,
    status: z.enum(["passed", "failed", "blocked"]),
    evidenceArtifactIds: z.array(EntityIdSchema).min(1).max(100),
    findingIds: z.array(EntityIdSchema).max(10_000),
  })
  .strict();

export const DocumentPageInspectionSchema = z
  .object({
    pageNumber: z.number().int().positive().max(1_000),
    pageArtifact: DocumentPngArtifactRefSchema,
    inspectorType: z.enum(["user", "agent", "service"]),
    inspectorId: EntityIdSchema,
    inspectedAt: IsoDateTimeSchema,
    zoomPercent: z.literal(100),
    clipping: z.boolean(),
    overlap: z.boolean(),
    missingGlyph: z.boolean(),
    fontFallback: z.boolean(),
    tableOverflow: z.boolean(),
    bulletMisalignment: z.boolean(),
    headerFooterCollision: z.boolean(),
    unexpectedPageBreak: z.boolean(),
    orphanHeading: z.boolean(),
    unexpectedBlankPage: z.boolean(),
    status: z.enum(["passed", "failed", "blocked"]),
    evidenceArtifactIds: z.array(EntityIdSchema).min(1).max(100),
  })
  .strict();

export const DocumentQaReportSchema = z
  .object({
    reportId: EntityIdSchema,
    resumeVersionId: EntityIdSchema,
    profileId: EntityIdSchema,
    candidateDocument: DocumentDocxArtifactRefSchema,
    buildManifestHash: Sha256Schema,
    textDiffReportHash: Sha256Schema,
    renderSetHash: Sha256Schema,
    visualDiffReportHash: Sha256Schema,
    privacyReportHash: Sha256Schema,
    auditorName: z.string().min(1).max(160),
    auditorVersion: z.string().min(1).max(160),
    runtimeHash: Sha256Schema,
    configurationHash: Sha256Schema,
    requiredCheckKinds: z.array(DocumentQaCheckKindSchema).length(12),
    checks: z.array(DocumentQaCheckSchema).length(12),
    pageInspections: z.array(DocumentPageInspectionSchema).min(1).max(1_000),
    findings: z.array(DocumentQaFindingSchema).max(10_000),
    overallStatus: z.enum(["passed", "failed", "blocked"]),
    reportArtifact: DocumentJsonArtifactRefSchema.extend({
      kind: z.literal("document_qa_report"),
    }).strict(),
    completedAt: IsoDateTimeSchema,
    reportHash: Sha256Schema,
  })
  .strict();

export const DocumentExportManifestSchema = z
  .object({
    manifestId: EntityIdSchema,
    operationId: EntityIdSchema,
    resumeVersionId: EntityIdSchema,
    profileId: EntityIdSchema,
    sourceDocument: DocumentDocxArtifactRefSchema,
    exportedDocument: DocumentDocxArtifactRefSchema.extend({
      kind: z.literal("document_export"),
    }).strict(),
    contentApprovalId: EntityIdSchema,
    contentApprovalHash: Sha256Schema,
    buildManifestHash: Sha256Schema,
    privacyReportHash: Sha256Schema,
    renderSetHash: Sha256Schema,
    qaReportHash: Sha256Schema,
    format: z.literal("docx"),
    destination: z.literal("user_download"),
    exactBytePromotion: z.literal(true),
    manifestArtifact: DocumentJsonArtifactRefSchema.extend({
      kind: z.literal("document_manifest"),
    }).strict(),
    exportedAt: IsoDateTimeSchema,
    manifestHash: Sha256Schema,
  })
  .strict();

const DocumentAuthorizationBindingShape = {
  operationId: EntityIdSchema,
  actionFingerprint: Sha256Schema,
  resumeVersionId: EntityIdSchema,
  expectedResumeRevision: z.number().int().nonnegative(),
  sourceArtifactId: EntityIdSchema,
  sourceArtifactHash: Sha256Schema,
};

const DocumentPolicyGrantBaseSchema = z
  .object({
    kind: z.literal("policy_grant"),
    ...DocumentAuthorizationBindingShape,
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

const DocumentEffectClaimBaseSchema = z
  .object({
    kind: z.literal("effect_claim"),
    ...DocumentAuthorizationBindingShape,
    risk: z.enum(["reversible", "consequential"]),
    approvalId: EntityIdSchema,
    dispatchEffectId: EntityIdSchema,
    workerId: EntityIdSchema,
    claimToken: z.string().min(32).max(512),
    claimedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    executionReservationId: EntityIdSchema,
    executionNonce: z.string().min(32).max(512),
    executionLeaseExpiresAt: IsoDateTimeSchema,
  })
  .strict();

function documentPolicyGrantFor<
  const TTool extends "docx_apply_changeset" | "docx_privacy_scrub",
>(tool: TTool) {
  return DocumentPolicyGrantBaseSchema.extend({ tool: z.literal(tool) }).strict();
}

function documentReversibleClaimFor<
  const TTool extends "docx_apply_changeset" | "docx_privacy_scrub",
>(tool: TTool) {
  return DocumentEffectClaimBaseSchema.extend({
    tool: z.literal(tool),
    risk: z.literal("reversible"),
  }).strict();
}

export const DocumentApplyAuthorizationSchema = documentReversibleClaimFor(
  "docx_apply_changeset",
);
export const DocumentPrivacyAuthorizationSchema = z.union([
  documentPolicyGrantFor("docx_privacy_scrub"),
  documentReversibleClaimFor("docx_privacy_scrub"),
]);
export const DocumentExportAuthorizationSchema = DocumentEffectClaimBaseSchema.extend({
  tool: z.literal("artifact_export"),
  risk: z.literal("consequential"),
  qaReportHash: Sha256Schema,
  exportedArtifactHash: Sha256Schema,
}).strict();
export const DocumentWriteAuthorizationSchema = z.union([
  DocumentApplyAuthorizationSchema,
  DocumentPrivacyAuthorizationSchema,
  DocumentExportAuthorizationSchema,
]);

const DocumentTrustedAuthorizationBaseSchema = z
  .object({
    ...DocumentAuthorizationBindingShape,
    risk: z.enum(["reversible", "consequential"]),
    executionReservationId: EntityIdSchema,
    executionNonceHash: Sha256Schema,
    executionLeaseExpiresAt: IsoDateTimeSchema,
    status: z.literal("executing"),
    reservedAt: IsoDateTimeSchema,
  })
  .strict();

export const DocumentTrustedAuthorizationRecordSchema = z.discriminatedUnion("kind", [
  DocumentTrustedAuthorizationBaseSchema.extend({
    kind: z.literal("policy_grant"),
    tool: z.literal("docx_privacy_scrub"),
    risk: z.literal("reversible"),
    decisionId: EntityIdSchema,
    policyVersion: z.string().min(1).max(160),
    grantHash: Sha256Schema,
    issuedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
  }).strict(),
  DocumentTrustedAuthorizationBaseSchema.extend({
    kind: z.literal("effect_claim"),
    tool: z.enum(["docx_apply_changeset", "docx_privacy_scrub", "artifact_export"]),
    approvalId: EntityIdSchema,
    dispatchEffectId: EntityIdSchema,
    workerId: EntityIdSchema,
    claimTokenHash: Sha256Schema,
    claimedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    qaReportHash: Sha256Schema.optional(),
    exportedArtifactHash: Sha256Schema.optional(),
  }).strict(),
]);

export const DocumentAuthorizationReceiptSchema = z.discriminatedUnion("kind", [
  DocumentTrustedAuthorizationRecordSchema.options[0].omit({ status: true, reservedAt: true }),
  DocumentTrustedAuthorizationRecordSchema.options[1].omit({ status: true, reservedAt: true }),
]);

const DocumentReadScopeShape = {
  ...DocumentOperationScopeSchema.shape,
};

export const DocxParseInputSchema = z
  .object({
    ...DocumentReadScopeShape,
    sourceDocument: DocumentDocxArtifactRefSchema,
    packageLimits: DocumentPackageLimitsSchema,
    parserProfileHash: Sha256Schema,
  })
  .strict();

export const TemplateInspectInputSchema = z
  .object({
    ...DocumentReadScopeShape,
    templateDocument: DocumentDocxArtifactRefSchema,
    packageLimits: DocumentPackageLimitsSchema,
    inspectionProfileHash: Sha256Schema,
  })
  .strict();

export const DocxApplyChangesetInputSchema = z
  .object({
    ...DocumentReadScopeShape,
    baseResume: DocumentResumeBindingSchema.extend({
      expectedResumeStatus: z.enum(["user_approved", "qa_passed", "finalized"]),
    }).strict(),
    resume: DocumentResumeBindingSchema.extend({
      expectedResumeStatus: z.literal("user_approved"),
    }).strict(),
    sourceDocument: DocumentDocxArtifactRefSchema,
    sourceSnapshotHash: Sha256Schema,
    changeSet: ResumeChangeSetSchema,
    reviews: z.array(ResumeChangeReviewSchema).min(1).max(10_000),
    contentApproval: ResumeContentApprovalSchema,
    factSnapshot: DocumentFactSnapshotSchema,
    requirementSnapshot: DocumentRequirementSnapshotSchema.optional(),
    template: DocumentTemplateProfileSchema,
    resultResume: ResumeIRSchema,
    presentationPlan: DocumentPresentationPlanSchema,
    builderProfileHash: Sha256Schema,
    presentation: z.enum(["clean", "tracked_changes", "tracked_changes_with_comments"]),
    authorization: DocumentApplyAuthorizationSchema,
  })
  .strict();

export const DocxTextDiffInputSchema = z
  .object({
    ...DocumentReadScopeShape,
    baseDocument: DocumentDocxArtifactRefSchema,
    candidateDocument: DocumentDocxArtifactRefSchema,
    baseSnapshotHash: Sha256Schema,
    candidateSnapshotHash: Sha256Schema,
    changeSetId: EntityIdSchema,
    changeSetHash: Sha256Schema,
    buildManifestHash: Sha256Schema,
    differProfileHash: Sha256Schema,
  })
  .strict();

export const DocxRenderPagesInputSchema = z
  .object({
    ...DocumentReadScopeShape,
    sourceDocument: DocumentDocxArtifactRefSchema,
    sourceSnapshotHash: Sha256Schema,
    rendererName: z.string().min(1).max(160),
    rendererVersion: z.string().min(1).max(160),
    runtimeHash: Sha256Schema,
    configurationHash: Sha256Schema,
    fontPackHash: Sha256Schema,
    revisionView: z.enum(["clean", "final_showing_markup"]),
    dpi: z.number().int().min(72).max(600),
  })
  .strict();

export const DocxVisualDiffInputSchema = z
  .object({
    ...DocumentReadScopeShape,
    baseRenderManifest: DocumentRenderManifestSchema,
    candidateRenderManifest: DocumentRenderManifestSchema,
    comparatorName: z.string().min(1).max(160),
    comparatorVersion: z.string().min(1).max(160),
    runtimeHash: Sha256Schema,
    configurationHash: Sha256Schema,
  })
  .strict();

export const DocxStructureAuditInputSchema = z
  .object({
    ...DocumentReadScopeShape,
    resume: DocumentResumeBindingSchema.extend({
      expectedResumeStatus: z.literal("docx_built"),
    }).strict(),
    candidateDocument: DocumentDocxArtifactRefSchema,
    buildManifest: DocumentBuildManifestSchema,
    textDiffReport: DocumentTextDiffReportSchema,
    renderManifest: DocumentRenderManifestSchema,
    visualDiffReport: DocumentVisualDiffReportSchema,
    privacyReport: DocumentPrivacyReportSchema,
    auditProfileHash: Sha256Schema,
    requiredCheckKinds: z.array(DocumentQaCheckKindSchema).length(12),
  })
  .strict();

export const DocxPrivacyScrubInputSchema = z
  .object({
    ...DocumentReadScopeShape,
    resume: DocumentResumeBindingSchema.extend({
      expectedResumeStatus: z.literal("docx_built"),
    }).strict(),
    sourceDocument: DocumentDocxArtifactRefSchema,
    sourceSnapshotHash: Sha256Schema,
    buildManifestHash: Sha256Schema,
    policyVersion: z.string().min(1).max(160),
    policyHash: Sha256Schema,
    scrubberProfileHash: Sha256Schema,
    visibleContentPolicy: z.literal("preserve_exactly"),
    authorization: DocumentPrivacyAuthorizationSchema,
  })
  .strict();

export const ArtifactExportInputSchema = z
  .object({
    ...DocumentReadScopeShape,
    resume: DocumentResumeBindingSchema.extend({
      expectedResumeStatus: z.literal("qa_passed"),
    }).strict(),
    sourceDocument: DocumentDocxArtifactRefSchema,
    contentApproval: ResumeContentApprovalSchema,
    buildManifestHash: Sha256Schema,
    privacyReportHash: Sha256Schema,
    renderSetHash: Sha256Schema,
    qaReport: DocumentQaReportSchema,
    exportFileName: SafeFileNameSchema.regex(/\.docx$/i),
    format: z.literal("docx"),
    destination: z.literal("user_download"),
    authorization: DocumentExportAuthorizationSchema,
  })
  .strict();

export const DocumentToolErrorSchema = z
  .object({
    code: z.string().min(1).max(160),
    message: z.string().min(1).max(2_000),
    redacted: z.literal(true),
  })
  .strict();

function documentResultBase<const TTool extends z.infer<typeof DocumentMcpToolNameSchema>>(
  tool: TTool,
) {
  return z
    .object({
      contractVersion: z.literal(CONTRACT_VERSION),
      requestId: EntityIdSchema,
      operationId: EntityIdSchema,
      profileId: EntityIdSchema,
      tool: z.literal(tool),
      startedAt: IsoDateTimeSchema,
      completedAt: IsoDateTimeSchema,
    })
    .strict();
}

function readFailure<const TTool extends z.infer<typeof DocumentMcpToolNameSchema>>(
  tool: TTool,
) {
  return documentResultBase(tool)
    .extend({
      outcome: z.enum(["blocked", "retryable_failure", "fatal_failure"]),
      error: DocumentToolErrorSchema,
      evidenceArtifactIds: z.array(EntityIdSchema).max(100),
    })
    .strict();
}

export const DocxParseOutputSchema = z.object({
  result: z.union([
    documentResultBase("docx_parse").extend({
      outcome: z.literal("success"),
      snapshot: DocumentSnapshotSchema,
    }).strict(),
    readFailure("docx_parse"),
  ]),
}).strict();

export const TemplateInspectOutputSchema = z.object({
  result: z.union([
    documentResultBase("template_inspect").extend({
      outcome: z.literal("success"),
      template: DocumentTemplateProfileSchema,
    }).strict(),
    readFailure("template_inspect"),
  ]),
}).strict();

function writeFailure<
  const TTool extends "docx_apply_changeset" | "docx_privacy_scrub" | "artifact_export",
>(tool: TTool) {
  const base = {
    actionFingerprint: Sha256Schema,
    authorizationReceipt: DocumentAuthorizationReceiptSchema,
    evidenceArtifactIds: z.array(EntityIdSchema).max(100),
    error: DocumentToolErrorSchema,
  };
  return z.union([
    documentResultBase(tool)
      .extend({
        ...base,
        outcome: z.literal("verified_not_created"),
        actionAttempted: z.boolean(),
        nonCreationProof: z
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
          .strict(),
      })
      .strict(),
    documentResultBase(tool)
      .extend({
        ...base,
        outcome: z.literal("uncertain"),
        actionAttempted: z.literal(true),
      })
      .strict(),
  ]);
}

export const DocxApplyChangesetOutputSchema = z.object({
  result: z.union([
    documentResultBase("docx_apply_changeset").extend({
      outcome: z.literal("verified_created"),
      actionFingerprint: Sha256Schema,
      authorizationReceipt: DocumentAuthorizationReceiptSchema,
      outputDocument: DocumentDocxArtifactRefSchema,
      outputSnapshot: DocumentSnapshotSchema,
      buildManifest: DocumentBuildManifestSchema,
      evidenceArtifactIds: z.array(EntityIdSchema).min(1).max(100),
    }).strict(),
    writeFailure("docx_apply_changeset"),
  ]),
}).strict();

export const DocxTextDiffOutputSchema = z.object({
  result: z.union([
    documentResultBase("docx_text_diff").extend({
      outcome: z.literal("success"),
      report: DocumentTextDiffReportSchema,
    }).strict(),
    readFailure("docx_text_diff"),
  ]),
}).strict();

export const DocxRenderPagesOutputSchema = z.object({
  result: z.union([
    documentResultBase("docx_render_pages").extend({
      outcome: z.literal("success"),
      manifest: DocumentRenderManifestSchema,
    }).strict(),
    readFailure("docx_render_pages"),
  ]),
}).strict();

export const DocxVisualDiffOutputSchema = z.object({
  result: z.union([
    documentResultBase("docx_visual_diff").extend({
      outcome: z.literal("success"),
      report: DocumentVisualDiffReportSchema,
    }).strict(),
    readFailure("docx_visual_diff"),
  ]),
}).strict();

export const DocxStructureAuditOutputSchema = z.object({
  result: z.union([
    documentResultBase("docx_structure_audit").extend({
      outcome: z.literal("success"),
      report: DocumentQaReportSchema,
    }).strict(),
    readFailure("docx_structure_audit"),
  ]),
}).strict();

export const DocxPrivacyScrubOutputSchema = z.object({
  result: z.union([
    documentResultBase("docx_privacy_scrub").extend({
      outcome: z.literal("verified_created"),
      actionFingerprint: Sha256Schema,
      authorizationReceipt: DocumentAuthorizationReceiptSchema,
      outputDocument: DocumentDocxArtifactRefSchema.extend({
        kind: z.literal("privacy_scrubbed_document"),
      }).strict(),
      report: DocumentPrivacyReportSchema,
      evidenceArtifactIds: z.array(EntityIdSchema).min(1).max(100),
    }).strict(),
    writeFailure("docx_privacy_scrub"),
  ]),
}).strict();

export const ArtifactExportOutputSchema = z.object({
  result: z.union([
    documentResultBase("artifact_export").extend({
      outcome: z.literal("verified_created"),
      actionFingerprint: Sha256Schema,
      authorizationReceipt: DocumentAuthorizationReceiptSchema,
      exportedDocument: DocumentDocxArtifactRefSchema.extend({
        kind: z.literal("document_export"),
      }).strict(),
      manifest: DocumentExportManifestSchema,
      evidenceArtifactIds: z.array(EntityIdSchema).min(1).max(100),
    }).strict(),
    writeFailure("artifact_export"),
  ]),
}).strict();

export const DocumentMcpToolDescriptorSchema = z
  .object({
    name: DocumentMcpToolNameSchema,
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
        openWorldHint: z.literal(false),
      })
      .strict(),
  })
  .strict();

export type DocumentMcpToolName = z.infer<typeof DocumentMcpToolNameSchema>;
export type DocumentTrustedAuthorizationRecord = z.infer<
  typeof DocumentTrustedAuthorizationRecordSchema
>;
export type DocumentArtifactRef = z.infer<typeof DocumentArtifactRefSchema>;
export type DocumentQaReport = z.infer<typeof DocumentQaReportSchema>;
export type DocumentMcpToolDescriptor = z.infer<typeof DocumentMcpToolDescriptorSchema>;

export interface DocumentMcpToolContract {
  descriptor: DocumentMcpToolDescriptor;
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
}

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const reversibleAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const documentMcpToolCatalog = {
  docx_parse: {
    descriptor: {
      name: "docx_parse",
      title: "Parse safe DOCX",
      description: "Parse one immutable DOCX after bounded, no-network package inspection.",
      risk: "read_only",
      inputSchemaName: "DocxParseInput",
      outputSchemaName: "DocxParseOutput",
      annotations: readAnnotations,
    },
    inputSchema: DocxParseInputSchema,
    outputSchema: DocxParseOutputSchema,
  },
  template_inspect: {
    descriptor: {
      name: "template_inspect",
      title: "Inspect DOCX template",
      description: "Derive a bounded template profile without exposing paths or arbitrary OOXML access.",
      risk: "read_only",
      inputSchemaName: "TemplateInspectInput",
      outputSchemaName: "TemplateInspectOutput",
      annotations: readAnnotations,
    },
    inputSchema: TemplateInspectInputSchema,
    outputSchema: TemplateInspectOutputSchema,
  },
  docx_apply_changeset: {
    descriptor: {
      name: "docx_apply_changeset",
      title: "Apply approved resume changes",
      description: "Create a new immutable DOCX from an approved, fact-backed change set and trusted template.",
      risk: "reversible",
      inputSchemaName: "DocxApplyChangesetInput",
      outputSchemaName: "DocxApplyChangesetOutput",
      annotations: reversibleAnnotations,
    },
    inputSchema: DocxApplyChangesetInputSchema,
    outputSchema: DocxApplyChangesetOutputSchema,
  },
  docx_text_diff: {
    descriptor: {
      name: "docx_text_diff",
      title: "Diff DOCX text and structure",
      description: "Compare trusted base and candidate documents and bind every text hunk to approved changes.",
      risk: "read_only",
      inputSchemaName: "DocxTextDiffInput",
      outputSchemaName: "DocxTextDiffOutput",
      annotations: readAnnotations,
    },
    inputSchema: DocxTextDiffInputSchema,
    outputSchema: DocxTextDiffOutputSchema,
  },
  docx_render_pages: {
    descriptor: {
      name: "docx_render_pages",
      title: "Render every DOCX page",
      description: "Render every page with a pinned runtime and font pack into immutable PNG evidence.",
      risk: "read_only",
      inputSchemaName: "DocxRenderPagesInput",
      outputSchemaName: "DocxRenderPagesOutput",
      annotations: readAnnotations,
    },
    inputSchema: DocxRenderPagesInputSchema,
    outputSchema: DocxRenderPagesOutputSchema,
  },
  docx_visual_diff: {
    descriptor: {
      name: "docx_visual_diff",
      title: "Diff rendered pages",
      description: "Produce a page-complete visual comparison from two trusted render manifests.",
      risk: "read_only",
      inputSchemaName: "DocxVisualDiffInput",
      outputSchemaName: "DocxVisualDiffOutput",
      annotations: readAnnotations,
    },
    inputSchema: DocxVisualDiffInputSchema,
    outputSchema: DocxVisualDiffOutputSchema,
  },
  docx_structure_audit: {
    descriptor: {
      name: "docx_structure_audit",
      title: "Audit final DOCX",
      description: "Require security, structure, accessibility, provenance, privacy, render, and full-page visual evidence.",
      risk: "read_only",
      inputSchemaName: "DocxStructureAuditInput",
      outputSchemaName: "DocxStructureAuditOutput",
      annotations: readAnnotations,
    },
    inputSchema: DocxStructureAuditInputSchema,
    outputSchema: DocxStructureAuditOutputSchema,
  },
  docx_privacy_scrub: {
    descriptor: {
      name: "docx_privacy_scrub",
      title: "Scrub DOCX metadata",
      description: "Create a new immutable privacy-scrubbed DOCX while preserving visible semantic content exactly.",
      risk: "reversible",
      inputSchemaName: "DocxPrivacyScrubInput",
      outputSchemaName: "DocxPrivacyScrubOutput",
      annotations: reversibleAnnotations,
    },
    inputSchema: DocxPrivacyScrubInputSchema,
    outputSchema: DocxPrivacyScrubOutputSchema,
  },
  artifact_export: {
    descriptor: {
      name: "artifact_export",
      title: "Export QA-approved artifact",
      description: "Promote the exact approved and QA-passed DOCX bytes for user download without modifying them.",
      risk: "consequential",
      inputSchemaName: "ArtifactExportInput",
      outputSchemaName: "ArtifactExportOutput",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    inputSchema: ArtifactExportInputSchema,
    outputSchema: ArtifactExportOutputSchema,
  },
} as const satisfies Record<DocumentMcpToolName, DocumentMcpToolContract>;
