import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Fact } from "@resume-agent/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../app/api/agent/fill-plan/route";
import { decideJob } from "../lib/application-agent";
import { generateAtsAnswerPlan, reviewAtsAnswer } from "../lib/ats-answer-plan";
import { readAtsAnswerStore, updateAtsAnswerStore, type AtsAnswerPlan } from "../lib/ats-answer-store";
import { reconcileGreenhouseDom, type observeApplicationPage } from "../lib/ats-dom-observation";
import { atsFillPayload, buildAtsFillPlan, deleteAtsFillPlan, projectAtsFillRows, reviewAtsFillPlan } from "../lib/ats-fill-plan";
import { readAtsFillStore, updateAtsFillStore } from "../lib/ats-fill-plan-store";
import { parseGreenhouseForm } from "../lib/ats-form-inspection";
import { readDiscoveryStore, updateDiscoveryStore } from "../lib/discovery-store";
import { normalizeDiscoveredJob } from "../lib/job-discovery";
import { readProfileStore, updateProfileStore } from "../lib/profile-store";

const NOW = "2026-09-20T12:00:00.000Z";
const candidate = normalizeDiscoveredJob({ provider: "greenhouse", board: "fixture", company: "SIMULATED PLAN TEST" }, { id: "17", title: "Software Engineer", location: "Ottawa", url: "https://job-boards.greenhouse.io/fixture/jobs/17", description: "Python tools" }, NOW);
const form = parseGreenhouseForm({ id: 17, title: candidate.title, location: { name: candidate.location }, absolute_url: candidate.url, content: candidate.description,
  questions: [{ label: "Describe a project", required: true, fields: [{ name: "question_1", type: "textarea" }] },
    { label: "First Name", required: true, fields: [{ name: "first_name", type: "input_text" }] }],
}, candidate, `application:${candidate.id}`, NOW);
const fact: Fact = { id: "fact:project", value: "Built Python tools.", sensitivity: "normal", kind: "project", key: "project", profileId: "profile:local", status: "verified",
  verification: { verifiedBy: "user", verifiedAt: NOW }, sources: [{ artifactId: "artifact:fixture", locator: "line:1", excerpt: "Built Python tools." }], version: 1, createdAt: NOW, updatedAt: NOW };
const provider = async () => ({ output: { answers: [{ questionId: "application:0", text: "Built Python tools.", factIds: [fact.id], confidence: 0.99 }] }, model: "SIMULATED" });
const inspect = async () => structuredClone(form);
type Observation = Awaited<ReturnType<typeof observeApplicationPage>>;
function observation(): Observation {
  const snapshot = { url: candidate.url, observedAt: new Date(Date.now()).toISOString(), structureHash: "d".repeat(64), blockedRequests: 1, signals: ["restricted_network_partial_view"], canFill: false as const, canSubmit: false as const,
    controls: [{ ref: "dom:0", id: "question_1", name: "", label: "Describe a project", tag: "textarea", type: "textarea", required: true, visible: true, disabled: false, optionLabels: [] }] };
  return { taskId: form.taskId, fingerprint: candidate.fingerprint, schemaHash: form.schemaHash, snapshot, ...reconcileGreenhouseDom(form, snapshot), canFill: false, canSubmit: false };
}

