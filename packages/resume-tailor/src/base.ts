import {
  ResumeIRSchema,
  type BaseResumeSkip,
  type Fact,
  type ResumeIR,
} from "@resume-agent/contracts";
import { createHash } from "node:crypto";

import { ResumeTailorError } from "./errors.js";

export const BUILDER_VERSION = "resume-base-v1";

export interface BaseResumeResult {
  resume: ResumeIR;
  contentHash: string;
  skipped: BaseResumeSkip[];
}

/** Length-prefixed parts keep the digest unambiguous when a value contains the separator. */
export function stableId(prefix: string, parts: readonly string[]): string {
  const encoded = parts.map((part) => `${part.length}:${part}`).join("|");
  return `${prefix}:${createHash("sha256").update(encoded).digest("hex").slice(0, 24)}`;
}

export function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * Digest of the verified facts a change set was generated from. Binding a change set to
 * it means an edited or newly rejected fact invalidates the proposal instead of silently
 * leaving an unsupported line in a resume.
 */
export function factSnapshotHash(facts: readonly Fact[]): string {
  return hashJson(
    [...facts]
      .filter((fact) => fact.status === "verified")
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((fact) => [fact.id, fact.version, fact.value]),
  );
}

function factText(fact: Fact): string {
  return typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value);
}

function contentItem(fact: Fact) {
  return {
    id: stableId("item", [fact.id]),
    text: factText(fact).slice(0, 4_000),
    factIds: [fact.id],
    requirementIds: [],
  };
}

/** `employment.northstar-labs.role` -> `northstar-labs` */
function entryKey(key: string): string | null {
  const match = /^(?:employment)\.([^.]+)\./.exec(key);
  return match?.[1] ?? null;
}

/**
 * Build the candidate's full resume from their verified facts.
 *
 * Only `verified` facts are readable here: a pending or rejected fact is invisible to
 * every later step, so nothing a person has not confirmed can reach a resume. Every
 * item's text is a fact's own value, and every item cites the fact it came from — the
 * contract's `factIds` minimum makes an uncited item unrepresentable.
 */
export function buildBaseResume(profileId: string, allFacts: readonly Fact[]): BaseResumeResult {
  // The caller may hold facts for more than one candidate. A profile-specific resume
  // must never absorb a verified fact merely because it appeared in the same array.
  const profileFacts = allFacts.filter((fact) => fact.profileId === profileId);
  const facts = profileFacts.filter((fact) => fact.status === "verified");
  const skipped: BaseResumeSkip[] = [];

  const unverifiedCount = profileFacts.length - facts.length;
  if (unverifiedCount > 0) {
    skipped.push({ key: `${unverifiedCount} unverified fact(s)`, reason: "unverified_fact" });
  }

  const headerFactIds = facts
    .filter((fact) => fact.kind === "identity" || fact.kind === "contact")
    .map((fact) => fact.id);

  if (headerFactIds.length === 0) {
    throw new ResumeTailorError(
      "NO_VERIFIED_HEADER_FACT",
      "Verify at least one identity or contact fact before building a resume.",
    );
  }

  const byKey = new Map(facts.map((fact) => [fact.key, fact]));
  const entryKeys: string[] = [];
  for (const fact of facts) {
    const key = fact.kind === "employment" || fact.kind === "achievement" ? entryKey(fact.key) : null;
    if (key && !entryKeys.includes(key)) {
      entryKeys.push(key);
    }
  }

  const experience = [];
  for (const key of entryKeys) {
    const role = byKey.get(`employment.${key}.role`);
    const organization = byKey.get(`employment.${key}.organization`);
    const dates = byKey.get(`employment.${key}.dates`);

    // An entry is only built when the facts that identify it are all verified.
    if (!role) {
      skipped.push({ key, reason: "unverified_role" });
      continue;
    }
    if (!organization) {
      skipped.push({ key, reason: "unverified_organization" });
      continue;
    }
    if (!dates) {
      skipped.push({ key, reason: "unverified_dates" });
      continue;
    }

    experience.push({
      id: stableId("experience", [key]),
      organizationFactId: organization.id,
      roleFactId: role.id,
      dateFactIds: [dates.id],
      bullets: facts
        .filter((fact) => fact.kind === "achievement" && entryKey(fact.key) === key)
        .map(contentItem),
    });
  }

  const resume = ResumeIRSchema.parse({
    profileId,
    headerFactIds,
    summary: facts.filter((fact) => fact.kind === "achievement" && fact.key.startsWith("summary.")).map(contentItem),
    skills: facts.filter((fact) => fact.kind === "skill").map(contentItem),
    experience,
    projects: facts.filter((fact) => fact.kind === "project" && !fact.key.includes(".detail.")).map(contentItem),
    education: facts.filter((fact) => fact.kind === "education" && !fact.key.includes(".dates")).map(contentItem),
  });

  return { resume, contentHash: hashJson(resume), skipped };
}

/** Every content item in the resume, in the order a reader would meet it. */
export function resumeItems(resume: ResumeIR) {
  return [
    ...resume.summary.map((item) => ({ item, section: "summary" as const })),
    ...resume.experience.flatMap((entry) =>
      entry.bullets.map((item) => ({ item, section: "experience" as const, experienceId: entry.id })),
    ),
    ...resume.skills.map((item) => ({ item, section: "skills" as const })),
    ...resume.projects.map((item) => ({ item, section: "projects" as const })),
    ...resume.education.map((item) => ({ item, section: "education" as const })),
  ];
}
