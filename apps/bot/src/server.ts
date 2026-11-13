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

const log = createLogger('bot:server')

export const INGEST_MAX_PER_HOUR = 30
export const INGEST_MAX_BODY_BYTES = 4096
export const INGEST_MAX_TEXT_CHARS = 500
const INGEST_MAX_CARD_CHARS = 60
const INGEST_WINDOW_MS = 3_600_000

export type ServerDeps = {
  /** Absent in development (long-polling), where only /ingest is served. */
  webhook?: {
    secret: string
    handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  }
  /** Resolves a capture key to its owner, or null when unknown/replaced. */
  login: (key: string) => Promise<IngestAuth | null>
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
  // Key hash → request timestamps inside the current window. Counted before
  // the key is checked, so guessing keys is throttled as well.
  const attempts = new Map<string, number[]>()

  function allow(keyHash: string, now: number): boolean {
    for (const [hash, times] of attempts) {
      const live = times.filter((t) => now - t < INGEST_WINDOW_MS)
      if (live.length === 0) attempts.delete(hash)
      else attempts.set(hash, live)
    }
    const times = attempts.get(keyHash) ?? []
    if (times.length >= INGEST_MAX_PER_HOUR) return false
    times.push(now)
    attempts.set(keyHash, times)
    return true
  }

  async function handleIngest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const header = req.headers['authorization']
    if (typeof header !== 'string' || !header.startsWith('Bearer ') || header.length <= 7) {
      sendJson(res, 401, { error: 'Unauthorized', code: 'NO_KEY' })
      return
    }
    const key = header.slice(7)

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

    const keyHash = createHash('sha256').update(key).digest('hex')
    if (!allow(keyHash, deps.now())) {
      sendJson(res, 429, { error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' })
      return
    }

    const auth = await deps.login(key)
    if (auth === null) {
      sendJson(res, 401, { error: 'Unauthorized', code: 'INVALID_INGEST_KEY' })
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
