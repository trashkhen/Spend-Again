/**
 * Global error-handling middleware for the Hono API.
 *
 * Catches all unhandled errors thrown in route handlers, maps them to a
 * consistent JSON error response shape, and prevents stack traces from
 * leaking to clients in production.
 *
 * Error response shape:
 *   { error: string, code: string, details?: unknown }
 */

import type { Context } from 'hono'
import { isAppError } from '@spend-again/shared'

// ── Consistent error response shape ──────────────────────────────────────────

export type ApiErrorResponse = {
  error: string
  code: string
  details?: unknown
}

// ── Hono onError handler ──────────────────────────────────────────────────────

/**
 * Pass this as `app.onError(globalErrorHandler)` in the Hono app setup.
 *
 * All errors thrown in route handlers bubble up here if not caught locally.
 */
export function globalErrorHandler(err: Error, c: Context): Response {
  // Typed application error — use its status code and structured fields
  if (isAppError(err)) {
    const body: ApiErrorResponse = {
      error: err.message,
      code: err.code,
    }

    if ('details' in err && err.details !== undefined) {
      body.details = err.details as unknown
    }

    return c.json(body, err.statusCode as Parameters<typeof c.json>[1])
  }

  // Unknown error — log it but return a generic 500 to the client
  // (never expose internal details / stack traces)
  console.error('[API] Unhandled error:', err)

  const body: ApiErrorResponse = {
    error: 'An unexpected error occurred',
    code: 'INTERNAL_ERROR',
  }

  return c.json(body, 500)
}
