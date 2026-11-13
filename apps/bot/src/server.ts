/**
 * HTTP request handler for the bot service.
 *
 * Two POST routes share one port:
 *   - `POST /ingest` — a phone automation (Apple Pay Shortcut) reporting a
 *     payment, authenticated by a personal capture key.
 *   - any other POST — the Telegram webhook, authenticated by Telegram's
 *     secret-token header.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createLogger } from '@spend-again/shared'
import type { IngestAuth, IngestOutcome, IngestRequest } from './lib/ingest.js'
import type { IngestLoginResult } from './lib/api-client.js'

const log = createLogger('bot:server')

export const INGEST_MAX_PER_HOUR = 30
export const INGEST_MAX_BODY_BYTES = 4096
export const INGEST_MAX_TEXT_CHARS = 500
const INGEST_MAX_CARD_CHARS = 60
const INGEST_WINDOW_MS = 3_600_000
/**
 * Key checks allowed per hour across ALL keys the bot has not verified.
 * Guessing with a fresh key each time shares this one budget, so it cannot
 * flood the API's login route (which would also lock real users out).
 */
export const INGEST_MAX_UNKNOWN_PER_HOUR = 120
/**
 * How long a verified key is trusted without asking the API again. Also the
 * longest a replaced key keeps working after /autolog is run again.
 */
export const INGEST_AUTH_CACHE_MS = 300_000
const INGEST_KEY_RE = /^sa_[A-Za-z0-9_-]{43}$/

export type ServerDeps = {
  /** Absent in development (long-polling), where only /ingest is served. */
  webhook?: {
    secret: string
    handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  }
  /** Resolves a capture key to its owner; tells a bad key from an unreachable API. */
  login: (key: string) => Promise<IngestLoginResult>
  process: (auth: IngestAuth, req: IngestRequest) => Promise<IngestOutcome>
  now: () => number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** Reads the body, or returns null once it exceeds `maxBytes`. */
async function readBody(req: IncomingMessage, maxBytes: number): Promise<string | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer)
    size += buf.length
    if (size > maxBytes) return null
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function parseIngestBody(raw: string): IngestRequest | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null

  const { source, text, card } = data as Record<string, unknown>
  if (source !== 'wallet') return null
  if (typeof text !== 'string' || text.trim().length === 0 || text.length > INGEST_MAX_TEXT_CHARS) {
    return null
  }
  if (card === undefined || card === null) return { source, text }
  if (typeof card !== 'string' || card.length > INGEST_MAX_CARD_CHARS) return null
  return { source, text, card }
}

// ── Handler factory ───────────────────────────────────────────────────────────

export function createRequestHandler(
  deps: ServerDeps,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  // Verified key hash → request timestamps in the current hour. Only keys
  // the API has confirmed get an entry, so this is bounded by user count.
  const perKey = new Map<string, number[]>()
  // Verified key hash → who it belongs to. Lets a real key keep working
  // while unknown keys are being throttled, and spares the API a login per tap.
  const verified = new Map<string, { auth: IngestAuth; at: number }>()
  // Timestamps of key checks for unverified keys, all keys together.
  let unknownChecks: number[] = []

  function withinWindow(times: number[], now: number): number[] {
    return times.filter((t) => now - t < INGEST_WINDOW_MS)
  }

  function allowKey(keyHash: string, now: number): boolean {
    const times = withinWindow(perKey.get(keyHash) ?? [], now)
    if (times.length >= INGEST_MAX_PER_HOUR) {
      perKey.set(keyHash, times)
      return false
    }
    times.push(now)
    perKey.set(keyHash, times)
    return true
  }

  async function handleIngest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const header = req.headers['authorization']
    const key = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : ''
    // Shape check first: junk never costs a hash, a map entry or an API call.
    if (!INGEST_KEY_RE.test(key)) {
      sendJson(res, 401, { error: 'Unauthorized', code: 'INVALID_INGEST_KEY' })
      return
    }

    const raw = await readBody(req, INGEST_MAX_BODY_BYTES)
    if (raw === null) {
      sendJson(res, 413, { error: 'Payload too large', code: 'BODY_TOO_LARGE' })
      req.resume()
      return
    }

    const body = parseIngestBody(raw)
    if (body === null) {
      sendJson(res, 400, { error: 'Invalid request', code: 'VALIDATION_ERROR' })
      return
    }

    const now = deps.now()
    const keyHash = createHash('sha256').update(key).digest('hex')

    let auth: IngestAuth
    const cached = verified.get(keyHash)
    if (cached !== undefined && now - cached.at < INGEST_AUTH_CACHE_MS) {
      auth = cached.auth
    } else {
      verified.delete(keyHash)
      unknownChecks = withinWindow(unknownChecks, now)
      if (unknownChecks.length >= INGEST_MAX_UNKNOWN_PER_HOUR) {
        sendJson(res, 429, { error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' })
        return
      }
      unknownChecks.push(now)

      const result = await deps.login(key)
      if (!result.ok) {
        perKey.delete(keyHash)
        if (result.reason === 'unavailable') {
          // Not the key's fault — say so, so the Shortcut can be retried.
          sendJson(res, 503, { error: 'Service unavailable', code: 'LOGIN_UNAVAILABLE' })
        } else {
          sendJson(res, 401, { error: 'Unauthorized', code: 'INVALID_INGEST_KEY' })
        }
        return
      }
      auth = result.auth
      verified.set(keyHash, { auth, at: now })
    }

    if (!allowKey(keyHash, now)) {
      sendJson(res, 429, { error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' })
      return
    }

    // Ack first: the Shortcut should not wait on Gemini or Telegram. The
    // user hears about the outcome in Telegram either way.
    sendJson(res, 202, { ok: true })
    deps.process(auth, body).catch((err: unknown) => {
      // The request body is deliberately not logged.
      log.error({ err }, 'auto-capture processing threw')
    })
  }

  async function handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const webhook = deps.webhook
    if (webhook === undefined) {
      res.writeHead(404)
      res.end('Not found')
      return
    }
    const provided = req.headers['x-telegram-bot-api-secret-token']
    const providedValid =
      typeof provided === 'string' &&
      provided.length === webhook.secret.length &&
      timingSafeEqual(Buffer.from(provided), Buffer.from(webhook.secret))
    if (!providedValid) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }
    await webhook.handle(req, res).catch((err: unknown) => {
      log.error({ err }, 'handleUpdate threw')
      if (!res.writableEnded) {
        res.writeHead(500)
        res.end()
      }
    })
  }

  return async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(200)
      res.end('Spend Again? Bot — webhook active')
      return
    }
    const path = (req.url ?? '/').split('?')[0]
    if (path === '/ingest') {
      await handleIngest(req, res).catch((err: unknown) => {
        log.error({ err }, 'ingest request failed')
        if (!res.writableEnded) sendJson(res, 500, { error: 'Internal error', code: 'INTERNAL' })
      })
      return
    }
    await handleWebhook(req, res)
  }
}
