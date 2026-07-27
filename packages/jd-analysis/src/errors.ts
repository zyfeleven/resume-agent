export type JdAnalysisErrorCode = "REQUIREMENT_NOT_FOUND";

export class JdAnalysisError extends Error {
  readonly code: JdAnalysisErrorCode;

  constructor(code: JdAnalysisErrorCode, message: string) {
    super(message);
    this.name = "JdAnalysisError";
    this.code = code;
  }
}
