import type { JsonValue } from "@resume-agent/contracts";

/**
 * The `redacted` flag on an audit event has to mean something, so it is enforced here
 * rather than asserted by whoever writes the event.
 *
 * An audit payload is for identifiers, hashes, counts, enums, and reasons — the things
 * that let someone reconstruct what happened. It is not for answers. A candidate's email
 * address, phone number, or a credential must never reach the timeline, because an audit
 * trail outlives the run it describes and is the last place anyone thinks to look for a
 * leak.
 */

export type RedactionCode =
  | "email_address"
  | "phone_number"
  | "payment_number"
  | "credential"
  | "free_text";

export interface RedactionFinding {
  path: string;
  code: RedactionCode;
}

/** The longest a payload string may be. Anything longer is prose, not a fact about a run. */
const MAX_STRING_LENGTH = 300;

const PATTERNS: ReadonlyArray<{ code: RedactionCode; pattern: RegExp }> = [
  { code: "email_address", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { code: "phone_number", pattern: /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/ },
  { code: "payment_number", pattern: /\b(?:\d[ -]?){13,19}\b/ },
  {
    code: "credential",
    pattern:
      /\b(pass(word|phrase)|passwd|api[-_ ]?key|secret[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|private[-_ ]?key|client[-_ ]?secret|bearer)\b/i,
  },
  { code: "credential", pattern: /(?:^|\s)(?:sk|pk|ghp|ghs|xox[baprs])[-_][A-Za-z0-9]{16,}/ },
];

/** A 64-character hex string is a digest, not a payment number. */
const SHA256 = /^[a-f0-9]{64}$/;

function inspectString(value: string, path: string, findings: RedactionFinding[]): void {
  if (SHA256.test(value)) {
    return;
  }
  if (value.length > MAX_STRING_LENGTH) {
    findings.push({ path, code: "free_text" });
    return;
  }
  for (const { code, pattern } of PATTERNS) {
    if (pattern.test(value)) {
      findings.push({ path, code });
      return;
    }
  }
}

function walk(value: JsonValue, path: string, findings: RedactionFinding[]): void {
  if (typeof value === "string") {
    inspectString(value, path, findings);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, `${path}[${index}]`, findings));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      walk(entry, path.length > 0 ? `${path}.${key}` : key, findings);
    }
  }
}

/** Everything in this payload that must not be written to an audit trail. */
export function findUnredacted(payload: Record<string, JsonValue>): RedactionFinding[] {
  const findings: RedactionFinding[] = [];
  walk(payload, "", findings);
  return findings;
}
