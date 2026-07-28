import type { PolicyDecision } from "@resume-agent/contracts";

export type BrowserRunnerErrorCode =
  | "ORIGIN_NOT_ALLOWED"
  | "POLICY_REFUSED"
  | "RESERVATION_SPENT"
  | "SESSION_NOT_FOUND"
  | "SESSION_CLOSED"
  | "STALE_SNAPSHOT"
  | "SUBMIT_REFUSED";

export class BrowserRunnerError extends Error {
  readonly code: BrowserRunnerErrorCode;
  readonly decision?: PolicyDecision;

  constructor(code: BrowserRunnerErrorCode, message: string, decision?: PolicyDecision) {
    super(message);
    this.name = "BrowserRunnerError";
    this.code = code;
    if (decision) {
      this.decision = decision;
    }
  }
}
