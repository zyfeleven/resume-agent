import {
  RequirementFactMatchSchema,
  type Fact,
  type JDRequirement,
  type RequirementFactEvidence,
  type RequirementFactMatch,
} from "@resume-agent/contracts";

export const MATCHER_VERSION = "requirement-match-v2";

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "have", "in", "into", "is", "it",
  "of", "on", "or", "our", "the", "their", "to", "up", "was", "we", "with", "you", "your", "will",
  "who", "that", "this", "these", "those", "using", "used", "use", "able", "ability", "strong",
  "excellent", "good", "great", "plus", "years", "year", "experience", "work", "working", "team",
  "teams", "role", "new", "other", "across", "within", "including", "such",
]);

/** Reduce related word forms to one deterministic comparison token. */
function stem(token: string): string {
  let value = token;
  if (value.length > 3 && value.endsWith("s") && !value.endsWith("ss")) value = value.slice(0, -1);
  for (const suffix of ["ers", "er", "ing", "ed"]) {
    if (value.length > suffix.length + 3 && value.endsWith(suffix)) return value.slice(0, -suffix.length);
  }
  return value;
}

/** Lowercase alphanumeric stems, minus stopwords. */
export function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9+#.]+/)) {
    const token = raw.replace(/^\.+|\.+$/g, "");
    if (token.length < 2 || STOPWORDS.has(token)) continue;
    tokens.add(stem(token));
  }
  return tokens;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
};

function statedYears(text: string): number | null {
  const lowered = text.toLowerCase();
  const values: number[] = [];
  for (const match of lowered.matchAll(/(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?(?:years?|yrs?)\b/g)) {
    values.push(Number(match[1]));
  }
  for (const match of lowered.matchAll(/([a-z]+)\s+(?:years?|yrs?)\b/g)) {
    const word = match[1];
    const value = word ? NUMBER_WORDS[word] : undefined;
    if (value !== undefined) values.push(value);
  }
  return values.length > 0 ? Math.max(...values) : null;
}

function factText(fact: Fact): string {
  return typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value);
}

function overlap(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((token) => right.has(token));
}

interface MatchCandidates {
  exact: RequirementFactEvidence[];
  related: RequirementFactEvidence[];
  bestOverlap: number;
}

function collectCandidates(requirement: JDRequirement, facts: readonly Fact[]): MatchCandidates {
  const requirementTokens = tokenize(requirement.text);
  const requiredYears = statedYears(requirement.text);
  const exact: RequirementFactEvidence[] = [];
  const related: RequirementFactEvidence[] = [];
  let bestOverlap = 0;

  for (const fact of facts) {
    if (fact.status !== "verified") continue;
    const text = factText(fact);
    const lowered = text.toLowerCase();
    const matchedKeywords = requirement.keywords.filter((keyword) => {
      const needle = keyword.toLowerCase();
      if (needle.length < 2) return false;
      return lowered.includes(needle) || (lowered.length >= 4 && needle.includes(lowered));
    }).slice(0, 20);

    if (matchedKeywords.length > 0) {
      exact.push({ factId: fact.id, basis: "keyword", terms: [...new Set(matchedKeywords)] });
      continue;
    }

    const factTokens = tokenize(`${text} ${fact.key.replace(/[._]/g, " ")}`);
    const shared = overlap(requirementTokens, factTokens);
    const meetsYears = requiredYears !== null && (statedYears(text) ?? 0) >= requiredYears;
    if (shared.length >= 2 || (shared.length >= 1 && (factTokens.size <= 3 || meetsYears))) {
      related.push({
        factId: fact.id,
        basis: shared.length === 1 && meetsYears ? "term_and_duration" : "term_overlap",
        terms: shared.slice(0, 20),
      });
      bestOverlap = Math.max(bestOverlap, shared.length);
    }
  }

  return { exact, related, bestOverlap };
}

function factIds(evidence: readonly RequirementFactEvidence[]): string[] {
  return evidence.map((entry) => entry.factId);
}

export interface MatchRequirementOptions {
  /** Verified facts in this set may be displayed as disputed evidence, but never count as support. */
  blockedFactIds?: readonly string[];
}

/** Match one requirement against verified facts using explicit lexical evidence only. */
export function matchRequirement(
  requirement: JDRequirement,
  facts: readonly Fact[],
  options: MatchRequirementOptions = {},
): RequirementFactMatch {
  const blockedIds = new Set(options.blockedFactIds ?? []);
  const usable = collectCandidates(requirement, facts.filter((fact) => !blockedIds.has(fact.id)));
  const blocked = collectCandidates(requirement, facts.filter((fact) => blockedIds.has(fact.id)));

  if (usable.exact.length > 0) {
    const terms = [...new Set(usable.exact.flatMap((entry) => entry.terms))];
    return RequirementFactMatchSchema.parse({
      requirementId: requirement.id,
      factIds: factIds(usable.exact),
      strength: "exact",
      rationale: `Verified facts contain the posting's stated wording: ${terms.slice(0, 5).join(", ")}.`,
      confidence: Math.min(0.95, 0.85 + 0.02 * (usable.exact.length - 1)),
      evidence: usable.exact,
    });
  }

  if (usable.related.length > 0) {
    return RequirementFactMatchSchema.parse({
      requirementId: requirement.id,
      factIds: factIds(usable.related),
      strength: "related",
      rationale: `No stated keyword matched, but ${usable.related.length} verified fact(s) share ${usable.bestOverlap} distinctive words with this requirement.`,
      confidence: Math.min(0.7, 0.4 + 0.1 * usable.bestOverlap),
      evidence: usable.related,
    });
  }

  const disputed = blocked.exact.length > 0 ? blocked.exact : blocked.related;
  if (disputed.length > 0) {
    return RequirementFactMatchSchema.parse({
      requirementId: requirement.id,
      factIds: factIds(disputed),
      strength: "conflict",
      rationale: "Matching verified facts have unresolved source conflicts, so they cannot satisfy this requirement.",
      confidence: 0,
      evidence: disputed,
    });
  }

  return RequirementFactMatchSchema.parse({
    requirementId: requirement.id,
    factIds: [],
    strength: "missing",
    rationale: "No verified fact supports this requirement. Nothing will be written to claim it.",
    confidence: 0,
    evidence: [],
  });
}

export function matchRequirements(
  requirements: readonly JDRequirement[],
  facts: readonly Fact[],
  options: MatchRequirementOptions = {},
): RequirementFactMatch[] {
  return requirements.map((requirement) => matchRequirement(requirement, facts, options));
}
