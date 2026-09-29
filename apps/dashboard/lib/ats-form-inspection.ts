import { z } from "zod";
import { BoardSchema, type DiscoveryStore, type DiscoveredJob } from "./discovery-model";
import { readDiscoveryStore } from "./discovery-store";
import { normalizeDiscoveredJob, plainJobText, sha256 } from "./job-discovery";

const Text = z.string().min(1).max(10000);
const Id = z.union([z.string().min(1).max(200), z.number().int()]).transform(String);
const Choice = z.object({ value: Id, label: Text });
const Field = z.object({ name: z.string().min(1).max(200), type: z.string().min(1).max(100), values: z.array(Choice).max(500).optional() });
const Question = z.object({ label: Text, description: z.string().max(30000).nullable().optional(), required: z.boolean(), fields: z.array(Field).min(1).max(20) });
const Detail = z.object({
  id: Id, title: Text, absolute_url: z.string().url().max(2000), content: z.string().min(1).max(500000),
  location: z.object({ name: z.string().max(240) }),
  questions: z.array(Question).min(1).max(200), location_questions: z.array(Question).max(100).nullable().optional(),
  compliance: z.array(Question).max(100).nullable().optional(),
  demographic_questions: z.object({ header: Text.optional(), description: z.string().max(30000).optional(),
    questions: z.array(z.object({ id: Id, label: Text, required: z.boolean(), type: z.string().max(100),
      answer_options: z.array(z.object({ id: Id, label: Text, free_form: z.boolean().optional() })).max(500),
    })).max(100),
  }).nullable().optional(),
  data_compliance: z.array(z.object({ type: z.string().max(100), requires_consent: z.boolean().optional(),
    requires_processing_consent: z.boolean().optional(), requires_retention_consent: z.boolean().optional(),
    retention_period: z.number().nonnegative().nullable().optional(),
  })).max(20).nullable().optional(),
  include_ai_disclaimer: z.boolean().nullable().optional(), ai_disclaimer: z.string().max(30000).nullable().optional(),
  application_deadline: z.string().max(100).nullable().optional(),
});
const KNOWN_TYPES = new Set(["input_file", "input_text", "input_hidden", "textarea", "multi_value_single_select", "multi_value_multi_select"]);
export interface FormQuestion {
  id: string;
  label: string;
  description: string | null;
  required: boolean;
  section: "application" | "location" | "compliance" | "demographic";
  fields: { name: string; type: string; knownType: boolean; options: { value: string; label: string; freeForm: boolean }[] }[];
}
export interface AtsFormInspection {
  taskId: string;
  candidateId: string;
  postingFingerprint: string;
  checkedAt: string;
  schemaHash: string;
  questions: FormQuestion[];
  notices: string[];
  requiredQuestionCount: number;
  source: "greenhouse_public_api";
  canFill: false;
  canSubmit: false;
}
export class FormInspectionError extends Error {
  constructor(message: string, readonly status = 422) { super(message); }
}

/** Grouped questions remain grouped: Resume/file and Resume/text are alternatives,
 * not two independently required fields. This schema is never a browser fill plan.
 */
export function parseGreenhouseForm(raw: unknown, candidate: DiscoveredJob, taskId: string, checkedAt: string): AtsFormInspection {
  const parsed = Detail.safeParse(raw);
  if (!parsed.success) throw new FormInspectionError("The public form schema is missing or unsupported. Inspect the original application manually.");
  const data = parsed.data;
  const source = BoardSchema.parse({ provider: candidate.provider, board: candidate.board, company: candidate.company });
  const fresh = normalizeDiscoveredJob(source, { id: data.id, title: data.title, location: data.location.name, url: data.absolute_url, description: data.content }, checkedAt);
  if (fresh.id !== candidate.id || fresh.fingerprint !== candidate.fingerprint) {
    throw new FormInspectionError("The live posting no longer matches your approved snapshot. Refresh jobs and review the posting again.", 409);
  }
  if (data.application_deadline && Number.isFinite(Date.parse(data.application_deadline)) && Date.parse(data.application_deadline) <= Date.parse(checkedAt)) {
    throw new FormInspectionError("The posting's stated application deadline has passed. Refresh jobs before continuing.", 409);
  }
  const questions: FormQuestion[] = [];
  const add = (rows: z.infer<typeof Question>[], section: FormQuestion["section"]) => rows.forEach((row, index) => {
    questions.push({ id: `${section}:${index}`, label: plainJobText(row.label), description: row.description ? plainJobText(row.description) : null, required: row.required, section,
      fields: row.fields.map((field) => ({ name: field.name, type: field.type, knownType: KNOWN_TYPES.has(field.type),
        options: (field.values ?? []).map((option) => ({ value: option.value, label: plainJobText(option.label), freeForm: false })),
      })),
    });
  });
  add(data.questions, "application"); add(data.location_questions ?? [], "location"); add(data.compliance ?? [], "compliance");
  for (const question of data.demographic_questions?.questions ?? []) {
    questions.push({ id: `demographic:${question.id}`, label: plainJobText(question.label), description: null, required: question.required, section: "demographic",
      fields: [{ name: `demographic:${question.id}`, type: question.type, knownType: KNOWN_TYPES.has(question.type), options: question.answer_options.map((option) => ({
        value: option.id, label: plainJobText(option.label), freeForm: option.free_form ?? false,
      })) }],
    });
  }
  const notices = ["Public API inventory only; not a browser DOM snapshot or a complete validation of the hosted form. Conditional questions, login, CAPTCHA and site-specific controls may appear later.",
    "No answers have been selected or checked against your profile. Required counts describe questions, not missing profile facts. Sensitive, consent and eligibility answers must be reviewed by you."];
  if (data.demographic_questions?.header) notices.push(`Demographic section: ${plainJobText(data.demographic_questions.header)}`);
  if (data.demographic_questions?.description) notices.push(plainJobText(data.demographic_questions.description));
  for (const consent of data.data_compliance ?? []) {
    notices.push(`Data compliance (${consent.type}): consent ${consent.requires_consent === undefined ? "unspecified" : consent.requires_consent ? "required" : "not required"}; processing consent ${consent.requires_processing_consent === undefined ? "unspecified" : consent.requires_processing_consent ? "required" : "not required"}; retention consent ${consent.requires_retention_consent === undefined ? "unspecified" : consent.requires_retention_consent ? "required" : "not required"}. Review the site's full wording yourself; nothing is accepted here.`);
  }
  if (data.include_ai_disclaimer || data.ai_disclaimer) notices.push(`Employer AI notice: ${data.ai_disclaimer ? plainJobText(data.ai_disclaimer) : "Review the employer's AI disclosure on the original site."}`);
  if (data.application_deadline) notices.push(`Source application deadline: ${data.application_deadline}`);
  if (questions.some((q) => q.fields.some((f) => !f.knownType))) notices.push("Unrecognized field types are included for manual inspection; they are not supported for filling.");
  const names = questions.flatMap((q) => q.fields.map((f) => `${q.section}:${f.name}`));
  if (new Set(names).size !== names.length) throw new FormInspectionError("The form returned ambiguous duplicate field identifiers. Inspect the original form manually.");
  return { taskId, candidateId: candidate.id, postingFingerprint: candidate.fingerprint, checkedAt,
    schemaHash: sha256(JSON.stringify({ questions, notices })), questions, notices,
    requiredQuestionCount: questions.filter((q) => q.required).length, source: "greenhouse_public_api", canFill: false, canSubmit: false };
}

