import { createHash } from "node:crypto";

function scopedId(prefix: string, changeSetId: string, approvedContentHash: string): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([changeSetId, approvedContentHash]))
    .digest("hex");
  return `${prefix}:${digest.slice(0, 24)}`;
}

/** Content-identical approvals remain distinct when they belong to different change sets. */
export function approvedResumeVersionId(changeSetId: string, approvedContentHash: string): string {
  return scopedId("resume-version", changeSetId, approvedContentHash);
}

/** Approval identity is scoped to the exact proposal the user reviewed. */
export function resumeContentApprovalId(changeSetId: string, approvedContentHash: string): string {
  return scopedId("content-approval", changeSetId, approvedContentHash);
}
