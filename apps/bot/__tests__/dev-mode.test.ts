import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../src/lib/api-client.js', () => ({
  tokenStore: new Map<number, string>(),
  apiClient: {},
}))

import { initDevMode } from '../src/lib/dev-mode.js'
import { tokenStore } from '../src/lib/api-client.js'

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('initDevMode', () => {
  beforeEach(() => {
    tokenStore.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('populates tokenStore with dev token for the given Telegram ID', async () => {
    const telegramId = 123456789
    const fakeToken = 'fake.jwt.token'
    const fakeUserId = '00000000-0000-4000-8000-000000000099'

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ token: fakeToken, userId: fakeUserId }),
      }),
    )

    const result = await initDevMode('http://localhost:3001', telegramId)

    expect(result).toEqual({ userId: fakeUserId, token: fakeToken })
    expect(tokenStore.get(telegramId)).toBe(fakeToken)
  })

  it('returns null and does not populate tokenStore when the API call fails', async () => {
    const telegramId = 123456789

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not found'),
      }),
    )

    const result = await initDevMode('http://localhost:3001', telegramId)

    expect(result).toBeNull()
    expect(tokenStore.has(telegramId)).toBe(false)
  })

  it('returns null and does not populate tokenStore when fetch throws', async () => {
    const telegramId = 123456789

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network error')),
    )

    const result = await initDevMode('http://localhost:3001', telegramId)

    expect(result).toBeNull()
    expect(tokenStore.has(telegramId)).toBe(false)
  })
})
