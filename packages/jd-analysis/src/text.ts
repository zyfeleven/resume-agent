import type { JdSectionKind } from "@resume-agent/contracts";

export interface JdLine {
  /** 1-based line number in the pasted text, used as the requirement locator. */
  number: number;
  text: string;
  isBullet: boolean;
}

export interface JdSection {
  kind: JdSectionKind;
  heading?: string;
  startLine: number;
  endLine: number;
  lines: JdLine[];
}

const BULLET_MARKER = /^(?:[-–—•*‣·▪▸○]+|\d{1,2}[.)])\s+/;

const SECTION_HEADINGS: ReadonlyArray<{ kind: JdSectionKind; pattern: RegExp }> = [
  {
    kind: "responsibilities",
    pattern:
      /^(what you('| wi)ll do|what you do|the role|your (impact|role)|responsibilities|key responsibilities|duties|day[- ]to[- ]day|in this role|about (the|this) role|role overview)$/,
  },
  {
    kind: "preferred",
    pattern:
      /^((preferred|desired|additional|bonus|nice)[- ]?(qualifications?|skills?|experience|requirements?)?|nice to have|nice[- ]to[- ]haves?|bonus points|extra credit|great to have|even better if|pluses)$/,
  },
  {
    kind: "requirements",
    pattern:
      /^((minimum|basic|required|core)[- ]?(qualifications?|requirements?|skills?)|requirements?|qualifications?|what you('| wi)ll need|what we('| a)re looking for|who you are|about you|your (background|experience)|skills? (and|&) experience|must[- ]haves?)$/,
  },
  {
    kind: "benefits",
    pattern:
      /^(benefits?|perks?|perks? (and|&) benefits|what we offer|compensation( and benefits)?|salary( range)?|pay( range)?|why join us|our offer)$/,
  },
  {
    kind: "about",
    pattern: /^(about( us| the company| the team| our team)?|who we are|our (mission|story|values|team)|company overview)$/,
  },
  {
    kind: "legal",
    pattern:
      /^(equal (employment )?opportunity( statement)?|eeo( statement)?|diversity( statement| and inclusion)?|accommodations?|privacy( notice| policy)?|legal|disclaimer|e-verify)$/,
  },
];

/**
 * Split pasted text into non-empty, whitespace-normalized lines.
 * Line numbers stay aligned with the pasted text so every requirement can cite one.
 */
export function toJdLines(text: string): JdLine[] {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/[\t\u00a0\u2007\u202f]/g, " ");
  const lines: JdLine[] = [];

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

function normalizeHeading(text: string): string {
  return text
    .replace(/^[#*\s]+/, "")
    .replace(/[:*\s]+$/, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .toLowerCase();
}

/** Classify a line as a known job-description heading, or return null for ordinary content. */
export function headingKind(line: JdLine): JdSectionKind | null {
  if (line.isBullet) {
    return null;
  }
  const normalized = normalizeHeading(line.text);
  if (normalized.length === 0 || normalized.length > 60) {
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
 * Group lines into sections. Text before the first recognized heading is the intro.
 * A short unknown heading opens an `unrecognized` section so its lines are reported
 * rather than inheriting the priority of the section above them.
 */
export function segmentJdSections(lines: JdLine[]): JdSection[] {
  if (lines.length === 0) {
    return [];
  }

  const first = lines[0];
  if (!first) {
    return [];
  }

  const sections: JdSection[] = [];
  let current: JdSection = { kind: "intro", startLine: first.number, endLine: first.number, lines: [] };

  for (const line of lines) {
    const kind = headingKind(line);
    const opensUnknownSection = kind === null && current.kind !== "intro" && looksLikeUnknownHeading(line);

    if (kind !== null || opensUnknownSection) {
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

function looksLikeUnknownHeading(line: JdLine): boolean {
  if (line.isBullet || line.text.length > 60) {
    return false;
  }
  const words = line.text.split(" ").filter((word) => word.length > 0);
  if (words.length === 0 || words.length > 5) {
    return false;
  }
  const withoutColon = line.text.replace(/[:*]+$/, "");
  // Commas usually mean an inline list rather than a heading.
  if (!/^[\p{L}\p{N} .'&/()-]+$/u.test(withoutColon) || !/\p{L}/u.test(withoutColon)) {
    return false;
  }
  return withoutColon === withoutColon.toUpperCase() || line.text.endsWith(":");
}
