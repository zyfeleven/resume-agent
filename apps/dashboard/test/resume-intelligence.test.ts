import type { Fact, JDRequirement, Job, ResumeIR } from "@resume-agent/contracts";
import { checkChangeSetClaims, checkSemanticClaims } from "@resume-agent/resume-tailor";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_GEMINI_MODEL } from "../lib/gemini-form-provider";
import { GeminiResumeError, GeminiResumeProvider } from "../lib/gemini-resume-provider";
import {
  ResumeIntelligenceError,
  buildResumeModelRequest,
  createResumeIntelligenceChangeSet,
  type ResumeIntelligenceProvider,
  type ResumeModelOutput,
} from "../lib/resume-intelligence";

const NOW = "2026-07-28T20:00:00.000Z";

function verifiedFact(input: {
  id: string;
  key: string;
  value: string;
  sensitivity?: "normal" | "pii";
  kind?: Fact["kind"];
}): Fact {
  return {
    id: input.id,
    profileId: "profile:local",
    kind: input.kind ?? "achievement",
    key: input.key,
    value: input.value,
    sensitivity: input.sensitivity ?? "normal",
    sources: [{ artifactId: "artifact:resume", locator: "line:1", excerpt: input.value }],
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    status: "verified",
    verification: { verifiedBy: "user", verifiedAt: NOW },
  };
}

const job: Job = {
  id: "job:test",
  title: "Platform Engineer",
  company: "Example",
  descriptionArtifactId: "artifact:jd",
  descriptionHash: "a".repeat(64),
  status: "active",
  createdAt: NOW,
  updatedAt: NOW,
};

const requirement: JDRequirement = {
  id: "requirement:async",
  jobId: job.id,
  kind: "experience",
  priority: "must_have",
  text: "Experience designing asynchronous distributed architecture",
  keywords: ["asynchronous", "distributed"],
  source: { artifactId: "artifact:jd", locator: "line:4", excerpt: "Experience designing asynchronous distributed architecture" },
};

function baseResume(text: string, factId = "fact:achievement"): ResumeIR {
  return {
    profileId: "profile:local",
    headerFactIds: ["fact:header"],
    summary: [{ id: "resume-item:achievement", text, factIds: [factId], requirementIds: [] }],
    skills: [],
    experience: [],
    projects: [],
    education: [],
  };
}

function provider(output: ResumeModelOutput): ResumeIntelligenceProvider {
  return {
    optimize: vi.fn(async () => ({
      output,
      provider: "gemini" as const,
      model: DEFAULT_GEMINI_MODEL,
      responseId: "response:resume-test",
    })),
  };
}

function modelOutput(input: { action?: "keep" | "rewrite" | "remove"; after?: string | null; factId?: string } = {}): ResumeModelOutput {
  const action = input.action ?? "keep";
  return {
    requirementMatches: [{
      requirementId: requirement.id,
      factIds: [input.factId ?? "fact:achievement"],
      strength: "related",
      confidence: 0.93,
      rationale: "Event-driven services are credible evidence of asynchronous distributed-system work.",
    }],
    itemProposals: [{
      targetItemId: "resume-item:achievement",
      action,
      requirementIds: action === "remove" ? [] : [requirement.id],
      after: action === "rewrite" ? (input.after ?? "Built event-driven services using Python.") : null,
      confidence: 0.94,
      rationale: "This verified achievement is relevant to the requirement.",
    }],
  };
}

