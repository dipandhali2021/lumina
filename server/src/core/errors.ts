/** Typed error hierarchy. `code` is part of the API contract; `message` is user-safe. */

export type ErrorCode =
  | "validation_error"
  | "config_error"
  | "upstream_error"
  | "timeout"
  | "aborted"
  | "not_found"
  | "rate_limited"
  | "internal_error";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** Extra context for logs only — never serialized to the client. */
  readonly details?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    status: number,
    details?: unknown
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super("validation_error", message, 400, details);
  }
}

/** Server misconfiguration (unknown provider id, missing key). Not the client's fault. */
export class ConfigError extends AppError {
  constructor(message: string, details?: unknown) {
    super("config_error", message, 500, details);
  }
}

/** A third-party API failed or answered unusably. */
export class UpstreamError extends AppError {
  constructor(message: string, details?: unknown) {
    super("upstream_error", message, 502, details);
  }
}

export class TimeoutError extends AppError {
  constructor(message: string, details?: unknown) {
    super("timeout", message, 504, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super("not_found", message, 404);
  }
}

export function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")
  );
}

/** Normalize anything thrown into an AppError so handlers have one shape to render. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (isAbortError(err)) {
    return new AppError("aborted", "Request cancelled.", 499);
  }
  const message = err instanceof Error ? err.message : String(err);
  return new AppError("internal_error", "Something went wrong.", 500, message);
}
