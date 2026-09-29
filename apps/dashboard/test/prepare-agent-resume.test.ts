import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Fact } from "@resume-agent/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideJob, prepareApplication } from "../lib/application-agent";
import { updateDiscoveryStore } from "../lib/discovery-store";
import { fetchBoard } from "../lib/job-discovery";
import { updateJobStore } from "../lib/job-store";
import { generateGeminiResume, importDiscoveredJob } from "../lib/prepare-agent-resume";
import { updateProfileStore } from "../lib/profile-store";
import type { ResumeIntelligenceProvider, ResumeModelRequest, ResumeModelResult } from "../lib/resume-intelligence";
import { readResumeStore } from "../lib/resume-store";

const now = "2026-09-18T12:00:00.000Z";
function fact(id: string, kind: Fact["kind"], key: string, value: string): Fact {
  return { id, profileId: "profile:local", kind, key, value, sensitivity: kind === "identity" ? "pii" : "normal",
    sources: [{ artifactId: "artifact:test", locator: "line:1", excerpt: value }], version: 1,
    createdAt: now, updatedAt: now, status: "verified", verification: { verifiedBy: "user", verifiedAt: now } };
}
function provider(duringGeneration?: () => Promise<unknown>): ResumeIntelligenceProvider {
  return { optimize: vi.fn(async (request: ResumeModelRequest): Promise<ResumeModelResult> => {
    await duringGeneration?.();
    return { provider: "gemini", model: "test-only", output: {
      requirementMatches: request.requirements.map((r) => ({ requirementId: r.id, factIds: ["fact:python"],
        strength: "exact", confidence: 0.99, rationale: "Verified Python skill." })),
      itemProposals: request.items.map((item) => ({ targetItemId: item.id, action: "keep", after: null,
        requirementIds: request.requirements.map((r) => r.id), confidence: 0.99, rationale: "Keep verified skill." })),
    } };
  }) };
}
async function candidate() {
  return (await fetchBoard({ provider: "greenhouse", board: "fixture", company: "Fixture" }, async () => new Response(JSON.stringify({
    jobs: [{ id: 1, title: "Software Engineer", location: { name: "Ottawa, Ontario" },
      absolute_url: "https://job-boards.greenhouse.io/fixture/jobs/1", content: "<h2>Requirements</h2><p>Experience with Python.</p>" }], meta: { total: 1 },
  }))))[0]!;
}

describe("approved job to persisted resume review integration", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "agent-resume-integration-"));
    vi.stubEnv("RESUME_AGENT_DATA_DIR", directory);
    await updateProfileStore((store) => ({ ...store, facts: [
      fact("fact:name", "identity", "name", "Test Candidate"), fact("fact:python", "skill", "skill.python", "Python"),
    ] }));
  });
  afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

  it("persists the exact handoff and both claim reports without auto-approving content", async () => {
    const posting = await candidate();
    await updateDiscoveryStore((store) => ({ ...store, jobs: [posting] }));
    const approved = await decideJob(posting.id, posting.fingerprint, "approved");
    const model = provider();
    const deps = { importJob: importDiscoveredJob, generate: async (jobId: string) => {
      const result = await generateGeminiResume(jobId, model);
      return { changeSetId: result.intelligence.changeSet.id, passed: result.guard.passed && result.semanticGuard.passed };
    } };
    const prepared = await prepareApplication(approved.tasks[0]!.id, deps);
    const task = prepared.tasks[0]!;
    const stored = await readResumeStore();
    expect(task.state).toBe("needs_review");
    expect(stored.changeSets).toHaveLength(1);
    expect(stored.changeSets[0]).toMatchObject({ id: task.changeSetId, jobId: task.jobId });
    expect(stored.guardReports[0]).toMatchObject({ changeSetId: task.changeSetId, passed: true });
    expect(stored.semanticGuardReports[0]).toMatchObject({ changeSetId: task.changeSetId, passed: true });
    expect(stored.approvals).toEqual([]);
    expect(stored.builds).toEqual([]);
    expect(JSON.stringify(vi.mocked(model.optimize).mock.calls)).not.toContain("Test Candidate");
    await prepareApplication(task.id, deps);
    expect(model.optimize).toHaveBeenCalledTimes(1);
  });

  it.each(["profile", "requirements"])("refuses to publish after %s evidence changes during generation", async (target) => {
    const jobId = await importDiscoveredJob(await candidate());
    const model = provider(async () => {
      if (target === "profile") await updateProfileStore((store) => ({ ...store, facts: store.facts.map((f) => f.id === "fact:python" ? { ...f, value: "SQL", version: 2 } : f) }));
      else await updateJobStore((store) => ({ ...store, requirements: store.requirements.map((r) => ({ ...r, priority: "preferred" })) }));
    });
    await expect(generateGeminiResume(jobId, model)).rejects.toMatchObject({ code: "stale_evidence" });
    expect((await readResumeStore()).changeSets).toEqual([]);
  });
});
