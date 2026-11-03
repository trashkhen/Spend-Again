import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ApiClient,
  isTokenExpired,
  loginViaTelegram,
  telegramUserStore,
  tokenStore,
  userIdStore,
} from '../src/lib/api-client.js'

// ── Fixtures ───────────────────────────────────────────────────────────────────

const API_URL = 'http://localhost:3001'
const FROM = { id: 123456789, first_name: 'Tester', username: 'tester' }
const USER_ID = '00000000-0000-4000-8000-000000000001'
const STALE_TOKEN = 'stale.token'
const FRESH_TOKEN = 'fresh.token'

const TX_INPUT = {
  userId: USER_ID,
  amountCents: 2005,
  item: 'Airport train',
  category: 'Transport',
  subCategory: 'MRT/Bus',
  date: '03/11/2026',
  source: 'bot',
} as const

function json(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response
}

function jwtWithExp(expSeconds: number): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'HS256' })}.${b64({ userId: USER_ID, exp: expSeconds })}.sig`
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ApiClient re-authentication on 401', () => {
  beforeEach(async () => {
    tokenStore.clear()
    userIdStore.clear()
    telegramUserStore.clear()
    // Prime the stores the way a real /start login does.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { token: STALE_TOKEN, userId: USER_ID })))
    await loginViaTelegram(FROM, API_URL)
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('logs in again and retries once when the cached token is rejected', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(json(401, { error: 'Unauthorized', code: 'INVALID_TOKEN' }))
      .mockResolvedValueOnce(json(200, { token: FRESH_TOKEN, userId: USER_ID }))
      .mockResolvedValueOnce(json(201, { id: 'tx-1' }))
    vi.stubGlobal('fetch', mockFetch)

    const client = new ApiClient(API_URL, STALE_TOKEN)
    const result = await client.createTransaction(TX_INPUT)

    expect(result).toEqual({ id: 'tx-1' })
    expect(mockFetch).toHaveBeenCalledTimes(3)

    const [loginUrl] = mockFetch.mock.calls[1] as [string, RequestInit]
    expect(loginUrl).toBe(`${API_URL}/api/auth/telegram-login`)

    const [retryUrl, retryInit] = mockFetch.mock.calls[2] as [string, RequestInit]
    expect(retryUrl).toBe(`${API_URL}/api/transactions`)
    expect((retryInit.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${FRESH_TOKEN}`)

    // Fresh token is cached for later requests.
    expect(tokenStore.get(FROM.id)).toBe(FRESH_TOKEN)
    expect(client.getToken()).toBe(FRESH_TOKEN)
  })

  it('does not retry more than once if the fresh token is also rejected', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(json(401, { code: 'INVALID_TOKEN' }))
      .mockResolvedValueOnce(json(200, { token: FRESH_TOKEN, userId: USER_ID }))
      .mockResolvedValueOnce(json(401, { code: 'INVALID_TOKEN' }))
    vi.stubGlobal('fetch', mockFetch)

    const client = new ApiClient(API_URL, STALE_TOKEN)
    const result = await client.createTransaction(TX_INPUT)

    expect(result).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('returns the original failure when re-login fails', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(json(401, { code: 'INVALID_TOKEN' }))
      .mockResolvedValueOnce(json(500, { error: 'boom' }))
    vi.stubGlobal('fetch', mockFetch)

    const client = new ApiClient(API_URL, STALE_TOKEN)
    const result = await client.createTransaction(TX_INPUT)

    expect(result).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('does not attempt re-login for a token that is not in the store', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(json(401, { code: 'INVALID_TOKEN' }))
    vi.stubGlobal('fetch', mockFetch)

    const client = new ApiClient(API_URL, 'unknown.token')
    const result = await client.createTransaction(TX_INPUT)

    expect(result).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

describe('isTokenExpired', () => {
  const now = Math.floor(Date.now() / 1000)

  it('is true for a token whose exp is in the past', () => {
    expect(isTokenExpired(jwtWithExp(now - 60))).toBe(true)
  })

  it('is true when expiry is within the safety margin', () => {
    expect(isTokenExpired(jwtWithExp(now + 30))).toBe(true)
  })

  it('is false for a token with plenty of life left', () => {
    expect(isTokenExpired(jwtWithExp(now + 86_400))).toBe(false)
  })

  it('is false for a token it cannot decode', () => {
    expect(isTokenExpired('not-a-jwt')).toBe(false)
  })
})
