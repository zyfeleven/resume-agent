import {
  RequirementFactMatchSchema,
  type Fact,
  type JDRequirement,
  type RequirementFactMatch,
} from "@resume-agent/contracts";

export const MATCHER_VERSION = "requirement-match-v1";

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "have", "in", "into", "is", "it",
  "of", "on", "or", "our", "the", "their", "to", "up", "was", "we", "with", "you", "your", "will",
  "who", "that", "this", "these", "those", "using", "used", "use", "able", "ability", "strong",
  "excellent", "good", "great", "plus", "years", "year", "experience", "work", "working", "team",
  "teams", "role", "new", "other", "across", "within", "including", "such",
]);

/**
 * Reduce a word to a comparable stem so `designer` and `design` meet.
 * The same stemmer runs on both sides of every comparison, so it only has to be
 * consistent, not linguistically correct.
 */
function stem(token: string): string {
  let value = token;
  if (value.length > 3 && value.endsWith("s") && !value.endsWith("ss")) {
    value = value.slice(0, -1);
  }
  for (const suffix of ["ers", "er", "ing", "ed"]) {
    if (value.length > suffix.length + 3 && value.endsWith(suffix)) {
      return value.slice(0, -suffix.length);
    }
  }
  return value;
}

/** Lowercase alphanumeric stems, minus stopwords. */
export function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9+#.]+/)) {
    const token = raw.replace(/^\.+|\.+$/g, "");
    if (token.length < 2 || STOPWORDS.has(token)) {
      continue;
    }
    tokens.add(stem(token));
  }
  return tokens;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
};

/** The largest number of years a text states, whether written in digits or words. */
function statedYears(text: string): number | null {
  const lowered = text.toLowerCase();
  const values: number[] = [];

  for (const match of lowered.matchAll(/(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?(?:years?|yrs?)\b/g)) {
    values.push(Number(match[1]));
  }
  for (const match of lowered.matchAll(/([a-z]+)\s+(?:years?|yrs?)\b/g)) {
    const word = match[1];
    const value = word ? NUMBER_WORDS[word] : undefined;
    if (value !== undefined) {
      values.push(value);
    }
  }

  return values.length > 0 ? Math.max(...values) : null;
}

function factText(fact: Fact): string {
  return typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value);
}

function overlap(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((token) => right.has(token));
}

/**
 * Match one requirement against the verified facts, by wording alone.
 *
 * This is lexical and deterministic: a keyword the posting stated has to appear in the
 * fact, or the two have to share several distinctive words. It never infers that a
 * candidate meets a requirement they have no fact for — that case is `missing`, and
 * `missing` is what the reviewer sees.
 */
export function matchRequirement(requirement: JDRequirement, facts: readonly Fact[]): RequirementFactMatch {
  const requirementTokens = tokenize(requirement.text);
  const requiredYears = statedYears(requirement.text);
  const exactFactIds: string[] = [];
  const relatedFactIds: string[] = [];
  let bestOverlap = 0;

  for (const fact of facts) {
    // Keep the exported single-requirement API fail-closed too. `matchRequirements`
    // already pre-filters, but callers must not have to know that safety invariant.
    if (fact.status !== "verified") {
      continue;
    }
    const text = factText(fact);
    const lowered = text.toLowerCase();

    const keywordHit = requirement.keywords.some((keyword) => {
      const needle = keyword.toLowerCase();
      if (needle.length < 2) {
        return false;
      }
      // The fact states the keyword, or the fact is the thing the keyword narrows —
      // a verified "Accessibility" skill answers a stated "accessibility standards".
      return lowered.includes(needle) || (lowered.length >= 4 && needle.includes(lowered));
    });

    if (keywordHit) {
      exactFactIds.push(fact.id);
      continue;
    }

    const factTokens = tokenize(`${text} ${fact.key.replace(/[._]/g, " ")}`);
    const shared = overlap(requirementTokens, factTokens);

    // A short fact carries few words, so one shared word is already most of it. A stated
    // duration only counts alongside a shared word, so a year count never matches alone.
    const meetsYears = requiredYears !== null && (statedYears(text) ?? 0) >= requiredYears;
    if (shared.length >= 2 || (shared.length >= 1 && (factTokens.size <= 3 || meetsYears))) {
      relatedFactIds.push(fact.id);
      bestOverlap = Math.max(bestOverlap, shared.length);
    }
  }

  if (exactFactIds.length > 0) {
    return RequirementFactMatchSchema.parse({
      requirementId: requirement.id,
      factIds: exactFactIds,
      strength: "exact",
      rationale: `A verified fact contains wording the posting asked for: ${requirement.keywords
        .slice(0, 3)
        .join(", ")}.`,
      confidence: Math.min(0.95, 0.85 + 0.02 * (exactFactIds.length - 1)),
    });
  }

  if (relatedFactIds.length > 0) {
    return RequirementFactMatchSchema.parse({
      requirementId: requirement.id,
      factIds: relatedFactIds,
      strength: "related",
      rationale: `No stated keyword matched, but ${relatedFactIds.length} verified fact(s) share ${bestOverlap} distinctive words with this requirement.`,
      confidence: Math.min(0.7, 0.4 + 0.1 * bestOverlap),
    });
  }

  return RequirementFactMatchSchema.parse({
    requirementId: requirement.id,
    factIds: [],
    strength: "missing",
    rationale: "No verified fact supports this requirement. Nothing will be written to claim it.",
    confidence: 0,
  });
}

export function matchRequirements(
  requirements: readonly JDRequirement[],
  facts: readonly Fact[],
): RequirementFactMatch[] {
  const verified = facts.filter((fact) => fact.status === "verified");
  return requirements.map((requirement) => matchRequirement(requirement, verified));
}
