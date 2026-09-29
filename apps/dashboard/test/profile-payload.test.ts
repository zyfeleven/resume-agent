import { FactSchema } from "@resume-agent/contracts";
import { describe, expect, it } from "vitest";

import { toProfilePayload } from "../lib/profile-payload";
import { ProfileStoreSchema, emptyProfileStore, usableProfileFacts } from "../lib/profile-store";

const importedAt = "2026-07-28T09:00:00-04:00";

function storeFixture() {
  const first = FactSchema.parse({
    id: "fact:toronto",
    profileId: "profile:local",
    kind: "contact",
    key: "contact.location",
    value: "Toronto, ON",
    status: "verified",
    verification: { verifiedBy: "user", verifiedAt: importedAt },
    sensitivity: "pii",
    sources: [{ artifactId: "artifact:first", locator: "line:2", excerpt: "Toronto, ON" }],
    version: 2,
    createdAt: importedAt,
    updatedAt: importedAt,
  });
  const second = FactSchema.parse({
    id: "fact:montreal",
    profileId: "profile:local",
    kind: "contact",
    key: "contact.location",
    value: "Montreal, QC",
    status: "pending",
    sensitivity: "pii",
    sources: [{ artifactId: "artifact:second", locator: "line:3", excerpt: "Montreal, QC" }],
    version: 1,
    createdAt: importedAt,
    updatedAt: importedAt,
  });
  const email = FactSchema.parse({
    id: "fact:email",
    profileId: "profile:local",
    kind: "contact",
    key: "contact.email",
    value: "maya@example.com",
    status: "verified",
    verification: { verifiedBy: "user", verifiedAt: importedAt },
    sensitivity: "pii",
    sources: [{ artifactId: "artifact:first", locator: "line:1" }],
    version: 2,
    createdAt: importedAt,
    updatedAt: importedAt,
  });

  return ProfileStoreSchema.parse({
    version: 1,
    profile: {
      id: "profile:local",
      displayName: "Maya Chen",
      factIds: [first.id, second.id, email.id],
      version: 1,
      createdAt: importedAt,
      updatedAt: importedAt,
    },
    artifacts: [
      {
        id: "artifact:first",
        kind: "source_resume",
        fileName: "resume-old.docx",
        mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        contentHash: "a".repeat(64),
        byteSize: 100,
        storageKey: "local:first.docx",
        sensitivity: "pii",
        createdAt: importedAt,
      },
      {
        id: "artifact:second",
        kind: "source_resume",
        fileName: "resume-new.docx",
        mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        contentHash: "b".repeat(64),
        byteSize: 110,
        storageKey: "local:second.docx",
        sensitivity: "pii",
        createdAt: importedAt,
      },
    ],
    imports: [
      {
        id: "import:first",
        profileId: "profile:local",
        artifactId: "artifact:first",
        extractorVersion: "resume-import-v1",
        importedAt,
        sourceLineCount: 2,
        sections: [],
        factCounts: [{ kind: "contact", count: 2 }],
        factIds: [first.id, email.id],
        skipped: [],
      },
      {
        id: "import:second",
        profileId: "profile:local",
        artifactId: "artifact:second",
        extractorVersion: "resume-import-v1",
        importedAt,
        sourceLineCount: 1,
        sections: [],
        factCounts: [{ kind: "contact", count: 1 }],
        factIds: [second.id],
        skipped: [],
      },
    ],
    facts: [first, second, email],
  });
}

describe("profile conflict payload", () => {
  it("keeps old profile stores readable by defaulting conflict decision history", () => {
    expect(ProfileStoreSchema.parse({ ...emptyProfileStore(), conflictDecisions: undefined }).conflictDecisions).toEqual(
      [],
    );
  });

  it("shows file-level evidence and a review hash for every active conflict", () => {
    const payload = toProfilePayload(storeFixture());

    expect(payload.conflicts).toHaveLength(1);
    expect(payload.blockedFactIds).toEqual(["fact:montreal", "fact:toronto"]);
    expect(payload.evidence["fact:toronto"]).toEqual([
      {
        artifactId: "artifact:first",
        fileName: "resume-old.docx",
        importedAt,
        locator: "line:2",
        excerpt: "Toronto, ON",
      },
    ]);
    expect(payload.conflicts[0]?.reviewedConflictHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("excludes unresolved conflict candidates from downstream facts", () => {
    expect(usableProfileFacts(storeFixture()).map((fact) => fact.id)).toEqual(["fact:email"]);
  });
});
