import {
  ResumeImportRequestSchema,
  ResumeImportResultSchema,
  type DataSensitivity,
  type Fact,
  type ResumeImportRequest,
  type ResumeImportResult,
  type ResumeImportSection,
  type ResumeImportSkipReason,
} from "@resume-agent/contracts";
import { createHash } from "node:crypto";

import {
  matchDateRange,
  segmentSections,
  slugify,
  splitSegments,
  toSourceLines,
  type SourceLine,
  type SourceSection,
} from "./text.js";

export const EXTRACTOR_VERSION = "resume-import-v1";

/** Facts and source excerpts are capped so one line can never exceed the locator contract. */
const MAX_VALUE_LENGTH = 2_000;
const MAX_PENDING_HEADER_LINES = 3;

type FactKind = Fact["kind"];

/**
 * Lines that look like a credential are dropped before any value is read.
 * Their text is never copied into a fact, an excerpt, or the import report.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(pass(word|phrase)|passwd|api[-_ ]?key|secret[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|private[-_ ]?key|client[-_ ]?secret)\b/i,
  /\b(ssn|social security (number|no))\b/i,
  /\b(credit card|card number|cvv|routing number|iban)\b/i,
  /(?:^|\s)(?:sk|pk|ghp|ghs|xox[baprs])[-_][A-Za-z0-9]{16,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

const WORK_AUTHORIZATION_PATTERN =
  /\b(work authorization|authorized to work|right to work|require sponsorship|sponsorship|visa|permanent resident|green card|citizenship|citizen of|h-?1b|tn visa|opt|cpt|ead)\b/i;

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_PATTERN = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const URL_PATTERN = /(?:https?:\/\/)?(?:www\.)?[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?:\/[^\s|]*)?/;
const LOCATION_PATTERN = /^[\p{Lu}][\p{L} .'-]*,\s*[\p{L}][\p{L} .'-]*$/u;
const HEADER_TOKEN_SEPARATOR = /\s*[|•·]\s*|\s+[—–]\s+/;

const SENSITIVITY_BY_KIND: Record<FactKind, DataSensitivity> = {
  identity: "pii",
  contact: "pii",
  employment: "normal",
  achievement: "normal",
  skill: "normal",
  education: "normal",
  project: "normal",
  credential: "normal",
  preference: "normal",
  work_authorization: "sensitive",
};

interface Collector {
  request: ResumeImportRequest;
  facts: Fact[];
  factIds: Set<string>;
  usedLines: Set<string>;
  skipped: Map<string, { line: number; reason: ResumeImportSkipReason }>;
}

/** Length-prefixed parts keep the digest unambiguous when a value contains the separator. */
function stableId(prefix: string, parts: readonly string[]): string {
  const encoded = parts.map((part) => `${part.length}:${part}`).join("|");
  const digest = createHash("sha256").update(encoded).digest("hex");
  return `${prefix}:${digest.slice(0, 24)}`;
}

function createCollector(request: ResumeImportRequest): Collector {
  return {
    request,
    facts: [],
    factIds: new Set<string>(),
    usedLines: new Set<string>(),
    skipped: new Map<string, { line: number; reason: ResumeImportSkipReason }>(),
  };
}

function skip(collector: Collector, line: SourceLine, reason: ResumeImportSkipReason): void {
  const key = `${line.number}:${reason}`;
  if (!collector.skipped.has(key)) {
    collector.skipped.set(key, { line: line.number, reason });
  }
}

/**
 * Record one extracted fact. Values are always a normalized slice of the source line,
 * never generated text, and every fact starts `pending` until the user reviews it.
 */
function collect(
  collector: Collector,
  kind: FactKind,
  key: string,
  value: string,
  line: SourceLine,
): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_VALUE_LENGTH) {
    return false;
  }

  const factKey = key.slice(0, 160);
  const id = stableId("fact", [collector.request.profileId, kind, factKey, trimmed]);
  if (collector.factIds.has(id)) {
    skip(collector, line, "duplicate_fact");
    return false;
  }

  collector.factIds.add(id);
  collector.usedLines.add(String(line.number));
  collector.facts.push({
    id,
    profileId: collector.request.profileId,
    kind,
    key: factKey,
    value: trimmed,
    status: "pending",
    sensitivity: SENSITIVITY_BY_KIND[kind],
    sources: [
      {
        artifactId: collector.request.source.artifactId,
        locator: `line:${line.number}`,
        excerpt: line.text.slice(0, MAX_VALUE_LENGTH),
      },
    ],
    version: 1,
    createdAt: collector.request.importedAt,
    updatedAt: collector.request.importedAt,
  });
  return true;
}

/** Apply the fail-closed line guards once, before any value is read. */
function usableLines(collector: Collector, lines: readonly SourceLine[]): SourceLine[] {
  const usable: SourceLine[] = [];
  for (const line of lines) {
    if (SECRET_PATTERNS.some((pattern) => pattern.test(line.text))) {
      skip(collector, line, "possible_secret");
      continue;
    }
    if (line.text.length > MAX_VALUE_LENGTH) {
      skip(collector, line, "line_too_long");
      continue;
    }
    usable.push(line);
  }
  return usable;
}

