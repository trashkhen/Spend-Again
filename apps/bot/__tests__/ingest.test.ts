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
  GeminiRateLimitError: class GeminiRateLimitError extends Error {},
  CurrencyConversionError: class CurrencyConversionError extends Error {},
}))

import {
  processIngest,
  normalizeWalletText,
  clearIngestState,
  INGEST_DUPLICATE_WINDOW_MS,
} from '../src/lib/ingest.js'
import type { IngestApi, IngestAuth, IngestDeps } from '../src/lib/ingest.js'
import { pendingConfirmations } from '../src/handlers/expense.js'
import { apiClient, tokenStore, userIdStore } from '../src/lib/api-client.js'
import { parse, GeminiRateLimitError } from '@spend-again/parser'
import type { ParseResult } from '@spend-again/parser'
import { getTodayDDMMYYYY } from '@spend-again/shared'

const AUTH: IngestAuth = { token: 'jwt.for.khen', userId: 'user-uuid', telegramId: '281882561' }
const CHAT_ID = 281882561

const CONFIDENT: ParseResult = {
  amount: 850,
  item: 'Ya Kun Kaya Toast',
  category: 'Food' as never,
  subCategory: 'Cafe' as never,
  confidence: 0.95,
  tier: 1,
}

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

function sentText(deps: { send: ReturnType<typeof vi.fn> }, call = 0): string {
  return deps.send.mock.calls[call]?.[1] as string
}

beforeEach(() => {
  vi.clearAllMocks()
  clearIngestState()
  pendingConfirmations.clear()
  tokenStore.clear()
  userIdStore.clear()
  vi.mocked(parse).mockResolvedValue({ ...CONFIDENT })
})

describe('normalizeWalletText', () => {
  it('removes thousands separators inside amounts', () => {
    expect(normalizeWalletText('S$1,234.00 Apple Store')).toBe('S$1234.00 Apple Store')
  })
  it('collapses whitespace and trims', () => {
    expect(normalizeWalletText('  SGD 8.50   Ya Kun\n')).toBe('SGD 8.50 Ya Kun')
  })
  it('leaves commas in merchant names alone', () => {
    expect(normalizeWalletText('$8.50 Tom, Dick & Harry')).toBe('$8.50 Tom, Dick & Harry')
  })
})

