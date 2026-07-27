export type ResumeTailorErrorCode =
  | "CHANGE_NOT_FOUND"
  | "CLAIM_GUARD_FAILED"
  | "NO_VERIFIED_HEADER_FACT"
  | "STALE_REVIEW";

export class ResumeTailorError extends Error {
  readonly code: ResumeTailorErrorCode;

  constructor(code: ResumeTailorErrorCode, message: string) {
    super(message);
    this.name = "ResumeTailorError";
    this.code = code;
  }
}
