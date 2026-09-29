import { describe, expect, it, vi } from "vitest";
import { buildResumeDocument, createResumeArtifactManifest, verifyDocumentBuild } from "@resume-agent/document-build";
import { parseJobDescription } from "@resume-agent/jd-analysis";
import { extractResumeFacts, factReviewHash, reviewFact } from "@resume-agent/resume-import";
import { applyReviewedChanges, buildBaseResume, changeReviewHash, generateChangeSet, reviewChange } from "@resume-agent/resume-tailor";
import { trustedRenderEvidence } from "../../../packages/document-build/test/render-evidence";
import { applicationReadiness, type ReadinessInput } from "../lib/application-readiness";
import { verifiedAttachmentDocument } from "../lib/ats-attachment-document";
import { applicationTaskHref, resolveApplicationTaskId } from "../lib/application-links";
import { defaultDiscoveryConfig } from "../lib/discovery-model";
import { hashJson } from "../lib/hash";
import { readJdSource } from "../lib/jd-source";
import { emptyJobStore } from "../lib/job-store";
import { emptyProfileStore } from "../lib/profile-store";
import { DEFAULT_TEMPLATE_ID, emptyResumeStore } from "../lib/resume-store";

const NOW = "2026-09-19T12:00:00.000Z";
const TASK = "application:fixture";
function fixture(): ReadinessInput {
  const facts = extractResumeFacts({ profileId: "profile:local", source: {
    artifactId: "artifact:source", fileName: "fixture.txt", format: "plain_text", contentHash: "a".repeat(64), byteSize: 100,
  }, text: "Test Candidate\ntest@example.com\n\nSKILLS\nTypeScript", importedAt: NOW }).facts.map((fact) => reviewFact(fact, {
    decision: "verify", factId: fact.id, reviewedValueHash: factReviewHash(fact), verifiedBy: "user", decidedAt: NOW,
  }));
  const source = readJdSource("Requirements\n- Experience with TypeScript.");
  const job = { id: "job:fixture", company: "SIMULATED READINESS FIXTURE", title: "Software Engineer", location: "Ottawa",
    sourceUrl: "https://job-boards.greenhouse.io/fixture/jobs/1", descriptionArtifactId: source.artifactId,
    descriptionHash: source.contentHash, status: "active" as const, createdAt: NOW, updatedAt: NOW };
  const requirements = parseJobDescription({ jobId: job.id, source: { artifactId: source.artifactId, contentHash: source.contentHash, byteSize: source.byteSize }, text: source.text, parsedAt: NOW }).requirements;
  const base = buildBaseResume("profile:local", facts);
  const version = { id: "resume-version:base", profileId: "profile:local", templateId: DEFAULT_TEMPLATE_ID, resume: base.resume,
    contentHash: base.contentHash, status: "draft" as const, createdAt: NOW, updatedAt: NOW };
  const generated = generateChangeSet({ jobId: job.id, profileId: "profile:local", baseResume: base.resume, baseResumeVersionId: version.id, requirements, facts, generatedAt: NOW });
  return { checkedAt: NOW, profile: { ...emptyProfileStore(), facts }, jobs: { ...emptyJobStore(), jobs: [job], requirements },
    resumes: { ...emptyResumeStore(), versions: [version], changeSets: [generated.changeSet] },
    discovery: { version: 1, config: defaultDiscoveryConfig, runs: [], decisions: [], assessments: [], sourceSearch: null,
      jobs: [{ id: "candidate:fixture", provider: "greenhouse", board: "fixture", externalId: "1", company: job.company,
        title: job.title, location: job.location, url: job.sourceUrl, description: source.text, fingerprint: "b".repeat(64),
        firstSeenAt: NOW, lastSeenAt: NOW, sourceUpdatedAt: null, availability: "open", decision: "approved", decisionHash: "b".repeat(64) }],
      tasks: [{ id: TASK, candidateId: "candidate:fixture", approvedHash: "b".repeat(64), approvedAt: NOW, state: "needs_review",
        jobId: job.id, changeSetId: generated.changeSet.id, message: "Fixture proposals prepared", attemptId: null, leaseUntil: null, updatedAt: NOW }],
    },
  };
}
function review(input: ReadinessInput) {
  const cs = input.resumes.changeSets[0]!;
  input.resumes.reviews = cs.changes.map((change) => reviewChange(cs, { changeId: change.id, decision: "approved",
    reviewedChangeHash: changeReviewHash(change), decidedBy: "user:local", decidedAt: NOW }));
  return applyReviewedChanges(input.resumes.versions[0]!.resume, cs, input.resumes.reviews);
}
function approve(input: ReadinessInput) {
  const applied = review(input);
  const cs = input.resumes.changeSets[0]!;
  const version = { ...input.resumes.versions[0]!, id: "resume-version:approved", jobId: cs.jobId, changeSetId: cs.id,
    resume: applied.resume, contentHash: applied.contentHash, status: "user_approved" as const };
  input.resumes.versions.push(version);
  input.resumes.approvals.push({ id: "approval:fixture", resumeVersionId: version.id, profileId: version.profileId,
    jobId: cs.jobId, changeSetId: cs.id, changeSetHash: cs.contentHash, approvedContentHash: applied.contentHash,
    approvedPresentationHash: hashJson([version.templateId, applied.contentHash]), decidedBy: "user:local", decidedAt: NOW });
  return applied;
}
function documentFixture(input: ReadinessInput) {
  const applied = approve(input);
  const changeSet = input.resumes.changeSets[0]!;
  const approval = input.resumes.approvals[0]!;
  const doc = buildResumeDocument({ resumeVersionId: approval.resumeVersionId, profileId: approval.profileId, jobId: changeSet.jobId,
    templateId: DEFAULT_TEMPLATE_ID, resume: applied.resume, facts: input.profile.facts, changeSet, approval, builtAt: NOW });
  // Synthetic rendering evidence is test-only; no claim that LibreOffice rendered this fixture.
  const report = verifyDocumentBuild({ build: doc.build, bytes: doc.bytes, resume: applied.resume, facts: input.profile.facts,
    changeSet, approval, renderEvidence: trustedRenderEvidence(doc.build, NOW), checkedAt: NOW });
  input.resumes.builds.push(doc.build);
  input.resumes.buildReports.push(report);
  input.resumes.artifactManifests.push(createResumeArtifactManifest({ build: doc.build, report, approval, changeSet }));
  return doc.bytes;
}
const step = async (input: ReadinessInput, id: string) => (await applicationReadiness(TASK, input))!.steps.find((entry) => entry.id === id)!;

