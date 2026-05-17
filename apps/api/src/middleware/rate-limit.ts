/**
 * In-memory sliding-window rate limiter for the Hono API.
 *
 * Limits each authenticated user to 60 requests per minute.
 * Unauthenticated requests are identified by IP address.
 *
 * This is an in-process implementation suitable for a single-process
 * deployment (Railway single dyno). For multi-instance deployments,
 * replace the backing store with Redis.
 *
 * Response on limit exceeded:
 *   HTTP 429 with { error, code: "RATE_LIMIT_EXCEEDED" }
 *   Retry-After header set to seconds until window resets
 */

import type { MiddlewareHandler } from 'hono'

// ── Configuration ─────────────────────────────────────────────────────────────

/** Maximum requests allowed per window. */
const MAX_REQUESTS = 60

/** Window duration in milliseconds (1 minute). */
const WINDOW_MS = 60_000

// ── In-memory store ───────────────────────────────────────────────────────────

type WindowRecord = {
  /** Timestamp (ms) when this window started. */
  windowStart: number
  /** Number of requests made in the current window. */
  count: number
}

/**
 * Map of identifier → window record.
 * Identifiers are user IDs (from JWT) or IP addresses for anonymous requests.
 *
 * Entries older than WINDOW_MS are pruned on each request to prevent unbounded
 * memory growth.
 */
const store = new Map<string, WindowRecord>()

// ── Pruning ───────────────────────────────────────────────────────────────────

function pruneExpiredEntries(): void {
  const now = Date.now()
  for (const [key, record] of store) {
    if (now - record.windowStart >= WINDOW_MS) {
      store.delete(key)
    }
  }
}

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * Rate-limiting middleware.
 *
 * Reads the user identifier from the Hono context:
 *   1. `c.get('userId')` — set by requireAuth middleware for authenticated routes
 *   2. Fallback: `X-Forwarded-For` or `CF-Connecting-IP` headers (proxy/CDN)
 *   3. Last resort: `'anonymous'`
 *
 * Register AFTER the requireAuth middleware so the userId variable is available.
 */
export const rateLimitMiddleware: MiddlewareHandler = async (c, next) => {
  // Prune stale entries periodically (cheap — O(n) but n is small in practice)
  pruneExpiredEntries()

  // Determine identifier
  const userId = c.get('userId') as string | undefined
  const ip =
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ??
    c.req.header('CF-Connecting-IP') ??
    'anonymous'
  const identifier = userId ?? ip

  const now = Date.now()
  const existing = store.get(identifier)

  if (existing === undefined || now - existing.windowStart >= WINDOW_MS) {
    // Start a new window
    store.set(identifier, { windowStart: now, count: 1 })
    await next()
    return
  }

  existing.count += 1

  if (existing.count > MAX_REQUESTS) {
    const retryAfterMs = WINDOW_MS - (now - existing.windowStart)
    const retryAfterSec = Math.ceil(retryAfterMs / 1000)

    c.header('Retry-After', String(retryAfterSec))
    return c.json(
      {
        error: `Rate limit exceeded. Try again in ${retryAfterSec} seconds.`,
        code: 'RATE_LIMIT_EXCEEDED',
      },
      429,
    )
  }

  await next()
}
