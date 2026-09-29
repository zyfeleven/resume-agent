import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GreenhouseDomSnapshot, ObservedControl } from "@resume-agent/browser-runner/greenhouse-observer";
import { POST } from "../app/api/agent/observe/route";
import { observeApplicationPage, probeApplicationResumeWidget, reconcileGreenhouseDom } from "../lib/ats-dom-observation";
import type { AtsFormInspection } from "../lib/ats-form-inspection";
import { fetchBoard, normalizeDiscoveredJob } from "../lib/job-discovery";
import { inspectApplicationForm } from "../lib/ats-form-inspection";
import { decideJob } from "../lib/application-agent";
import { readDiscoveryStore, updateDiscoveryStore } from "../lib/discovery-store";
import { ResumeWidgetProbeError } from '@resume-agent/browser-runner/greenhouse-widget-probe';

const time = "2026-09-20T00:00:00.000Z";
const url = "https://job-boards.greenhouse.io/fixture/jobs/17";
const candidate = () => normalizeDiscoveredJob({ provider: "greenhouse", board: "fixture", company: "SIMULATED DOM FIXTURE" }, { id: "17", title: "Software Engineer", location: "Ottawa", url, description: "Python experience." }, time);
const control = (override: Partial<ObservedControl> = {}): ObservedControl => ({ ref: "dom:0", id: "first_name", name: "job_application[first_name]", label: "First name *", tag: "input", type: "text", required: true, disabled: false, visible: true, optionLabels: [], ...override });
const snapshot = (): GreenhouseDomSnapshot => ({ url, observedAt: time, controls: [control()], signals: [], structureHash: "d".repeat(64), blockedRequests: 0, canFill: false, canSubmit: false });
const form = (taskId = "task"): AtsFormInspection => ({ taskId, candidateId: candidate().id, postingFingerprint: candidate().fingerprint, checkedAt: time, schemaHash: "a".repeat(64), notices: [], source: "greenhouse_public_api", requiredQuestionCount: 1, canFill: false, canSubmit: false,
  questions: [{ id: "application:0", label: "First name", description: null, required: true, section: "application", fields: [{ name: "first_name", type: "input_text", knownType: true, options: [] }] }] });

