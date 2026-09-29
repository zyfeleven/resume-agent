import type { ResumeChangeSet, ResumeContentApproval, ResumeIR, ResumeVersion } from "@resume-agent/contracts";
import { describe, expect, it } from "vitest";

import { hashJson } from "../lib/hash";
import { DEFAULT_TEMPLATE_ID, emptyResumeStore } from "../lib/resume-store";
import { ResumeRestoreError, restoreResumeVersion } from "../lib/resume-version-restore";

const NOW = "2026-07-28T20:00:00-04:00";
const resume: ResumeIR = {
  profileId: "profile:local",
  headerFactIds: ["fact:name"],
  summary: [],
  skills: [],
  experience: [],
  projects: [],
  education: [],
};
const baseResume: ResumeIR = { ...resume, headerFactIds: ["fact:base"] };
const contentHash = hashJson(resume);
const baseContentHash = hashJson(baseResume);
const baseVersion: ResumeVersion = {
  id: "resume-version:base",
  profileId: "profile:local",
  templateId: DEFAULT_TEMPLATE_ID,
  resume: baseResume,
  status: "draft",
  contentHash: baseContentHash,
  createdAt: NOW,
  updatedAt: NOW,
};
const version: ResumeVersion = {
  id: "resume-version:approved",
  profileId: "profile:local",
  jobId: "job:one",
  parentVersionId: baseVersion.id,
  templateId: DEFAULT_TEMPLATE_ID,
  resume,
  changeSetId: "change-set:one",
  status: "user_approved",
  contentHash,
  createdAt: NOW,
  updatedAt: NOW,
};
const changeSet: ResumeChangeSet = {
  id: "change-set:one",
  jobId: "job:one",
  baseResumeVersionId: baseVersion.id,
  baseContentHash,
  resultContentHash: contentHash,
  factSnapshotHash: "1".repeat(64),
  requirementSnapshotHash: "2".repeat(64),
  changes: [],
  promptVersion: "test",
  model: "test",
  contentHash: "3".repeat(64),
  createdAt: NOW,
  updatedAt: NOW,
};
const approval: ResumeContentApproval = {
  id: "content-approval:one",
  resumeVersionId: version.id,
  profileId: version.profileId,
  jobId: version.jobId,
  changeSetId: changeSet.id,
  changeSetHash: changeSet.contentHash,
  approvedContentHash: contentHash,
  approvedPresentationHash: "4".repeat(64),
  decidedBy: "user:local",
  decidedAt: NOW,
};

function store() {
  return {
    ...emptyResumeStore(),
    versions: [baseVersion, version],
    changeSets: [changeSet],
    approvals: [approval],
  };
}

describe("resume version restore", () => {
  it("re-activates the exact approved snapshot without copying it", () => {
    const before = store();
    const result = restoreResumeVersion(before, {
      versionId: version.id,
      restoredBy: "user:local",
      restoredAt: NOW,
    });

    expect(result.store.activeResumeVersionId).toBe(version.id);
    expect(result.store.versions).toEqual(before.versions);
    expect(result.restore).toMatchObject({
      sourceVersionId: version.id,
      sourceApprovalId: approval.id,
      sourceContentHash: contentHash,
      sourceApprovalHash: hashJson(approval),
    });
    expect(result.restore.restoreHash).toBe(
      hashJson({
        sourceVersionId: version.id,
        sourceApprovalId: approval.id,
        sourceContentHash: contentHash,
        sourceApprovalHash: hashJson(approval),
        restoredBy: "user:local",
        restoredAt: NOW,
      }),
    );
  });

  it("links a later restore to the previously active version", () => {
    const result = restoreResumeVersion(
      { ...store(), activeResumeVersionId: "resume-version:previous" },
      { versionId: version.id, restoredBy: "user:local", restoredAt: NOW },
    );
    expect(result.restore.previousActiveVersionId).toBe("resume-version:previous");
  });

  it("fails closed when the stored content was changed", () => {
    const tampered = store();
    tampered.versions = [{ ...baseVersion }, { ...version, resume: { ...resume, headerFactIds: ["fact:other"] } }];

    expect(() =>
      restoreResumeVersion(tampered, { versionId: version.id, restoredBy: "user:local", restoredAt: NOW }),
    ).toThrowError(ResumeRestoreError);
  });

  it("refuses a draft or version whose approval is missing", () => {
    const missingApproval = { ...store(), approvals: [] };
    expect(() =>
      restoreResumeVersion(missingApproval, {
        versionId: version.id,
        restoredBy: "user:local",
        restoredAt: NOW,
      }),
    ).toThrow(/explicitly approved/i);
  });

  it("refuses a stale approval, change set, or parent link", () => {
    const stale = store();
    stale.changeSets = [{ ...changeSet, contentHash: "8".repeat(64) }];
    expect(() =>
      restoreResumeVersion(stale, { versionId: version.id, restoredBy: "user:local", restoredAt: NOW }),
    ).toThrow(/missing or stale/i);
  });
});
