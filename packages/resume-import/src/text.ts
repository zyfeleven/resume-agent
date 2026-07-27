import type { ResumeSectionKind } from "@resume-agent/contracts";

export interface SourceLine {
  /** 1-based line number in the extracted source text, used as the fact locator. */
  number: number;
  text: string;
  isBullet: boolean;
}

export interface SourceSection {
  kind: ResumeSectionKind;
  heading?: string;
  startLine: number;
  endLine: number;
  lines: SourceLine[];
}

const BULLET_MARKER = /^[-–—•*‣·▪]+\s+/;

const SECTION_HEADINGS: ReadonlyArray<{ kind: ResumeSectionKind; pattern: RegExp }> = [
  { kind: "summary", pattern: /^(professional |career |executive )?(summary|profile|objective|overview|about)$/ },
  { kind: "skills", pattern: /^(technical |core |key |relevant )?(skills|competencies|technologies|toolkit|tech stack)$/ },
  { kind: "experience", pattern: /^(work |professional |employment |relevant )?(experience|history)$/ },
  { kind: "projects", pattern: /^(selected |personal |side |key )?projects$/ },
  { kind: "education", pattern: /^education( and training)?$/ },
  { kind: "certifications", pattern: /^(certifications?|licen[cs]es?|credentials|awards)$/ },
  { kind: "work_authorization", pattern: /^(work authorization|authorization|eligibility|legal status|immigration status)$/ },
];

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const DATE_POINT = `(?:${MONTH}\\s+\\d{4}|\\d{1,2}/\\d{4}|\\d{4})`;
const DATE_END = `(?:${DATE_POINT}|present|current|now|ongoing)`;
const DATE_RANGE = new RegExp(`${DATE_POINT}\\s*(?:–|—|-|to|until|through)\\s*${DATE_END}`, "i");

/** Strong separators only. Commas are excluded because they appear inside organization and place names. */
const SEGMENT_SEPARATOR = /\s(?:[—–|·•]|-|@|at)\s/;

const MAX_SLUG_LENGTH = 48;

/**
 * Split the extracted text into non-empty, whitespace-normalized lines.
 * Line numbers stay aligned with the original text so a fact locator always
 * points back at a real line of the source document.
 */
export function toSourceLines(text: string): SourceLine[] {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/[\t\u00a0\u2007\u202f]/g, " ");
  const lines: SourceLine[] = [];

  normalized.split("\n").forEach((rawLine, index) => {
    const collapsed = rawLine.replace(/\s{2,}/g, " ").trim();
    if (collapsed.length === 0) {
      return;
    }
    const isBullet = BULLET_MARKER.test(collapsed);
    const value = isBullet ? collapsed.replace(BULLET_MARKER, "").trim() : collapsed;
    if (value.length === 0) {
      return;
    }
    lines.push({ number: index + 1, text: value, isBullet });
  });

  return lines;
}

/** Classify a line as a known section heading, or return null when it is ordinary content. */
export function headingKind(line: SourceLine): ResumeSectionKind | null {
  if (line.isBullet) {
    return null;
  }
  const normalized = line.text
    .replace(/[:•·|]+$/, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .toLowerCase();
  if (normalized.length === 0 || normalized.length > 48) {
    return null;
  }
  for (const { kind, pattern } of SECTION_HEADINGS) {
    if (pattern.test(normalized)) {
      return kind;
    }
  }
  return null;
}

/**
 * Group lines into sections. Everything before the first recognized heading is the
 * header block. A heading that is not recognized starts an `unrecognized` section:
 * its content is reported as skipped rather than guessed into the wrong fact kind.
 */
export function segmentSections(lines: SourceLine[]): SourceSection[] {
  if (lines.length === 0) {
    return [];
  }

  const sections: SourceSection[] = [];
  const firstLine = lines[0];
  if (!firstLine) {
    return [];
  }

  let current: SourceSection = {
    kind: "header",
    startLine: firstLine.number,
    endLine: firstLine.number,
    lines: [],
  };

  for (const line of lines) {
    const kind = headingKind(line);
    const startsUnrecognizedSection =
      kind === null && current.kind !== "header" && looksLikeUnknownHeading(line);

    if (kind !== null || startsUnrecognizedSection) {
      if (current.lines.length > 0) {
        sections.push(current);
      }
      current = {
        kind: kind ?? "unrecognized",
        heading: line.text.slice(0, 160),
        startLine: line.number,
        endLine: line.number,
        lines: [],
      };
      continue;
    }

    current.lines.push(line);
    current.endLine = line.number;
  }

  if (current.lines.length > 0) {
    sections.push(current);
  }
  return sections;
}

/**
 * A short all-caps or colon-terminated line with no dates reads as a heading rather than
 * content. Used only to detect sections this extractor deliberately does not model, so
 * their content is reported as skipped instead of being filed under the previous section.
 */
function looksLikeUnknownHeading(line: SourceLine): boolean {
  if (line.isBullet || line.text.length > 48 || matchDateRange(line.text) !== null) {
    return false;
  }
  const words = line.text.split(" ").filter((word) => word.length > 0);
  if (words.length === 0 || words.length > 4) {
    return false;
  }
  const withoutColon = line.text.replace(/:$/, "");
  // Commas usually mean an inline list, such as a line of all-caps skill acronyms.
  if (!/^[\p{L}\p{N} .'&/()-]+$/u.test(withoutColon) || !/\p{L}/u.test(withoutColon)) {
    return false;
  }
  return withoutColon === withoutColon.toUpperCase() || line.text.endsWith(":");
}

/** Return the first date range in a line, for example `Jan 2021 – Present`. */
export function matchDateRange(text: string): string | null {
  const match = DATE_RANGE.exec(text);
  return match ? match[0].trim() : null;
}

/** Split an entry header such as `Senior Designer — Northstar Labs` into its parts. */
export function splitSegments(text: string): string[] {
  return text
    .split(SEGMENT_SEPARATOR)
    .map((segment) => segment.replace(/^[\s,;|·•—–-]+|[\s,;|·•—–-]+$/g, "").trim())
    .filter((segment) => segment.length > 0);
}

/** Stable, readable key fragment. Returns an empty string when nothing usable remains. */
export function slugify(text: string): string {
  const normalized = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (normalized.length <= MAX_SLUG_LENGTH) {
    return normalized;
  }

  // Cut on a word boundary so a truncated key does not read as a different word.
  const truncated = normalized.slice(0, MAX_SLUG_LENGTH);
  const lastBoundary = truncated.lastIndexOf("-");
  return (lastBoundary > 0 ? truncated.slice(0, lastBoundary) : truncated).replace(/-+$/g, "");
}