describe("public schema to DOM correspondence", () => {
  const status = (s: GreenhouseDomSnapshot) => reconcileGreenhouseDom(form(), s).questions[0]!.fields[0]!.status;
  it("requires exact unique identity, label, type and required flags", () => expect(status(snapshot())).toBe("corresponding"));
  it("never guesses from labels when identifiers differ", () => expect(status({ ...snapshot(), controls: [control({ id: "other", name: "other" })] })).toBe("missing"));
  it("keeps duplicated identifiers ambiguous", () => expect(status({ ...snapshot(), controls: [control(), control({ ref: "dom:1" })] })).toBe("ambiguous"));
  it("does not map one DOM control to two public questions", () => {
    const f = form(); f.questions.push({ ...f.questions[0]!, id: "application:1", fields: [{ name: "email", type: "input_text", knownType: true, options: [] }] });
    const result = reconcileGreenhouseDom(f, { ...snapshot(), controls: [control({ name: "email" })] });
    expect(result.questions.map(q => q.fields[0]!.status)).toEqual(["ambiguous", "ambiguous"]);
  });
  it.each([{ label: "Password" }, { type: "password" }, { required: false }, { visible: false }, { disabled: true }, { type: "combobox" }])("requires manual reconciliation for %o", change => expect(status({ ...snapshot(), controls: [control(change)] })).toBe("needs_review"));
  it("does not infer required alternative inputs or hidden fields", () => {
    const f = form(); f.questions[0]!.fields.push({ name: "alternative", type: "textarea", knownType: true, options: [] });
    expect(reconcileGreenhouseDom(f, snapshot()).questions[0]!.fields[0]!.status).toBe("needs_review");
  });
  it("exposes unmatched submit and required controls as unmapped only", () => {
    const result = reconcileGreenhouseDom(form(), { ...snapshot(), controls: [control(), control({ id: "submit", name: "submit", ref: "dom:1", label: "Submit", tag: "button", type: "submit" })] });
    expect(result.extraControls).toEqual([{ ref: "dom:1", label: "Submit", type: "submit", required: true }]);
  });
  const resumeForm = () => ({ ...form(), questions: [{ ...form().questions[0]!, label: "Resume", fields: [{ name: "resume", type: "input_file", knownType: true, options: [] }] }] });
  const uploadControl = () => control({ id: "resume", name: "resume", label: "Resume", type: "file", upload: { accept: [".docx"], multiple: false, directory: false, group: null } });
  it("explains visually hidden Attach controls and unmounted text alternatives without granting correspondence", () => {
    const f = resumeForm(); f.questions[0]!.fields.push({ name: "resume_text", type: "textarea", knownType: true, options: [] });
    const c = uploadControl(); c.label = "Attach"; c.visible = false;
    c.upload!.group = { label: "Resume", labelStatus: "explicit", fieldIds: ["resume"], triggerTargets: ["resume", "resume_text"] };
    const fields = reconcileGreenhouseDom(f, { ...snapshot(), controls: [c] }).questions[0]!.fields;
    expect(fields[0]).toMatchObject({ status: "needs_review", controls: [c.ref] });
    expect(fields[0]!.reason).toContain("visually hidden or clipped");
    expect(fields[0]!.reason).toContain("Named upload group: Resume");
    expect(fields[0]!.reason).toContain("no empty-text check");
    expect(fields[1]).toMatchObject({ status: "missing", controls: [] });
    expect(fields[1]!.reason).toContain("not mounted");
  });
  it.each(["multiple", "directory", "pdf", "ambiguous_group", "different_group"])("routes unsupported upload metadata to manual handling: %s", kind => {
    const c = uploadControl();
    if (kind === "multiple") c.upload!.multiple = true;
    if (kind === "directory") c.upload!.directory = true;
    if (kind === "pdf") c.upload!.accept = [".pdf"];
    if (kind.endsWith("group")) c.upload!.group = { label: kind === "different_group" ? "Cover letter" : "", labelStatus: kind === "different_group" ? "explicit" : "ambiguous", fieldIds: ["resume"], triggerTargets: ["resume"] };
    const field = reconcileGreenhouseDom(resumeForm(), { ...snapshot(), controls: [c] }).questions[0]!.fields[0]!;
    expect(field.status).toBe("needs_review");
    expect(field.reason).toContain("manual handling");
  });
  it("keeps matching native-file evidence observational, not authority", () => {
    const c = uploadControl(); c.upload!.accept = [".PDF", ".DOCX"];
    c.upload!.group = { label: "Resume", labelStatus: "explicit", fieldIds: ["resume"], triggerTargets: ["resume"] };
    const field = reconcileGreenhouseDom(resumeForm(), { ...snapshot(), controls: [c] }).questions[0]!.fields[0]!;
    expect(field.status).toBe("corresponding");
    expect(field.reason).toContain("no filling is authorized");
    expect(field.reason).toContain("does not replace");
  });
});

