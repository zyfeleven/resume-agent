import {
  FactConflictDecisionSchema,
  FactSchema,
  EntityIdSchema,
  IsoDateTimeSchema,
  Sha256Schema,
  type Fact,
  type FactConflictDecision,
  type FactKind,
  type JsonValue,
} from "@resume-agent/contracts";
import { createHash } from "node:crypto";

import { ResumeImportError } from "./errors.js";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableId(prefix: string, parts: readonly string[]): string {
  const encoded = parts.map((part) => `${part.length}:${part}`).join("|");
  return `${prefix}:${sha256(encoded).slice(0, 24)}`;
}

function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key] as JsonValue)]));
  }
  return value;
}

function valueIdentity(fact: Fact): string {
  return JSON.stringify(canonicalize(fact.value));
}

function updatedFactBase(fact: Fact, decidedAt: string) {
  return {
    id: fact.id,
    profileId: fact.profileId,
    kind: fact.kind,
    key: fact.key,
    value: fact.value,
    sensitivity: fact.sensitivity,
    sources: fact.sources,
    version: fact.version + 1,
    createdAt: fact.createdAt,
    updatedAt: decidedAt,
  };
}

export interface FactConflict {
  id: string;
  profileId: string;
  kind: FactKind;
  key: string;
  candidateFactIds: string[];
  reviewedConflictHash: string;
}

function conflictHash(facts: readonly Fact[]): string {
  const snapshot = [...facts]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((fact) => ({
      id: fact.id,
      value: canonicalize(fact.value),
      status: fact.status,
      version: fact.version,
      sources: [...fact.sources].sort((left, right) =>
        `${left.artifactId}\u0000${left.locator}\u0000${left.excerpt ?? ""}`.localeCompare(
          `${right.artifactId}\u0000${right.locator}\u0000${right.excerpt ?? ""}`,
        ),
      ),
    }));
  return sha256(JSON.stringify(snapshot));
}

/** Find active facts that assert different values for the same canonical key. */
export function detectFactConflicts(factInputs: readonly unknown[]): FactConflict[] {
  const facts = factInputs.map((fact) => FactSchema.parse(fact));
  const groups = new Map<string, Fact[]>();

  for (const fact of facts) {
    if (fact.status === "rejected") continue;
    const groupId = JSON.stringify([fact.profileId, fact.kind, fact.key]);
    groups.set(groupId, [...(groups.get(groupId) ?? []), fact]);
  }

  const conflicts: FactConflict[] = [];
  for (const group of groups.values()) {
    if (group.length < 2 || new Set(group.map(valueIdentity)).size < 2) continue;
    const candidates = [...group].sort((left, right) => left.id.localeCompare(right.id));
    const first = candidates[0];
    if (!first) continue;
    const candidateFactIds = candidates.map((fact) => fact.id);
    conflicts.push({
      id: stableId("fact-conflict", [first.profileId, first.kind, first.key, ...candidateFactIds]),
      profileId: first.profileId,
      kind: first.kind,
      key: first.key,
      candidateFactIds,
      reviewedConflictHash: conflictHash(candidates),
    });
  }

  return conflicts.sort((left, right) => left.id.localeCompare(right.id));
}

export function conflictedFactIds(facts: readonly Fact[]): Set<string> {
  return new Set(detectFactConflicts(facts).flatMap((conflict) => conflict.candidateFactIds));
}

/** Facts safe for downstream generation and browser filling. */
export function usableFacts(facts: readonly Fact[]): Fact[] {
  const blocked = conflictedFactIds(facts);
  return facts.filter((fact) => !blocked.has(fact.id));
}

export interface ResolveFactConflictInput {
  conflictId: string;
  selectedFactId: string;
  reviewedConflictHash: string;
  decidedBy: string;
  decidedAt: string;
}

export interface ResolveFactConflictResult {
  facts: Fact[];
  decision: FactConflictDecision;
}

/** Select one assertion and reject every competing value in the reviewed conflict snapshot. */
export function resolveFactConflict(
  factInputs: readonly unknown[],
  input: ResolveFactConflictInput,
): ResolveFactConflictResult {
  const facts = factInputs.map((fact) => FactSchema.parse(fact));
  const parsedInput = {
    conflictId: EntityIdSchema.parse(input.conflictId),
    selectedFactId: EntityIdSchema.parse(input.selectedFactId),
    reviewedConflictHash: Sha256Schema.parse(input.reviewedConflictHash),
    decidedBy: EntityIdSchema.parse(input.decidedBy),
    decidedAt: IsoDateTimeSchema.parse(input.decidedAt),
  };
  const conflict = detectFactConflicts(facts).find((candidate) => candidate.id === parsedInput.conflictId);
  if (!conflict) {
    throw new ResumeImportError("CONFLICT_NOT_FOUND", `Conflict ${parsedInput.conflictId} is no longer active.`);
  }
  if (conflict.reviewedConflictHash !== parsedInput.reviewedConflictHash) {
    throw new ResumeImportError("STALE_CONFLICT", "The conflict evidence changed after it was reviewed.");
  }
  if (!conflict.candidateFactIds.includes(parsedInput.selectedFactId)) {
    throw new ResumeImportError(
      "INVALID_CONFLICT_SELECTION",
      `Fact ${parsedInput.selectedFactId} is not a candidate in conflict ${conflict.id}.`,
    );
  }

  const candidateIds = new Set(conflict.candidateFactIds);
  const resolved = facts.map((fact): Fact => {
    if (!candidateIds.has(fact.id)) return fact;
    if (Date.parse(parsedInput.decidedAt) < Date.parse(fact.updatedAt)) {
      throw new ResumeImportError("REVIEW_TIME_REGRESSION", "Decision time cannot move backwards.");
    }
    const base = updatedFactBase(fact, parsedInput.decidedAt);
    if (fact.id === parsedInput.selectedFactId) {
      return FactSchema.parse({
        ...base,
        status: "verified",
        verification: { verifiedBy: "user", verifiedAt: parsedInput.decidedAt },
      });
    }
    return FactSchema.parse({
      ...base,
      status: "rejected",
      rejection: {
        rejectedBy: parsedInput.decidedBy,
        rejectedAt: parsedInput.decidedAt,
        reason: `Superseded by ${parsedInput.selectedFactId} during conflict review.`,
      },
    });
  });

  const decision = FactConflictDecisionSchema.parse({
    id: stableId("fact-conflict-decision", [conflict.id, parsedInput.selectedFactId, parsedInput.reviewedConflictHash]),
    conflictId: conflict.id,
    profileId: conflict.profileId,
    kind: conflict.kind,
    key: conflict.key,
    candidateFactIds: conflict.candidateFactIds,
    selectedFactId: parsedInput.selectedFactId,
    reviewedConflictHash: parsedInput.reviewedConflictHash,
    decidedBy: parsedInput.decidedBy,
    decidedAt: parsedInput.decidedAt,
  });

  return { facts: resolved, decision };
}