function approvedCandidate(store: DiscoveryStore, taskId: string, fingerprint: string) {
  const task = store.tasks.find((entry) => entry.id === taskId);
  const candidate = store.jobs.find((entry) => entry.id === task?.candidateId);
  if (!task || !candidate) throw new FormInspectionError("The application task is no longer stored.", 404);
  if (candidate.availability !== "open" || candidate.decision !== "approved" || candidate.fingerprint !== fingerprint
    || candidate.decisionHash !== fingerprint || task.approvedHash !== fingerprint || ["cancelled", "needs_reapproval"].includes(task.state)) {
    throw new FormInspectionError("Review and approve the current posting before inspecting its form.", 409);
  }
  return { task, candidate };
}

const inFlight = new Set<string>();
/** One bounded public GET, with no credentials, cookies, browser scripts or user facts. */
export async function inspectApplicationForm(taskId: string, fingerprint: string, fetcher: typeof fetch = fetch): Promise<AtsFormInspection> {
  if (inFlight.has(taskId) || inFlight.size >= 3) throw new FormInspectionError("A form inspection is already running. Try again after it finishes.", 409);
  inFlight.add(taskId);
  try {
    const { task, candidate } = approvedCandidate(await readDiscoveryStore(), taskId, fingerprint);
    if (candidate.provider !== "greenhouse") throw new FormInspectionError("This pilot supports Greenhouse only. Inspect other ATS forms manually.");
    const board = BoardSchema.safeParse({ provider: candidate.provider, board: candidate.board, company: candidate.company });
    if (!board.success || !/^\d{1,20}$/.test(candidate.externalId)) throw new FormInspectionError("This posting has an unsupported board or job identifier.");
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.data.board.toLowerCase())}/jobs/${candidate.externalId}?questions=true`;
    const response = await fetcher(url, { method: "GET", headers: { Accept: "application/json" }, credentials: "omit",
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (response.status === 404 || response.status === 410) throw new FormInspectionError("The public posting is no longer available. Refresh jobs before continuing.", 409);
    if (response.status === 429) throw new FormInspectionError("Greenhouse rate limit reached. Try later; no automatic retry was made.", 429);
    if (!response.ok || !response.body) throw new FormInspectionError("The public form could not be read. No application action was taken.", 502);
    if (Number(response.headers.get("content-length")) > 2_000_000) throw new FormInspectionError("The public form response exceeds the inspection size limit.");
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length; if (size > 2_000_000) throw new FormInspectionError("The public form response exceeds the inspection size limit.");
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const inspection = parseGreenhouseForm(JSON.parse(Buffer.concat(chunks).toString("utf8")), candidate, taskId, new Date().toISOString());
    const fresh = approvedCandidate(await readDiscoveryStore(), taskId, fingerprint);
    if (fresh.task.approvedAt !== task.approvedAt || JSON.stringify(fresh.candidate) !== JSON.stringify(candidate)) {
      throw new FormInspectionError("The posting or approval changed during inspection. Refresh the workspace and try again.", 409);
    }
    return inspection;
  } catch (error) {
    if (error instanceof FormInspectionError) throw error;
    throw new FormInspectionError("The public form could not be safely read. No answers, uploads or application were sent.", 502);
  } finally { inFlight.delete(taskId); }
}
