import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Fact } from "@resume-agent/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../app/api/agent/execute/route";
import { decideJob } from "../lib/application-agent";
import { generateAtsAnswerPlan, reviewAtsAnswer } from "../lib/ats-answer-plan";
import { reconcileGreenhouseDom } from "../lib/ats-dom-observation";
import { buildAtsFillPlan, reviewAtsFillPlan } from "../lib/ats-fill-plan";
import type { AtsFillPlan } from "../lib/ats-fill-plan-store";
import { atsExecutionPayload, closeAtsExecution, executeAtsSession, openAtsExecution, prepareAtsAttachment, attachAtsResume, resumeAttachmentTarget } from "../lib/ats-execution";
import { readAtsExecutions, updateAtsExecutions } from "../lib/ats-execution-store";
import { parseGreenhouseForm } from "../lib/ats-form-inspection";
import { updateDiscoveryStore } from "../lib/discovery-store";
import { normalizeDiscoveredJob } from "../lib/job-discovery";
import { updateProfileStore } from "../lib/profile-store";
import * as atomicJson from "../lib/atomic-json-write";
import type { ResumeAttachment } from "@resume-agent/browser-runner/greenhouse-fill";
import type { GreenhouseDomSnapshot } from "@resume-agent/browser-runner/greenhouse-observer";

const NOW = "2026-09-20T12:00:00.000Z";
const candidate = normalizeDiscoveredJob({ provider: "greenhouse", board: "fixture", company: "SIMULATED EXECUTION TEST" }, { id: "17", title: "Software Engineer", location: "Ottawa", url: "https://job-boards.greenhouse.io/fixture/jobs/17", description: "Python tools" }, NOW);
const form = parseGreenhouseForm({ id: 17, title: candidate.title, location: { name: candidate.location }, absolute_url: candidate.url, content: candidate.description,
  questions: [...[0, 1].map(i => ({ label: i ? "Describe your skills" : "Describe a project", required: true, fields: [{ name: `question_${i}`, type: "textarea" }] })), { label: "Resume", required: true, fields: [{ name: "resume", type: "input_file" }] }],
}, candidate, `application:${candidate.id}`, NOW);
const fact: Fact = { id: "fact:project", value: "Built Python tools.", sensitivity: "normal", kind: "project", key: "project", profileId: "profile:local", status: "verified",
  verification: { verifiedBy: "user", verifiedAt: NOW }, sources: [{ artifactId: "artifact:fixture", locator: "line:1", excerpt: "Built Python tools." }], version: 1, createdAt: NOW, updatedAt: NOW };
const provider = async () => ({ output: { answers: [0, 1].map(i => ({ questionId: `application:${i}`, text: "Built Python tools.", factIds: [fact.id], confidence: 0.99 })) }, model: "SIMULATED" });
const inspect = vi.fn(async () => structuredClone(form));
function snapshot(): GreenhouseDomSnapshot { return { url: candidate.url, observedAt: new Date(Date.now()).toISOString(), structureHash: "d".repeat(64), blockedRequests: 1, signals: ["restricted_network_partial_view"], canFill: false as const, canSubmit: false as const,
  controls: [...[0, 1].map(i => ({ ref: `dom:${i}`, id: `question_${i}`, name: "", label: i ? "Describe your skills" : "Describe a project", tag: "textarea", type: "textarea", required: true, visible: true, disabled: false, optionLabels: [] })),
    { ref: "dom:2", id: "resume", name: "resume", label: "Resume", tag: "input", type: "file", required: true, visible: true, disabled: false, optionLabels: [] }] }; }
const observe = async () => ({ taskId: form.taskId, fingerprint: candidate.fingerprint, schemaHash: form.schemaHash, snapshot: snapshot(), ...reconcileGreenhouseDom(form, snapshot()), canFill: false as const, canSubmit: false as const });