describe("read-only application readiness", () => {
  it("hands off the exact checked DOCX buffer with a safe name and bound artifact evidence", async () => {
    const input = fixture(); const bytes = documentFixture(input); const reader = vi.fn(async () => bytes);
    const result = await verifiedAttachmentDocument(TASK, input, reader);
    expect(reader).toHaveBeenCalledTimes(1); expect(result.bytes).toEqual(Buffer.from(bytes));
    expect(result.artifact).toMatchObject({ fileName: "resume.docx", buildId: input.resumes.builds[0]!.id, outputHash: input.resumes.builds[0]!.outputHash, byteSize: bytes.length });
    expect(JSON.stringify(result.artifact)).not.toMatch(/test@example|Test Candidate/);
  });
  it.each(["missing_task", "cancelled", "unlinked", "facts", "approval", "manifest", "render", "corrupt", "oversize"])("attachment refuses %s even if a previous document existed", async kind => {
    const input = fixture(); const bytes = documentFixture(input);
    if (kind === "cancelled") input.discovery.tasks[0]!.state = "cancelled";
    if (kind === "unlinked") input.discovery.tasks[0]!.changeSetId = null;
    if (kind === "facts") input.profile.facts = [];
    if (kind === "approval") input.resumes.approvals = [];
    if (kind === "manifest") input.resumes.artifactManifests = [];
    if (kind === "render") delete input.resumes.buildReports[0]!.renderEvidence;
    await expect(verifiedAttachmentDocument(kind === "missing_task" ? "other" : TASK, input, async () => kind === "corrupt" ? new Uint8Array([1]) : kind === "oversize" ? new Uint8Array(5_000_001) : bytes)).rejects.toThrow(/gates/);
  });
  it("round-trips encoded route IDs including colons and slashes", () => {
    const id = "application:greenhouse:fixture:job/1";
    const segment = applicationTaskHref(id).split("/").at(-1)!;
    expect(resolveApplicationTaskId([{ id }], segment)).toBe(id);
    expect(resolveApplicationTaskId([{ id }], id)).toBe(id);
  });
  it("prefers a literal stored percent-encoded ID over another task", () => {
    expect(resolveApplicationTaskId([{ id: "a%3Ab" }, { id: "a:b" }], "a%3Ab")).toBe("a%3Ab");
  });
  it.each(["application%253Afixture", "%invalid", "missing"])("does not infer a task from %s", (segment) => {
    expect(resolveApplicationTaskId([{ id: TASK }], segment)).toBeNull();
  });
  it("returns no task instead of falling back to the globally active resume", async () => {
    expect(await applicationReadiness("missing", fixture())).toBeNull();
  });
  it.each(["closed", "changed", "cancelled", "reapproval", "unapproved", "decision_hash", "removed"])("blocks %s posting approval", async (kind) => {
    const input = fixture();
    if (kind === "closed") input.discovery.jobs[0]!.availability = "closed";
    if (kind === "changed") input.discovery.jobs[0]!.fingerprint = "c".repeat(64);
    if (kind === "cancelled") input.discovery.tasks[0]!.state = "cancelled";
    if (kind === "reapproval") input.discovery.tasks[0]!.state = "needs_reapproval";
    if (kind === "unapproved") input.discovery.jobs[0]!.decision = "saved";
    if (kind === "decision_hash") input.discovery.jobs[0]!.decisionHash = null;
    if (kind === "removed") input.discovery.jobs = [];
    expect((await step(input, "posting")).status).toBe("blocked");
    expect((await applicationReadiness(TASK, input))!.resumeUrl).toBeNull();
  });
  it("explains missing generation without spending a key or mutating state", async () => {
    const input = fixture(); input.discovery.tasks[0]!.changeSetId = null;
    const before = JSON.stringify(input); const reader = vi.fn();
    expect((await applicationReadiness(TASK, input, reader))!.steps[1]!.status).toBe("action_required");
    expect(reader).not.toHaveBeenCalled(); expect(JSON.stringify(input)).toBe(before);
  });
  it.each(["job", "change_set", "base", "description", "url", "title", "inactive"])("refuses mismatched %s linkage", async (kind) => {
    const input = fixture();
    if (kind === "job") input.discovery.tasks[0]!.jobId = "job:other";
    if (kind === "change_set") input.resumes.changeSets[0]!.jobId = "job:other";
    if (kind === "base") input.resumes.versions = [];
    if (kind === "description") input.jobs.jobs[0]!.descriptionHash = "c".repeat(64);
    if (kind === "url") input.jobs.jobs[0]!.sourceUrl = "https://example.com/other";
    if (kind === "title") input.jobs.jobs[0]!.title = "Different role";
    if (kind === "inactive") input.jobs.jobs[0]!.status = "closed";
    expect((await step(input, "resume")).status).toBe("blocked");
  });
  it("requires sentence decisions and never trusts the task label alone", async () => {
    const input = fixture();
    expect((await step(input, "review")).status).toBe("action_required");
    expect((await applicationReadiness(TASK, input))!.downloadUrl).toBeNull();
    review(input);
    expect((await step(input, "review")).status).toBe("passed");
    expect((await step(input, "approval")).status).toBe("action_required");
  });
  it("refuses stale sentence decisions", async () => {
    const input = fixture(); review(input); input.resumes.reviews[0]!.reviewedChangeHash = "c".repeat(64);
    expect((await step(input, "review")).status).toBe("blocked");
  });
  it.each(["facts", "requirements", "verification"])("rechecks changed %s instead of trusting old approval", async (kind) => {
    const input = fixture(); approve(input);
    if (kind === "facts") input.profile.facts[0]!.value = "Another Candidate";
    if (kind === "requirements") input.jobs.requirements[0]!.text = "Different requirement";
    if (kind === "verification") {
      const original = input.profile.facts[0]!;
      if (original.status !== "verified") throw new Error("Expected verified fixture");
      const { verification: _verification, ...pending } = original;
      input.profile.facts[0] = { ...pending, status: "pending" };
    }
    expect((await step(input, "claims")).status).toBe("blocked");
  });
  it.each(["hash", "version", "wording", "presentation", "job"])("refuses changed approval %s", async (kind) => {
    const input = fixture(); approve(input);
    if (kind === "hash") input.resumes.approvals[0]!.approvedContentHash = "c".repeat(64);
    if (kind === "version") input.resumes.versions.pop();
    if (kind === "wording") input.resumes.versions[1]!.resume = { ...input.resumes.versions[1]!.resume, headerFactIds: [] };
    if (kind === "presentation") input.resumes.approvals[0]!.approvedPresentationHash = "c".repeat(64);
    if (kind === "job") input.resumes.approvals[0]!.jobId = "job:other";
    expect((await step(input, "approval")).status).toBe("blocked");
  });
  it("distinguishes approved content from a built document", async () => {
    const input = fixture(); approve(input);
    expect((await step(input, "approval")).status).toBe("passed");
    expect((await step(input, "document")).status).toBe("action_required");
  });
  it("verifies the exact local document but still never enables submission", async () => {
    const input = fixture(); const bytes = documentFixture(input); const before = JSON.stringify(input);
    const view = (await applicationReadiness(TASK, input, async () => bytes))!;
    expect(view.steps.slice(0, 6).map((s) => s.status)).toEqual(Array(6).fill("passed"));
    expect(view.documentVerified).toBe(true); expect(view.downloadUrl).toContain("buildId=");
    expect(view.canSubmit).toBe(false); expect(view.steps[6]!.status).toBe("unavailable");
    expect(JSON.stringify(input)).toBe(before);
  });
  it.each(["missing", "corrupt", "manifest", "render", "report"])("fails closed for %s artifact evidence", async (kind) => {
    const input = fixture(); const bytes = documentFixture(input);
    if (kind === "manifest") input.resumes.artifactManifests[0]!.manifestHash = "c".repeat(64);
    if (kind === "render") delete input.resumes.buildReports[0]!.renderEvidence;
    if (kind === "report") input.resumes.buildReports[0]!.passed = false;
    const reader = vi.fn(async () => { if (kind === "missing") throw new Error("missing"); return kind === "corrupt" ? new Uint8Array([1, 2]) : bytes; });
    const view = (await applicationReadiness(TASK, input, reader))!;
    expect(view.steps[5]!.status).toBe("blocked"); expect(view.downloadUrl).toBeNull();
    if (["manifest", "render", "report"].includes(kind)) expect(reader).not.toHaveBeenCalled();
  });
});
