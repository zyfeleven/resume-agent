import { describe, expect, it } from "vitest";

import { approvedResumeVersionId, resumeContentApprovalId } from "../lib/resume-identity";

describe("approved resume identity", () => {
  it("is stable when the same change set and content are retried", () => {
    const hash = "a".repeat(64);
    expect(approvedResumeVersionId("change-set:1", hash)).toBe(approvedResumeVersionId("change-set:1", hash));
    expect(resumeContentApprovalId("change-set:1", hash)).toBe(resumeContentApprovalId("change-set:1", hash));
  });

  it("keeps content-identical approvals for different change sets distinct", () => {
    const hash = "a".repeat(64);
    expect(approvedResumeVersionId("change-set:1", hash)).not.toBe(approvedResumeVersionId("change-set:2", hash));
    expect(resumeContentApprovalId("change-set:1", hash)).not.toBe(resumeContentApprovalId("change-set:2", hash));
  });
});
