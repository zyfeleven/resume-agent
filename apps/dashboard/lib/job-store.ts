import { ArtifactSchema, JDRequirementSchema, JdParseReportSchema, JobSchema } from "@resume-agent/contracts";
import { z } from "zod";

import { createJsonStore } from "./local-store";

export const JobStoreSchema = z
  .object({
    version: z.literal(1),
    jobs: z.array(JobSchema),
    artifacts: z.array(ArtifactSchema),
    reports: z.array(JdParseReportSchema),
    requirements: z.array(JDRequirementSchema),
  })
  .strict();

export type JobStore = z.infer<typeof JobStoreSchema>;

export function emptyJobStore(): JobStore {
  return { version: 1, jobs: [], artifacts: [], reports: [], requirements: [] };
}

const store = createJsonStore({
  fileName: "jobs-store.json",
  schema: JobStoreSchema,
  empty: emptyJobStore,
  artifactScope: "jobs",
});

export const readJobStore = store.read;
export const updateJobStore = store.update;

/** Delete every locally stored job, requirement, parse report, and description file. */
export const clearJobStore = store.clear;
