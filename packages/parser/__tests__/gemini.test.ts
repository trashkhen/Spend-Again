import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CATEGORY_MAP, GEMINI_RPM_LIMIT } from '@spend-again/shared'

// ---------------------------------------------------------------------------
// Mock @google/generative-ai BEFORE importing the module under test.
// The mock factory runs at hoist-time so the import in gemini.ts sees it.
// ---------------------------------------------------------------------------

const mockGenerateContent = vi.fn()
const mockGetGenerativeModel = vi.fn()

vi.mock('@google/generative-ai', () => {
  class GoogleGenerativeAI {
    constructor(_apiKey: string) {}
    getGenerativeModel(opts: { model: string }, requestOptions?: { timeout?: number }) {
      mockGetGenerativeModel(opts, requestOptions)
      return {
        generateContent: mockGenerateContent,
      }
    }
  }

  class GoogleGenerativeAIAbortError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'GoogleGenerativeAIAbortError'
    }
  }

  class GoogleGenerativeAIFetchError extends Error {
    status?: number
    statusText?: string
    constructor(message: string, status?: number, statusText?: string) {
      super(message)
      this.name = 'GoogleGenerativeAIFetchError'
      this.status = status
      this.statusText = statusText
    }
  }

  return { GoogleGenerativeAI, GoogleGenerativeAIFetchError, GoogleGenerativeAIAbortError }
})

// ---------------------------------------------------------------------------
// Import the module under test AFTER the mock is registered.
// ---------------------------------------------------------------------------

import { GeminiRateLimitError, buildPrompt, buildSpacePrompt, parseWithGemini, parseSpaceWithGemini } from '../src/gemini.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(text: string): { response: { text: () => string } } {
  return { response: { text: () => text } }
}

function jsonResponse(obj: unknown): { response: { text: () => string } } {
  return makeResponse(JSON.stringify(obj))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildPrompt', () => {
  it('includes all top-level category names', () => {
    const prompt = buildPrompt('test input')
    const categories = Object.keys(CATEGORY_MAP)
    for (const cat of categories) {
      expect(prompt).toContain(cat)
    }
  })

  it('includes the user input verbatim', () => {
    const input = '8.50 for lunch at Amoy'
    const prompt = buildPrompt(input)
    expect(prompt).toContain(input)
  })

  it('includes today date in DD/MM/YYYY format', () => {
    const prompt = buildPrompt('test')
    // The date appears in the prompt — verify at least one DD/MM/YYYY pattern
    expect(prompt).toMatch(/\d{2}\/\d{2}\/\d{4}/)
  })

  it('asks for amount in dollars (not cents)', () => {
    const prompt = buildPrompt('test')
    expect(prompt.toLowerCase()).toContain('dollar')
  })

  it('includes a currency instruction', () => {
    const prompt = buildPrompt('test')
    expect(prompt.toLowerCase()).toContain('currency')
    expect(prompt).toContain('ISO 4217')
  })
})

