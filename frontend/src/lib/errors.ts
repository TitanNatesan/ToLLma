import { toast } from "sonner";
import { ApiError } from "@/services/api";

export interface ParsedApiError {
  status: number;
  code: string;
  message: string;
  retryable: boolean;
}

const FALLBACK_MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: "The provider rejected these credentials. Check the provider settings.",
  MODEL_NOT_FOUND: "That model is no longer available on the provider.",
  MODEL_UNAVAILABLE: "The provider is temporarily unavailable. Try again shortly.",
  RATE_LIMITED: "Rate limited by the provider. Wait a moment and retry.",
  TIMEOUT: "The provider request timed out. Retry, or pick a faster model.",
  STREAM_INTERRUPTED: "The response stream was interrupted. Retry to continue.",
  GENERATION_CANCELLED: "Generation was stopped.",
  INVALID_CONFIGURATION: "This provider or model is misconfigured.",
  MESSAGE_TOO_LONG: "The message is too long for this model.",
  FILE_NOT_SUPPORTED: "This model does not support that file type.",
  MODEL_NOT_CAPABLE: "This model does not support that input.",
  VALIDATION_ERROR: "The request was rejected. Check the values and try again.",
  DATABASE_ERROR: "A database error occurred. Retry in a moment.",
  CACHE_ERROR: "A caching error occurred. Retry in a moment.",
  NOT_FOUND: "That item no longer exists.",
  UNAUTHENTICATED: "Your session expired. Sign in again.",
  CONFLICT: "Another generation is already running for this conversation.",
  UNKNOWN_ERROR: "Something went wrong. Please try again.",
};

/** Turn any thrown value into an actionable, human-readable error. */
export function parseApiError(error: unknown): ParsedApiError {
  if (error instanceof ApiError) {
    const body = error.data as { error?: { code?: string; message?: string; retryable?: boolean } } | null;
    const code = body?.error?.code ?? "UNKNOWN_ERROR";
    const message =
      body?.error?.message && !body.error.message.startsWith("An unexpected")
        ? body.error.message
        : FALLBACK_MESSAGES[code] ?? error.message;
    return { status: error.status, code, message, retryable: body?.error?.retryable ?? false };
  }
  if (error instanceof Error) {
    return { status: 0, code: "UNKNOWN_ERROR", message: error.message, retryable: true };
  }
  return { status: 0, code: "UNKNOWN_ERROR", message: FALLBACK_MESSAGES.UNKNOWN_ERROR, retryable: true };
}

/** Toast an API failure with an optional retry action. Never shows raw stack traces. */
export function toastApiError(error: unknown, options?: { title?: string; onRetry?: () => void }): ParsedApiError {
  const parsed = parseApiError(error);
  const retry = options?.onRetry;
  toast.error(options?.title ?? "Request failed", {
    description: parsed.message,
    action: retry && parsed.retryable ? { label: "Retry", onClick: retry } : undefined,
  });
  return parsed;
}
