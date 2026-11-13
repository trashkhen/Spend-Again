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

// Only the network-bound pieces are faked. The merchant → category map is the
// real one, so these tests cross the same lookup production uses.
vi.mock('@spend-again/parser', async () => {
  const actual = await vi.importActual<typeof import('@spend-again/parser')>('@spend-again/parser')
  return {
    ...actual,
    parseWithGemini: vi.fn(),
    waitForGeminiRpmBudget: vi.fn().mockResolvedValue(undefined),
    convertToSGD: vi.fn(),
  }
})

import {
  processIngest,
  parseWalletText,
  clearIngestState,
  autologMerchantFor,
  INGEST_DUPLICATE_WINDOW_MS,
} from '../src/lib/ingest.js'
import type { IngestApi, IngestAuth, IngestDeps } from '../src/lib/ingest.js'
import { pendingConfirmations } from '../src/handlers/expense.js'
import { apiClient, tokenStore, userIdStore } from '../src/lib/api-client.js'
import { parseWithGemini, convertToSGD, GeminiRateLimitError, CurrencyConversionError } from '@spend-again/parser'
import { getTodayDDMMYYYY } from '@spend-again/shared'

const AUTH: IngestAuth = { token: 'jwt.for.khen', userId: 'user-uuid', telegramId: '281882561' }
const CHAT_ID = 281882561
const YA_KUN = { source: 'wallet' as const, text: 'S$8.50 Ya Kun Kaya Toast' }
/** A merchant the built-in Singapore map does not know. */
const UNKNOWN = { source: 'wallet' as const, text: 'S$5.00 Zxqv Trading Pte Ltd' }

function makeApi(overrides: Partial<IngestApi> = {}): IngestApi {
  return {
    createTransaction: vi.fn().mockResolvedValue({ id: 'tx-1' }),
    getLearnedMapping: vi.fn().mockResolvedValue(null),
    getActiveSpace: vi.fn().mockResolvedValue(null),
    attachTransactionToSpace: vi.fn().mockResolvedValue(true),
    ...overrides,
  }
}

function makeDeps(api: IngestApi, now = 1_000_000): IngestDeps & { send: ReturnType<typeof vi.fn>; makeClient: ReturnType<typeof vi.fn> } {
  return {
    send: vi.fn().mockResolvedValue(undefined),
    makeClient: vi.fn().mockReturnValue(api),
    now: () => now,
  }
}

function sentText(deps: { send: ReturnType<typeof vi.fn> }): string {
  return deps.send.mock.calls[0]?.[1] as string
}

function savedInput(api: IngestApi): Record<string, unknown> {
  return vi.mocked(api.createTransaction).mock.calls[0]?.[0] as unknown as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  clearIngestState()
  pendingConfirmations.clear()
  tokenStore.clear()
  userIdStore.clear()
  vi.mocked(parseWithGemini).mockResolvedValue(null)
})

