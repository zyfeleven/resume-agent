import type { RedactionFinding } from "./redaction.js";

export type AuditErrorCode = "UNREDACTED_PAYLOAD" | "BROKEN_CHAIN";

export class AuditError extends Error {
  readonly code: AuditErrorCode;
  readonly findings: RedactionFinding[];

  constructor(code: AuditErrorCode, message: string, findings: RedactionFinding[] = []) {
    super(message);
    this.name = "AuditError";
    this.code = code;
    this.findings = findings;
  }
}
