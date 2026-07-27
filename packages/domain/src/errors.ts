export type TransitionErrorCode =
  | "DUPLICATE_EVENT_CONFLICT"
  | "GUARD_FAILED"
  | "INVALID_TRANSITION"
  | "STALE_REVISION";

export class TransitionError extends Error {
  readonly code: TransitionErrorCode;

  constructor(code: TransitionErrorCode, message: string) {
    super(message);
    this.name = "TransitionError";
    this.code = code;
  }
}
