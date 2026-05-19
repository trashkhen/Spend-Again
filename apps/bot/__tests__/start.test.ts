import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Must mock api-client before importing the handler so the module uses the mock
vi.mock('../src/lib/api-client.js', () => ({
  loginViaTelegram: vi.fn(),
  tokenStore: new Map<number, string>(),
  userIdStore: new Map<number, string>(),
  apiClient: {},
}))

import { startHandler } from '../src/handlers/start.js'
import { loginViaTelegram, tokenStore, userIdStore } from '../src/lib/api-client.js'

// ── Fixtures ───────────────────────────────────────────────────────────────────

const FAKE_TOKEN = 'eyJ.fake.jwt'
const FAKE_USER_ID = '00000000-0000-4000-8000-000000000001'
const DASHBOARD_URL = 'https://spend-again-dashboard.vercel.app'

function makeCtx(overrides: Partial<{ from: object }> = {}) {
  const replies: Array<{ text: string; options?: object }> = []
  return {
    from: {
      id: 123456789,
      first_name: 'Tester',
      username: 'tester',
      ...overrides.from,
    },
    reply: vi.fn().mockImplementation((text: string, options?: object) => {
      replies.push({ text, options })
      return Promise.resolve()
    }),
    _replies: replies,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('startHandler — JWT token in dashboard URL', () => {
  const originalDashboardUrl = process.env['DASHBOARD_URL']
  const originalApiUrl = process.env['API_URL']

  beforeEach(() => {
    process.env['DASHBOARD_URL'] = DASHBOARD_URL
    process.env['API_URL'] = 'http://localhost:3001'
    tokenStore.clear()
    userIdStore.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (originalDashboardUrl !== undefined) {
      process.env['DASHBOARD_URL'] = originalDashboardUrl
    } else {
      delete process.env['DASHBOARD_URL']
    }
    if (originalApiUrl !== undefined) {
      process.env['API_URL'] = originalApiUrl
    } else {
      delete process.env['API_URL']
    }
  })

  it('welcome message URL contains JWT token when auth succeeds', async () => {
    vi.mocked(loginViaTelegram).mockResolvedValue({ token: FAKE_TOKEN, userId: FAKE_USER_ID })

    const ctx = makeCtx()
    await startHandler(ctx as never)

    const welcomeReply = ctx._replies[0]
    expect(welcomeReply).toBeDefined()
    expect(welcomeReply!.text).toContain(`/auth?token=${encodeURIComponent(FAKE_TOKEN)}`)
    expect(welcomeReply!.text).toContain(DASHBOARD_URL)
  })

  it('inline keyboard URL contains JWT token when auth succeeds', async () => {
    vi.mocked(loginViaTelegram).mockResolvedValue({ token: FAKE_TOKEN, userId: FAKE_USER_ID })

    const ctx = makeCtx()
    await startHandler(ctx as never)

    const inlineReply = ctx._replies[1]
    expect(inlineReply).toBeDefined()
    const keyboard = (inlineReply!.options as { reply_markup?: { inline_keyboard?: unknown[][] } })
      ?.reply_markup
    expect(JSON.stringify(keyboard)).toContain(`/auth?token=`)
    expect(JSON.stringify(keyboard)).toContain(encodeURIComponent(FAKE_TOKEN))
  })

  it('welcome message URL is base URL (no token) when auth fails', async () => {
    vi.mocked(loginViaTelegram).mockResolvedValue(null)

    const ctx = makeCtx()
    await startHandler(ctx as never)

    const welcomeReply = ctx._replies[0]
    expect(welcomeReply!.text).toContain(DASHBOARD_URL)
    expect(welcomeReply!.text).not.toContain('/auth?token=')
  })

  it('sends fallback message (no inline button) when auth fails', async () => {
    vi.mocked(loginViaTelegram).mockResolvedValue(null)

    const ctx = makeCtx()
    await startHandler(ctx as never)

    // Second reply should be the plain-text fallback, not an inline keyboard
    const fallbackReply = ctx._replies[1]
    expect(fallbackReply!.text).toContain('Bring me to Site')
    expect((fallbackReply!.options as { reply_markup?: unknown } | undefined)?.reply_markup).toBeUndefined()
  })

  it('sends "dashboard ready" inline button message when auth succeeds', async () => {
    vi.mocked(loginViaTelegram).mockResolvedValue({ token: FAKE_TOKEN, userId: FAKE_USER_ID })

    const ctx = makeCtx()
    await startHandler(ctx as never)

    const inlineReply = ctx._replies[1]
    expect(inlineReply!.text).toContain('dashboard')
  })

  it('handles missing ctx.from gracefully (no crash)', async () => {
    vi.mocked(loginViaTelegram).mockResolvedValue(null)

    const ctx = makeCtx()
    ;(ctx as unknown as { from: undefined }).from = undefined
    await expect(startHandler(ctx as never)).resolves.not.toThrow()
  })
})