describe('parseWithGemini', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env['GEMINI_API_KEY'] = 'test-key'
  })

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('parses a valid JSON response into ParseResult', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({
        amount: 8.5,
        item: 'Lunch at Amoy',
        category: 'Food',
        subCategory: 'Hawker',
        date: '12/05/2026',
      }),
    )

    const result = await parseWithGemini('8.50 for lunch at Amoy')

    expect(result).not.toBeNull()
    expect(result?.item).toBe('Lunch at Amoy')
    expect(result?.category).toBe('Food')
    expect(result?.subCategory).toBe('Hawker')
    expect(result?.date).toBe('12/05/2026')
    expect(result?.tier).toBe(3)
    expect(result?.confidence).toBe(0.85)
  })

  it('converts dollar amount to integer cents', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({ amount: 8.5, item: 'Coffee', category: 'Food', subCategory: 'Cafe', date: '12/05/2026' }),
    )

    const result = await parseWithGemini('$8.50 coffee')
    expect(result?.amount).toBe(850)
  })

  it('converts whole-dollar amount to cents without floating-point error', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({ amount: 12, item: 'NTUC', category: 'Groceries', subCategory: 'Supermarket', date: '12/05/2026' }),
    )

    const result = await parseWithGemini('$12 NTUC')
    expect(result?.amount).toBe(1200)
  })

  it('handles three-decimal amounts via Math.round', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({ amount: 10.005, item: 'Kopi', category: 'Food', subCategory: 'Hawker', date: '12/05/2026' }),
    )

    const result = await parseWithGemini('$10 kopi')
    // Math.round(10.005 * 100) = Math.round(1000.5) = 1001
    expect(result?.amount).toBe(1001)
  })

  it('sets tier to 3', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({ amount: 5, item: 'Test', category: 'Other', subCategory: 'Other', date: '01/01/2026' }),
    )

    const result = await parseWithGemini('some input')
    expect(result?.tier).toBe(3)
  })

  it('sets confidence to 0.85', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({ amount: 5, item: 'Test', category: 'Other', subCategory: 'Other', date: '01/01/2026' }),
    )

    const result = await parseWithGemini('some input')
    expect(result?.confidence).toBe(0.85)
  })

  // -------------------------------------------------------------------------
  // Category validation
  // -------------------------------------------------------------------------

  it('omits category when Gemini returns an invalid category name', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({ amount: 10, item: 'Mystery', category: 'NotACategory', subCategory: null, date: null }),
    )

    const result = await parseWithGemini('$10 mystery item')
    expect(result?.category).toBeUndefined()
    expect(result?.subCategory).toBeUndefined()
  })

  it('omits subCategory when sub is invalid for the given category', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({ amount: 10, item: 'Item', category: 'Food', subCategory: 'NotASubCat', date: null }),
    )

    const result = await parseWithGemini('$10 item')
    expect(result?.category).toBe('Food')
    expect(result?.subCategory).toBeUndefined()
  })

  it('accepts valid category and subCategory', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({ amount: 25, item: 'Grab ride', category: 'Transport', subCategory: 'Grab', date: null }),
    )

    const result = await parseWithGemini('grab home 25')
    expect(result?.category).toBe('Transport')
    expect(result?.subCategory).toBe('Grab')
  })

  // -------------------------------------------------------------------------
  // Currency field
  // -------------------------------------------------------------------------

  it('sets currency when Gemini reports a non-SGD currency', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({
        amount: 50,
        item: 'Taxi',
        category: 'Transport',
        subCategory: 'Taxi',
        date: '01/01/2026',
        currency: 'THB',
      }),
    )

    const result = await parseWithGemini('50 baht taxi')
    expect(result?.currency).toBe('THB')
  })

  it('omits currency when Gemini returns null', () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({ amount: 10, item: 'Item', category: null, subCategory: null, date: null, currency: null }),
    )

    return parseWithGemini('$10 item').then((result) => {
      expect(result?.currency).toBeUndefined()
    })
  })

  it('omits currency when Gemini omits the field entirely', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({ amount: 10, item: 'Item', category: null, subCategory: null, date: null }),
    )

    const result = await parseWithGemini('$10 item')
    expect(result?.currency).toBeUndefined()
  })

  it('omits currency when Gemini reports SGD explicitly', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({ amount: 10, item: 'Item', category: null, subCategory: null, date: null, currency: 'SGD' }),
    )

    const result = await parseWithGemini('$10 item')
    expect(result?.currency).toBeUndefined()
  })

  it('uppercases a lowercase currency code from Gemini', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({ amount: 50, item: 'Taxi', category: null, subCategory: null, date: null, currency: 'thb' }),
    )

    const result = await parseWithGemini('50 baht taxi')
    expect(result?.currency).toBe('THB')
  })

  // -------------------------------------------------------------------------
  // Null / empty date handling
  // -------------------------------------------------------------------------

  it('omits date when Gemini returns null for date', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({ amount: 10, item: 'Item', category: null, subCategory: null, date: null }),
    )

    const result = await parseWithGemini('$10 item')
    expect(result?.date).toBeUndefined()
  })

  it('includes date when Gemini returns a valid date string', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({ amount: 10, item: 'Item', category: null, subCategory: null, date: '05/05/2026' }),
    )

    const result = await parseWithGemini('$10 item 05/05/2026')
    expect(result?.date).toBe('05/05/2026')
  })

  // -------------------------------------------------------------------------
  // JSON embedded in markdown fences
  // -------------------------------------------------------------------------

  it('extracts JSON when response is wrapped in markdown code fences', async () => {
    const wrapped = '```json\n{"amount":5,"item":"Kopi","category":"Food","subCategory":"Hawker","date":"01/01/2026"}\n```'
    mockGenerateContent.mockResolvedValueOnce(makeResponse(wrapped))

    const result = await parseWithGemini('$5 kopi')
    expect(result).not.toBeNull()
    expect(result?.amount).toBe(500)
    expect(result?.item).toBe('Kopi')
  })

  // -------------------------------------------------------------------------
  // Null return for unparseable responses
  // -------------------------------------------------------------------------

  it('returns null when response has no JSON object', async () => {
    mockGenerateContent.mockResolvedValueOnce(makeResponse('Sorry, I cannot parse this.'))

    const result = await parseWithGemini('gibberish with no amount')
    expect(result).toBeNull()
  })

  it('returns null when JSON is missing the amount field', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({ item: 'Something', category: null, subCategory: null, date: null }),
    )

    const result = await parseWithGemini('something without amount')
    expect(result).toBeNull()
  })

  it('returns null when JSON amount is not a number', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({ amount: 'eight fifty', item: 'Item', category: null, subCategory: null, date: null }),
    )

    const result = await parseWithGemini('eight fifty')
    expect(result).toBeNull()
  })

  // -------------------------------------------------------------------------
  // Rate limit error
  // -------------------------------------------------------------------------

  it('throws GeminiRateLimitError on HTTP 429', async () => {
    const { GoogleGenerativeAIFetchError } = await import('@google/generative-ai')
    const rateLimitErr = new GoogleGenerativeAIFetchError('Too Many Requests', 429, 'Too Many Requests')
    mockGenerateContent.mockRejectedValueOnce(rateLimitErr)

    await expect(parseWithGemini('test input')).rejects.toThrow(GeminiRateLimitError)
  })

  it('throws GeminiRateLimitError on HTTP 503 (service unavailable)', async () => {
    const { GoogleGenerativeAIFetchError } = await import('@google/generative-ai')
    const serviceErr = new GoogleGenerativeAIFetchError('Service Unavailable', 503, 'Service Unavailable')
    mockGenerateContent.mockRejectedValueOnce(serviceErr)

    await expect(parseWithGemini('test input')).rejects.toThrow(GeminiRateLimitError)
  })

  it('GeminiRateLimitError has the correct message', async () => {
    const { GoogleGenerativeAIFetchError } = await import('@google/generative-ai')
    const rateLimitErr = new GoogleGenerativeAIFetchError('Too Many Requests', 429, 'Too Many Requests')
    mockGenerateContent.mockRejectedValueOnce(rateLimitErr)

    await expect(parseWithGemini('test input')).rejects.toThrow(
      `Gemini rate limit exceeded (${GEMINI_RPM_LIMIT} RPM)`,
    )
  })

  it('sets a request timeout so a stuck Gemini call cannot hang the handler', async () => {
    mockGenerateContent.mockResolvedValueOnce(jsonResponse({ amount: 1, item: 'x', category: null, subCategory: null, date: null }))
    await parseWithGemini('x 1')

    const [, requestOptions] = mockGetGenerativeModel.mock.calls.at(-1) as [unknown, { timeout?: number }]
    expect(requestOptions.timeout).toBeGreaterThan(0)
  })

  it('throws GeminiRateLimitError when the request is aborted by the timeout', async () => {
    const { GoogleGenerativeAIAbortError } = await import('@google/generative-ai')
    mockGenerateContent.mockRejectedValueOnce(new GoogleGenerativeAIAbortError('Request aborted when fetching'))

    await expect(parseWithGemini('test input')).rejects.toThrow(GeminiRateLimitError)
  })

  it('rethrows non-429/503 errors as-is', async () => {
    const networkErr = new Error('Network error')
    mockGenerateContent.mockRejectedValueOnce(networkErr)

    await expect(parseWithGemini('test input')).rejects.toThrow('Network error')
  })

  // -------------------------------------------------------------------------
  // Missing API key
  // -------------------------------------------------------------------------

  it('throws when GEMINI_API_KEY is not set', async () => {
    delete process.env['GEMINI_API_KEY']

    await expect(parseWithGemini('test input')).rejects.toThrow('GEMINI_API_KEY')
  })

  // -------------------------------------------------------------------------
  // Prompt includes CATEGORY_MAP categories
  // -------------------------------------------------------------------------

  it('sends a prompt that includes all category names to Gemini', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({ amount: 5, item: 'Test', category: 'Food', subCategory: 'Hawker', date: null }),
    )

    await parseWithGemini('$5 test')

    expect(mockGenerateContent).toHaveBeenCalledOnce()
    const promptArg: unknown = mockGenerateContent.mock.calls[0]?.[0]
    const promptStr = typeof promptArg === 'string' ? promptArg : ''

    const categories = Object.keys(CATEGORY_MAP)
    for (const cat of categories) {
      expect(promptStr).toContain(cat)
    }
  })
})