describe("separate one-use supervised execution authorization", () => {
  let directory: string; let plan: AtsFillPlan; let alive: boolean;
  const held = { get alive() { return alive; }, assertCurrent: vi.fn(async () => snapshot()), freezeNetwork: vi.fn(async () => undefined),
    attachResume: vi.fn(async (file: ResumeAttachment) => ({ reservationId: "attachment:r1", outputHash: file.outputHash, byteSize: file.buffer.length })),
    fill: vi.fn(async (row: { questionId: string }) => ({ questionId: row.questionId, reservationId: `reservation:${row.questionId}`, verified: true as const })), close: vi.fn(async () => { alive = false; }) };
  const open = vi.fn(async () => held);
  const start = () => openAtsExecution(plan.id, plan.planHash, open, inspect);
  const run = (record: Awaited<ReturnType<typeof start>>) => executeAtsSession(record.id, record.challenge, record.planHash, true, inspect);
  const document = vi.fn(async () => ({ bytes: Buffer.from("SIMULATED"), artifact: { buildId: "build:fixture", outputHash: "a".repeat(64), byteSize: 9, manifestHash: "b".repeat(64), evidenceHash: "c".repeat(64), fileName: "resume.docx" as const, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const } }));
  const prepare = (record: Awaited<ReturnType<typeof start>>) => prepareAtsAttachment(record.id, document, inspect);
  const attach = (record: Awaited<ReturnType<typeof prepare>>) => attachAtsResume(record.id, record.attachment!.id, record.attachment!.attachmentHash, true, document, inspect);
  beforeEach(async () => {
    vi.clearAllMocks(); alive = true; inspect.mockImplementation(async () => structuredClone(form)); open.mockImplementation(async () => held);
    held.assertCurrent.mockImplementation(async () => snapshot()); held.freezeNetwork.mockResolvedValue(undefined);
    held.fill.mockImplementation(async row => ({ questionId: row.questionId, reservationId: `reservation:${row.questionId}`, verified: true }));
    held.attachResume.mockImplementation(async file => ({ reservationId: "attachment:r1", outputHash: file.outputHash, byteSize: file.buffer.length }));
    directory = await mkdtemp(path.join(os.tmpdir(), "ats-execution-test-")); vi.stubEnv("RESUME_AGENT_DATA_DIR", directory);
    vi.stubEnv("GEMINI_API_KEY", " "); vi.stubEnv("GOOGLE_API_KEY", " ");
    await updateDiscoveryStore(s => ({ ...s, jobs: [structuredClone(candidate)] })); await decideJob(candidate.id, candidate.fingerprint, "approved");
    await updateProfileStore(s => ({ ...s, facts: [structuredClone(fact)] }));
    const answers = await generateAtsAnswerPlan(form.taskId, candidate.fingerprint, form.schemaHash, provider, inspect);
    for (const i of [0, 1]) await reviewAtsAnswer(answers.id, answers.planHash, `application:${i}`, "approved", inspect);
    plan = await buildAtsFillPlan(form.taskId, candidate.fingerprint, form.schemaHash, observe);
    plan = await reviewAtsFillPlan(plan.id, plan.planHash, "approved", observe);
  });
  afterEach(async () => {
    for (const record of (await readAtsExecutions()).sessions) await closeAtsExecution(record.id);
    vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true });
  });
  it("does not touch the browser when spent-consent persistence fails", async () => {
    const record = await start(); const error = Object.assign(new Error("SIMULATED storage failure"), { code: "EPERM" });
    const save = vi.spyOn(atomicJson, "writeJsonAtomically").mockRejectedValue(error);
    try {
      await expect(run(record)).rejects.toBe(error);
      expect(held.fill).not.toHaveBeenCalled(); expect(held.freezeNetwork).not.toHaveBeenCalled();
      expect((await readAtsExecutions()).sessions[0]).toMatchObject({ state: "awaiting_authorization", consumed: false, receipts: [] });
    } finally { save.mockRestore(); }
  });
  it("does not replay a browser write after receipt persistence fails", async () => {
    const record = await start(); const original = atomicJson.writeJsonAtomically;
    const save = vi.spyOn(atomicJson, "writeJsonAtomically").mockImplementation(async (target, contents) => {
      if (path.basename(target) === "ats-executions.json" && JSON.parse(contents).sessions.some((s: { id: string; state: string; receipts: unknown[] }) => s.id === record.id && s.state === "running" && s.receipts.length === 1)) {
        throw Object.assign(new Error("SIMULATED receipt persistence failure"), { code: "EPERM" });
      }
      return original(target, contents);
    });
    try {
      await expect(run(record)).rejects.toThrow(/stopped/); expect(held.fill).toHaveBeenCalledOnce();
      expect((await readAtsExecutions()).sessions[0]).toMatchObject({ state: "stopped", consumed: true });
      await expect(run(record)).rejects.toThrow(/consumed/); expect(held.fill).toHaveBeenCalledOnce();
    } finally { save.mockRestore(); }
  });
  it("prepares metadata only, then separately confirms and verifies exactly one attachment", async () => {
    const record = await start(); await expect(prepare(record)).rejects.toThrow(/Complete/);
    await run(record); const prepared = await prepare(record);
    expect(held.attachResume).not.toHaveBeenCalled(); expect(prepared.attachment).toMatchObject({ consumed: false, state: "prepared", artifact: { fileName: "resume.docx" } });
    expect(JSON.stringify(prepared)).not.toContain("SIMULATED");
    const result = await attach(prepared); expect(result.attachment).toMatchObject({ consumed: true, state: "attached", receipt: { outputHash: "a".repeat(64) } });
    expect(held.attachResume).toHaveBeenCalledTimes(1); expect(document).toHaveBeenCalledTimes(2);
    await expect(attach(prepared)).rejects.toThrow(/consumed/); await expect(prepare(record)).rejects.toThrow(/replayed/);
    expect(await atsExecutionPayload(plan.id)).toMatchObject({ canPrepareAttachment: false, canAttachOffline: false, canUpload: false, canSubmit: false });
  });
  it.each(["id", "hash", "consent"])("refuses incorrect attachment %s", async kind => {
    const record = await start(); await run(record); const prepared = await prepare(record); const a = prepared.attachment!;
    await expect(attachAtsResume(record.id, kind === "id" ? "other" : a.id, kind === "hash" ? "f".repeat(64) : a.attachmentHash, (kind !== "consent") as true, document, inspect)).rejects.toThrow();
    expect(held.attachResume).not.toHaveBeenCalled();
  });
  it("spends attachment consent before revalidation and refuses changed document evidence", async () => {
    const record = await start(); await run(record); const prepared = await prepare(record);
    document.mockImplementationOnce(async () => {
      expect((await readAtsExecutions()).sessions[0]!.attachment).toMatchObject({ state: "running", consumed: true });
      return { bytes: Buffer.from("SIMULATED"), artifact: { ...prepared.attachment!.artifact, evidenceHash: "e".repeat(64) } };
    });
    await expect(attach(prepared)).rejects.toThrow(/stopped/); expect(held.attachResume).not.toHaveBeenCalled();
    expect((await readAtsExecutions()).sessions[0]!.attachment!.state).toBe("stopped");
  });
  it("does not replay after a partial file control failure", async () => {
    const record = await start(); await run(record); const prepared = await prepare(record); held.attachResume.mockRejectedValueOnce(new Error("SECRET_FILE_PATH"));
    await expect(attach(prepared)).rejects.toThrow(/stopped/); await expect(attach(prepared)).rejects.toThrow(/consumed/);
    expect(JSON.stringify(await readAtsExecutions())).not.toContain("SECRET_FILE_PATH");
  });
  it("refuses concurrent attachment consent while preserving the first attempt", async () => {
    const record = await start(); await run(record); const prepared = await prepare(record);
    let entered!: () => void; let release!: () => void; const ready = new Promise<void>(r => { entered = r; });
    // Pause before the per-write transaction; a duplicate must see durable consumption.
    inspect.mockImplementationOnce(async () => { entered(); await new Promise<void>(r => { release = r; }); return structuredClone(form); });
    const pending = attach(prepared); await ready; await expect(attach(prepared)).rejects.toThrow(/consumed/);
    release(); await pending; expect(held.attachResume).toHaveBeenCalledTimes(1);
  });
  it.each(["facts", "closed", "tampered"])("refuses %s attachment scope before transfer", async kind => {
    const record = await start(); await run(record); const prepared = await prepare(record);
    if (kind === "facts") await updateProfileStore(s => ({ ...s, facts: [] }));
    if (kind === "closed") await closeAtsExecution(record.id);
    if (kind === "tampered") await updateAtsExecutions(s => ({ ...s, sessions: s.sessions.map(r => ({ ...r, attachment: { ...r.attachment!, artifact: { ...r.attachment!.artifact, outputHash: "f".repeat(64) } } })) }));
    await expect(attach(prepared)).rejects.toThrow(); expect(held.attachResume).not.toHaveBeenCalled();
  });
  it("does not prepare an unverified or missing DOCX", async () => {
    const record = await start(); await run(record); document.mockRejectedValueOnce(new Error("Document gate refused"));
    await expect(prepare(record)).rejects.toThrow(); expect((await readAtsExecutions()).sessions[0]!.attachment).toBeUndefined();
    expect(held.attachResume).not.toHaveBeenCalled();
  });
  it.each(["alternatives", "missing", "hidden", "duplicate", "wrong_label", "private"])("refuses %s resume controls", kind => {
    const f = structuredClone(form); const s = snapshot();
    if (kind === "alternatives") f.questions[2]!.fields.push({ name: "resume_text", type: "textarea", knownType: true, options: [] });
    if (kind === "missing") s.controls.pop();
    if (kind === "hidden") s.controls[2]!.visible = false;
    if (kind === "duplicate") s.controls.push({ ...s.controls[2]!, ref: "dom:3" });
    if (kind === "wrong_label") s.controls[2]!.label = "Passport";
    if (kind === "private") f.questions[2]!.section = "compliance";
    expect(() => resumeAttachmentTarget(f, s)).toThrow();
  });
  function groupFixture() {
    const f = structuredClone(form); const s = snapshot();
    f.questions[2]!.fields.push({ name: "resume_text", type: "textarea", knownType: true, options: [] });
    s.controls[2]!.required = false;
    s.controls.push({ ref: "dom:3", id: "resume_text", name: "job_application[resume_text]", label: "Resume", tag: "textarea", type: "textarea", required: false, disabled: false, visible: true, optionLabels: [] });
    return { f, s };
  }
  it.each([false, true])("maps the documented file/text group without treating each branch as required (hidden text=%s)", hidden => {
    const { f, s } = groupFixture(); s.controls[3]!.visible = !hidden;
    expect(resumeAttachmentTarget(f, s)).toMatchObject({ id: "resume", alternative: { id: "resume_text", name: "job_application[resume_text]" } });
    f.questions[2]!.fields.reverse(); expect(resumeAttachmentTarget(f, s).alternative!.ref).toBe("dom:3");
  });
  function pickerFixture() {
    const { f, s } = groupFixture(); const file = s.controls[2]!;
    file.visible = false; file.label = 'Attach';
    file.upload = { accept: ['.docx'], multiple: false, directory: false,
      group: { label: 'Resume', labelStatus: 'explicit', fieldIds: ['resume', 'resume_text'], triggerTargets: ['resume', 'resume_text'] },
      trigger: { forId: 'resume', label: 'Attach', visible: true, associated: true } };
    return { f, s };
  }
  it("prepares a hidden native picker only with the exact visible association and observed alternative", () => {
    const { f, s } = pickerFixture();
    expect(resumeAttachmentTarget(f, s)).toMatchObject({ id: 'resume', label: 'Attach', picker: { forId: 'resume', label: 'Attach', groupLabel: 'Resume' }, alternative: { id: 'resume_text' } });
  });
  it.each(['hidden_trigger', 'unassociated', 'cover_letter', 'unmounted', 'other_control', 'duplicate_target', 'standalone'])("refuses unsafe picker evidence: %s", kind => {
    const { f, s } = pickerFixture(); const upload = s.controls[2]!.upload!;
    if (kind === 'hidden_trigger') upload.trigger!.visible = false;
    if (kind === 'unassociated') upload.trigger!.associated = false;
    if (kind === 'cover_letter') upload.group!.label = 'Cover Letter';
    if (kind === 'unmounted') { upload.group!.fieldIds = ['resume']; s.controls.pop(); }
    if (kind === 'other_control') upload.group!.fieldIds.push('cover_letter');
    if (kind === 'duplicate_target') s.controls.push({ ...s.controls[2]!, ref: 'dom:99' });
    if (kind === 'standalone') f.questions[2]!.fields.pop();
    expect(() => resumeAttachmentTarget(f, s)).toThrow();
  });
  it("persists and hash-binds the separately reviewed picker association", async () => {
    const record = await start(); await run(record); const { f, s } = pickerFixture();
    inspect.mockImplementation(async () => f); held.assertCurrent.mockImplementation(async () => s);
    const prepared = await prepare(record);
    expect((await readAtsExecutions()).sessions[0]!.attachment!.target.picker).toEqual({ forId: 'resume', label: 'Attach', groupLabel: 'Resume' });
    await updateAtsExecutions(store => ({ ...store, sessions: store.sessions.map(r => ({ ...r, attachment: { ...r.attachment!, target: { ...r.attachment!.target, picker: { ...r.attachment!.target.picker!, groupLabel: 'Cover Letter' } } } })) }));
    await expect(attach(prepared)).rejects.toThrow(/stale/);
    expect(held.attachResume).not.toHaveBeenCalled();
  });
  it("passes a fresh picker scope through the existing one-use attachment flow", async () => {
    const record = await start(); await run(record); const { f, s } = pickerFixture();
    inspect.mockImplementation(async () => f); held.assertCurrent.mockImplementation(async () => s);
    const prepared = await prepare(record); const result = await attach(prepared);
    expect(result.attachment!.state).toBe('attached');
    expect(held.attachResume).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ picker: { forId: 'resume', label: 'Attach', groupLabel: 'Resume' } }) }), true);
    await expect(attach(prepared)).rejects.toThrow(/consumed/);
  });
  it.each(["shared", "unknown_name", "unknown_type", "extra_field", "different_label", "disabled", "hidden_file", "custom", "same_control"])("refuses grouped %s ambiguity", kind => {
    const { f, s } = groupFixture();
    if (kind === "shared") f.questions[1]!.fields.push({ ...f.questions[2]!.fields[1]! });
    if (kind === "unknown_name") f.questions[2]!.fields[1]!.name = "other";
    if (kind === "unknown_type") f.questions[2]!.fields[1]!.knownType = false;
    if (kind === "extra_field") f.questions[2]!.fields.push({ ...f.questions[2]!.fields[1]!, name: "third" });
    if (kind === "different_label") s.controls[3]!.label = "Passport";
    if (kind === "disabled") s.controls[3]!.disabled = true;
    if (kind === "hidden_file") s.controls[2]!.visible = false;
    if (kind === "custom") s.controls[3]!.type = "combobox";
    if (kind === "same_control") s.controls[3]!.ref = s.controls[2]!.ref;
    expect(() => resumeAttachmentTarget(f, s)).toThrow();
  });
  it("refuses an unlisted resume-text control even for a standalone public question", () => {
    const { s } = groupFixture(); s.controls[2]!.required = true;
    expect(() => resumeAttachmentTarget(form, s)).toThrow(/unlisted/);
  });
  it.each(["ambiguous", "missing", "cover_letter"])("refuses a grouped attachment with %s group ownership", kind => {
    const { f, s } = groupFixture();
    s.controls[2]!.upload = { accept: [".docx"], multiple: false, directory: false, group: { label: kind === "cover_letter" ? "Cover letter" : "", labelStatus: kind === "cover_letter" ? "explicit" : kind as "missing" | "ambiguous", fieldIds: ["resume", "resume_text"], triggerTargets: ["resume", "resume_text"] } };
    expect(() => resumeAttachmentTarget(f, s)).toThrow(/upload group/);
  });
  it("persists the reviewed alternative and invalidates consent when that target is altered", async () => {
    const record = await start(); await run(record); const { f, s } = groupFixture();
    // Transport doubles isolate group binding; actual structural extraction is tested in Chromium.
    inspect.mockImplementation(async () => f); held.assertCurrent.mockImplementation(async () => s);
    const prepared = await prepare(record);
    expect((await readAtsExecutions()).sessions[0]!.attachment!.target.alternative?.id).toBe("resume_text");
    await updateAtsExecutions(store => ({ ...store, sessions: store.sessions.map(r => ({ ...r, attachment: { ...r.attachment!, target: { ...r.attachment!.target, alternative: { ...r.attachment!.target.alternative!, id: "other" } } } })) }));
    await expect(attach(prepared)).rejects.toThrow(/stale/); expect(held.attachResume).not.toHaveBeenCalled();
  });
  it("opens without answer data or writes, then freezes before writing only approved fields", async () => {
    const record = await start(); expect(open).toHaveBeenCalledExactlyOnceWith("fixture", "17", plan.observationHash);
    expect(held.fill).not.toHaveBeenCalled(); expect(held.freezeNetwork).not.toHaveBeenCalled();
    expect((await atsExecutionPayload(plan.id)).canAuthorize).toBe(true);
    const result = await run(record); expect(result.state).toBe("filled"); expect(result.receipts).toHaveLength(2);
    expect(held.freezeNetwork.mock.invocationCallOrder[0]).toBeLessThan(held.fill.mock.invocationCallOrder[0]!);
    expect(held.fill).toHaveBeenCalledWith(expect.objectContaining({ text: fact.value, factIds: [fact.id] }));
    expect(JSON.stringify(await readAtsExecutions())).not.toContain(fact.value);
    expect(await atsExecutionPayload(plan.id)).toMatchObject({ canAuthorize: false, canUpload: false, canSubmit: false, live: true });
    await expect(run(record)).rejects.toThrow(/consumed/);
    await closeAtsExecution(record.id); alive = true; await expect(start()).rejects.toThrow(/consumed/);
  });
  it("consumes authorization durably before browser work and rejects a concurrent duplicate", async () => {
    const record = await start(); let release!: () => void; let entered!: () => void;
    const ready = new Promise<void>(r => { entered = r; });
    held.freezeNetwork.mockImplementation(async () => { entered(); await new Promise<void>(r => { release = r; }); });
    const pending = run(record); await ready;
    expect((await readAtsExecutions()).sessions[0]).toMatchObject({ consumed: true, state: "running" });
    await expect(run(record)).rejects.toThrow(/consumed/); release(); await pending; expect(held.fill).toHaveBeenCalledTimes(2);
  });
  it.each(["challenge", "hash", "consent"])("rejects invalid %s without typing", async kind => {
    const record = await start(); await expect(executeAtsSession(record.id, kind === "challenge" ? "wrong" : record.challenge,
      kind === "hash" ? "f".repeat(64) : record.planHash, (kind !== "consent") as true, inspect)).rejects.toThrow();
    expect(held.fill).not.toHaveBeenCalled(); expect((await readAtsExecutions()).sessions[0]!.consumed).toBe(false);
  });
  it.each(["facts", "review", "expiry", "closed"])("refuses %s changes after opening", async kind => {
    const record = await start();
    if (kind === "facts") await updateProfileStore(s => ({ ...s, facts: [] }));
    if (kind === "review") await reviewAtsFillPlan(plan.id, plan.planHash, "rejected", observe);
    if (kind === "expiry") vi.spyOn(Date, "now").mockReturnValue(Date.parse(plan.expiresAt));
    if (kind === "closed") alive = false;
    expect((await atsExecutionPayload(plan.id)).canAuthorize).toBe(false);
    await expect(run(record)).rejects.toThrow(); expect(held.fill).not.toHaveBeenCalled();
  });
  it("checks the source schema again and spends failed attempts without writing", async () => {
    const record = await start(); inspect.mockImplementation(async () => ({ ...form, schemaHash: "e".repeat(64) }));
    await expect(run(record)).rejects.toThrow(/stopped/); expect(held.fill).not.toHaveBeenCalled();
    expect((await readAtsExecutions()).sessions[0]).toMatchObject({ state: "stopped", consumed: true });
  });
  it("retains verified receipts and stops at the first partial failure", async () => {
    const record = await start(); held.fill.mockResolvedValueOnce({ questionId: "application:0", reservationId: "r0", verified: true }).mockRejectedValueOnce(new Error("SECRET_VALUE"));
    await expect(run(record)).rejects.toThrow(/Some fields may have changed/);
    const saved = (await readAtsExecutions()).sessions[0]!; expect(saved.state).toBe("stopped"); expect(saved.receipts).toHaveLength(1);
    expect(JSON.stringify(saved)).not.toMatch(/SECRET_VALUE|Built Python/); await expect(run(record)).rejects.toThrow(/consumed/);
  });
  it("revalidates facts inside each field's serialization boundary", async () => {
    const record = await start(); held.freezeNetwork.mockImplementation(async () => { await updateProfileStore(s => ({ ...s, facts: [] })); });
    await expect(run(record)).rejects.toThrow(/stopped/); expect(held.fill).not.toHaveBeenCalled();
  });
  it("closing during a field prevents later writes without erasing partial receipts", async () => {
    const record = await start(); let entered!: () => void; let release!: () => void; const ready = new Promise<void>(r => { entered = r; });
    held.fill.mockImplementationOnce(async row => { entered(); await new Promise<void>(r => { release = r; }); return { questionId: row.questionId, reservationId: "r0", verified: true }; });
    const pending = run(record); const rejection = expect(pending).rejects.toThrow(/stopped/); await ready;
    const closing = closeAtsExecution(record.id); release(); await closing; await rejection;
    expect(held.fill).toHaveBeenCalledTimes(1); expect((await readAtsExecutions()).sessions[0]!.state).toBe("closed");
  });
  it("closes an opened browser if approval changes during opening", async () => {
    open.mockImplementation(async () => { await reviewAtsFillPlan(plan.id, plan.planHash, "rejected", observe); return held; });
    await expect(start()).rejects.toThrow(); expect(held.close).toHaveBeenCalled(); expect((await readAtsExecutions()).sessions).toEqual([]);
  });
  it("never reconstructs missing runtime sessions from persisted records", async () => {
    const record = await start(); await closeAtsExecution(record.id);
    await updateAtsExecutions(s => ({ ...s, sessions: s.sessions.map(r => ({ ...r, state: "awaiting_authorization" as const })) }));
    expect((await atsExecutionPayload(plan.id)).canAuthorize).toBe(false); await expect(run(record)).rejects.toThrow(/restarted/);
  });
  it.each([
    { action: "authorize", sessionId: "x", challenge: "123", planHash: "f".repeat(64), confirmOfflineFill: false },
    { action: "open", planId: "x", planHash: "f".repeat(64), url: "https://evil.test" },
    { action: "fill", text: "fabricated", selector: "#q" }, { action: "submit" }, { action: "upload" },
    { action: "prepare_attachment", sessionId: "x", path: "C:/private.docx" },
    { action: "attach_offline", sessionId: "x", attachmentId: "12345678-1234-4234-8234-123456789abc", attachmentHash: "a".repeat(64), confirmOfflineAttachment: false },
    { action: "attach_offline", sessionId: "x", attachmentId: "12345678-1234-4234-8234-123456789abc", attachmentHash: "a".repeat(64), confirmOfflineAttachment: true, buffer: "invented" },
  ])("rejects unsupported HTTP commands: %j", async command => {
    const response = await POST(new Request("http://localhost/api/agent/execute", { method: "POST", headers: { Origin: "http://localhost" }, body: JSON.stringify(command) }));
    expect(response.status).toBe(400); expect(open).not.toHaveBeenCalled();
  });
  it("rejects cross-origin writes and returns only local state on GET", async () => {
    const record = await start(); const before = inspect.mock.calls.length;
    expect((await GET(new Request(`http://localhost/api/agent/execute?planId=${encodeURIComponent(plan.id)}`))).status).toBe(200);
    expect(inspect).toHaveBeenCalledTimes(before);
    expect((await POST(new Request("http://localhost/api/agent/execute", { method: "POST", headers: { Origin: "https://evil.test" }, body: JSON.stringify({ action: "close", sessionId: record.id }) }))).status).toBe(403);
    expect(held.close).not.toHaveBeenCalled();
  });
});
