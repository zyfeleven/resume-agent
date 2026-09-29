import { createHash } from "node:crypto";

import type { BrowserPageSnapshot, Fact, PolicySafetySignal } from "@resume-agent/contracts";
import {
  planFill,
  sensitivityOf,
  type AnswerSource,
  type FieldNormalization,
  type FillPlan,
} from "@resume-agent/browser-runner";
import { z } from "zod";

const FormProposalSchema = z
  .object({
    targetId: z.string().min(1).max(200),
    canonicalField: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
    action: z.enum(["direct", "draft", "human"]),
    factIds: z.array(z.string().min(1).max(200)).max(20),
    confidence: z.number().min(0).max(1),
    draftText: z.string().max(2_000).nullable(),
    reason: z.string().min(1).max(500),
  })
  .strict();

export const FormModelOutputSchema = z
  .object({
    proposals: z.array(FormProposalSchema).max(500),
  })
  .strict();

export type FormModelOutput = z.infer<typeof FormModelOutputSchema>;

export const FORM_MODEL_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["proposals"],
  properties: {
    proposals: {
      type: "array",
      maxItems: 500,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["targetId", "canonicalField", "action", "factIds", "confidence", "draftText", "reason"],
        properties: {
          targetId: { type: "string" },
          canonicalField: { type: "string", pattern: "^[a-z][a-z0-9_]{0,79}$" },
          action: { type: "string", enum: ["direct", "draft", "human"] },
          factIds: { type: "array", maxItems: 20, items: { type: "string" } },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          draftText: { anyOf: [{ type: "string", maxLength: 2000 }, { type: "null" }] },
          reason: { type: "string", minLength: 1, maxLength: 500 },
        },
      },
    },
  },
} as const;

export interface ModelFieldDescriptor {
  targetId: string;
  label: string;
  question: string;
  controlType: string;
  required: boolean;
  sensitivity: string;
  options: string[];
  deterministicCanonicalField: string;
  deterministicConfidence: number;
  deterministicContested: boolean;
}

export interface ModelFactDescriptor {
  factId: string;
  key: string;
  kind: string;
  sensitivity: string;
  /** Present only for normal facts that may support a grounded narrative draft. */
  value?: string;
  valueWithheld: boolean;
}

export interface FormModelRequest {
  pageTitle: string;
  fields: ModelFieldDescriptor[];
  facts: ModelFactDescriptor[];
}

export interface FormModelResult {
  output: unknown;
  provider: "gemini";
  model: string;
  responseId?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface FormIntelligenceProvider {
  generatePlan(request: FormModelRequest): Promise<FormModelResult>;
}

export interface RejectedFormProposal {
  targetId: string;
  code:
    | "duplicate_target"
    | "unknown_target"
    | "field_not_empty"
    | "unsupported_control"
    | "sensitive_field"
    | "prompt_injection_signal"
    | "unknown_fact"
    | "invalid_direct_answer"
    | "invalid_draft_sources"
    | "unsupported_draft";
}

export interface FormIntelligencePlan {
  plan: FillPlan;
  answers: AnswerSource[];
  valueByAnswerId: Map<string, string>;
  normalizations: Record<string, FieldNormalization>;
  rejected: RejectedFormProposal[];
  provider: "gemini";
  model: string;
  responseId?: string;
  inputTokens?: number;
  outputTokens?: number;
  proposedCount: number;
  acceptedCount: number;
}

const TEXT_CONTROLS = new Set(["text", "email", "phone", "number", "date", "textarea"]);
const NARRATIVE_QUESTION = /\b(?:why|describe|experience|summary|additional|cover|motivation|achievement|tell us)\b/i;
const PAGE_INSTRUCTION = /\b(?:ignore (?:all |the )?(?:previous|prior)|system prompt|developer message|api key|secret|password)\b/i;
const SENSITIVE_QUESTION = /\b(?:work authori[sz]ation|sponsor(?:ship)?|salary|compensation|gender|race|ethnicity|veteran|disability|birth|signature|criminal|background check|citizen(?:ship)?)\b/i;

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "because", "by", "for", "from", "has", "have", "i", "in", "is",
  "it", "my", "of", "on", "or", "our", "that", "the", "their", "this", "to", "was", "we", "were", "with", "using",
]);

