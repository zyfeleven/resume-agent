import type { Fact, ResumeIR } from "@resume-agent/contracts";
import mammoth from "mammoth";
import { describe, expect, it } from "vitest";

import { buildResumeDocx, crc32, extractDocxText, readZip, writeZip } from "../src/index.js";

const NOW = "2026-07-27T16:00:00-04:00";

function fact(id: string, kind: Fact["kind"], key: string, value: string): Fact {
  return {
    id,
    profileId: "profile:local",
    kind,
    key,
    value,
    status: "verified",
    verification: { verifiedBy: "user", verifiedAt: NOW },
    sensitivity: kind === "identity" || kind === "contact" ? "pii" : "normal",
    sources: [{ artifactId: "artifact:resume1", locator: "line:1", excerpt: value }],
    version: 2,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const facts: Fact[] = [
  fact("fact:name", "identity", "full_name", "Maya Chen"),
  fact("fact:email", "contact", "email", "maya.chen@example.com"),
  fact("fact:role", "employment", "employment.northstar.role", "Senior Product Designer"),
  fact("fact:org", "employment", "employment.northstar.organization", "Northstar Labs"),
  fact("fact:dates", "employment", "employment.northstar.dates", "Jan 2021 – Present"),
  fact("fact:bullet", "achievement", "employment.northstar.achievement.1", "Led the redesign of the analytics workspace."),
  fact("fact:skill", "skill", "skill.figma", "Figma"),
  fact("fact:summary", "achievement", "summary.1", "Product designer with eight years of experience."),
  fact("fact:education", "education", "education.emily-carr", "BDes, Interaction Design — Emily Carr University"),
];

const resume: ResumeIR = {
  profileId: "profile:local",
  headerFactIds: ["fact:name", "fact:email"],
  summary: [{ id: "item:summary", text: "Product designer with eight years of experience.", factIds: ["fact:summary"], requirementIds: [] }],
  skills: [{ id: "item:figma", text: "Figma", factIds: ["fact:skill"], requirementIds: [] }],
  experience: [
    {
      id: "experience:northstar",
      organizationFactId: "fact:org",
      roleFactId: "fact:role",
      dateFactIds: ["fact:dates"],
      bullets: [
        {
          id: "item:bullet",
          text: "Led the redesign of the analytics workspace.",
          factIds: ["fact:bullet"],
          requirementIds: [],
        },
      ],
    },
  ],
  projects: [],
  education: [
    {
      id: "item:education",
      text: "BDes, Interaction Design — Emily Carr University",
      factIds: ["fact:education"],
      requirementIds: [],
    },
  ],
};

describe("zip", () => {
  it("computes the CRC-32 checksum the format requires", () => {
    // Known vector: CRC-32 of "123456789" is 0xCBF43926.
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcb_f4_39_26);
  });

  it("round-trips entries", () => {
    const encoder = new TextEncoder();
    const archive = writeZip([
      { name: "a.txt", data: encoder.encode("first") },
      { name: "nested/b.xml", data: encoder.encode("<x/>") },
    ]);

    const entries = readZip(archive);
    expect([...entries.keys()]).toEqual(["a.txt", "nested/b.xml"]);
    expect(new TextDecoder().decode(entries.get("nested/b.xml"))).toBe("<x/>");
  });
});

describe("buildResumeDocx", () => {
  it("is read by an independent DOCX parser", async () => {
    const document = buildResumeDocx(resume, facts);
    const parsed = await mammoth.extractRawText({ buffer: Buffer.from(document.bytes) });

    expect(parsed.value).toContain("Maya Chen");
    expect(parsed.value).toContain("Senior Product Designer — Northstar Labs");
    expect(parsed.value).toContain("Led the redesign of the analytics workspace.");
    expect(parsed.value).toContain("BDes, Interaction Design — Emily Carr University");
  });

  it("writes every approved line and nothing else", () => {
    const document = buildResumeDocx(resume, facts);
    const lines = document.text.split("\n");

    expect(lines).toContain("Maya Chen");
    expect(lines).toContain("maya.chen@example.com");
    expect(lines).toContain("Jan 2021 – Present");
    expect(lines).toContain("• Led the redesign of the analytics workspace.");
    expect(document.text).not.toContain("Woodworking");
  });

  it("cites verified facts on every block", () => {
    const document = buildResumeDocx(resume, facts);
    const verifiedIds = new Set(facts.map((entry) => entry.id));

    expect(document.blocks.length).toBeGreaterThan(5);
    for (const block of document.blocks) {
      expect(block.factIds.length).toBeGreaterThan(0);
      for (const factId of block.factIds) {
        expect(verifiedIds.has(factId)).toBe(true);
      }
    }
  });

  it("never writes an unverified fact into the document", () => {
    const withPending = facts.map((entry) =>
      entry.id === "fact:skill" ? ({ ...entry, status: "pending" } as Fact) : entry,
    );
    const document = buildResumeDocx({ ...resume, skills: [] }, withPending);

    expect(document.text).not.toContain("Figma");
  });

  it("escapes text that would otherwise break the document XML", () => {
    const trickyFacts = facts.map((entry) =>
      entry.id === "fact:summary" ? fact("fact:summary", "achievement", "summary.1", 'Built "A & B" <tools>') : entry,
    );
    const trickyResume: ResumeIR = {
      ...resume,
      summary: [{ id: "item:summary", text: 'Built "A & B" <tools>', factIds: ["fact:summary"], requirementIds: [] }],
    };

    const document = buildResumeDocx(trickyResume, trickyFacts);
    expect(document.text).toContain('Built "A & B" <tools>');
    expect(extractDocxText(document.bytes)).toContain('Built "A & B" <tools>');
  });

  it("produces identical bytes for identical input", () => {
    const first = buildResumeDocx(resume, facts);
    const second = buildResumeDocx(resume, facts);

    expect(first.contentHash).toBe(second.contentHash);
    expect(Buffer.from(first.bytes).equals(Buffer.from(second.bytes))).toBe(true);
  });

  it("refuses to build a resume with nothing in it", () => {
    const empty: ResumeIR = { ...resume, headerFactIds: ["fact:missing"], summary: [], skills: [], experience: [], projects: [], education: [] };
    expect(() => buildResumeDocx(empty, facts)).toThrow(/at least one line/i);
  });
});
