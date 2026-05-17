/**
 * Typed error classes shared across the Spend Again? monorepo.
 *
 * Using named error classes (instead of plain Error) allows handlers to
 * distinguish error types without relying on message-string matching.
 */

// ---------------------------------------------------------------------------
// API / HTTP errors
// ---------------------------------------------------------------------------

/** Base class for all application errors. */
export class AppError extends Error {
  /** Machine-readable error code, e.g. "NOT_FOUND". */
  readonly code: string
  /** HTTP status code to return. */
  readonly statusCode: number

  constructor(message: string, code: string, statusCode = 500) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.statusCode = statusCode
  }
}

/** 400 Bad Request — invalid input from the client. */
export class ValidationError extends AppError {
  readonly details?: unknown

  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', 400)
    this.name = 'ValidationError'
    this.details = details
  }
}

/** 401 Unauthorized — missing or invalid credentials. */
export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 'UNAUTHORIZED', 401)
    this.name = 'UnauthorizedError'
  }
}

/** 404 Not Found — resource does not exist. */
export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 'NOT_FOUND', 404)
    this.name = 'NotFoundError'
  }
}

/** 429 Too Many Requests — rate limit exceeded. */
export class RateLimitError extends AppError {
  /** Time (in seconds) until the limit resets, if known. */
  readonly retryAfterSeconds?: number

  constructor(message = 'Rate limit exceeded', retryAfterSeconds?: number) {
    super(message, 'RATE_LIMIT_EXCEEDED', 429)
    this.name = 'RateLimitError'
    if (retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = retryAfterSeconds
    }
  }
}

/** 500 Internal Server Error — unexpected server-side failure. */
export class InternalError extends AppError {
  constructor(message = 'Internal server error') {
    super(message, 'INTERNAL_ERROR', 500)
    this.name = 'InternalError'
  }
}

// ---------------------------------------------------------------------------
// AI / parsing errors
// ---------------------------------------------------------------------------

/** Thrown when the Gemini API returns a 429 rate-limit response. */
export class GeminiRateLimitError extends RateLimitError {
  constructor() {
    super('Gemini rate limit exceeded (15 RPM)')
    this.name = 'GeminiRateLimitError'
  }
}

/** Thrown when the Gemini Vision OCR API returns a 429 response. */
export class OcrRateLimitError extends RateLimitError {
  constructor() {
    super('OCR rate limit exceeded')
    this.name = 'OcrRateLimitError'
  }
}

// ---------------------------------------------------------------------------
// Type guard helpers
// ---------------------------------------------------------------------------

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError
}
