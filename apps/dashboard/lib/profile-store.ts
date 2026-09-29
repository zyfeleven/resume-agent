import {
  ArtifactSchema,
  CandidateProfileSchema,
  FactConflictDecisionSchema,
  FactSchema,
  ResumeImportReportSchema,
} from "@resume-agent/contracts";
import { z } from "zod";
import { usableFacts } from "@resume-agent/resume-import";

import { createJsonStore } from "./local-store";

export const LOCAL_PROFILE_ID = "profile:local";
export const LOCAL_REVIEWER_ID = "user:local";

export const ProfileStoreSchema = z
  .object({
    version: z.literal(1),
    profile: CandidateProfileSchema.nullable(),
    artifacts: z.array(ArtifactSchema),
    imports: z.array(ResumeImportReportSchema),
    facts: z.array(FactSchema),
    conflictDecisions: z.array(FactConflictDecisionSchema).default([]),
  })
  .strict();

export type ProfileStore = z.infer<typeof ProfileStoreSchema>;

export function emptyProfileStore(): ProfileStore {
  return { version: 1, profile: null, artifacts: [], imports: [], facts: [], conflictDecisions: [] };
}

const store = createJsonStore({
  fileName: "profile-store.json",
  schema: ProfileStoreSchema,
  empty: emptyProfileStore,
  artifactScope: "resumes",
});

export const readProfileStore = store.read;
export const updateProfileStore = store.update;

export function usableProfileFacts(profileStore: ProfileStore) {
  return usableFacts(profileStore.facts);
}

/** Delete every locally stored fact, import report, and source resume file. */
export const clearProfileStore = store.clear;
