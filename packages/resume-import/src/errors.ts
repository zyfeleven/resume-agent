export type ResumeImportErrorCode =
  | "ALREADY_REVIEWED"
  | "CONFLICT_NOT_FOUND"
  | "FACT_CONFLICT"
  | "FACT_MISMATCH"
  | "INVALID_CONFLICT_SELECTION"
  | "PROFILE_MISMATCH"
  | "REVIEW_TIME_REGRESSION"
  | "STALE_CONFLICT"
  | "STALE_REVIEW";

export class ResumeImportError extends Error {
  readonly code: ResumeImportErrorCode;

  constructor(code: ResumeImportErrorCode, message: string) {
    super(message);
    this.name = "ResumeImportError";
    this.code = code;
  }
}