function looksLikeName(text: string): boolean {
  if (text.length > 60 || /[@:\d]/.test(text)) {
    return false;
  }
  const words = text.split(" ").filter((word) => word.length > 0);
  return words.length >= 1 && words.length <= 5 && /^\p{Lu}/u.test(text);
}

function classifyUrl(url: string): string | null {
  const normalized = url.toLowerCase();
  if (normalized.includes("linkedin.")) {
    return "linkedin";
  }
  if (normalized.includes("github.")) {
    return "github";
  }
  if (/\.(com|dev|io|net|org|design|me|ca|co)(\/|$)/.test(normalized)) {
    return "website";
  }
  return null;
}

function collectHeader(collector: Collector, section: SourceSection): void {
  let nameFound = false;

  for (const line of usableLines(collector, section.lines)) {
    const tokens = line.text
      .split(HEADER_TOKEN_SEPARATOR)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);

    if (!nameFound && !line.isBullet && tokens.length === 1 && looksLikeName(line.text)) {
      nameFound = collect(collector, "identity", "full_name", line.text, line);
      continue;
    }

    for (const token of tokens) {
      const email = EMAIL_PATTERN.exec(token);
      if (email) {
        collect(collector, "contact", "email", email[0], line);
        continue;
      }

      const phone = PHONE_PATTERN.exec(token);
      if (phone) {
        collect(collector, "contact", "phone", phone[0], line);
        continue;
      }

      const url = URL_PATTERN.exec(token);
      if (url) {
        const label = classifyUrl(url[0]);
        if (label) {
          collect(collector, "contact", label, url[0], line);
          continue;
        }
      }

      if (LOCATION_PATTERN.test(token)) {
        collect(collector, "contact", "location", token, line);
        continue;
      }

      if (!nameFound && looksLikeName(token)) {
        nameFound = collect(collector, "identity", "full_name", token, line);
      }
    }
  }
}

function collectSummary(collector: Collector, section: SourceSection): void {
  let index = 0;
  for (const line of usableLines(collector, section.lines)) {
    index += 1;
    collect(collector, "achievement", `summary.${index}`, line.text, line);
  }
}

function collectSkills(collector: Collector, section: SourceSection): void {
  for (const line of usableLines(collector, section.lines)) {
    // Drop a leading group label such as `Design:` so the group name is not stored as a skill.
    const body = line.text.replace(/^[\p{L}][\p{L} /&+-]{0,40}:\s*/u, "");
    for (const token of body.split(/[,;|•·]/)) {
      const value = token.trim().replace(/\.$/, "");
      if (value.length < 2 || value.length > 80) {
        continue;
      }
      const slug = slugify(value);
      if (slug.length === 0) {
        continue;
      }
      collect(collector, "skill", `skill.${slug}`, value, line);
    }
  }
}

function lineContaining(candidates: readonly SourceLine[], text: string, fallback: SourceLine): SourceLine {
  return candidates.find((candidate) => candidate.text.includes(text)) ?? fallback;
}

/**
 * Employment entries are anchored on a date range. Role and organization are only
 * separated when the header text splits cleanly; otherwise the raw headline is kept
 * so the reviewer sees the source wording instead of a guess.
 */
function collectExperience(collector: Collector, section: SourceSection): void {
  let pending: SourceLine[] = [];
  let entrySlug: string | null = null;
  let entryIndex = 0;
  let achievementIndex = 0;

  for (const line of usableLines(collector, section.lines)) {
    if (line.isBullet) {
      if (entrySlug === null) {
        skip(collector, line, "unattached_bullet");
        continue;
      }
      achievementIndex += 1;
      collect(collector, "achievement", `employment.${entrySlug}.achievement.${achievementIndex}`, line.text, line);
      continue;
    }

    const dates = matchDateRange(line.text);
    if (dates === null) {
      if (pending.length >= MAX_PENDING_HEADER_LINES) {
        const dropped = pending.shift();
        if (dropped) {
          skip(collector, dropped, "unrecognized_line");
        }
      }
      pending.push(line);
      continue;
    }

    entryIndex += 1;
    achievementIndex = 0;

    const remainder = line.text
      .replace(dates, " ")
      .replace(/\s{2,}/g, " ")
      .replace(/^[\s,;|·•—–-]+|[\s,;|·•—–-]+$/g, "")
      .trim();
    const pieces = [...pending.map((entry) => entry.text), remainder].filter((piece) => piece.length > 0);
    const segments = pieces.length === 1 ? splitSegments(pieces[0] ?? "") : pieces;
    const candidates = [...pending, line];

    const role = segments[0];
    const organization = segments[1];
    const slug = slugify(organization ?? role ?? "") || `entry-${entryIndex}`;
    entrySlug = slug;

    if (role !== undefined && organization !== undefined) {
      collect(collector, "employment", `employment.${slug}.role`, role, lineContaining(candidates, role, line));
      collect(
        collector,
        "employment",
        `employment.${slug}.organization`,
        organization,
        lineContaining(candidates, organization, line),
      );
      segments.slice(2).forEach((detail, offset) => {
        collect(
          collector,
          "employment",
          `employment.${slug}.detail.${offset + 1}`,
          detail,
          lineContaining(candidates, detail, line),
        );
      });
    } else if (role !== undefined) {
      collect(collector, "employment", `employment.${slug}.headline`, role, lineContaining(candidates, role, line));
    }

    collect(collector, "employment", `employment.${slug}.dates`, dates, line);
    pending = [];
  }

  for (const leftover of pending) {
    skip(collector, leftover, "unrecognized_line");
  }
}

