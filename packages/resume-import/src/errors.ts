export type ResumeImportErrorCode =
  | "ALREADY_REVIEWED"
  | "FACT_MISMATCH"
  | "REVIEW_TIME_REGRESSION"
  | "STALE_REVIEW";

export class ResumeImportError extends Error {
  readonly code: ResumeImportErrorCode;

  constructor(code: ResumeImportErrorCode, message: string) {
    super(message);
    this.name = "ResumeImportError";
    this.code = code;
  }
}