describe('buildSpacePrompt', () => {
  it('includes emoji in the JSON shape', () => {
    const prompt = buildSpacePrompt('Bali Trip from 03/06 to 08/06')
    expect(prompt).toContain('"emoji"')
  })
})

describe('parseSpaceWithGemini', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env['GEMINI_API_KEY'] = 'test-key'
  })

  it('returns the emoji when Gemini returns a valid emoji string', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({
        name: 'Beach Holiday',
        emoji: '🏖️',
        budgetCents: 50000,
        startDate: '2026-06-03',
        endDate: '2026-06-08',
      }),
    )

    const result = await parseSpaceWithGemini('Bali Trip from 03/06 to 08/06 budget $500')

    expect(result).not.toBeNull()
    expect(result?.emoji).toBe('🏖️')
  })

  it('returns null for emoji when Gemini returns an empty string', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({
        name: 'Mystery Trip',
        emoji: '',
        budgetCents: null,
        startDate: null,
        endDate: null,
      }),
    )

    const result = await parseSpaceWithGemini('some vague trip')

    expect(result).not.toBeNull()
    expect(result?.emoji).toBeNull()
  })

  it('returns null for emoji when Gemini returns null', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({
        name: 'NUS Semester',
        emoji: null,
        budgetCents: null,
        startDate: null,
        endDate: null,
      }),
    )

    const result = await parseSpaceWithGemini('NUS Semester')

    expect(result).not.toBeNull()
    expect(result?.emoji).toBeNull()
  })
})