const NEGATION = /\b(?:no|not|never|neither|without|didn't|did not|wasn't|was not)\b/i;
const INCREASE = /\b(?:increase|increased|increasing|grew|grown|raise|raised|improve|improved|accelerate|accelerated)\b/i;
const DECREASE = /\b(?:decrease|decreased|decreasing|reduce|reduced|reducing|cut|lower|lowered|decline|declined)\b/i;
const HIGH_RESPONSIBILITY = /\b(?:lead|led|leading|own|owned|owner|drive|drove|driven|manage|managed|direct|directed|head|headed|spearhead|spearheaded)\b/i;
const LOW_RESPONSIBILITY = /\b(?:assist|assisted|support|supported|contribute|contributed|collaborate|collaborated|participate|participated)\b/i;
const HIGH_PROFICIENCY = /\b(?:expert|expertise|master|mastered|mastery|advanced|authority|specialist)\b/i;
const LOW_PROFICIENCY = /\b(?:familiar|familiarity|basic|beginner|exposure|introductory|working knowledge)\b/i;

function stringValue(fact: Fact): string | null {
  return fact.status === "verified" && typeof fact.value === "string" && fact.value.trim().length > 0
    ? fact.value.trim()
    : null;
}

function factById(facts: readonly Fact[]): Map<string, Fact> {
  return new Map(facts.filter((fact) => stringValue(fact) !== null).map((fact) => [fact.id, fact]));
}

