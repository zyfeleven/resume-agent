import { randomUUID } from "node:crypto";
import { atsAnswerPayload } from "./ats-answer-plan";
import type { AtsAnswerPlan } from "./ats-answer-store";
import { observeApplicationPage } from "./ats-dom-observation";
import { AtsFillPlanSchema, readAtsFillStore, updateAtsFillStore, type AtsFillPlan, type AtsFillRow } from "./ats-fill-plan-store";
import { FormInspectionError } from "./ats-form-inspection";
import { hashJson } from "./hash";

type Observation = Awaited<ReturnType<typeof observeApplicationPage>>;
type Observe = (taskId: string, fingerprint: string, schemaHash: string) => Promise<Observation>;
const TTL = 5 * 60 * 1000;
const REVIEWABLE_LIMITS = new Set(["custom_controls_need_review", "restricted_network_partial_view"]);
export class AtsFillPlanError extends Error { constructor(message: string, readonly status = 409) { super(message); } }
function reviewsHash(plan: AtsAnswerPlan) { return hashJson(plan.reviews.map(r => [r.questionId, r.decision, r.decidedAt])); }
function observationHash(observation: Observation) {
  return hashJson([observation.snapshot.url, observation.snapshot.structureHash, [...observation.snapshot.signals].sort()]);
}
function latestApproved(plan: AtsAnswerPlan, id: string) { return [...plan.reviews].reverse().find(r => r.questionId === id)?.decision === "approved"; }
async function currentAnswers(taskId: string, fingerprint: string, schemaHash: string) {
  const payload = await atsAnswerPayload(taskId, schemaHash);
  if (!payload.plan || payload.stale || payload.plan.fingerprint !== fingerprint) throw new AtsFillPlanError("Generate and review current answer drafts before planning. Facts or posting approval may have changed.");
  return payload.plan;
}
function checkObservation(answers: AtsAnswerPlan, observation: Observation) {
  if (observation.taskId !== answers.taskId || observation.fingerprint !== answers.fingerprint || observation.schemaHash !== answers.schemaHash) throw new AtsFillPlanError("The observation does not belong to these approved answers.");
  const age = Date.now() - Date.parse(observation.snapshot.observedAt);
  if (!Number.isFinite(age) || age < -60000 || age >= TTL) throw new AtsFillPlanError("The browser observation is too old or has an invalid timestamp. Observe again.");
}
/** This is a reviewed-answer preview, not an executable browser action or selector. */
export function projectAtsFillRows(answers: AtsAnswerPlan, observation: Observation): AtsFillRow[] {
  checkObservation(answers, observation);
  return observation.questions.map(question => {
    const matches = answers.answers.filter(a => a.questionId === question.questionId);
    const answer = matches.length === 1 ? matches[0] : undefined;
    const base = { questionId: question.questionId, label: question.label, required: question.required };
    const manual = (reason: string): AtsFillRow => ({ ...base, status: "manual", text: null, factIds: [], target: null, reason });
    if (!answer || answer.label !== question.label || answer.required !== question.required) return manual("Question identity or wording does not match the saved answer.");
    if (answer.disposition !== "draft" || !answer.text || !latestApproved(answers, answer.questionId)) return manual("No currently approved narrative answer. Keep this question manual.");
    const field = question.fields.length === 1 ? question.fields[0] : undefined;
    if (!field || field.status !== "corresponding" || field.controls.length !== 1) return manual("The public question does not uniquely correspond to an available DOM control.");
    const targets = observation.snapshot.controls.filter(c => c.ref === field.controls[0]);
    const target = targets.length === 1 ? targets[0] : undefined;
    const shared = target && observation.questions.flatMap(q => q.fields).filter(f => f.controls.includes(target.ref)).length > 1;
    if (!target || shared || !target.visible || target.disabled || !(target.tag === "textarea" && target.type === "textarea" || target.tag === "input" && target.type === "text") || target.optionLabels.length) {
      return manual("Only one unique visible, enabled ordinary text control can receive a narrative-answer preview. Other controls remain manual.");
    }
    return { ...base, status: "planned", text: answer.text, factIds: [...answer.factIds],
      target: { ref: target.ref, id: target.id, name: target.name, label: target.label, tag: target.tag, type: target.type },
      reason: "Exact approved wording and observed text control. Plan review is not permission to fill." };
  });
}
function digest(plan: Omit<AtsFillPlan, "planHash" | "reviews">) {
  return hashJson([plan.id, plan.taskId, plan.fingerprint, plan.schemaHash, plan.answerPlanId, plan.answerPlanHash, plan.answerReviewsHash,
    plan.profileHash, plan.approvedAt, plan.observationHash, plan.observedAt, plan.targetUrl, plan.createdAt, plan.expiresAt,
    plan.rows.map(r => [r.questionId, r.label, r.required, r.status, r.text, r.factIds, r.target ? [r.target.ref, r.target.id, r.target.name, r.target.label, r.target.tag, r.target.type] : null, r.reason]),
    plan.limitations, plan.blockers, plan.extraControls.map(c => [c.label, c.type, c.required])]);
}
function requireDigest(plan: AtsFillPlan) { if (plan.planHash !== digest(plan)) throw new AtsFillPlanError("Saved plan content no longer matches its hash. Build a new preview."); }
async function requireFresh(plan: AtsFillPlan) {
  requireDigest(plan);
  if (Date.now() >= Date.parse(plan.expiresAt)) throw new AtsFillPlanError("This five-minute preview has expired. Build a new plan from a fresh browser observation.");
  const answers = await currentAnswers(plan.taskId, plan.fingerprint, plan.schemaHash);
  if (answers.id !== plan.answerPlanId || answers.planHash !== plan.answerPlanHash || reviewsHash(answers) !== plan.answerReviewsHash
    || answers.profileHash !== plan.profileHash || answers.approvedAt !== plan.approvedAt) throw new AtsFillPlanError("Answers, reviews, facts or posting approval changed. Build and review a new plan.");
  return answers;
}
const active = new Set<string>();
/** Preview approval is necessary but not sufficient: callers need a separate one-use execution consent. */
export async function requireReviewedFillPlan(planId: string, planHash: string) {
  const plan = (await readAtsFillStore()).plans.find(p => p.id === planId && p.planHash === planHash);
  if (!plan) throw new AtsFillPlanError("The reviewed preview was replaced or deleted.");
  await requireFresh(plan);
  if (plan.reviews.at(-1)?.decision !== "approved" || plan.blockers.length) throw new AtsFillPlanError("Approve an unblocked current preview first.");
  return plan;
}
export async function buildAtsFillPlan(taskId: string, fingerprint: string, schemaHash: string, observe: Observe = observeApplicationPage) {
  if (active.has(taskId)) throw new AtsFillPlanError("A plan is already being built for this task.");
  active.add(taskId);
  try {
    const answers = await currentAnswers(taskId, fingerprint, schemaHash);
    if (!answers.answers.some(a => a.disposition === "draft" && a.text && latestApproved(answers, a.questionId))) throw new AtsFillPlanError("Approve at least one narrative answer before building a plan.", 422);
    // Values never go to the browser observer; only the exact posting identifiers do.
    const observation = await observe(taskId, fingerprint, schemaHash);
    const rows = projectAtsFillRows(answers, observation);
    const blockers = observation.snapshot.signals.filter(s => !REVIEWABLE_LIMITS.has(s));
    if (!rows.some(r => r.status === "planned")) blockers.push("no_corresponding_approved_answers");
    const createdAt = new Date(Date.now()).toISOString();
    const body = { id: `ats-fill:${randomUUID()}`, taskId, fingerprint, schemaHash, answerPlanId: answers.id, answerPlanHash: answers.planHash,
      answerReviewsHash: reviewsHash(answers), profileHash: answers.profileHash, approvedAt: answers.approvedAt,
      observationHash: observationHash(observation), observedAt: observation.snapshot.observedAt, targetUrl: observation.snapshot.url,
      createdAt, expiresAt: new Date(Math.min(Date.now(), Date.parse(observation.snapshot.observedAt)) + TTL).toISOString(), rows,
      limitations: observation.snapshot.signals, blockers,
      extraControls: observation.extraControls.map(c => ({ label: c.label, type: c.type, required: c.required })) };
    const plan = AtsFillPlanSchema.parse({ ...body, planHash: digest(body), reviews: [] });
    await updateAtsFillStore(async store => { await requireFresh(plan); return { ...store, plans: [...store.plans.filter(p => p.taskId !== taskId), plan] }; });
    return plan;
  } catch (error) {
    if (error instanceof AtsFillPlanError || error instanceof FormInspectionError) throw error;
    throw new AtsFillPlanError("Plan preparation failed safely. The previous saved plan was not replaced.", 502);
  } finally { active.delete(taskId); }
}
export async function reviewAtsFillPlan(planId: string, planHash: string, decision: "approved" | "rejected", observe: Observe = observeApplicationPage) {
  const initial = (await readAtsFillStore()).plans.find(p => p.id === planId);
  if (!initial || initial.planHash !== planHash) throw new AtsFillPlanError("This plan was replaced or deleted. Reload it.");
  requireDigest(initial);
  if (decision === "approved") {
    const answers = await requireFresh(initial);
    if (initial.blockers.length) throw new AtsFillPlanError("Resolve observation blockers before approving this preview.");
    const observation = await observe(initial.taskId, initial.fingerprint, initial.schemaHash);
    checkObservation(answers, observation);
    if (observationHash(observation) !== initial.observationHash || hashJson(projectAtsFillRows(answers, observation)) !== hashJson(initial.rows)) throw new AtsFillPlanError("The observed page or plan correspondence changed. Build a new preview.");
  }
  let updated!: AtsFillPlan;
  await updateAtsFillStore(async store => {
    const plan = store.plans.find(p => p.id === planId);
    if (!plan || plan.planHash !== planHash) throw new AtsFillPlanError("This plan was replaced or deleted. Reload it.");
    requireDigest(plan);
    if (decision === "approved") {
      if (hashJson(plan.reviews) !== hashJson(initial.reviews)) throw new AtsFillPlanError("This preview was reviewed while the page was being checked. Reload before approving.");
      await requireFresh(plan);
    }
    updated = { ...plan, reviews: [...plan.reviews, { decision, decidedAt: new Date(Date.now()).toISOString() }] };
    return { ...store, plans: store.plans.map(p => p.id === planId ? updated : p) };
  });
  return updated;
}
export async function deleteAtsFillPlan(planId: string, planHash: string) {
  await updateAtsFillStore(store => {
    if (!store.plans.some(p => p.id === planId && p.planHash === planHash)) throw new AtsFillPlanError("The plan changed. Reload before deleting.");
    return { ...store, plans: store.plans.filter(p => p.id !== planId) };
  });
}
export async function atsFillPayload(taskId: string, schemaHash: string) {
  const plan = (await readAtsFillStore()).plans.find(p => p.taskId === taskId) ?? null;
  let staleReason: string | null = null;
  if (plan) {
    try { await requireFresh(plan); if (plan.schemaHash !== schemaHash) throw new AtsFillPlanError("The inspected public form changed. Build a new plan."); }
    catch (error) { staleReason = error instanceof AtsFillPlanError ? error.message : "Current evidence could not be verified. Build a new plan."; }
  }
  return { plan, staleReason, canApprovePreview: !!plan && !staleReason && !plan.blockers.length,
    canFill: false as const, canUpload: false as const, canSubmit: false as const };
}