describe("Gemini resume intelligence", () => {
  it("withholds PII facts from Gemini while sending verified experience evidence", () => {
    const achievement = verifiedFact({ id: "fact:achievement", key: "achievement", value: "Built event-driven services" });
    const header = verifiedFact({ id: "fact:header", key: "email", value: "candidate@example.com", sensitivity: "pii", kind: "contact" });
    const request = buildResumeModelRequest({
      job,
      requirements: [requirement],
      facts: [achievement, header],
      baseResume: baseResume(achievement.value as string),
    });

    expect(request.facts).toContainEqual(expect.objectContaining({ id: achievement.id, value: achievement.value }));
    expect(request.facts.some((fact) => fact.id === header.id)).toBe(false);
  });

  it("accepts semantic matches without keyword overlap and records model evidence", async () => {
    const achievement = verifiedFact({
      id: "fact:achievement",
      key: "achievement",
      value: "Built event-driven services using Python",
    });
    const header = verifiedFact({ id: "fact:header", key: "email", value: "candidate@example.com", sensitivity: "pii", kind: "contact" });
    const result = await createResumeIntelligenceChangeSet({
      job,
      profileId: "profile:local",
      baseResume: baseResume(achievement.value as string),
      baseResumeVersionId: "resume-version:base",
      requirements: [requirement],
      facts: [achievement, header],
      provider: provider(modelOutput()),
      generatedAt: NOW,
    });

    expect(result.matches[0]).toMatchObject({ strength: "related", factIds: [achievement.id] });
    expect(result.matches[0]?.evidence[0]?.basis).toBe("semantic_model");
    expect(result.changeSet.changes[0]).toMatchObject({ intent: "keep", requirementIds: [requirement.id] });
    expect(result.changeSet.model).toBe(DEFAULT_GEMINI_MODEL);
  });

  it("allows grounded rewrites and both independent claim guards still pass", async () => {
    const achievement = verifiedFact({
      id: "fact:achievement",
      key: "achievement",
      value: "Built Python APIs for hiring workflows",
    });
    const header = verifiedFact({ id: "fact:header", key: "email", value: "candidate@example.com", sensitivity: "pii", kind: "contact" });
    const resume = baseResume(achievement.value as string);
    const result = await createResumeIntelligenceChangeSet({
      job,
      profileId: "profile:local",
      baseResume: resume,
      baseResumeVersionId: "resume-version:base",
      requirements: [requirement],
      facts: [achievement, header],
      provider: provider(modelOutput({ action: "rewrite", after: "Built hiring workflows using Python APIs." })),
      generatedAt: NOW,
    });

    const deterministic = checkChangeSetClaims({
      changeSet: result.changeSet,
      baseResume: resume,
      finalizedResume: result.proposedResume,
      facts: [achievement, header],
      requirements: [requirement],
      checkedAt: NOW,
    });
    const semantic = checkSemanticClaims({
      changeSet: result.changeSet,
      baseResume: resume,
      finalizedResume: result.proposedResume,
      facts: [achievement, header],
      requirements: [requirement],
      checkedAt: NOW,
    });

    expect(result.changeSet.changes[0]).toMatchObject({ intent: "rewrite", after: "Built hiring workflows using Python APIs." });
    expect(deterministic.passed).toBe(true);
    expect(semantic.passed).toBe(true);
  });

  it("rejects invented leadership before a change set is stored", async () => {
    const achievement = verifiedFact({ id: "fact:achievement", key: "achievement", value: "Supported Python API delivery" });
    await expect(createResumeIntelligenceChangeSet({
      job,
      profileId: "profile:local",
      baseResume: baseResume(achievement.value as string),
      baseResumeVersionId: "resume-version:base",
      requirements: [requirement],
      facts: [achievement],
      provider: provider(modelOutput({ action: "rewrite", after: "Led Python API delivery." })),
      generatedAt: NOW,
    })).rejects.toMatchObject({ code: "UNSUPPORTED_REWRITE" } satisfies Partial<ResumeIntelligenceError>);
  });

  it("rejects unknown fact IDs and incomplete model coverage", async () => {
    const achievement = verifiedFact({ id: "fact:achievement", key: "achievement", value: "Built event-driven services" });
    await expect(createResumeIntelligenceChangeSet({
      job,
      profileId: "profile:local",
      baseResume: baseResume(achievement.value as string),
      baseResumeVersionId: "resume-version:base",
      requirements: [requirement],
      facts: [achievement],
      provider: provider(modelOutput({ factId: "fact:unknown" })),
      generatedAt: NOW,
    })).rejects.toMatchObject({ code: "INVALID_MODEL_PLAN" });

    await expect(createResumeIntelligenceChangeSet({
      job,
      profileId: "profile:local",
      baseResume: baseResume(achievement.value as string),
      baseResumeVersionId: "resume-version:base",
      requirements: [requirement],
      facts: [achievement],
      provider: provider({ requirementMatches: [], itemProposals: [] }),
      generatedAt: NOW,
    })).rejects.toMatchObject({ code: "INVALID_MODEL_PLAN" });

    const lowConfidence = modelOutput();
    lowConfidence.requirementMatches[0]!.confidence = 0.4;
    await expect(createResumeIntelligenceChangeSet({
      job,
      profileId: "profile:local",
      baseResume: baseResume(achievement.value as string),
      baseResumeVersionId: "resume-version:base",
      requirements: [requirement],
      facts: [achievement],
      provider: provider(lowConfidence),
      generatedAt: NOW,
    })).rejects.toMatchObject({ code: "INVALID_MODEL_PLAN" });
  });

  it("requires a server-side key for live resume optimization", () => {
    expect(() => GeminiResumeProvider.fromEnvironment({})).toThrowError(GeminiResumeError);
  });

  it("uses Gemini structured output through an injected client", async () => {
    const generate = vi.fn(async () => ({
      text: JSON.stringify({ requirementMatches: [], itemProposals: [] }),
      responseId: "response:mock",
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 8 },
    }));
    const client = new GeminiResumeProvider("gemini-test", generate);
    const result = await client.optimize({ job: { id: "job", title: "Role", company: "Co" }, requirements: [], facts: [], items: [] });

    expect(result).toMatchObject({ model: "gemini-test", responseId: "response:mock", inputTokens: 20, outputTokens: 8 });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      model: "gemini-test",
      config: expect.objectContaining({ responseMimeType: "application/json" }),
    }));
  });
});