describe("reviewed-answer fill previews", () => {
  let directory: string; let answers: AtsAnswerPlan;
  const observer = vi.fn(async () => observation());
  const build = () => buildAtsFillPlan(form.taskId, candidate.fingerprint, form.schemaHash, observer);
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "ats-fill-test-")); vi.stubEnv("RESUME_AGENT_DATA_DIR", directory);
    vi.stubEnv("GEMINI_API_KEY", " "); vi.stubEnv("GOOGLE_API_KEY", " "); observer.mockReset(); observer.mockImplementation(async () => observation());
    await updateDiscoveryStore(s => ({ ...s, jobs: [structuredClone(candidate)] })); await decideJob(candidate.id, candidate.fingerprint, "approved");
    await updateProfileStore(s => ({ ...s, facts: [structuredClone(fact)] }));
    answers = await generateAtsAnswerPlan(form.taskId, candidate.fingerprint, form.schemaHash, provider, inspect);
    answers = await reviewAtsAnswer(answers.id, answers.planHash, "application:0", "approved", inspect);
  });
  afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
  it("saves exact approved wording and targets, retaining manual questions and no execution authority", async () => {
    const before = await readDiscoveryStore(); const plan = await build();
    expect(observer).toHaveBeenCalledExactlyOnceWith(form.taskId, candidate.fingerprint, form.schemaHash);
    expect(JSON.stringify(observer.mock.calls)).not.toContain("Built Python tools");
    expect(plan.rows[0]).toMatchObject({ status: "planned", text: "Built Python tools.", target: { id: "question_1", tag: "textarea" } });
    expect(plan.rows[1]).toMatchObject({ status: "manual", text: null, target: null, factIds: [] });
    const payload = await atsFillPayload(form.taskId, form.schemaHash);
    expect(payload).toMatchObject({ staleReason: null, canApprovePreview: true, canFill: false, canUpload: false, canSubmit: false });
    expect(payload.plan).toEqual(plan); expect(await readDiscoveryStore()).toEqual(before);
  });
  it("rereads the browser before recording preview review and reloads history without a browser", async () => {
    const plan = await build(); const approved = await reviewAtsFillPlan(plan.id, plan.planHash, "approved", observer);
    expect(approved.reviews.at(-1)!.decision).toBe("approved"); expect(observer).toHaveBeenCalledTimes(2);
    expect((await atsFillPayload(form.taskId, form.schemaHash)).plan!.reviews).toEqual(approved.reviews);
    expect(observer).toHaveBeenCalledTimes(2); expect((await readAtsFillStore()).plans[0]!.planHash).toBe(plan.planHash);
  });
  it.each(["missing", "pending", "rejected"])("rejects %s answers before browser work", async kind => {
    await updateAtsAnswerStore(s => ({ ...s, plans: kind === "missing" ? [] : s.plans.map(p => ({ ...p, reviews: kind === "pending" ? [] : [{ questionId: "application:0", decision: "rejected" as const, decidedAt: NOW }] })) }));
    await expect(build()).rejects.toThrow(/answer|Approve/); expect(observer).not.toHaveBeenCalled();
  });
  it.each(["profile", "posting", "answer_review", "regenerated", "answer_deleted"])("invalidates a saved preview after %s changes", async kind => {
    const plan = await build(); observer.mockClear();
    if (kind === "profile") await updateProfileStore(s => ({ ...s, facts: [{ ...fact, value: "Built Java tools." }] }));
    if (kind === "posting") await decideJob(candidate.id, candidate.fingerprint, "saved");
    if (kind === "answer_review") await reviewAtsAnswer(answers.id, answers.planHash, "application:0", "rejected", inspect);
    if (kind === "regenerated") await generateAtsAnswerPlan(form.taskId, candidate.fingerprint, form.schemaHash, provider, inspect);
    if (kind === "answer_deleted") await updateAtsAnswerStore(s => ({ ...s, plans: [] }));
    expect((await atsFillPayload(form.taskId, form.schemaHash)).canApprovePreview).toBe(false);
    await expect(reviewAtsFillPlan(plan.id, plan.planHash, "approved", observer)).rejects.toThrow(); expect(observer).not.toHaveBeenCalled();
  });
  it.each(["reviews", "profile", "approval"])("does not save after %s changes during observation", async kind => {
    observer.mockImplementation(async () => {
      if (kind === "reviews") await reviewAtsAnswer(answers.id, answers.planHash, "application:0", "rejected", inspect);
      if (kind === "profile") await updateProfileStore(s => ({ ...s, facts: [] }));
      if (kind === "approval") await decideJob(candidate.id, candidate.fingerprint, "saved");
      return observation();
    });
    await expect(build()).rejects.toThrow(); expect((await readAtsFillStore()).plans).toEqual([]);
  });
  it.each(["captcha_or_access_check", "login_or_mfa", "unobserved_frames", "dom_changed_during_observation", "presentation_assets_incomplete", "unknown_safety_signal", "offline_widget_probe_not_fill_evidence"])("blocks preview approval for %s", async signal => {
    observer.mockImplementation(async () => { const o = observation(); o.snapshot.signals = [signal]; return o; });
    const plan = await build(); expect(plan.blockers).toContain(signal);
    expect((await atsFillPayload(form.taskId, form.schemaHash)).canApprovePreview).toBe(false);
    await expect(reviewAtsFillPlan(plan.id, plan.planHash, "approved", observer)).rejects.toThrow(/blockers/);
  });
  it.each(["ambiguous", "missing", "needs_review"] as const)("never plans %s correspondence", async status => {
    observer.mockImplementation(async () => { const o = observation(); o.questions[0]!.fields[0]!.status = status; return o; });
    const plan = await build(); expect(plan.rows[0]!.text).toBeNull(); expect(plan.blockers).toContain("no_corresponding_approved_answers");
  });
  it.each(["file", "submit", "combobox", "email", "hidden", "password"])("keeps %s controls out even if supplied as corresponding", type => {
    const o = observation(); o.snapshot.controls[0]!.tag = "input"; o.snapshot.controls[0]!.type = type;
    expect(projectAtsFillRows(answers, o)[0]!.status).toBe("manual");
  });
  it("does not reuse a shared control or mismatched question label", () => {
    const o = observation(); o.questions[1]!.fields[0]!.controls = ["dom:0"];
    expect(projectAtsFillRows(answers, o)[0]!.status).toBe("manual");
    const other = observation(); other.questions[0]!.label = "Different question";
    expect(projectAtsFillRows(answers, other)[0]!.text).toBeNull();
  });
  it.each(["task", "schema", "age", "future"])("refuses mismatched %s observation evidence", async kind => {
    observer.mockImplementation(async () => {
      const o = observation(); if (kind === "task") o.taskId = "other"; if (kind === "schema") o.schemaHash = "f".repeat(64);
      if (kind === "age") o.snapshot.observedAt = new Date(Date.now() - 300000).toISOString();
      if (kind === "future") o.snapshot.observedAt = new Date(Date.now() + 120000).toISOString(); return o;
    });
    await expect(build()).rejects.toThrow(); expect((await readAtsFillStore()).plans).toHaveLength(0);
  });
  it("refuses changed DOM structure or new limitations during approval", async () => {
    const plan = await build(); observer.mockImplementation(async () => { const o = observation(); o.snapshot.structureHash = "e".repeat(64); return o; });
    await expect(reviewAtsFillPlan(plan.id, plan.planHash, "approved", observer)).rejects.toThrow(/page or plan/);
    observer.mockImplementation(async () => { const o = observation(); o.snapshot.signals.push("unobserved_frames"); return o; });
    await expect(reviewAtsFillPlan(plan.id, plan.planHash, "approved", observer)).rejects.toThrow(/page or plan/);
    expect((await readAtsFillStore()).plans[0]!.reviews).toEqual([]);
  });
  it("does not approve if an answer is rejected during the fresh browser check", async () => {
    const plan = await build(); observer.mockImplementation(async () => { await reviewAtsAnswer(answers.id, answers.planHash, "application:0", "rejected", inspect); return observation(); });
    await expect(reviewAtsFillPlan(plan.id, plan.planHash, "approved", observer)).rejects.toThrow(/changed/);
    expect((await readAtsFillStore()).plans[0]!.reviews).toEqual([]);
  });
  it("never overwrites a newer rejection with a slower approval", async () => {
    const plan = await build(); observer.mockImplementation(async () => { await reviewAtsFillPlan(plan.id, plan.planHash, "rejected", observer); return observation(); });
    await expect(reviewAtsFillPlan(plan.id, plan.planHash, "approved", observer)).rejects.toThrow(/reviewed while/);
    expect((await readAtsFillStore()).plans[0]!.reviews.at(-1)!.decision).toBe("rejected");
  });
  it("expires after five minutes but still permits local rejection and deletion", async () => {
    const plan = await build(); vi.spyOn(Date, "now").mockReturnValue(Date.parse(plan.expiresAt)); observer.mockClear();
    expect((await atsFillPayload(form.taskId, form.schemaHash)).staleReason).toMatch(/expired/);
    await expect(reviewAtsFillPlan(plan.id, plan.planHash, "approved", observer)).rejects.toThrow(/expired/);
    await reviewAtsFillPlan(plan.id, plan.planHash, "rejected", observer); expect(observer).not.toHaveBeenCalled();
    await deleteAtsFillPlan(plan.id, plan.planHash); expect((await readAtsFillStore()).plans).toEqual([]);
  });
  it("rejects altered plan content after store reload", async () => {
    const plan = await build(); await updateAtsFillStore(s => { s.plans[0]!.rows[0]!.text = "Unsupported changes"; return s; });
    await expect(reviewAtsFillPlan(plan.id, plan.planHash, "approved", observer)).rejects.toThrow(/hash/);
    expect((await atsFillPayload(form.taskId, form.schemaHash)).canApprovePreview).toBe(false);
  });
  it("rebuilds explicitly and keeps previous plans after failed rebuilds", async () => {
    const first = await build(); const second = await build(); expect(second.id).not.toBe(first.id);
    await expect(reviewAtsFillPlan(first.id, first.planHash, "approved", observer)).rejects.toThrow(/replaced/);
    observer.mockRejectedValue(new Error("PRIVATE_TRANSPORT_ERROR")); await expect(build()).rejects.toThrow(/failed safely/);
    expect((await readAtsFillStore()).plans.map(p => p.id)).toEqual([second.id]);
  });
  it("serializes builds per task", async () => {
    let release!: () => void; observer.mockImplementation(async () => { await new Promise<void>(r => { release = r; }); return observation(); });
    const pending = build(); await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await expect(build()).rejects.toThrow(/already/); release(); await pending;
  });
  it("strictly validates API origin/commands and only deletes the selected local preview", async () => {
    const plan = await build(); const beforeAnswers = await readAtsAnswerStore(); const beforeProfile = await readProfileStore();
    const request = (body: unknown, origin = "http://127.0.0.1:3000") => new Request("http://localhost:3000/api/agent/fill-plan", { method: "POST", headers: { origin, host: "127.0.0.1:3000" }, body: JSON.stringify(body) });
    const command = { action: "delete", planId: plan.id, planHash: plan.planHash };
    expect((await POST(request(command, "https://evil.test"))).status).toBe(403);
    for (const extra of [{ answers: [] }, { selector: "#submit" }, { targetUrl: "http://127.0.0.1" }, { submit: true }]) expect((await POST(request({ ...command, ...extra }))).status).toBe(400);
    expect((await POST(request({ ...command, action: "execute" }))).status).toBe(400);
    const response = await GET(new Request(`http://localhost/api/agent/fill-plan?${new URLSearchParams({ taskId: form.taskId, schemaHash: form.schemaHash })}`));
    expect(response.headers.get("Cache-Control")).toBe("no-store"); expect((await response.json()).plan.id).toBe(plan.id);
    expect((await POST(request(command))).status).toBe(200); expect((await readAtsFillStore()).plans).toEqual([]);
    expect(await readAtsAnswerStore()).toEqual(beforeAnswers); expect(await readProfileStore()).toEqual(beforeProfile);
  });
});
