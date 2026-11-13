import { describe, it, expect, vi, afterEach } from 'vitest'
import { createServer } from 'node:http'
import type { Server, IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

vi.mock('../src/lib/api-client.js', () => ({
  tokenStore: new Map<number, string>(),
  userIdStore: new Map<number, string>(),
  apiClient: {},
}))

import {
  createRequestHandler,
  INGEST_MAX_PER_HOUR,
  INGEST_MAX_TEXT_CHARS,
  INGEST_MAX_UNKNOWN_PER_HOUR,
  INGEST_AUTH_CACHE_MS,
} from '../src/server.js'
import type { ServerDeps } from '../src/server.js'

const AUTH = { token: 'jwt', userId: 'user-uuid', telegramId: '281882561' }
const KEY = `sa_${'a'.repeat(43)}`
const BODY = { source: 'wallet', text: 'S$8.50 Ya Kun Kaya Toast', card: 'Revolut' }

type Harness = {
  url: string
  deps: {
    login: ReturnType<typeof vi.fn>
    process: ReturnType<typeof vi.fn>
    handle: ReturnType<typeof vi.fn>
  }
  setNow: (ms: number) => void
}

let server: Server | undefined

async function start(opts: { webhook?: boolean } = {}): Promise<Harness> {
  let now = 1_000_000
  const login = vi.fn().mockResolvedValue({ ok: true, auth: AUTH })
  const process = vi.fn().mockResolvedValue('saved')
  const handle = vi.fn(async (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200)
    res.end('webhook-ok')
  })
  const deps: ServerDeps = {
    login,
    process,
    now: () => now,
    ...(opts.webhook === false ? {} : { webhook: { secret: 'hook-secret', handle } }),
  }
  const s = createServer(createRequestHandler(deps))
  server = s
  await new Promise<void>((resolve) => s.listen(0, resolve))
  const { port } = s.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    deps: { login, process, handle },
    setNow: (ms) => {
      now = ms
    },
  }
}

function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const bearer = (key = KEY): Record<string, string> => ({ Authorization: `Bearer ${key}` })

afterEach(async () => {
  const s = server
  server = undefined
  if (s !== undefined) await new Promise<void>((resolve) => s.close(() => resolve()))
})