describe("approved task browser orchestration", () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "ats-dom-test-")); vi.stubEnv("RESUME_AGENT_DATA_DIR", directory); });
  afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
  async function setup() {
    const job = candidate(); await updateDiscoveryStore(s => ({ ...s, jobs: [job] }));
    const task = (await decideJob(job.id, job.fingerprint, "approved")).tasks[0]!;
    return { task, observer: vi.fn(async () => snapshot()), inspect: vi.fn(async () => form(task.id)) };
  }
  function probeForm(taskId: string) {
    const f = form(taskId); f.questions = [{ ...f.questions[0]!, label: 'Resume', fields: [
      { name: 'resume', type: 'input_file', knownType: true, options: [] }, { name: 'resume_text', type: 'textarea', knownType: true, options: [] } ] }]; return f;
  }
  it('probes only the approved grouped schema with separate consent and two public checks', async () => {
    const { task } = await setup(); const inspect = vi.fn(async () => probeForm(task.id));
    const probe = vi.fn(async () => ({ ...snapshot(), signals: ['offline_widget_probe_not_fill_evidence'] }));
    const before = await readDiscoveryStore();
    const result = await probeApplicationResumeWidget(task.id, task.approvedHash, form().schemaHash, true, probe, inspect);
    expect(probe).toHaveBeenCalledExactlyOnceWith('fixture', '17', true); expect(inspect).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ offlineWidgetProbe: true, canFill: false, canSubmit: false });
    expect(await readDiscoveryStore()).toEqual(before);
  });
  it.each(['no_consent', 'ungrouped', 'shared', 'unknown'])('refuses %s before widget activation', async kind => {
    const { task } = await setup(); const f = probeForm(task.id); const probe = vi.fn(async () => snapshot());
    if (kind === 'ungrouped') f.questions[0]!.fields.pop();
    if (kind === 'shared') f.questions.push({ ...f.questions[0]!, id: 'other', label: 'Other' });
    if (kind === 'unknown') f.questions[0]!.fields[0]!.knownType = false;
    await expect(probeApplicationResumeWidget(task.id, task.approvedHash, form().schemaHash, (kind !== 'no_consent') as true, probe, async () => f)).rejects.toThrow();
    expect(probe).not.toHaveBeenCalled();
  });
  it('discards probe results when approval changes during the temporary session', async () => {
    const { task } = await setup(); const probe = async () => { await updateDiscoveryStore(s => { s.tasks[0]!.state = 'cancelled'; return s; }); return snapshot(); };
    await expect(probeApplicationResumeWidget(task.id, task.approvedHash, form().schemaHash, true, probe, async () => probeForm(task.id))).rejects.toThrow();
  });
  it('exposes only typed fixed-stage probe failures, never raw browser errors', async () => {
    const { task } = await setup();
    await expect(probeApplicationResumeWidget(task.id, task.approvedHash, form().schemaHash, true, async () => { throw new ResumeWidgetProbeError('Offline inspection stopped (revealed control).'); }, async () => probeForm(task.id))).rejects.toThrow(/revealed control/);
    await expect(probeApplicationResumeWidget(task.id, task.approvedHash, form().schemaHash, true, async () => { throw new Error('SECRET_BROWSER_ERROR'); }, async () => probeForm(task.id))).rejects.toThrow(/could not finish safely/);
  });
  it.each([
    { action: 'probe_resume_widget' }, { action: 'probe_resume_widget', confirmOfflineSwitch: false },
    { confirmOfflineSwitch: true }, { action: 'probe_resume_widget', confirmOfflineSwitch: true, selector: '#submit' },
  ])('requires a closed explicit probe command: %j', async extra => {
    const response = await POST(new Request('http://localhost/api/agent/observe', { method: 'POST', headers: { Origin: 'http://localhost' }, body: JSON.stringify({ taskId: 'task', fingerprint: 'a'.repeat(64), schemaHash: 'b'.repeat(64), ...extra }) }));
    expect(response.status).toBe(400);
  });
  it.skipIf(process.env.RESUME_AGENT_LIVE_DOM !== "1")("reads a real public posting and browser DOM with isolated approval records only", async () => {
    const jobs = await fetchBoard({ provider: "greenhouse", board: "spaceium", company: "READ-ONLY ACCEPTANCE" });
    const job = jobs.find(j => j.externalId === "4185276009"); expect(job).toBeDefined();
    await updateDiscoveryStore(s => ({ ...s, jobs: [job!] }));
    const task = (await decideJob(job!.id, job!.fingerprint, "approved")).tasks[0]!;
    const inspected = await inspectApplicationForm(task.id, job!.fingerprint);
    const result = await observeApplicationPage(task.id, job!.fingerprint, inspected.schemaHash);
    expect(result.snapshot.controls.length).toBeGreaterThan(0);
    expect(result.questions.some(q => q.fields.some(f => f.status === "corresponding"))).toBe(true);
    expect(result.canFill).toBe(false); expect(result.canSubmit).toBe(false);
  }, 90000);
  it("makes two public checks and one ephemeral read without changing local records or authorizing writes", async () => {
    const { task, observer, inspect } = await setup(); const before = await readDiscoveryStore();
    const result = await observeApplicationPage(task.id, task.approvedHash, form().schemaHash, observer, inspect);
    expect(inspect).toHaveBeenCalledTimes(2); expect(observer).toHaveBeenCalledExactlyOnceWith("fixture", "17");
    expect(result.canFill).toBe(false); expect(result.canSubmit).toBe(false); expect(await readDiscoveryStore()).toEqual(before);
  });
  it.each(["cancelled", "closed", "changed", "custom_url", "unapproved", "lever"])("refuses %s before launching a browser", async kind => {
    const { task, observer, inspect } = await setup();
    await updateDiscoveryStore(s => {
      if (kind === "cancelled") s.tasks[0]!.state = "cancelled";
      if (kind === "closed") s.jobs[0]!.availability = "closed";
      if (kind === "changed") s.jobs[0]!.fingerprint = "b".repeat(64);
      if (kind === "custom_url") s.jobs[0]!.url = "https://example.com/form";
      if (kind === "unapproved") s.jobs[0]!.decision = "saved";
      if (kind === "lever") s.jobs[0]!.provider = "lever";
      return s;
    });
    await expect(observeApplicationPage(task.id, task.approvedHash, form().schemaHash, observer, inspect)).rejects.toThrow();
    expect(observer).not.toHaveBeenCalled(); expect(inspect).not.toHaveBeenCalled();
  });
  it("rejects a changed public form before browser work", async () => {
    const { task, observer, inspect } = await setup();
    await expect(observeApplicationPage(task.id, task.approvedHash, "b".repeat(64), observer, inspect)).rejects.toThrow(/form changed/);
    expect(observer).not.toHaveBeenCalled();
  });
  it.each(["approval", "schema", "url"])("rejects %s drift during browser latency", async kind => {
    const { task, inspect } = await setup();
    const observer = async () => {
      if (kind === "approval") await updateDiscoveryStore(s => { s.tasks[0]!.approvedAt = "2026-09-20T01:00:00.000Z"; return s; });
      if (kind === "schema") inspect.mockImplementation(async () => ({ ...form(task.id), schemaHash: "b".repeat(64) }));
      return { ...snapshot(), url: kind === "url" ? "https://example.com" : url };
    };
    await expect(observeApplicationPage(task.id, task.approvedHash, form().schemaHash, observer, inspect)).rejects.toThrow(/changed|match/);
  });
  it("does not leak transport errors", async () => {
    const { task, inspect } = await setup();
    await expect(observeApplicationPage(task.id, task.approvedHash, form().schemaHash, async () => { throw new Error("SECRET"); }, inspect)).rejects.toThrow(/could not finish safely/);
  });
  it("rejects concurrent browser tasks", async () => {
    const { task, inspect } = await setup(); let release!: () => void;
    const observer = async () => { await new Promise<void>(resolve => { release = resolve; }); return snapshot(); };
    const pending = observeApplicationPage(task.id, task.approvedHash, form().schemaHash, observer, inspect);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await expect(observeApplicationPage(task.id, task.approvedHash, form().schemaHash, observer, inspect)).rejects.toThrow(/already running/);
    release(); await pending;
  });
  it("rejects cross-origin and arbitrary destination/answer commands", async () => {
    const body = { taskId: "task", fingerprint: "a".repeat(64), schemaHash: "a".repeat(64) };
    expect((await POST(new Request("http://localhost/api/agent/observe", { method: "POST", headers: { Origin: "https://evil.test" }, body: JSON.stringify(body) }))).status).toBe(403);
    const response = await POST(new Request("http://localhost/api/agent/observe", { method: "POST", headers: { Origin: "http://localhost" }, body: JSON.stringify({ ...body, targetUrl: "http://127.0.0.1", answers: [] }) }));
    expect(response.status).toBe(400); expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
