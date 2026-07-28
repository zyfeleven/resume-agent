import type { Fact } from "@resume-agent/contracts";
import { describe, expect, it } from "vitest";

import { extractResumeFacts, mergeImportedFacts } from "../src/index.js";

function facts(profileId: string): Fact[] {
  return extractResumeFacts({
    profileId,
    source: {
      artifactId: `artifact:${profileId.replace(/[^a-z]/g, "")}`,
      fileName: "resume.txt",
      format: "plain_text",
      contentHash: "a".repeat(64),
      byteSize: 20,
    },
    text: "Maya Chen\nmaya@example.com",
    importedAt: "2026-07-28T04:00:00-04:00",
  }).facts;
}

describe("fact merge boundary", () => {
  it("refuses to merge facts from different profiles", () => {
    expect(() => mergeImportedFacts(facts("profile:one"), facts("profile:two"))).toThrow(/different profiles/i);
  });
});
