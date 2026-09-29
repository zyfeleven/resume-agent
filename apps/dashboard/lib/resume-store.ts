import {
  ArtifactSchema,
  ClaimGuardReportSchema,
  DocumentBuildReportSchema,
  RequirementFactMatchSchema,
  ResumeChangeReviewSchema,
  ResumeChangeSetSchema,
  ResumeContentApprovalSchema,
  ResumeDocumentBuildSchema,
  ResumeArtifactManifestSchema,
  ResumeSentenceReviewSchema,
  ResumeTailorReportSchema,
  ResumeVersionSchema,
  ResumeVersionRestoreSchema,
} from "@resume-agent/contracts";
import { CLASSIC_RESUME_TEMPLATE_ID } from "@resume-agent/document-build";
import { z } from "zod";

import { createJsonStore } from "./local-store";

/** The one supported, versioned high-fidelity template. */
export const DEFAULT_TEMPLATE_ID = CLASSIC_RESUME_TEMPLATE_ID;

const MatchSetSchema = z
  .object({
    changeSetId: z.string().min(1),
    matches: z.array(RequirementFactMatchSchema),
  })
  .strict();

export const ResumeStoreSchema = z
  .object({
    version: z.literal(1),
    versions: z.array(ResumeVersionSchema),
    activeResumeVersionId: z.string().min(1).optional(),
    versionRestores: z.array(ResumeVersionRestoreSchema).default([]),
    changeSets: z.array(ResumeChangeSetSchema),
    reports: z.array(ResumeTailorReportSchema),
    guardReports: z.array(ClaimGuardReportSchema),
    semanticGuardReports: z.array(ClaimGuardReportSchema).default([]),
    matchSets: z.array(MatchSetSchema),
    reviews: z.array(ResumeChangeReviewSchema),
    sentenceReviews: z.array(ResumeSentenceReviewSchema).default([]),
    approvals: z.array(ResumeContentApprovalSchema),
    builds: z.array(ResumeDocumentBuildSchema),
    buildReports: z.array(DocumentBuildReportSchema),
    artifactManifests: z.array(ResumeArtifactManifestSchema).default([]),
    artifacts: z.array(ArtifactSchema),
  })
  .strict();

export type ResumeStore = z.infer<typeof ResumeStoreSchema>;

export function emptyResumeStore(): ResumeStore {
  return {
    version: 1,
    versions: [],
    versionRestores: [],
    changeSets: [],
    reports: [],
    guardReports: [],
    semanticGuardReports: [],
    matchSets: [],
    reviews: [],
    sentenceReviews: [],
    approvals: [],
    builds: [],
    buildReports: [],
    artifactManifests: [],
    artifacts: [],
  };
}

const store = createJsonStore({
  fileName: "resume-store.json",
  schema: ResumeStoreSchema,
  empty: emptyResumeStore,
  artifactScope: "documents",
});

export const readResumeStore = store.read;
export const updateResumeStore = store.update;

/** Delete every locally stored resume version, change set, and review. */
export const clearResumeStore = store.clear;