describe('parseWalletText — amount and merchant are split here, not by the free-text parser', () => {
  it.each([
    ['S$8.50 Ya Kun Kaya Toast', 850, 'SGD', 'Ya Kun Kaya Toast'],
    ['SGD 8.50 Ya Kun', 850, 'SGD', 'Ya Kun'],
    ['SGD8.50 Ya Kun', 850, 'SGD', 'Ya Kun'],
    ['$8.50 Ya Kun', 850, 'SGD', 'Ya Kun'],
    ['8.50 Ya Kun', 850, 'SGD', 'Ya Kun'],
    ['S$8.5 Ya Kun', 850, 'SGD', 'Ya Kun'],
    ['S$8 Ya Kun', 800, 'SGD', 'Ya Kun'],
    ['S$1,234.00 Apple Store', 123400, 'SGD', 'Apple Store'],
    ['  S$8.50   Ya  Kun \n', 850, 'SGD', 'Ya Kun'],
  ])('%s', (text, cents, currency, merchant) => {
    expect(parseWalletText(text)).toEqual({ amountCents: cents, currency, merchant })
  })

  it.each([
    ['S$12.10 May Flower Restaurant', 1210, 'May Flower Restaurant'],
    ["S$5.30 Jan's Kitchen", 530, "Jan's Kitchen"],
    ['S$18.00 Yen Yakiniku', 1800, 'Yen Yakiniku'],
    ['S$15.00 Pound Cake Co', 1500, 'Pound Cake Co'],
    ['S$9.90 Today Cafe', 990, 'Today Cafe'],
    ['S$8.50 Tom, Dick & Harry', 850, 'Tom, Dick & Harry'],
    ['S$4.20 7-Eleven 24 Raffles', 420, '7-Eleven 24 Raffles'],
  ])('keeps the amount and name intact for a merchant with a date/currency-like word: %s', (text, cents, merchant) => {
    expect(parseWalletText(text)).toEqual({ amountCents: cents, currency: 'SGD', merchant })
  })

  it.each([
    ['US$12.00 Amazon', 1200, 'USD', 'Amazon'],
    ['USD 12.00 Amazon', 1200, 'USD', 'Amazon'],
    ['€5.00 Cafe de Flore', 500, 'EUR', 'Cafe de Flore'],
    ['£4.50 Pret', 450, 'GBP', 'Pret'],
    ['¥1,200 Lawson', 120000, 'JPY', 'Lawson'],
    ['JPY 1200 Lawson', 120000, 'JPY', 'Lawson'],
    ['RM10.50 Mamak', 1050, 'MYR', 'Mamak'],
    ['RM 10.50 Mamak', 1050, 'MYR', 'Mamak'],
    ['HK$88.00 Tim Ho Wan', 8800, 'HKD', 'Tim Ho Wan'],
    ['A$20.00 Coles', 2000, 'AUD', 'Coles'],
    ['NT$150 Family Mart', 15000, 'TWD', 'Family Mart'],
    ['THB 120.00 Seven', 12000, 'THB', 'Seven'],
  ])('reads a foreign currency: %s', (text, cents, currency, merchant) => {
    expect(parseWalletText(text)).toEqual({ amountCents: cents, currency, merchant })
  })

  it('accepts an amount with no merchant', () => {
    expect(parseWalletText('S$8.50')).toEqual({ amountCents: 850, currency: 'SGD', merchant: '' })
  })

  it.each([
    ['a refund (leading minus)', '-S$8.50 Ya Kun'],
    ['a refund (unicode minus)', '\u{2212}S$8.50 Ya Kun'],
    ['a refund (minus after the symbol)', 'S$-8.50 Ya Kun'],
    ['no amount', 'Ya Kun Kaya Toast'],
    ['a zero amount', 'S$0.00 Ya Kun'],
    ['an unknown currency symbol', '\u{20BF}5 Coinbase'],
    ['empty text', '   '],
  ])('returns null for %s', (_label, text) => {
    expect(parseWalletText(text)).toBeNull()
  })
})

