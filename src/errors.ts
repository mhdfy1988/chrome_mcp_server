export type BrowserToolErrorCode =
  | "blocked_by_verification"
  | "auth_required"
  | "overlay_blocking"
  | "action_verification_failed"
  | "external_browser_close_blocked"
  | "external_page_close_blocked"
  | "invalid_operation"
  | "internal_error";

export class BrowserToolError extends Error {
  public readonly code: BrowserToolErrorCode;
  public readonly details?: unknown;

  public constructor(
    code: BrowserToolErrorCode,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "BrowserToolError";
    this.code = code;
    this.details = details;
  }
}

export interface BrowserToolErrorPayload {
  error: {
    code: BrowserToolErrorCode;
    message: string;
    details?: unknown;
  };
}

export function normalizeBrowserToolError(
  error: unknown,
): BrowserToolErrorPayload {
  if (error instanceof BrowserToolError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    };
  }

  if (error instanceof Error) {
    return {
      error: {
        code: "internal_error",
        message: error.message,
      },
    };
  }

  return {
    error: {
      code: "internal_error",
      message: String(error),
    },
  };
}
