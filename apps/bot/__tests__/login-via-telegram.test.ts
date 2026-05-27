import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { loginViaTelegram, tokenStore, userIdStore } from '../src/lib/api-client.js'

// ── Fixtures ───────────────────────────────────────────────────────────────────

const FAKE_TOKEN = 'eyJ.fake.jwt'
const FAKE_USER_ID = '00000000-0000-4000-8000-000000000001'
const TEST_API_URL = 'http://localhost:3001'
const FROM = { id: 123456789, first_name: 'Tester', username: 'tester' }

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('loginViaTelegram', () => {
  // BOT_TOKEN is now captured at module load by apps/bot/src/lib/env.ts. The
  // vitest setup file provides a default so import succeeds; we only need to
  // reset stores between tests.
  beforeEach(() => {
    tokenStore.clear()
    userIdStore.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns token and userId, and populates stores on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ token: FAKE_TOKEN, userId: FAKE_USER_ID }),
      }),
    )

    const result = await loginViaTelegram(FROM, TEST_API_URL)

    expect(result).toEqual({ token: FAKE_TOKEN, userId: FAKE_USER_ID })
    expect(tokenStore.get(FROM.id)).toBe(FAKE_TOKEN)
    expect(userIdStore.get(FROM.id)).toBe(FAKE_USER_ID)
  })

  it('POSTs to the correct telegram-login endpoint', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: FAKE_TOKEN, userId: FAKE_USER_ID }),
    })
    vi.stubGlobal('fetch', mockFetch)

    await loginViaTelegram(FROM, TEST_API_URL)

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${TEST_API_URL}/api/auth/telegram-login`)
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body['id']).toBe(String(FROM.id))
    expect(typeof body['auth_date']).toBe('number')
    expect(typeof body['hash']).toBe('string')
    expect((body['hash'] as string).length).toBe(64) // hex SHA256
  })

  it('returns null and does not populate stores when API returns error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      }),
    )

    const result = await loginViaTelegram(FROM, TEST_API_URL)

    expect(result).toBeNull()
    expect(tokenStore.has(FROM.id)).toBe(false)
    expect(userIdStore.has(FROM.id)).toBe(false)
  })

  it('returns null when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))

    const result = await loginViaTelegram(FROM, TEST_API_URL)

    expect(result).toBeNull()
  })

  // Note: BOT_TOKEN is now validated at module load via apps/bot/src/lib/env.ts,
  // so there is no runtime "BOT_TOKEN missing" branch left to test. The bot
  // process would fail to start instead.
})
