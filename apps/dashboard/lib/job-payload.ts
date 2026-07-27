import type { JDRequirement, JdParseReport, Job } from "@resume-agent/contracts";
import { summarizeRequirements, type RequirementSummary } from "@resume-agent/jd-analysis";

import type { JobStore } from "./job-store";

const PRIORITY_ORDER: Record<JDRequirement["priority"], number> = {
  must_have: 0,
  preferred: 1,
  context: 2,
};

export interface JobView {
  job: Job;
  requirements: JDRequirement[];
  summary: RequirementSummary;
  report: JdParseReport | null;
  descriptionBytes: number;
}

export interface JobsPayload {
  jobs: JobView[];
}

export function toJobsPayload(store: JobStore): JobsPayload {
  const artifactsById = new Map(store.artifacts.map((artifact) => [artifact.id, artifact]));

  return {
    jobs: [...store.jobs]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((job) => {
        const requirements = store.requirements
          .filter((requirement) => requirement.jobId === job.id)
          .sort(
            (left, right) =>
              PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority] ||
              left.source.locator.localeCompare(right.source.locator, undefined, { numeric: true }),
          );

        const report =
          [...store.reports]
            .filter((entry) => entry.jobId === job.id)
            .sort((left, right) => right.parsedAt.localeCompare(left.parsedAt))[0] ?? null;

        return {
          job,
          requirements,
          summary: summarizeRequirements(requirements),
          report,
          descriptionBytes: artifactsById.get(job.descriptionArtifactId)?.byteSize ?? 0,
        };
      }),
  };
}
