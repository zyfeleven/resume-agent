import {
  ClaimGuardReportSchema,
  RequirementFactMatchSchema,
  ResumeChangeReviewSchema,
  ResumeChangeSetSchema,
  ResumeTailorReportSchema,
  ResumeVersionSchema,
} from "@resume-agent/contracts";
import { z } from "zod";

import { createJsonStore } from "./local-store";

/** Phase 1 has no template library yet; the base version records that plainly. */
export const DEFAULT_TEMPLATE_ID = "template:default";

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
    changeSets: z.array(ResumeChangeSetSchema),
    reports: z.array(ResumeTailorReportSchema),
    guardReports: z.array(ClaimGuardReportSchema),
    matchSets: z.array(MatchSetSchema),
    reviews: z.array(ResumeChangeReviewSchema),
  })
  .strict();

export type ResumeStore = z.infer<typeof ResumeStoreSchema>;

export function emptyResumeStore(): ResumeStore {
  return { version: 1, versions: [], changeSets: [], reports: [], guardReports: [], matchSets: [], reviews: [] };
}

const store = createJsonStore({
  fileName: "resume-store.json",
  schema: ResumeStoreSchema,
  empty: emptyResumeStore,
});

export const readResumeStore = store.read;
export const updateResumeStore = store.update;

/** Delete every locally stored resume version, change set, and review. */
export const clearResumeStore = store.clear;