describe('processIngest — saving', () => {
  it('saves a known merchant with source "wallet" and sends one message with Edit and Delete', async () => {
    const api = makeApi()
    const deps = makeDeps(api)

    const outcome = await processIngest(AUTH, { ...YA_KUN, card: 'Revolut' }, deps)

    expect(outcome).toBe('saved')
    expect(savedInput(api)).toMatchObject({
      userId: 'user-uuid',
      amountCents: 850,
      item: 'Ya Kun Kaya Toast',
      category: 'Food',
      subCategory: 'Cafe',
      source: 'wallet',
      date: getTodayDDMMYYYY(),
    })
    expect(parseWithGemini).not.toHaveBeenCalled()
    expect(deps.send).toHaveBeenCalledOnce()
    expect(deps.send.mock.calls[0]?.[0]).toBe(CHAT_ID)
    const text = sentText(deps)
    expect(text).toContain('Auto-logged')
    expect(text).toContain('S$8.50')
    expect(text).toContain('Ya Kun Kaya Toast')
    expect(text).toContain('Food / Cafe')
    expect(text).toContain('Apple Pay (Revolut)')
    expect(text).not.toContain('Not sure')
    const keyboard = deps.send.mock.calls[0]?.[2] as { inline_keyboard: { callback_data: string }[][] }
    expect(keyboard.inline_keyboard.flat().map((b) => b.callback_data)).toEqual(['edit_select:tx-1', 'autolog_del:tx-1'])
  })

  it('uses a category the user taught the bot, without asking Gemini', async () => {
    const api = makeApi({
      getLearnedMapping: vi.fn().mockResolvedValue({ category: 'Shopping', subCategory: 'Hobbies', confidence: 0.5 }),
    })
    const outcome = await processIngest(AUTH, UNKNOWN, makeDeps(api))

    expect(outcome).toBe('saved')
    expect(api.getLearnedMapping).toHaveBeenCalledWith('zxqv trading pte ltd')
    expect(savedInput(api)).toMatchObject({ category: 'Shopping', subCategory: 'Hobbies', amountCents: 500 })
    expect(parseWithGemini).not.toHaveBeenCalled()
  })

  it('takes only the category from Gemini — never its amount, date or item', async () => {
    vi.mocked(parseWithGemini).mockResolvedValue({
      amount: 99999,
      item: 'Something Else',
      date: '01/01/2020',
      category: 'Shopping' as never,
      subCategory: 'Electronics' as never,
      confidence: 0.85,
      tier: 3,
    })
    const api = makeApi()
    await processIngest(AUTH, UNKNOWN, makeDeps(api))

    expect(savedInput(api)).toMatchObject({
      amountCents: 500,
      item: 'Zxqv Trading Pte Ltd',
      date: getTodayDDMMYYYY(),
      category: 'Shopping',
      subCategory: 'Electronics',
    })
  })

  it('still saves, as Other and flagged, when nothing can categorise the merchant', async () => {
    const api = makeApi()
    const deps = makeDeps(api)

    const outcome = await processIngest(AUTH, UNKNOWN, deps)

    expect(outcome).toBe('saved')
    expect(savedInput(api)).toMatchObject({ amountCents: 500, category: 'Other', subCategory: 'Other' })
    expect(sentText(deps)).toContain('Not sure of the category')
  })

  it('still saves, as Other and flagged, when Gemini is rate limited', async () => {
    vi.mocked(parseWithGemini).mockRejectedValue(new GeminiRateLimitError())
    const api = makeApi()
    const deps = makeDeps(api)

    expect(await processIngest(AUTH, UNKNOWN, deps)).toBe('saved')
    expect(savedInput(api)).toMatchObject({ amountCents: 500, category: 'Other' })
    expect(sentText(deps)).toContain('Not sure of the category')
  })

  it('never opens a confirm prompt — typed expenses cannot overwrite or be overwritten by a capture', async () => {
    const existing = { result: { amount: 1200, item: 'lunch', confidence: 1, tier: 1 as const }, rawInput: '12 lunch' }
    pendingConfirmations.set(CHAT_ID, existing)

    await processIngest(AUTH, UNKNOWN, makeDeps(makeApi()))

    expect(pendingConfirmations.size).toBe(1)
    expect(pendingConfirmations.get(CHAT_ID)).toBe(existing)
  })

  it('saves a payment with no merchant name under a generic item', async () => {
    const api = makeApi()
    await processIngest(AUTH, { source: 'wallet', text: 'S$8.50' }, makeDeps(api))
    expect(savedInput(api)).toMatchObject({ amountCents: 850, item: 'Apple Pay payment', category: 'Other' })
  })

  it('uses a client built from the capture token, never the shared apiClient', async () => {
    const deps = makeDeps(makeApi())
    await processIngest(AUTH, YA_KUN, deps)
    expect(deps.makeClient).toHaveBeenCalledWith('jwt.for.khen')
    expect(apiClient.setToken).not.toHaveBeenCalled()
  })

  it('remembers the login so the Edit and Delete buttons work afterwards', async () => {
    await processIngest(AUTH, YA_KUN, makeDeps(makeApi()))
    expect(tokenStore.get(CHAT_ID)).toBe('jwt.for.khen')
    expect(userIdStore.get(CHAT_ID)).toBe('user-uuid')
  })

  it('remembers which merchant a saved entry came from, so an Edit can teach the bot', async () => {
    await processIngest(AUTH, UNKNOWN, makeDeps(makeApi()))
    expect(autologMerchantFor('tx-1')).toBe('Zxqv Trading Pte Ltd')
    expect(autologMerchantFor('tx-unknown')).toBeUndefined()
  })

  it('attaches the expense to the active Space', async () => {
    const api = makeApi({ getActiveSpace: vi.fn().mockResolvedValue({ id: 'space-1', name: 'Tokyo' }) })
    await processIngest(AUTH, YA_KUN, makeDeps(api))
    expect(api.attachTransactionToSpace).toHaveBeenCalledWith('tx-1', 'space-1')
  })

  it('still reports "saved" when the Space lookup throws', async () => {
    const api = makeApi({ getActiveSpace: vi.fn().mockRejectedValue(new Error('boom')) })
    expect(await processIngest(AUTH, YA_KUN, makeDeps(api))).toBe('saved')
  })

  it('still reports "saved" when the Telegram message fails to send', async () => {
    const deps = makeDeps(makeApi())
    deps.send.mockRejectedValue(new Error('telegram down'))
    expect(await processIngest(AUTH, YA_KUN, deps)).toBe('saved')
  })
})

