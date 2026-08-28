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
  CurrencyConversionError: class CurrencyConversionError extends Error {
    constructor(message = 'Currency conversion unavailable') {
      super(message)
      this.name = 'CurrencyConversionError'
    }
  },
}))

vi.mock('../src/keyboards/confirm.js', () => ({
  buildConfirmKeyboard: vi.fn().mockReturnValue({ inline_keyboard: [] }),
}))

import { expenseHandler, deriveDescription, buildConfirmationMessage } from '../src/handlers/expense.js'
import { loginViaTelegram, tokenStore } from '../src/lib/api-client.js'
import { parse, CurrencyConversionError } from '@spend-again/parser'
import type { ParseResult } from '@spend-again/parser'

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

describe('deriveDescription', () => {
  it('strips dollar-prefix amount from start', () => {
    expect(deriveDescription('$3.50 coffee from june coffee')).toBe('coffee from june coffee')
  })
  it('strips S$ prefix', () => {
    expect(deriveDescription('S$8.50 lunch at Amoy')).toBe('lunch at Amoy')
  })
  it('strips bare number from start', () => {
    expect(deriveDescription('8.50 for lunch')).toBe('for lunch')
  })
  it('strips trailing currency amount', () => {
    expect(deriveDescription('coffee S$3.50')).toBe('coffee')
  })
  it('returns undefined for amount-only input', () => {
    expect(deriveDescription('$5')).toBeUndefined()
  })
})

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

describe('buildConfirmationMessage — currency conversion note', () => {
  function makeResult(overrides: Partial<ParseResult> = {}): ParseResult {
    return {
      amount: 805,
      item: 'Pasta',
      category: 'Food' as never,
      subCategory: 'Restaurant' as never,
      confidence: 0.85,
      tier: 3,
      ...overrides,
    }
  }

  it('appends a conversion note when originalAmount/originalCurrency/exchangeRate are set', () => {
    const msg = buildConfirmationMessage({
      result: makeResult({ originalAmount: 560, originalCurrency: 'EUR', exchangeRate: 1.4384 }),
      rawInput: '5.60 euro pasta',
    })

    expect(msg).toContain('€5.60')
    expect(msg).toContain('S$8.05')
    expect(msg).toContain('1 EUR = 1.4384 SGD')
  })

  it('omits the conversion note when there was no conversion', () => {
    const msg = buildConfirmationMessage({ result: makeResult(), rawInput: '$8.05 pasta' })

    expect(msg).not.toContain('→')
  })
})

describe('expenseHandler — currency conversion failure', () => {
  beforeEach(() => {
    tokenStore.clear()
    vi.clearAllMocks()
    tokenStore.set(TELEGRAM_ID, FAKE_TOKEN)
  })

  it('replies with the currency-unavailable message and does not throw when parse() rejects with CurrencyConversionError', async () => {
    vi.mocked(parse).mockRejectedValue(new CurrencyConversionError('rate service down'))

    const ctx = makeCtx()
    await expenseHandler(ctx as never)

    expect(ctx.reply).toHaveBeenCalledOnce()
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('exchange rate'))
  })
})
