import {
  JdParseRequestSchema,
  JdParseResultSchema,
  type JDRequirement,
  type JdParseRequest,
  type JdParseResult,
  type JdParseSection,
  type JdParseSkipReason,
  type JdSectionKind,
} from "@resume-agent/contracts";
import { createHash } from "node:crypto";

import { segmentJdSections, toJdLines, type JdLine, type JdSection } from "./text.js";

export const PARSER_VERSION = "jd-analysis-v1";

const MAX_REQUIREMENT_LENGTH = 2_000;
const MIN_REQUIREMENT_LENGTH = 8;
const MAX_KEYWORDS = 8;

type RequirementKind = JDRequirement["kind"];
type RequirementPriority = JDRequirement["priority"];

/**
 * A job posting is untrusted input. Text that tries to address the agent is dropped
 * before it can become a stored requirement, and its wording is never copied into the
 * report, so it cannot reach a later prompt through parse output.
 */
const INJECTION_PATTERNS: readonly RegExp[] = [
  /\bignore\s+(?:all\s+|any\s+)?(?:the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|rules?)/i,
  /\bdisregard\s+(?:all\s+|any\s+)?(?:the\s+)?(?:previous|prior|above|system)\b/i,
  /\b(?:system|developer)\s+(?:prompt|message)\b/i,
  /\byou\s+are\s+(?:now\s+)?(?:an?\s+)?(?:ai|assistant|language\s+model|chatbot)\b/i,
  /\b(?:as\s+an?\s+)?(?:ai|language)\s+model\b.{0,40}\b(?:must|should|please)\b/i,
  /<\s*script\b/i,
];

const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(pass(word|phrase)|api[-_ ]?key|secret[-_ ]?key|access[-_ ]?token|private[-_ ]?key)\b/i,
  /(?:^|\s)(?:sk|pk|ghp|ghs|xox[baprs])[-_][A-Za-z0-9]{16,}/,
];

const PREFERRED_MARKERS =
  /\b(preferred|preferably|nice to have|nice-to-have|a plus|a big plus|bonus|ideally|desirable|not required|optional|would be great|even better)\b/i;