describe('processIngest — foreign currency', () => {
  it('converts to SGD, saves the converted amount, and shows both', async () => {
    vi.mocked(convertToSGD).mockResolvedValue({ convertedCents: 1620, rate: 1.35 })
    const api = makeApi()
    const deps = makeDeps(api)

    const outcome = await processIngest(AUTH, { source: 'wallet', text: 'US$12.00 Ya Kun Kaya Toast' }, deps)

    expect(outcome).toBe('saved')
    expect(convertToSGD).toHaveBeenCalledWith(1200, 'USD')
    expect(savedInput(api)).toMatchObject({ amountCents: 1620, item: 'Ya Kun Kaya Toast' })
    const text = sentText(deps)
    expect(text).toContain('S$16.20')
    expect(text).toContain('$12.00')
    expect(text).toContain('\u{2192}')
  })

  it('does not convert an SGD payment', async () => {
    await processIngest(AUTH, YA_KUN, makeDeps(makeApi()))
    expect(convertToSGD).not.toHaveBeenCalled()
  })

  it('reports the original amount and saves nothing when the rate lookup fails', async () => {
    vi.mocked(convertToSGD).mockRejectedValue(new CurrencyConversionError())
    const api = makeApi()
    const deps = makeDeps(api)

    const outcome = await processIngest(AUTH, { source: 'wallet', text: '\u{00A5}1,200 Lawson' }, deps)

    expect(outcome).toBe('failed')
    expect(api.createTransaction).not.toHaveBeenCalled()
    expect(sentText(deps)).toContain("Couldn't log")
    expect(sentText(deps)).toContain('1200.00')
    expect(sentText(deps)).toContain('Lawson')
  })

  it('checks duplicates on the converted SGD amount', async () => {
    vi.mocked(convertToSGD).mockResolvedValue({ convertedCents: 850, rate: 1 })
    const api = makeApi()
    await processIngest(AUTH, YA_KUN, makeDeps(api))
    const deps = makeDeps(api)
    await processIngest(AUTH, { source: 'wallet', text: 'US$6.30 Ya Kun Kaya Toast' }, deps)
    expect(sentText(deps)).toContain('Same amount')
  })
})

describe('processIngest — duplicates', () => {
  it('saves both and warns on the second when the same amount arrives within the window', async () => {
    const api = makeApi()
    const first = makeDeps(api, 1_000_000)
    const second = makeDeps(api, 1_000_000 + INGEST_DUPLICATE_WINDOW_MS)

    await processIngest(AUTH, YA_KUN, first)
    const outcome = await processIngest(AUTH, YA_KUN, second)

    expect(outcome).toBe('saved')
    expect(api.createTransaction).toHaveBeenCalledTimes(2)
    expect(sentText(first)).not.toContain('Same amount')
    expect(sentText(second).startsWith('\u{26A0}\u{FE0F} Same amount')).toBe(true)
  })

  it('warns on a retry of an uncategorised payment too', async () => {
    const api = makeApi()
    await processIngest(AUTH, UNKNOWN, makeDeps(api))
    const deps = makeDeps(api)
    await processIngest(AUTH, UNKNOWN, deps)
    expect(sentText(deps)).toContain('Same amount')
  })

  it('does not warn once the window has passed', async () => {
    const api = makeApi()
    await processIngest(AUTH, YA_KUN, makeDeps(api, 1_000_000))
    const later = makeDeps(api, 1_000_000 + INGEST_DUPLICATE_WINDOW_MS + 1)
    await processIngest(AUTH, YA_KUN, later)
    expect(sentText(later)).not.toContain('Same amount')
  })

  it('does not warn for a different user with the same amount', async () => {
    const api = makeApi()
    await processIngest(AUTH, YA_KUN, makeDeps(api))
    const other = makeDeps(api)
    await processIngest({ ...AUTH, userId: 'other-uuid', telegramId: '42' }, YA_KUN, other)
    expect(sentText(other)).not.toContain('Same amount')
  })

  it('does not count a failed save as a duplicate candidate', async () => {
    const failing = makeApi({ createTransaction: vi.fn().mockResolvedValue(null) })
    await processIngest(AUTH, YA_KUN, makeDeps(failing))
    const deps = makeDeps(makeApi())
    await processIngest(AUTH, YA_KUN, deps)
    expect(sentText(deps)).not.toContain('Same amount')
  })
})

describe('processIngest — failures are reported, never silent', () => {
  it.each([
    ['text with no amount', 'gibberish with no amount'],
    ['a refund', '-S$8.50 Ya Kun Kaya Toast'],
    ['an unknown currency', '\u{20BF}5 Coinbase'],
  ])('reports %s and saves nothing', async (_label, text) => {
    const api = makeApi()
    const deps = makeDeps(api)

    const outcome = await processIngest(AUTH, { source: 'wallet', text }, deps)

    expect(outcome).toBe('failed')
    expect(api.createTransaction).not.toHaveBeenCalled()
    expect(deps.send).toHaveBeenCalledOnce()
    expect(sentText(deps)).toContain("Couldn't log")
  })

  it('reports, with amount and merchant, when the API refuses the save', async () => {
    const api = makeApi({ createTransaction: vi.fn().mockResolvedValue(null) })
    const deps = makeDeps(api)

    const outcome = await processIngest(AUTH, YA_KUN, deps)

    expect(outcome).toBe('failed')
    expect(sentText(deps)).toContain('S$8.50')
    expect(sentText(deps)).toContain('Ya Kun Kaya Toast')
  })
})