function tokens(value: string): Set<string> {
  return new Set(
    (value.toLowerCase().match(/[\p{L}\p{N}+#.]+/gu) ?? [])
      .map((token) => token.replace(/^\.+|\.+$/g, ""))
      .filter((token) => token.length > 0 && !STOP_WORDS.has(token)),
  );
}

function numbers(value: string): string[] {
  return [...value.matchAll(/\d+(?:[.,]\d+)*/g)].map((match) => match[0].replace(/,/g, ""));
}

/** A generated answer may rearrange verified wording, but it may not invent claim-bearing terms or meaning. */
export function groundedDraft(draft: string, sourceTexts: readonly string[]): boolean {
  const support = sourceTexts.join(" ");
  const supportTokens = tokens(support);
  if ([...tokens(draft)].some((token) => !supportTokens.has(token))) return false;

  const supportNumbers = new Set(numbers(support));
  if (numbers(draft).some((number) => !supportNumbers.has(number))) return false;
  if (NEGATION.test(draft) !== NEGATION.test(support)) return false;
  if ((INCREASE.test(draft) && DECREASE.test(support)) || (DECREASE.test(draft) && INCREASE.test(support))) return false;
  if (HIGH_RESPONSIBILITY.test(draft) && LOW_RESPONSIBILITY.test(support) && !HIGH_RESPONSIBILITY.test(support)) return false;
  if (HIGH_PROFICIENCY.test(draft) && LOW_PROFICIENCY.test(support) && !HIGH_PROFICIENCY.test(support)) return false;
  return true;
}

function stricterSensitivity(left: FieldNormalization["sensitivity"], right: FieldNormalization["sensitivity"]): FieldNormalization["sensitivity"] {
  const order = { normal: 0, pii: 1, sensitive: 2, secret: 3 } as const;
  return order[left] >= order[right] ? left : right;
}

export function buildFormModelRequest(input: {
  snapshot: BrowserPageSnapshot;
  normalizations: Record<string, FieldNormalization>;
  facts: readonly Fact[];
}): FormModelRequest {
  return {
    pageTitle: input.snapshot.title.slice(0, 500),
    fields: input.snapshot.targets
      .filter((target) => target.kind === "field" && !target.disabled && target.observedValue.state === "empty")
      .map((target) => {
        const normalization = input.normalizations[target.id];
        return {
          targetId: target.id,
          label: target.accessibleName,
          question: target.question,
          controlType: target.controlType,
          required: target.required,
          sensitivity: target.sensitivity,
          options: target.options.map((option) => option.label),
          deterministicCanonicalField: normalization?.canonicalField ?? "unknown",
          deterministicConfidence: normalization?.confidence ?? 0,
          deterministicContested: normalization?.contested ?? false,
        };
      }),
    facts: input.facts.flatMap((fact) => {
      const value = stringValue(fact);
      if (value === null) return [];
      const mayDraft = fact.sensitivity === "normal";
      return [{
        factId: fact.id,
        key: fact.key,
        kind: fact.kind,
        sensitivity: fact.sensitivity,
        ...(mayDraft ? { value: value.slice(0, 2_000) } : {}),
        valueWithheld: !mayDraft,
      }];
    }),
  };
}

function answerId(snapshotId: string, targetId: string, factIds: readonly string[], value: string): string {
  const digest = createHash("sha256").update(JSON.stringify([snapshotId, targetId, factIds, value])).digest("hex");
  return `answer:ai:${digest.slice(0, 24)}`;
}

function rejected(targetId: string, code: RejectedFormProposal["code"]): RejectedFormProposal {
  return { targetId, code };
}

/**
 * Ask the model for suggestions, then rebuild every executable decision locally.
 * Model output never contains selectors or tool calls and is treated as untrusted input.
 */
export async function createFormIntelligencePlan(input: {
  snapshot: BrowserPageSnapshot;
  normalizations: Record<string, FieldNormalization>;
  safetySignals: readonly PolicySafetySignal[];
  facts: readonly Fact[];
  provider: FormIntelligenceProvider;
  evaluatedAt: string;
}): Promise<FormIntelligencePlan> {
  const modelResult = await input.provider.generatePlan(buildFormModelRequest(input));
  const output = FormModelOutputSchema.parse(modelResult.output);
  const facts = factById(input.facts);
  const targets = new Map(input.snapshot.targets.map((target) => [target.id, target]));
  const seenTargets = new Set<string>();
  const answers: AnswerSource[] = [];
  const values = new Map<string, string>();
  const normalizations = { ...input.normalizations };
  const rejectedProposals: RejectedFormProposal[] = [];

  for (const proposal of output.proposals) {
    if (seenTargets.has(proposal.targetId)) {
      rejectedProposals.push(rejected(proposal.targetId, "duplicate_target"));
      continue;
    }
    seenTargets.add(proposal.targetId);

    const target = targets.get(proposal.targetId);
    if (!target || target.kind !== "field") {
      rejectedProposals.push(rejected(proposal.targetId, "unknown_target"));
      continue;
    }
    if (target.observedValue.state !== "empty") {
      rejectedProposals.push(rejected(proposal.targetId, "field_not_empty"));
      continue;
    }
    if (!TEXT_CONTROLS.has(target.controlType)) {
      rejectedProposals.push(rejected(proposal.targetId, "unsupported_control"));
      continue;
    }

    const question = `${target.accessibleName} ${target.question}`;
    const canonicalSensitivity = sensitivityOf(proposal.canonicalField);
    if (
      proposal.action === "human" ||
      target.sensitivity === "sensitive" ||
      target.sensitivity === "secret" ||
      canonicalSensitivity === "sensitive" ||
      SENSITIVE_QUESTION.test(question)
    ) {
      rejectedProposals.push(rejected(proposal.targetId, "sensitive_field"));
      continue;
    }
    if (PAGE_INSTRUCTION.test(question)) {
      rejectedProposals.push(rejected(proposal.targetId, "prompt_injection_signal"));
      continue;
    }

    const citedFacts = proposal.factIds.map((id) => facts.get(id));
    if (citedFacts.some((fact) => !fact)) {
      rejectedProposals.push(rejected(proposal.targetId, "unknown_fact"));
      continue;
    }
    const verifiedFacts = citedFacts as Fact[];
    const existing = input.normalizations[target.id] ?? {
      canonicalField: "unknown",
      confidence: 0,
      sensitivity: target.sensitivity,
      evidence: [],
      contested: false,
    };
    const disagrees = existing.canonicalField !== "unknown" && existing.canonicalField !== proposal.canonicalField;
    const confidence = disagrees && existing.confidence >= 0.7
      ? Math.min(0.65, proposal.confidence)
      : Math.min(0.95, proposal.confidence);

    normalizations[target.id] = {
      canonicalField: proposal.canonicalField,
      confidence,
      sensitivity: stricterSensitivity(target.sensitivity, canonicalSensitivity),
      contested: existing.contested || disagrees,
      evidence: [
        ...existing.evidence,
        {
          source: "ai_model",
          detail: `${modelResult.model}: ${proposal.reason}`.slice(0, 500),
          canonicalField: proposal.canonicalField,
          weight: confidence,
        },
      ],
    };

    if (proposal.action === "direct") {
      if (verifiedFacts.length !== 1 || proposal.draftText !== null) {
        rejectedProposals.push(rejected(proposal.targetId, "invalid_direct_answer"));
        continue;
      }
      const fact = verifiedFacts[0] as Fact;
      const value = stringValue(fact);
      if (value === null) {
        rejectedProposals.push(rejected(proposal.targetId, "invalid_direct_answer"));
        continue;
      }
      answers.push({
        canonicalField: proposal.canonicalField,
        factId: fact.id,
        factStatus: "verified",
        sourceCount: fact.sources.length,
        sensitivity: fact.sensitivity,
        provenance: "verified_fact",
      });
      values.set(fact.id, value);
      continue;
    }

    if (
      proposal.action !== "draft" ||
      !proposal.draftText ||
      verifiedFacts.length === 0 ||
      target.sensitivity !== "normal" ||
      canonicalSensitivity !== "normal" ||
      !NARRATIVE_QUESTION.test(question) ||
      verifiedFacts.some((fact) => fact.sensitivity !== "normal")
    ) {
      rejectedProposals.push(rejected(proposal.targetId, "invalid_draft_sources"));
      continue;
    }

    const sourceTexts = verifiedFacts.map((fact) => stringValue(fact)).filter((value): value is string => value !== null);
    if (!groundedDraft(proposal.draftText, sourceTexts)) {
      rejectedProposals.push(rejected(proposal.targetId, "unsupported_draft"));
      continue;
    }

    const id = answerId(input.snapshot.snapshotId, target.id, proposal.factIds, proposal.draftText);
    answers.push({
      canonicalField: proposal.canonicalField,
      factId: id,
      factStatus: "verified",
      sourceCount: verifiedFacts.reduce((count, fact) => count + fact.sources.length, 0),
      sensitivity: "normal",
      provenance: "answer_policy",
      answerReuse: "this_application_only",
    });
    values.set(id, proposal.draftText);
  }

  const plan = planFill({
    snapshot: input.snapshot,
    normalizations,
    answers,
    safetySignals: input.safetySignals,
    evaluatedAt: input.evaluatedAt,
  });

  return {
    plan,
    answers,
    valueByAnswerId: values,
    normalizations,
    rejected: rejectedProposals,
    provider: modelResult.provider,
    model: modelResult.model,
    ...(modelResult.responseId ? { responseId: modelResult.responseId } : {}),
    ...(modelResult.inputTokens === undefined ? {} : { inputTokens: modelResult.inputTokens }),
    ...(modelResult.outputTokens === undefined ? {} : { outputTokens: modelResult.outputTokens }),
    proposedCount: output.proposals.length,
    acceptedCount: answers.length,
  };
}