const MUST_MARKERS =
  /\b(must have|must be|is required|are required|required|requirement|minimum of|at least|you have|you'll need|proven|demonstrated)\b/i;

const YEARS_PATTERN = /\b\d{1,2}\s*\+?\s*(?:-\s*\d{1,2}\s*)?(?:years?|yrs?)\b/i;
const EDUCATION_PATTERN = /\b(bachelor|master|ph\.?d|doctorate|degree|diploma|b\.?sc|m\.?sc|b\.?s\.|m\.?s\.|mba|undergraduate)\b/i;
const CREDENTIAL_PATTERN = /\b(certifi(?:ed|cation|cations)|licen[cs]e[sd]?|accredited|clearance|credential)\b/i;
const EXPERIENCE_PATTERN = /\b(experience|background|track record|history of|worked on|shipped)\b/i;
const BEHAVIOR_PATTERN =
  /\b(communicat|collaborat|team player|self[- ]starter|attention to detail|ownership|proactive|mentor|leadership|stakeholder|interpersonal|problem[- ]solving|empathy|curious)/i;
const SKILL_PATTERN =
  /\b(proficien|familiar|knowledge of|expertise|skilled|hands[- ]on|fluent|understanding of|comfortable with|ability to use)/i;

const KEYWORD_CLAUSE_PATTERN =
  /\b(?:experience (?:with|in|using)|proficien(?:cy|t) (?:in|with)|knowledge of|familiarity with|expertise in|skilled in|working knowledge of|fluent in)\s+(.{3,140}?)(?:[.;]|$)/i;

const ACRONYM_STOPWORDS = new Set([
  "AND",
  "OR",
  "THE",
  "YOU",
  "WE",
  "US",
  "IT",
  "FOR",
  "WITH",
  "PLUS",
  "NOT",
  "ALL",
  "ANY",
  "OUR",
  "ARE",
  "CAN",
  "NEW",
  "PER",
  "VIA",
  "A",
  "I",
]);

const PRIORITY_BY_SECTION: Partial<Record<JdSectionKind, RequirementPriority>> = {
  responsibilities: "context",
  requirements: "must_have",
  preferred: "preferred",
};

const NON_REQUIREMENT_SECTIONS: ReadonlySet<JdSectionKind> = new Set<JdSectionKind>(["benefits", "about", "legal"]);

interface Collector {
  request: JdParseRequest;
  requirements: JDRequirement[];
  requirementIds: Set<string>;
  skipped: Map<string, { line: number; reason: JdParseSkipReason }>;
}

/** Length-prefixed parts keep the digest unambiguous when a value contains the separator. */
function stableId(prefix: string, parts: readonly string[]): string {
  const encoded = parts.map((part) => `${part.length}:${part}`).join("|");
  return `${prefix}:${createHash("sha256").update(encoded).digest("hex").slice(0, 24)}`;
}

function skip(collector: Collector, line: JdLine, reason: JdParseSkipReason): void {
  const key = `${line.number}:${reason}`;
  if (!collector.skipped.has(key)) {
    collector.skipped.set(key, { line: line.number, reason });
  }
}

function requirementKind(text: string, sectionKind: JdSectionKind): RequirementKind {
  if (sectionKind === "responsibilities") {
    return "responsibility";
  }
  if (EDUCATION_PATTERN.test(text)) {
    return "education";
  }
  if (CREDENTIAL_PATTERN.test(text)) {
    return "credential";
  }
  // An explicit duration is the strongest experience signal; otherwise a stated
  // proficiency reads as a skill before a general mention of past work does.
  if (YEARS_PATTERN.test(text)) {
    return "experience";
  }
  if (SKILL_PATTERN.test(text)) {
    return "skill";
  }
  if (BEHAVIOR_PATTERN.test(text)) {
    return "behavior";
  }
  if (EXPERIENCE_PATTERN.test(text)) {
    return "experience";
  }
  return "other";
}

/**
 * The section sets the default priority. An explicit in-line marker can lower a
 * requirement to `preferred`, and may raise one only where the section itself carries
 * no priority, so a stated section is never overruled by a stray word.
 */
function requirementPriority(sectionPriority: RequirementPriority, text: string, allowUpgrade: boolean): RequirementPriority {
  if (PREFERRED_MARKERS.test(text)) {
    return "preferred";
  }
  if (allowUpgrade && MUST_MARKERS.test(text)) {
    return "must_have";
  }
  return sectionPriority;
}

function isTechnologyToken(token: string): boolean {
  if (token.length < 2 || token.length > 40) {
    return false;
  }
  if (/^[A-Z]{2,6}$/.test(token)) {
    return !ACRONYM_STOPWORDS.has(token);
  }
  if (/^[A-Z]{2,6}\/[A-Z]{2,6}$/.test(token)) {
    return true;
  }
  if (/^[A-Za-z][A-Za-z0-9]*\+\+$/.test(token)) {
    return true;
  }
  if (/^\.?[A-Za-z][A-Za-z0-9]*\.(?:js|ts|net|io|py|sh)$/i.test(token)) {
    return true;
  }
  // Internal capital letters, such as TypeScript or PostgreSQL.
  return /^[A-Za-z][a-z0-9]*[A-Z][A-Za-z0-9+#]*$/.test(token);
}

/** Every keyword is a substring of the requirement text; nothing here is generated. */
function extractKeywords(text: string): string[] {
  const keywords: string[] = [];
  const add = (value: string): void => {
    const cleaned = value.replace(/^[^\p{L}\p{N}.+]+|[^\p{L}\p{N}+#]+$/gu, "").trim();
    if (cleaned.length < 2 || cleaned.length > 60) {
      return;
    }
    if (!text.includes(cleaned)) {
      return;
    }
    if (!keywords.some((existing) => existing.toLowerCase() === cleaned.toLowerCase())) {
      keywords.push(cleaned);
    }
  };

  const years = YEARS_PATTERN.exec(text);
  if (years) {
    add(years[0]);
  }

  for (const token of text.split(/[\s,;:()"']+/)) {
    const trimmed = token.replace(/[.,;:)]+$/, "");
    if (isTechnologyToken(trimmed)) {
      add(trimmed);
    }
  }

  const clause = KEYWORD_CLAUSE_PATTERN.exec(text);
  const captured = clause?.[1];
  if (captured) {
    for (const part of captured.split(/,| and | or |\/(?=\s)/i)) {
      const candidate = part.replace(/^\s*(?:the|a|an)\s+/i, "").trim();
      // A clause fragment that carries a verb is a sentence, not a keyword.
      if (/\b(?:is|are|was|were|will|would|that|who|which)\b/i.test(candidate)) {
        continue;
      }
      if (candidate.length >= 2 && candidate.split(" ").length <= 4) {
        add(candidate);
      }
    }
  }

  return keywords.slice(0, MAX_KEYWORDS);
}

function collect(
  collector: Collector,
  line: JdLine,
  sectionKind: JdSectionKind,
  priority: RequirementPriority,
): void {
  const text = line.text.trim();
  const id = stableId("requirement", [collector.request.jobId, text.toLowerCase()]);
  if (collector.requirementIds.has(id)) {
    skip(collector, line, "duplicate_requirement");
    return;
  }

  collector.requirementIds.add(id);
  collector.requirements.push({
    id,
    jobId: collector.request.jobId,
    kind: requirementKind(text, sectionKind),
    priority,
    text,
    keywords: extractKeywords(text),
    source: {
      artifactId: collector.request.source.artifactId,
      locator: `line:${line.number}`,
      excerpt: text.slice(0, MAX_REQUIREMENT_LENGTH),
    },
  });
}

/** Fail-closed line guards, applied before any text is read as a requirement. */
function usableLines(collector: Collector, lines: readonly JdLine[]): JdLine[] {
  const usable: JdLine[] = [];
  for (const line of lines) {
    if (INJECTION_PATTERNS.some((pattern) => pattern.test(line.text))) {
      skip(collector, line, "possible_injection");
      continue;
    }
    if (SECRET_PATTERNS.some((pattern) => pattern.test(line.text))) {
      skip(collector, line, "possible_secret");
      continue;
    }
    if (line.text.length > MAX_REQUIREMENT_LENGTH) {
      skip(collector, line, "line_too_long");
      continue;
    }
    if (line.text.length < MIN_REQUIREMENT_LENGTH || !/\p{L}/u.test(line.text)) {
      skip(collector, line, "not_a_requirement");
      continue;
    }
    usable.push(line);
  }
  return usable;
}

function toReportSection(section: JdSection): JdParseSection {
  return {
    kind: section.kind,
    ...(section.heading === undefined ? {} : { heading: section.heading }),
    startLine: section.startLine,
    endLine: section.endLine,
  };
}

/**
 * Turn a pasted job description into structured requirements.
 *
 * The parser is deterministic and value-preserving: no clock, no randomness, no network,
 * and no model call. Every requirement keeps the source wording and cites the line it
 * came from, and priority reflects the section it was written under rather than a guess
 * about the employer's intent.
 */
export function parseJobDescription(input: unknown): JdParseResult {
  const request = JdParseRequestSchema.parse(input);
  const lines = toJdLines(request.text);
  const sections = segmentJdSections(lines);
  const collector: Collector = {
    request,
    requirements: [],
    requirementIds: new Set<string>(),
    skipped: new Map<string, { line: number; reason: JdParseSkipReason }>(),
  };

  // An unrecognized heading is usually a sub-heading of the section above it, so its
  // lines inherit that section's priority instead of being dropped.
  let inheritedPriority: RequirementPriority | null = null;

  for (const section of sections) {
    if (NON_REQUIREMENT_SECTIONS.has(section.kind)) {
      inheritedPriority = null;
      for (const line of section.lines) {
        skip(collector, line, "non_requirement_section");
      }
      continue;
    }

    const sectionPriority = PRIORITY_BY_SECTION[section.kind];
    if (sectionPriority) {
      inheritedPriority = sectionPriority;
    }

    const effectivePriority = sectionPriority ?? inheritedPriority;
    // Intro prose, and any section with no stated priority, only yields a requirement
    // when the line is a list item or states its own priority.
    const requiresOwnSignal = effectivePriority === null || effectivePriority === undefined;
    const basePriority: RequirementPriority = effectivePriority ?? "context";

    for (const line of usableLines(collector, section.lines)) {
      const priority = requirementPriority(basePriority, line.text, requiresOwnSignal);
      if (requiresOwnSignal && !line.isBullet && priority === basePriority) {
        skip(collector, line, "not_a_requirement");
        continue;
      }
      collect(collector, line, section.kind, priority);
    }
  }

  const priorityCounts = new Map<RequirementPriority, number>();
  for (const requirement of collector.requirements) {
    priorityCounts.set(requirement.priority, (priorityCounts.get(requirement.priority) ?? 0) + 1);
  }

  const report = {
    id: stableId("jd-parse", [request.jobId, request.source.contentHash, request.parsedAt]),
    jobId: request.jobId,
    artifactId: request.source.artifactId,
    parserVersion: PARSER_VERSION,
    parsedAt: request.parsedAt,
    sourceLineCount: lines.length,
    sections: sections.map(toReportSection),
    priorityCounts: [...priorityCounts.entries()].map(([priority, count]) => ({ priority, count })),
    requirementIds: collector.requirements.map((requirement) => requirement.id),
    skipped: [...collector.skipped.values()].sort(
      (left, right) => left.line - right.line || left.reason.localeCompare(right.reason),
    ),
  };

  return JdParseResultSchema.parse({ report, requirements: collector.requirements });
}
