import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CATEGORY_MAP } from '@spend-again/shared'

// ---------------------------------------------------------------------------
// Mock @google/generative-ai BEFORE importing the module under test.
// The mock factory runs at hoist-time so the import in gemini.ts sees it.
// ---------------------------------------------------------------------------

const mockGenerateContent = vi.fn()

vi.mock('@google/generative-ai', () => {
  class GoogleGenerativeAI {
    constructor(_apiKey: string) {}
    getGenerativeModel(_opts: { model: string }) {
      return {
        generateContent: mockGenerateContent,
      }
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

  return { GoogleGenerativeAI, GoogleGenerativeAIFetchError }
})

// ---------------------------------------------------------------------------
// Import the module under test AFTER the mock is registered.
// ---------------------------------------------------------------------------

import { GeminiRateLimitError, buildPrompt, parseWithGemini } from '../src/gemini.js'

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

  it('GeminiRateLimitError has the correct message', async () => {
    const { GoogleGenerativeAIFetchError } = await import('@google/generative-ai')
    const rateLimitErr = new GoogleGenerativeAIFetchError('Too Many Requests', 429, 'Too Many Requests')
    mockGenerateContent.mockRejectedValueOnce(rateLimitErr)

    await expect(parseWithGemini('test input')).rejects.toThrow('Gemini rate limit exceeded (15 RPM)')
  })

  it('rethrows non-429 errors as-is', async () => {
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
