import { randomUUID } from "node:crypto";
import { greenhouseTarget, labelledResumePicker } from "@resume-agent/browser-runner/greenhouse-observer";
import { openGreenhouseTextSession, type GreenhouseTextSession } from "@resume-agent/browser-runner/greenhouse-fill";
import { requireReviewedFillPlan, AtsFillPlanError } from "./ats-fill-plan";
import { readAtsExecutions, updateAtsExecutions, type AtsExecution, type AtsAttachment } from "./ats-execution-store";
import { inspectApplicationForm, type AtsFormInspection } from "./ats-form-inspection";
import { reconcileGreenhouseDom } from "./ats-dom-observation";
import { currentAttachmentDocument } from "./ats-attachment-document";
import type { GreenhouseDomSnapshot, ObservedControl } from "@resume-agent/browser-runner/greenhouse-observer";
import { readDiscoveryStore } from "./discovery-store";
import { hashJson } from "./hash";

type Session = Pick<GreenhouseTextSession, "alive" | "assertCurrent" | "freezeNetwork" | "fill" | "close"> & Partial<Pick<GreenhouseTextSession, "attachResume">>;
type Open = (board: string, externalId: string, hash: string) => Promise<Session>;
// Single local process only. Losing this map never reconstructs a browser or replays a write.
const held = new Map<string, Session>();
let opening = false;
function fail(message: string): never { throw new AtsFillPlanError(message); }
async function fresh(record: AtsExecution) {
  const plan = await requireReviewedFillPlan(record.planId, record.planHash);
  if (hashJson(plan.reviews) !== record.reviewsHash || Date.now() >= Date.parse(record.expiresAt)) fail("The execution authorization expired or preview reviews changed. Build a fresh preview.");
  return plan;
}
async function publicSchema(record: AtsExecution, inspect: typeof inspectApplicationForm) {
  const plan = await fresh(record); const form = await inspect(plan.taskId, plan.fingerprint);
  if (form.schemaHash !== plan.schemaHash) fail("The public form changed. Inspect and review a fresh preview.");
  await fresh(record);
  return form;
}
export function resumeAttachmentTarget(form: AtsFormInspection, snapshot: GreenhouseDomSnapshot): AtsAttachment["target"] {
  const questions = form.questions.filter(q => q.section === "application" && /^(resume|cv|resume\s*\/\s*cv)\s*\*?$/i.test(q.label.trim()));
  if (questions.length !== 1) fail("One unambiguous Resume/CV question is required.");
  const question = questions[0]!;
  const plain = (c: ObservedControl) => ({ ref: c.ref, id: c.id, name: c.name, label: c.label, tag: c.tag, type: c.type });
  if (question.fields.length === 2) {
    // This is a narrow adapter for the documented resume + resume_text group, not a
    // general waiver of grouped-question reconciliation or permission to clear text.
    if (!question.fields.some(f => f.name === "resume" && f.type === "input_file" && f.knownType && !f.options.length)
      || !question.fields.some(f => f.name === "resume_text" && f.type === "textarea" && f.knownType && !f.options.length)) fail("This grouped upload question is not the supported resume/file-text alternative.");
    const identity = (s: string) => s.replace(/^job_application\[([^\]]+)\]$/, "$1");
    const normalize = (s: string) => s.replace(/\*/g, "").trim().toLowerCase().replace(/\s+/g, " ");
    function one(name: string) {
      const matches = snapshot.controls.filter(c => [identity(c.id), identity(c.name)].includes(name));
      if (matches.length !== 1) fail("Resume alternatives need unique observed native controls.");
      const c = matches[0]!;
      const picker = name === "resume" ? labelledResumePicker(c) : undefined;
      if (form.questions.flatMap(q => q.fields).filter(f => [identity(c.id), identity(c.name)].includes(f.name)).length !== 1
        || c.disabled || c.optionLabels.length || normalize(picker?.groupLabel ?? c.label) !== normalize(question.label)) fail("Resume alternatives have shared identifiers or mismatched labels/types.");
      const group = c.upload?.group;
      if (group && (group.labelStatus !== "explicit" || normalize(group.label) !== normalize(question.label))) fail("The upload group does not unambiguously belong to the resume question.");
      return c;
    }
    const file = one("resume"); const text = one("resume_text");
    const picker = labelledResumePicker(file);
    if (file.ref === text.ref || file.tag !== "input" || file.type !== "file" || (!file.visible && !picker) || text.tag !== "textarea" || text.type !== "textarea") fail("Only a visible native file input or supported labelled picker and an observed native textarea are supported.");
    return { ...plain(file), alternative: plain(text), ...(picker ? { picker: { ...picker, forId: "resume" as const, label: "Attach" as const } } : {}) };
  }
  if (question.fields.length !== 1 || question.fields[0]!.type !== "input_file") fail("Unsupported resume attachment controls; inspect manually.");
  const matched = reconcileGreenhouseDom(form, snapshot).questions.find(q => q.questionId === questions[0]!.id)?.fields[0];
  if (!matched || matched.status !== "corresponding" || matched.controls.length !== 1) fail("The resume file control needs manual reconciliation.");
  const control = snapshot.controls.find(c => c.ref === matched.controls[0]);
  if (!control || control.tag !== "input" || control.type !== "file") fail("No supported resume file input was observed.");
  if (snapshot.controls.some(c => [c.id, c.name].some(s => s.replace(/^job_application\[([^\]]+)\]$/, "$1") === "resume_text"))) fail("An unlisted resume-text alternative needs source reconciliation.");
  return plain(control);
}
function attachmentHash(record: AtsExecution, attachment: Pick<AtsAttachment, "id" | "artifact" | "target">) {
  return hashJson([record.id, record.planHash, attachment.id, attachment.artifact, attachment.target]);
}
export async function prepareAtsAttachment(id: string, document = currentAttachmentDocument, inspect = inspectApplicationForm) {
  const initial = (await readAtsExecutions()).sessions.find(s => s.id === id); const session = held.get(id);
  if (!initial || initial.state !== "filled" || initial.attachment?.consumed || !session?.alive || !session.attachResume) fail("Complete the supervised text fill in a live browser before preparing an attachment. A used attachment scope cannot be replayed.");
  const form = await publicSchema(initial, inspect); const target = resumeAttachmentTarget(form, await session.assertCurrent());
  let record!: AtsExecution;
  await updateAtsExecutions(async store => {
    const current = store.sessions.find(s => s.id === id);
    if (!current || current.state !== "filled" || current.attachment?.consumed || held.get(id) !== session || !session.alive) fail("The browser or attachment scope changed.");
    await fresh(current); const verified = await document(current.taskId); await session.assertCurrent();
    const body = { id: randomUUID(), artifact: verified.artifact, target };
    record = { ...current, attachment: { ...body, attachmentHash: attachmentHash(current, body), state: "prepared", consumed: false, receipt: null } };
    return { ...store, sessions: store.sessions.map(s => s.id === id ? record : s) };
  });
  return record;
}
export async function attachAtsResume(id: string, attachmentId: string, expectedHash: string, confirmed: true, document = currentAttachmentDocument, inspect = inspectApplicationForm) {
  if (confirmed !== true) fail("Separate one-time offline attachment consent is required.");
  const session = held.get(id); if (!session?.alive || !session.attachResume) fail("The supervised browser ended. No attachment was replayed.");
  let record!: AtsExecution;
  await updateAtsExecutions(async store => {
    const current = store.sessions.find(s => s.id === id); const attachment = current?.attachment;
    if (!current || current.state !== "filled" || !attachment || attachment.id !== attachmentId || attachment.attachmentHash !== expectedHash
      || attachmentHash(current, attachment) !== expectedHash || attachment.state !== "prepared" || attachment.consumed) fail("The attachment consent is stale or already consumed.");
    await fresh(current); record = { ...current, attachment: { ...attachment, state: "running", consumed: true } };
    return { ...store, sessions: store.sessions.map(s => s.id === id ? record : s) };
  });
  try {
    const form = await publicSchema(record, inspect);
    await updateAtsExecutions(async store => {
      const current = store.sessions.find(s => s.id === id); const attachment = current?.attachment;
      if (!current || current.state !== "filled" || attachment?.state !== "running" || held.get(id) !== session || !session.alive) fail("The attachment session stopped.");
      await fresh(current); const verified = await document(current.taskId);
      if (hashJson(verified.artifact) !== hashJson(attachment.artifact)) fail("The approved document or its current evidence changed. Nothing was attached.");
      const target = resumeAttachmentTarget(form, await session.assertCurrent());
      if (hashJson(target) !== hashJson(attachment.target)) fail("The resume target changed.");
      const receipt = await session.attachResume!({ ...verified.artifact, buffer: verified.bytes, target }, true);
      record = { ...current, attachment: { ...attachment, state: "attached", receipt: { ...receipt, verifiedAt: new Date(Date.now()).toISOString() } } };
      return { ...store, sessions: store.sessions.map(s => s.id === id ? record : s) };
    });
    return record;
  } catch {
    await updateAtsExecutions(store => ({ ...store, sessions: store.sessions.map(s => s.id === id && s.attachment?.state === "running"
      ? { ...s, attachment: { ...s.attachment, state: "stopped" as const } } : s) }));
    fail("Attachment stopped. The file control may have changed; inspect the offline browser. Consent was consumed, with no automatic retry or employer delivery.");
  }
}
export async function openAtsExecution(planId: string, planHash: string, open: Open = openGreenhouseTextSession, inspect = inspectApplicationForm) {
  if (opening || [...held.values()].some(s => s.alive)) fail("Close the existing supervised browser before opening another.");
  opening = true; let session: Session | undefined;
  try {
    const plan = await requireReviewedFillPlan(planId, planHash);
    if ((await readAtsExecutions()).sessions.some(s => s.planId === planId && s.consumed)) fail("This preview already consumed an execution attempt. Inspect the result and build a new preview; do not replay it.");
    const discovery = await readDiscoveryStore();
    const task = discovery.tasks.find(t => t.id === plan.taskId); const job = discovery.jobs.find(j => j.id === task?.candidateId);
    if (!job || job.provider !== "greenhouse" || job.url !== plan.targetUrl || greenhouseTarget(job.board, job.externalId) !== plan.targetUrl) fail("Only the exact approved canonical Greenhouse posting is supported.");
    const record: AtsExecution = { id: `ats-execution:${randomUUID()}`, taskId: plan.taskId, planId, planHash, reviewsHash: hashJson(plan.reviews), challenge: randomUUID(),
      createdAt: new Date(Date.now()).toISOString(), expiresAt: plan.expiresAt, holdExpiresAt: new Date(Date.now() + 600000).toISOString(),
      state: "awaiting_authorization", consumed: false, receipts: [] };
    await publicSchema(record, inspect);
    session = await open(job.board, job.externalId, plan.observationHash);
    await session.assertCurrent(); await publicSchema(record, inspect);
    await updateAtsExecutions(async store => { await fresh(record); return { ...store, sessions: [...store.sessions, record] }; });
    held.set(record.id, session);
    return record;
  } catch (error) { await session?.close(); throw error; }
  finally { opening = false; }
}
export async function executeAtsSession(id: string, challenge: string, planHash: string, confirmed: true, inspect = inspectApplicationForm) {
  if (confirmed !== true) fail("Explicit one-time offline filling consent is required.");
  const session = held.get(id); if (!session?.alive) fail("The held browser ended or the server restarted. No write was replayed.");
  let record!: AtsExecution;
  // Persist spent authorization BEFORE any asynchronous external checks or browser writes.
  await updateAtsExecutions(async store => {
    const current = store.sessions.find(s => s.id === id);
    if (!current || current.challenge !== challenge || current.planHash !== planHash || current.consumed || current.state !== "awaiting_authorization") fail("This execution consent is invalid or already consumed.");
    await fresh(current); record = { ...current, consumed: true, state: "running" };
    return { ...store, sessions: store.sessions.map(s => s.id === id ? record : s) };
  });
  try {
    await publicSchema(record, inspect);
    await session.freezeNetwork(); await session.assertCurrent();
    const plan = await fresh(record);
    for (const row of plan.rows.filter(r => r.status === "planned")) {
      // The common store queue serializes approval/fact mutations around each field write.
      // No nested store update is allowed in this callback.
      await updateAtsExecutions(async store => {
        const current = store.sessions.find(s => s.id === id);
        if (!current || current.state !== "running" || !session.alive || held.get(id) !== session) fail("The supervised run stopped. Inspect any partially filled fields.");
        await fresh(current);
        if (!row.target || !row.text) fail("The saved planned answer has no target or text.");
        const receipt = await session.fill({ questionId: row.questionId, text: row.text, factIds: row.factIds, target: row.target });
        record = { ...current, receipts: [...current.receipts, { questionId: receipt.questionId, reservationId: receipt.reservationId, verifiedAt: new Date(Date.now()).toISOString() }] };
        return { ...store, sessions: store.sessions.map(s => s.id === id ? record : s) };
      });
    }
    await updateAtsExecutions(async store => {
      const current = store.sessions.find(s => s.id === id);
      if (!current || current.state !== "running" || !session.alive || held.get(id) !== session) fail("The browser closed during verification.");
      await fresh(current); await session.assertCurrent(); record = { ...current, state: "filled" };
      return { ...store, sessions: store.sessions.map(s => s.id === id ? record : s) };
    });
    return record;
  } catch {
    await updateAtsExecutions(store => ({ ...store, sessions: store.sessions.map(s => s.id === id && s.state === "running" ? { ...s, state: "stopped" as const } : s) }));
    fail("Filling stopped. Some fields may have changed; inspect the offline browser. Authorization was consumed and will not retry. Nothing was submitted.");
  }
}
export async function closeAtsExecution(id: string) {
  const session = held.get(id); held.delete(id); await session?.close();
  await updateAtsExecutions(store => ({ ...store, sessions: store.sessions.map(s => s.id === id ? { ...s, state: "closed" as const } : s) }));
}
export async function atsExecutionPayload(planId: string) {
  const record = [...(await readAtsExecutions()).sessions].reverse().find(s => s.planId === planId) ?? null;
  const live = !!record && !!held.get(record.id)?.alive;
  let canAuthorize = live && record?.state === "awaiting_authorization" && !record.consumed;
  let reason: string | null = !live && record ? "Browser ended or server restarted. No automatic replay; inspect any previous partial result." : null;
  if (canAuthorize && record) {
    try { await fresh(record); } catch { canAuthorize = false; reason = "The preview, facts, reviews or expiry changed. Build a fresh preview."; }
  }
  let attachmentFresh = live && record?.state === "filled";
  if (attachmentFresh && record) { try { await fresh(record); } catch { attachmentFresh = false; } }
  return { record, live, canAuthorize: !!canAuthorize, reason,
    canPrepareAttachment: !!attachmentFresh && !record?.attachment?.consumed,
    canAttachOffline: !!attachmentFresh && record?.attachment?.state === "prepared" && !record.attachment.consumed,
    canUpload: false as const, canSubmit: false as const };
}
