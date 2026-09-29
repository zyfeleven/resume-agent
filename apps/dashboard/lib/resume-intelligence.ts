import {
  ResumeChangeSetSchema,
  ResumeTailorReportSchema,
  type Fact,
  type JDRequirement,
  type Job,
  type RequirementFactMatch,
  type ResumeChange,
  type ResumeChangeSet,
  type ResumeIR,
  type ResumeTailorReport,
} from "@resume-agent/contracts";
import {
  applyReviewedChanges,
  factSnapshotHash,
  hashJson,
  resumeItems,
  stableId,
} from "@resume-agent/resume-tailor";
import { z } from "zod";

import { groundedDraft } from "./form-intelligence";

const ItemProposalSchema = z
  .object({
    targetItemId: z.string().min(1).max(200),
    action: z.enum(["keep", "rewrite", "remove"]),
    requirementIds: z.array(z.string().min(1).max(200)).max(50),
    after: z.string().max(4_000).nullable(),
    confidence: z.number().min(0).max(1),
    rationale: z.string().min(1).max(1_000),
  })
  .strict();

const RequirementMatchSchema = z
  .object({
    requirementId: z.string().min(1).max(200),
    factIds: z.array(z.string().min(1).max(200)).max(50),
    strength: z.enum(["exact", "related", "missing"]),
    confidence: z.number().min(0).max(1),
    rationale: z.string().min(1).max(1_000),
  })
  .strict();

export const ResumeModelOutputSchema = z
  .object({
    requirementMatches: z.array(RequirementMatchSchema).max(500),
    itemProposals: z.array(ItemProposalSchema).max(1_000),
  })
  .strict();

export type ResumeModelOutput = z.infer<typeof ResumeModelOutputSchema>;

export const RESUME_MODEL_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["requirementMatches", "itemProposals"],
  properties: {
    requirementMatches: {
      type: "array",
      maxItems: 500,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["requirementId", "factIds", "strength", "confidence", "rationale"],
        properties: {
          requirementId: { type: "string" },
          factIds: { type: "array", maxItems: 50, items: { type: "string" } },
          strength: { type: "string", enum: ["exact", "related", "missing"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          rationale: { type: "string", minLength: 1, maxLength: 1000 },
        },
      },
    },
    itemProposals: {
      type: "array",
      maxItems: 1000,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["targetItemId", "action", "requirementIds", "after", "confidence", "rationale"],
        properties: {
          targetItemId: { type: "string" },
          action: { type: "string", enum: ["keep", "rewrite", "remove"] },
          requirementIds: { type: "array", maxItems: 50, items: { type: "string" } },
          after: { anyOf: [{ type: "string", maxLength: 4000 }, { type: "null" }] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          rationale: { type: "string", minLength: 1, maxLength: 1000 },
        },
      },
    },
  },
} as const;

export interface ResumeModelRequest {
  job: { id: string; title: string; company: string };
  requirements: Array<{ id: string; text: string; priority: string; kind: string }>;
  facts: Array<{ id: string; key: string; kind: string; value: string }>;
  items: Array<{ id: string; section: string; text: string; factIds: string[] }>;
}