/**
 * Education, projects, and certifications share one shape: a heading line per entry,
 * optionally followed by detail bullets.
 */
function collectEntries(
  collector: Collector,
  section: SourceSection,
  kind: FactKind,
  keyPrefix: string,
): void {
  let entrySlug: string | null = null;
  let entryIndex = 0;
  let detailIndex = 0;

  for (const line of usableLines(collector, section.lines)) {
    if (line.isBullet) {
      if (entrySlug === null) {
        skip(collector, line, "unattached_bullet");
        continue;
      }
      detailIndex += 1;
      collect(collector, kind, `${keyPrefix}.${entrySlug}.detail.${detailIndex}`, line.text, line);
      continue;
    }

    entryIndex += 1;
    detailIndex = 0;
    const segments = splitSegments(line.text);
    entrySlug = slugify(segments[0] ?? line.text) || `entry-${entryIndex}`;
    collect(collector, kind, `${keyPrefix}.${entrySlug}`, line.text, line);

    const dates = matchDateRange(line.text);
    if (dates !== null) {
      collect(collector, kind, `${keyPrefix}.${entrySlug}.dates`, dates, line);
    }
  }
}

function collectWorkAuthorization(collector: Collector, lines: readonly SourceLine[], onlyUnusedLines: boolean): void {
  for (const line of usableLines(collector, lines)) {
    if (onlyUnusedLines && collector.usedLines.has(String(line.number))) {
      continue;
    }
    if (!WORK_AUTHORIZATION_PATTERN.test(line.text)) {
      continue;
    }
    const slug = slugify(line.text) || "statement";
    collect(collector, "work_authorization", `work_authorization.${slug}`, line.text, line);
  }
}

function toReportSection(section: SourceSection): ResumeImportSection {
  return {
    kind: section.kind,
    ...(section.heading === undefined ? {} : { heading: section.heading }),
    startLine: section.startLine,
    endLine: section.endLine,
  };
}

/**
 * Turn already-extracted resume text into pending candidate facts.
 *
 * The extractor is deterministic and value-preserving: it has no clock, no randomness,
 * no network, and no model call, and every emitted value is a normalized slice of a
 * source line that is cited by line number. Nothing it returns is usable by the rest of
 * the system until a person verifies it.
 */
export function extractResumeFacts(input: unknown): ResumeImportResult {
  const request = ResumeImportRequestSchema.parse(input);
  const lines = toSourceLines(request.text);
  const sections = segmentSections(lines);
  const collector = createCollector(request);

  for (const section of sections) {
    switch (section.kind) {
      case "header":
        collectHeader(collector, section);
        break;
      case "summary":
        collectSummary(collector, section);
        break;
      case "skills":
        collectSkills(collector, section);
        break;
      case "experience":
        collectExperience(collector, section);
        break;
      case "education":
        collectEntries(collector, section, "education", "education");
        break;
      case "projects":
        collectEntries(collector, section, "project", "project");
        break;
      case "certifications":
        collectEntries(collector, section, "credential", "certification");
        break;
      case "work_authorization":
        collectWorkAuthorization(collector, section.lines, false);
        break;
      case "unrecognized":
        // Still run the line guards so a suspected credential is reported as one.
        for (const line of usableLines(collector, section.lines)) {
          skip(collector, line, "unrecognized_line");
        }
        break;
    }
  }

  // Work-authorization statements are often written outside a dedicated section.
  // Only section content is rescanned, so a heading is never stored as a fact.
  collectWorkAuthorization(
    collector,
    sections.flatMap((section) => section.lines),
    true,
  );

  const factCounts = new Map<FactKind, number>();
  for (const fact of collector.facts) {
    factCounts.set(fact.kind, (factCounts.get(fact.kind) ?? 0) + 1);
  }

  const report = {
    id: stableId("import", [request.profileId, request.source.contentHash, request.importedAt]),
    profileId: request.profileId,
    artifactId: request.source.artifactId,
    extractorVersion: EXTRACTOR_VERSION,
    importedAt: request.importedAt,
    sourceLineCount: lines.length,
    sections: sections.map(toReportSection),
    factCounts: [...factCounts.entries()].map(([kind, count]) => ({ kind, count })),
    factIds: collector.facts.map((fact) => fact.id),
    skipped: [...collector.skipped.values()].sort(
      (left, right) => left.line - right.line || left.reason.localeCompare(right.reason),
    ),
  };

  return ResumeImportResultSchema.parse({ report, facts: collector.facts });
}