describe('POST /ingest', () => {
  it('accepts a valid Apple Pay report with 202 and processes it once', async () => {
    const h = await start()
    const res = await post(`${h.url}/ingest`, BODY, bearer())

    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ ok: true })
    expect(h.deps.login).toHaveBeenCalledWith(KEY)
    expect(h.deps.process).toHaveBeenCalledOnce()
    expect(h.deps.process).toHaveBeenCalledWith(AUTH, BODY)
  })

  it('accepts a report without a card', async () => {
    const h = await start()
    const res = await post(`${h.url}/ingest`, { source: 'wallet', text: '8.50 Ya Kun' }, bearer())
    expect(res.status).toBe(202)
    expect(h.deps.process).toHaveBeenCalledWith(AUTH, { source: 'wallet', text: '8.50 Ya Kun' })
  })

  it('rejects a request with no Authorization header', async () => {
    const h = await start()
    const res = await post(`${h.url}/ingest`, BODY)
    expect(res.status).toBe(401)
    expect(h.deps.login).not.toHaveBeenCalled()
    expect(h.deps.process).not.toHaveBeenCalled()
  })

  it('rejects an unknown or replaced key with 401 and processes nothing', async () => {
    const h = await start()
    h.deps.login.mockResolvedValue({ ok: false, reason: 'invalid' })
    const res = await post(`${h.url}/ingest`, BODY, bearer())
    expect(res.status).toBe(401)
    expect(h.deps.process).not.toHaveBeenCalled()
  })

  it('answers 503, not 401, when the API cannot be reached to check the key', async () => {
    const h = await start()
    h.deps.login.mockResolvedValue({ ok: false, reason: 'unavailable' })
    const res = await post(`${h.url}/ingest`, BODY, bearer())
    expect(res.status).toBe(503)
    expect(h.deps.process).not.toHaveBeenCalled()
  })

  it.each(['not-a-key', 'sa_short', `sk_${'a'.repeat(43)}`, `sa_${'a'.repeat(44)}`])(
    'rejects the malformed key %s with 401 without asking the API',
    async (bad) => {
      const h = await start()
      const res = await post(`${h.url}/ingest`, BODY, bearer(bad))
      expect(res.status).toBe(401)
      expect(h.deps.login).not.toHaveBeenCalled()
    },
  )

  it('checks a key with the API once, then trusts it for INGEST_AUTH_CACHE_MS', async () => {
    const h = await start()
    await post(`${h.url}/ingest`, BODY, bearer())
    await post(`${h.url}/ingest`, BODY, bearer())
    expect(h.deps.login).toHaveBeenCalledOnce()

    h.setNow(1_000_000 + INGEST_AUTH_CACHE_MS + 1)
    await post(`${h.url}/ingest`, BODY, bearer())
    expect(h.deps.login).toHaveBeenCalledTimes(2)
  })

  it('stops honouring a replaced key once the cache expires', async () => {
    const h = await start()
    expect((await post(`${h.url}/ingest`, BODY, bearer())).status).toBe(202)
    h.deps.login.mockResolvedValue({ ok: false, reason: 'invalid' })
    h.setNow(1_000_000 + INGEST_AUTH_CACHE_MS + 1)
    expect((await post(`${h.url}/ingest`, BODY, bearer())).status).toBe(401)
  })

  it.each([
    ['an unsupported source', { source: 'email', text: 'x' }],
    ['the paused sms source', { source: 'sms', text: 'UOB: paid SGD 5.00' }],
    ['empty text', { source: 'wallet', text: '   ' }],
    ['text over the limit', { source: 'wallet', text: 'a'.repeat(INGEST_MAX_TEXT_CHARS + 1) }],
    ['a non-string card', { source: 'wallet', text: '8.50 Ya Kun', card: 42 }],
    ['a non-object body', [1, 2, 3]],
  ])('rejects %s with 400', async (_label, body) => {
    const h = await start()
    const res = await post(`${h.url}/ingest`, body, bearer())
    expect(res.status).toBe(400)
    expect(h.deps.process).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON with 400', async () => {
    const h = await start()
    const res = await post(`${h.url}/ingest`, '{not json', bearer())
    expect(res.status).toBe(400)
  })

  it('accepts text exactly at the limit', async () => {
    const h = await start()
    const res = await post(`${h.url}/ingest`, { source: 'wallet', text: 'a'.repeat(INGEST_MAX_TEXT_CHARS) }, bearer())
    expect(res.status).toBe(202)
  })

  it('rejects an oversized body with 413', async () => {
    const h = await start()
    const res = await post(`${h.url}/ingest`, { source: 'wallet', text: 'a'.repeat(5000) }, bearer())
    expect(res.status).toBe(413)
    expect(h.deps.process).not.toHaveBeenCalled()
  })

  it('limits each key to INGEST_MAX_PER_HOUR requests but leaves other keys alone', async () => {
    const h = await start()
    for (let i = 0; i < INGEST_MAX_PER_HOUR; i++) {
      expect((await post(`${h.url}/ingest`, BODY, bearer())).status).toBe(202)
    }
    const limited = await post(`${h.url}/ingest`, BODY, bearer())
    expect(limited.status).toBe(429)
    expect(h.deps.process).toHaveBeenCalledTimes(INGEST_MAX_PER_HOUR)

    const other = await post(`${h.url}/ingest`, BODY, bearer(`sa_${'b'.repeat(43)}`))
    expect(other.status).toBe(202)
  })

  it('caps key checks across ALL unknown keys, so guessing with fresh keys is throttled', async () => {
    const h = await start()
    h.deps.login.mockResolvedValue({ ok: false, reason: 'invalid' })
    const junk = (i: number): string => `sa_${String(i).padStart(43, 'x')}`
    for (let i = 0; i < INGEST_MAX_UNKNOWN_PER_HOUR; i++) {
      expect((await post(`${h.url}/ingest`, BODY, bearer(junk(i)))).status).toBe(401)
    }
    expect((await post(`${h.url}/ingest`, BODY, bearer(junk(9999)))).status).toBe(429)
    expect(h.deps.login).toHaveBeenCalledTimes(INGEST_MAX_UNKNOWN_PER_HOUR)
  })

  it('keeps serving an already-verified key while junk keys are being throttled', async () => {
    const h = await start()
    expect((await post(`${h.url}/ingest`, BODY, bearer())).status).toBe(202)

    h.deps.login.mockResolvedValue({ ok: false, reason: 'invalid' })
    const junk = (i: number): string => `sa_${String(i).padStart(43, 'x')}`
    for (let i = 0; i <= INGEST_MAX_UNKNOWN_PER_HOUR; i++) await post(`${h.url}/ingest`, BODY, bearer(junk(i)))

    expect((await post(`${h.url}/ingest`, BODY, bearer())).status).toBe(202)
  })

  it('lets requests through again once the hour has passed', async () => {
    const h = await start()
    for (let i = 0; i < INGEST_MAX_PER_HOUR; i++) await post(`${h.url}/ingest`, BODY, bearer())
    h.setNow(1_000_000 + 3_600_000 + 1)
    expect((await post(`${h.url}/ingest`, BODY, bearer())).status).toBe(202)
  })

  it('still answers 202 and keeps serving when processing rejects', async () => {
    const h = await start()
    h.deps.process.mockRejectedValue(new Error('boom'))
    expect((await post(`${h.url}/ingest`, BODY, bearer())).status).toBe(202)
    h.deps.process.mockResolvedValue('saved')
    expect((await post(`${h.url}/ingest`, BODY, bearer())).status).toBe(202)
  })

  it('ignores a query string on the path', async () => {
    const h = await start()
    expect((await post(`${h.url}/ingest?x=1`, BODY, bearer())).status).toBe(202)
  })
})

describe('Telegram webhook routing is unchanged', () => {
  it('passes a POST with the right secret to the webhook handler', async () => {
    const h = await start()
    const res = await post(`${h.url}/`, { update_id: 1 }, { 'x-telegram-bot-api-secret-token': 'hook-secret' })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('webhook-ok')
    expect(h.deps.handle).toHaveBeenCalledOnce()
    expect(h.deps.process).not.toHaveBeenCalled()
  })

  it('rejects a POST with the wrong secret with 403', async () => {
    const h = await start()
    const res = await post(`${h.url}/`, { update_id: 1 }, { 'x-telegram-bot-api-secret-token': 'nope' })
    expect(res.status).toBe(403)
    expect(h.deps.handle).not.toHaveBeenCalled()
  })

  it('answers 500 when the webhook handler throws', async () => {
    const h = await start()
    h.deps.handle.mockRejectedValue(new Error('handler blew up'))
    const res = await post(`${h.url}/`, { update_id: 1 }, { 'x-telegram-bot-api-secret-token': 'hook-secret' })
    expect(res.status).toBe(500)
  })

  it('answers 404 to non-ingest POSTs when no webhook is configured (dev)', async () => {
    const h = await start({ webhook: false })
    const res = await post(`${h.url}/`, { update_id: 1 })
    expect(res.status).toBe(404)
  })

  it('answers GET with 200', async () => {
    const h = await start()
    const res = await fetch(`${h.url}/`)
    expect(res.status).toBe(200)
  })
})