describe('processIngest — confident parse', () => {
  it('saves with source "wallet" and sends one message with Edit and Delete buttons', async () => {
    const api = makeApi()
    const deps = makeDeps(api)

    const outcome = await processIngest(AUTH, { source: 'wallet', text: 'S$8.50 Ya Kun Kaya Toast', card: 'Revolut' }, deps)

    expect(outcome).toBe('saved')
    expect(api.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-uuid',
        amountCents: 850,
        item: 'Ya Kun Kaya Toast',
        category: 'Food',
        subCategory: 'Cafe',
        source: 'wallet',
      }),
    )
    expect(deps.send).toHaveBeenCalledOnce()
    expect(deps.send.mock.calls[0]?.[0]).toBe(CHAT_ID)
    const text = sentText(deps)
    expect(text).toContain('Auto-logged')
    expect(text).toContain('$8.50')
    expect(text).toContain('Ya Kun Kaya Toast')
    expect(text).toContain('Food / Cafe')
    expect(text).toContain('Apple Pay (Revolut)')
    const keyboard = deps.send.mock.calls[0]?.[2] as { inline_keyboard: { callback_data: string }[][] }
    const callbacks = keyboard.inline_keyboard.flat().map((b) => b.callback_data)
    expect(callbacks).toEqual(['edit_select:tx-1', 'autolog_del:tx-1'])
  })

  it('normalises the wallet text before parsing', async () => {
    const deps = makeDeps(makeApi())
    await processIngest(AUTH, { source: 'wallet', text: 'S$1,234.00 Apple Store' }, deps)
    expect(parse).toHaveBeenCalledWith('S$1234.00 Apple Store', expect.objectContaining({ lookupItem: expect.any(Function) }))
  })

  it('defaults the date to today when the parse has none', async () => {
    const api = makeApi()
    await processIngest(AUTH, { source: 'wallet', text: '8.50 Ya Kun' }, makeDeps(api))
    expect(api.createTransaction).toHaveBeenCalledWith(expect.objectContaining({ date: getTodayDDMMYYYY() }))
  })

  it('uses a client built from the capture token, never the shared apiClient', async () => {
    const deps = makeDeps(makeApi())
    await processIngest(AUTH, { source: 'wallet', text: '8.50 Ya Kun' }, deps)
    expect(deps.makeClient).toHaveBeenCalledWith('jwt.for.khen')
    expect(apiClient.setToken).not.toHaveBeenCalled()
  })

  it('remembers the login so Edit and Confirm taps work afterwards', async () => {
    await processIngest(AUTH, { source: 'wallet', text: '8.50 Ya Kun' }, makeDeps(makeApi()))
    expect(tokenStore.get(CHAT_ID)).toBe('jwt.for.khen')
    expect(userIdStore.get(CHAT_ID)).toBe('user-uuid')
  })

  it('attaches the expense to the active Space', async () => {
    const api = makeApi({ getActiveSpace: vi.fn().mockResolvedValue({ id: 'space-1', name: 'Tokyo' }) })
    await processIngest(AUTH, { source: 'wallet', text: '8.50 Ya Kun' }, makeDeps(api))
    expect(api.attachTransactionToSpace).toHaveBeenCalledWith('tx-1', 'space-1')
  })

  it('still reports "saved" when the Space lookup throws', async () => {
    const api = makeApi({ getActiveSpace: vi.fn().mockRejectedValue(new Error('boom')) })
    const outcome = await processIngest(AUTH, { source: 'wallet', text: '8.50 Ya Kun' }, makeDeps(api))
    expect(outcome).toBe('saved')
  })

  it('still reports "saved" when the Telegram message fails to send', async () => {
    const deps = makeDeps(makeApi())
    deps.send.mockRejectedValue(new Error('telegram down'))
    const outcome = await processIngest(AUTH, { source: 'wallet', text: '8.50 Ya Kun' }, deps)
    expect(outcome).toBe('saved')
  })
})

describe('processIngest — duplicates', () => {
  it('saves both and warns on the second when the same amount arrives within the window', async () => {
    const api = makeApi()
    const first = makeDeps(api, 1_000_000)
    const second = makeDeps(api, 1_000_000 + INGEST_DUPLICATE_WINDOW_MS)

    await processIngest(AUTH, { source: 'wallet', text: '8.50 Ya Kun' }, first)
    const outcome = await processIngest(AUTH, { source: 'wallet', text: '8.50 Ya Kun' }, second)

    expect(outcome).toBe('saved')
    expect(api.createTransaction).toHaveBeenCalledTimes(2)
    expect(sentText(first)).not.toContain('Same amount')
    expect(sentText(second).startsWith('\u{26A0}\u{FE0F} Same amount')).toBe(true)
  })

  it('does not warn once the window has passed', async () => {
    const api = makeApi()
    await processIngest(AUTH, { source: 'wallet', text: '8.50 Ya Kun' }, makeDeps(api, 1_000_000))
    const later = makeDeps(api, 1_000_000 + INGEST_DUPLICATE_WINDOW_MS + 1)
    await processIngest(AUTH, { source: 'wallet', text: '8.50 Ya Kun' }, later)
    expect(sentText(later)).not.toContain('Same amount')
  })

  it('does not warn for a different user with the same amount', async () => {
    const api = makeApi()
    await processIngest(AUTH, { source: 'wallet', text: '8.50 Ya Kun' }, makeDeps(api))
    const other = makeDeps(api)
    await processIngest({ ...AUTH, userId: 'other-uuid', telegramId: '42' }, { source: 'wallet', text: '8.50 Ya Kun' }, other)
    expect(sentText(other)).not.toContain('Same amount')
  })
})