export interface ResumeModelResult {
  output: unknown;
  provider: "gemini";
  model: string;
  responseId?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ResumeIntelligenceProvider {
  optimize(request: ResumeModelRequest): Promise<ResumeModelResult>;
}

export class ResumeIntelligenceError extends Error {
  constructor(
    readonly code: "INVALID_MODEL_PLAN" | "UNSUPPORTED_REWRITE",
    message: string,
  ) {
    super(message);
    this.name = "ResumeIntelligenceError";
  }
}

export interface ResumeIntelligenceResult {
  changeSet: ResumeChangeSet;
  proposedResume: ResumeIR;
  matches: RequirementFactMatch[];
  report: ResumeTailorReport;
  provider: "gemini";
  model: string;
  responseId?: string;
  inputTokens?: number;
  outputTokens?: number;
}

function factText(fact: Fact): string | null {
  return fact.status === "verified" && fact.sensitivity === "normal" && typeof fact.value === "string"
    ? fact.value.trim() || null
    : null;
}

export function buildResumeModelRequest(input: {
  job: Job;
  requirements: readonly JDRequirement[];
  facts: readonly Fact[];
  baseResume: ResumeIR;
}): ResumeModelRequest {
  const facts = input.facts.flatMap((fact) => {
    const value = factText(fact);
    return value === null ? [] : [{ id: fact.id, key: fact.key, kind: fact.kind, value: value.slice(0, 4_000) }];
  });
  const visibleFactIds = new Set(facts.map((fact) => fact.id));

  return {
    job: { id: input.job.id, title: input.job.title, company: input.job.company },
    requirements: input.requirements.map((requirement) => ({
      id: requirement.id,
      text: requirement.text,
      priority: requirement.priority,
      kind: requirement.kind,
    })),
    facts,
    items: resumeItems(input.baseResume).map(({ item, section }) => ({
      id: item.id,
      section,
      // Resume content backed by non-normal facts is withheld from the model.
      text: item.factIds.every((factId) => visibleFactIds.has(factId)) ? item.text : "[withheld]",
      factIds: item.factIds.filter((factId) => visibleFactIds.has(factId)),
    })),
  };
}

function requirementSnapshot(requirements: readonly JDRequirement[]): string {
  return hashJson(
    [...requirements]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((requirement) => [requirement.id, requirement.priority, requirement.text]),
  );
}

function invalid(message: string): never {
  throw new ResumeIntelligenceError("INVALID_MODEL_PLAN", message);
}

/** Treat Gemini output as untrusted and rebuild the entire change set from local snapshots. */
export async function createResumeIntelligenceChangeSet(input: {
  job: Job;
  profileId: string;
  baseResume: ResumeIR;
  baseResumeVersionId: string;
  requirements: readonly JDRequirement[];
  facts: readonly Fact[];
  provider: ResumeIntelligenceProvider;
  generatedAt: string;
}): Promise<ResumeIntelligenceResult> {
  const modelResult = await input.provider.optimize(buildResumeModelRequest(input));
  const output = ResumeModelOutputSchema.parse(modelResult.output);
  const items = resumeItems(input.baseResume);
  const itemsById = new Map(items.map(({ item, section }) => [item.id, { item, section }]));
  const factsById = new Map(input.facts.filter((fact) => factText(fact) !== null).map((fact) => [fact.id, fact]));
  const requirementsById = new Map(input.requirements.map((requirement) => [requirement.id, requirement]));

  if (new Set(output.itemProposals.map((proposal) => proposal.targetItemId)).size !== items.length || output.itemProposals.length !== items.length) {
    invalid("Gemini must return exactly one proposal for every resume item.");
  }
  if (
    new Set(output.requirementMatches.map((match) => match.requirementId)).size !== input.requirements.length ||
    output.requirementMatches.length !== input.requirements.length
  ) {
    invalid("Gemini must return exactly one match decision for every job requirement.");
  }

  const matches: RequirementFactMatch[] = output.requirementMatches.map((match) => {
    if (!requirementsById.has(match.requirementId)) invalid(`Unknown requirement ${match.requirementId}.`);
    if (new Set(match.factIds).size !== match.factIds.length) invalid("A requirement match cannot cite the same fact twice.");
    if (match.factIds.some((factId) => !factsById.has(factId))) invalid(`Requirement ${match.requirementId} cites an unavailable fact.`);
    if (match.strength === "missing" && match.factIds.length > 0) invalid("A missing requirement cannot cite supporting facts.");
    if (match.strength !== "missing" && match.factIds.length === 0) invalid("A supported requirement must cite a verified fact.");
    if (match.strength !== "missing" && match.confidence < 0.7) invalid("A semantic match below the local confidence threshold cannot support resume content.");

    return {
      requirementId: match.requirementId,
      factIds: [...new Set(match.factIds)],
      strength: match.strength,
      rationale: match.rationale,
      confidence: match.strength === "missing" ? 0 : match.confidence,
      evidence: match.factIds.map((factId) => ({
        factId,
        basis: "semantic_model" as const,
        terms: [(factsById.get(factId)?.key ?? "semantic evidence").slice(0, 120)],
      })),
    };
  });
  const matchByRequirement = new Map(matches.map((match) => [match.requirementId, match]));

  const changes: ResumeChange[] = output.itemProposals.map((proposal) => {
    const target = itemsById.get(proposal.targetItemId);
    if (!target) invalid(`Unknown resume item ${proposal.targetItemId}.`);
    if (proposal.confidence < 0.7 && proposal.action !== "remove") invalid(`Gemini was not confident enough to keep or rewrite ${proposal.targetItemId}.`);
    if (new Set(proposal.requirementIds).size !== proposal.requirementIds.length) invalid("A proposal cannot cite the same requirement twice.");
    if (proposal.requirementIds.some((requirementId) => !requirementsById.has(requirementId))) invalid("A proposal cites an unknown requirement.");

    const supportedRequirements = proposal.requirementIds.filter((requirementId) => {
      const match = matchByRequirement.get(requirementId);
      return match && match.strength !== "missing" && match.factIds.some((factId) => target.item.factIds.includes(factId));
    });
    if (supportedRequirements.length !== proposal.requirementIds.length) invalid("A proposal cites a requirement not supported by its own facts.");

    const id = stableId("change", [input.job.id, target.item.id, modelResult.model]);
    const base = {
      id,
      targetItemId: target.item.id,
      factIds: target.item.factIds,
      requirementIds: supportedRequirements,
      rationale: `Gemini (${Math.round(proposal.confidence * 100)}%): ${proposal.rationale}`,
    };

    if (proposal.action === "remove") {
      if (proposal.after !== null || proposal.requirementIds.length > 0) invalid("A removal cannot contain rewritten text or requirement citations.");
      return { ...base, intent: "remove", before: target.item.text, after: null };
    }
    if (supportedRequirements.length === 0) invalid("A kept or rewritten item must answer at least one supported requirement.");

    if (proposal.action === "keep") {
      if (proposal.after !== null) invalid("A keep proposal cannot replace the original wording.");
      return { ...base, intent: "keep", before: target.item.text };
    }

    if (!proposal.after) invalid("A rewrite proposal must include replacement text.");
    const sourceTexts = target.item.factIds
      .map((factId) => factsById.get(factId))
      .map((fact) => (fact ? factText(fact) : null))
      .filter((value): value is string => value !== null);
    if (sourceTexts.length !== target.item.factIds.length || !groundedDraft(proposal.after, sourceTexts)) {
      throw new ResumeIntelligenceError(
        "UNSUPPORTED_REWRITE",
        `Gemini's rewrite for ${target.item.id} introduced wording or meaning absent from its verified facts.`,
      );
    }
    return { ...base, intent: "rewrite", before: target.item.text, after: proposal.after };
  });

  const baseContentHash = hashJson(input.baseResume);
  const provisional = ResumeChangeSetSchema.parse({
    id: stableId("change-set", [input.job.id, baseContentHash, modelResult.model, modelResult.responseId ?? input.generatedAt]),
    jobId: input.job.id,
    baseResumeVersionId: input.baseResumeVersionId,
    baseContentHash,
    resultContentHash: "0".repeat(64),
    factSnapshotHash: factSnapshotHash(input.facts),
    requirementSnapshotHash: requirementSnapshot(input.requirements),
    changes,
    promptVersion: "gemini-resume-optimizer-v1",
    model: modelResult.model,
    contentHash: "0".repeat(64),
    createdAt: input.generatedAt,
    updatedAt: input.generatedAt,
  });
  const proposedResume = applyReviewedChanges(input.baseResume, provisional, []).resume;
  const resultContentHash = hashJson(proposedResume);
  const changeSet = ResumeChangeSetSchema.parse({
    ...provisional,
    resultContentHash,
    contentHash: hashJson([provisional.id, baseContentHash, resultContentHash, provisional.factSnapshotHash, changes]),
  });
  const report = ResumeTailorReportSchema.parse({
    id: stableId("tailor-report", [changeSet.id, input.generatedAt]),
    jobId: input.job.id,
    profileId: input.profileId,
    changeSetId: changeSet.id,
    baseResumeVersionId: input.baseResumeVersionId,
    generatorVersion: "gemini-resume-optimizer-v1",
    generatedAt: input.generatedAt,
    verifiedFactCount: input.facts.filter((fact) => fact.status === "verified").length,
    keptItemCount: changes.filter((change) => change.intent !== "remove").length,
    removedItemCount: changes.filter((change) => change.intent === "remove").length,
    coverage: matches.map((match) => ({
      requirementId: match.requirementId,
      priority: requirementsById.get(match.requirementId)?.priority ?? "context",
      strength: match.strength,
      factIds: match.factIds,
    })),
    skipped: [],
  });

  return {
    changeSet,
    proposedResume,
    matches,
    report,
    provider: modelResult.provider,
    model: modelResult.model,
    ...(modelResult.responseId ? { responseId: modelResult.responseId } : {}),
    ...(modelResult.inputTokens === undefined ? {} : { inputTokens: modelResult.inputTokens }),
    ...(modelResult.outputTokens === undefined ? {} : { outputTokens: modelResult.outputTokens }),
  };
}
