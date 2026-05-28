import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/lib/api-client.js', () => ({
  loginViaTelegram: vi.fn(),
  tokenStore: new Map<number, string>(),
  userIdStore: new Map<number, string>(),
  apiClient: {
    setToken: vi.fn(),
    getLearnedMapping: vi.fn().mockResolvedValue(null),
  },
}))

vi.mock('@spend-again/parser', () => ({
  parse: vi.fn(),
  GeminiRateLimitError: class GeminiRateLimitError extends Error {
    constructor() {
      super('Gemini rate limit exceeded')
      this.name = 'GeminiRateLimitError'
    }
  },
}))

vi.mock('../src/keyboards/confirm.js', () => ({
  buildConfirmKeyboard: vi.fn().mockReturnValue({ inline_keyboard: [] }),
}))

import { expenseHandler } from '../src/handlers/expense.js'
import { loginViaTelegram, tokenStore } from '../src/lib/api-client.js'
import { parse } from '@spend-again/parser'

const FAKE_TOKEN = 'eyJ.fake.jwt'
const TELEGRAM_ID = 281882561
const EXPENSE_TEXT = '$3000 lv hoodie'

function makeCtx(overrides: { text?: string; telegramId?: number } = {}) {
  const text = overrides.text ?? EXPENSE_TEXT
  const id = overrides.telegramId ?? TELEGRAM_ID
  return {
    from: { id, first_name: 'khen', username: 'trashkhen' },
    chat: { id },
    message: { text },
    reply: vi.fn().mockResolvedValue(undefined),
  }
}

describe('expenseHandler — auto-reauth when tokenStore is empty after restart', () => {
  beforeEach(() => {
    tokenStore.clear()
    vi.clearAllMocks()
    vi.mocked(parse).mockResolvedValue({
      amount: 300000,
      item: 'LV Hoodie',
      category: 'Shopping' as never,
      subCategory: 'Luxury' as never,
      date: '21/05/2026',
      tier: 3,
      confidence: 0.85,
    })
  })

  it('re-authenticates silently and processes expense when tokenStore is empty', async () => {
    vi.mocked(loginViaTelegram).mockResolvedValue({ token: FAKE_TOKEN, userId: 'some-uuid' })

    const ctx = makeCtx()
    await expenseHandler(ctx as never)

    expect(loginViaTelegram).toHaveBeenCalledOnce()
    expect(ctx.reply).not.toHaveBeenCalledWith(expect.stringContaining("haven't registered"))
    expect(parse).toHaveBeenCalledWith(EXPENSE_TEXT, expect.objectContaining({ lookupItem: expect.any(Function) }))
  })

  it('shows "not registered" when tokenStore is empty and re-auth fails (user never signed up)', async () => {
    vi.mocked(loginViaTelegram).mockResolvedValue(null)

    const ctx = makeCtx()
    await expenseHandler(ctx as never)

    expect(ctx.reply).toHaveBeenCalledOnce()
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("haven't registered"))
    expect(parse).not.toHaveBeenCalled()
  })

  it('does not call loginViaTelegram when token already exists in store', async () => {
    tokenStore.set(TELEGRAM_ID, FAKE_TOKEN)

    const ctx = makeCtx()
    await expenseHandler(ctx as never)

    expect(loginViaTelegram).not.toHaveBeenCalled()
    expect(parse).toHaveBeenCalledWith(EXPENSE_TEXT, expect.objectContaining({ lookupItem: expect.any(Function) }))
  })
})