describe('processIngest — not confident', () => {
  const UNSURE: ParseResult = { amount: 500, item: 'AH HUAT', confidence: 0.4, tier: 3 }

  it('asks through the normal confirm prompt and saves nothing', async () => {
    vi.mocked(parse).mockResolvedValue({ ...UNSURE })
    const api = makeApi()
    const deps = makeDeps(api)

    const outcome = await processIngest(AUTH, { source: 'wallet', text: '5.00 AH HUAT' }, deps)

    expect(outcome).toBe('asked')
    expect(api.createTransaction).not.toHaveBeenCalled()
    expect(pendingConfirmations.get(CHAT_ID)?.result.amount).toBe(500)
    expect(pendingConfirmations.get(CHAT_ID)?.rawInput).toBe('5.00 AH HUAT')
    expect(deps.send).toHaveBeenCalledOnce()
    const keyboard = deps.send.mock.calls[0]?.[2] as { inline_keyboard: { callback_data: string }[][] }
    expect(keyboard.inline_keyboard.flat().map((b) => b.callback_data)).toContain('confirm_yes')
  })

  it('asks when a category is present but confidence is below the bar', async () => {
    vi.mocked(parse).mockResolvedValue({ ...CONFIDENT, confidence: 0.79 })
    const outcome = await processIngest(AUTH, { source: 'wallet', text: '8.50 Ya Kun' }, makeDeps(makeApi()))
    expect(outcome).toBe('asked')
  })

  it('does not overwrite a confirmation that is already pending', async () => {
    vi.mocked(parse).mockResolvedValue({ ...UNSURE })
    const existing = { result: { ...CONFIDENT, amount: 1200 }, rawInput: '12 lunch' }
    pendingConfirmations.set(CHAT_ID, existing)
    const deps = makeDeps(makeApi())

    const outcome = await processIngest(AUTH, { source: 'wallet', text: '5.00 AH HUAT' }, deps)

    expect(outcome).toBe('failed')
    expect(pendingConfirmations.get(CHAT_ID)).toBe(existing)
    expect(sentText(deps)).toContain("Couldn't log")
    expect(sentText(deps)).toContain('$5.00')
    expect(sentText(deps)).toContain('AH HUAT')
  })
})

describe('processIngest — failures are reported, never silent', () => {
  it('reports when the parser finds nothing', async () => {
    vi.mocked(parse).mockResolvedValue(null)
    const deps = makeDeps(makeApi())
    const outcome = await processIngest(AUTH, { source: 'wallet', text: 'gibberish' }, deps)
    expect(outcome).toBe('failed')
    expect(sentText(deps)).toContain("Couldn't log")
  })

  it('reports when the parse has a zero amount', async () => {
    vi.mocked(parse).mockResolvedValue({ ...CONFIDENT, amount: 0 })
    const api = makeApi()
    const outcome = await processIngest(AUTH, { source: 'wallet', text: 'Ya Kun' }, makeDeps(api))
    expect(outcome).toBe('failed')
    expect(api.createTransaction).not.toHaveBeenCalled()
  })

  it('reports when Gemini is rate limited', async () => {
    vi.mocked(parse).mockRejectedValue(new GeminiRateLimitError())
    const deps = makeDeps(makeApi())
    const outcome = await processIngest(AUTH, { source: 'wallet', text: '8.50 Ya Kun' }, deps)
    expect(outcome).toBe('failed')
    expect(sentText(deps)).toContain("Couldn't log")
  })

  it('reports, with amount and merchant, when the API refuses the save', async () => {
    const api = makeApi({ createTransaction: vi.fn().mockResolvedValue(null) })
    const deps = makeDeps(api)
    const outcome = await processIngest(AUTH, { source: 'wallet', text: '8.50 Ya Kun' }, deps)
    expect(outcome).toBe('failed')
    expect(sentText(deps)).toContain('$8.50')
    expect(sentText(deps)).toContain('Ya Kun Kaya Toast')
  })

  it('does not count a failed save as a duplicate candidate', async () => {
    const failing = makeApi({ createTransaction: vi.fn().mockResolvedValue(null) })
    await processIngest(AUTH, { source: 'wallet', text: '8.50 Ya Kun' }, makeDeps(failing))
    const deps = makeDeps(makeApi())
    await processIngest(AUTH, { source: 'wallet', text: '8.50 Ya Kun' }, deps)
    expect(sentText(deps)).not.toContain('Same amount')
  })
})
