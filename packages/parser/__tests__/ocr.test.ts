import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CATEGORY_MAP } from '@spend-again/shared'

// ---------------------------------------------------------------------------
// Mock @google/generative-ai BEFORE importing the module under test.
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
// Import after mock registration.
// ---------------------------------------------------------------------------

import {
  OcrRateLimitError,
  buildOcrPrompt,
  parseReceiptWithOcr,
  simpleReceiptToParseResult,
} from '../src/ocr.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(text: string): { response: { text: () => string } } {
  return { response: { text: () => text } }
}

function jsonResponse(obj: unknown): { response: { text: () => string } } {
  return makeResponse(JSON.stringify(obj))
}

/** Create a minimal 1-byte fake image buffer. */
function fakeImage(): Uint8Array {
  return new Uint8Array([0xff])
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildOcrPrompt', () => {
  it('includes all top-level category names', () => {
    const prompt = buildOcrPrompt()
    for (const cat of Object.keys(CATEGORY_MAP)) {
      expect(prompt).toContain(cat)
    }
  })

  it('mentions multi and simple receipt types', () => {
    const prompt = buildOcrPrompt()
    expect(prompt).toContain('multi')
    expect(prompt).toContain('simple')
  })

  it('includes today date in DD/MM/YYYY format', () => {
    const prompt = buildOcrPrompt()
    expect(prompt).toMatch(/\d{2}\/\d{2}\/\d{4}/)
  })

  it('asks for amounts in dollars', () => {
    const prompt = buildOcrPrompt()
    expect(prompt.toLowerCase()).toContain('dollar')
  })
})

describe('parseReceiptWithOcr', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env['GEMINI_API_KEY'] = 'test-key'
  })

  // ── Simple receipt ─────────────────────────────────────────────────────────

  it('parses a simple receipt into a SimpleReceiptResult', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({
        type: 'simple',
        item: 'Chicken Rice at Maxwell',
        amount: 4.5,
        category: 'Food',
        subCategory: 'Hawker',
        date: '14/05/2026',
      }),
    )

    const result = await parseReceiptWithOcr(fakeImage(), 'image/jpeg')
    expect(result).not.toBeNull()
    expect(result?.type).toBe('simple')
    if (result?.type === 'simple') {
      expect(result.item).toBe('Chicken Rice at Maxwell')
      expect(result.amount).toBe(450) // dollars → cents
      expect(result.category).toBe('Food')
      expect(result.subCategory).toBe('Hawker')
      expect(result.date).toBe('14/05/2026')
    }
  })

  it('converts dollar amounts to integer cents', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({ type: 'simple', item: 'Coffee', amount: 8.5, category: 'Food', subCategory: 'Cafe', date: null }),
    )

    const result = await parseReceiptWithOcr(fakeImage(), 'image/jpeg')
    if (result?.type === 'simple') {
      expect(result.amount).toBe(850)
    }
  })

  it('omits invalid category from simple receipt', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({ type: 'simple', item: 'Mystery', amount: 10, category: 'NotACategory', subCategory: null, date: null }),
    )

    const result = await parseReceiptWithOcr(fakeImage(), 'image/jpeg')
    if (result?.type === 'simple') {
      expect(result.category).toBeUndefined()
      expect(result.subCategory).toBeUndefined()
    }
  })

  it('omits invalid subCategory but keeps category on simple receipt', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({ type: 'simple', item: 'Item', amount: 10, category: 'Food', subCategory: 'InvalidSub', date: null }),
    )

    const result = await parseReceiptWithOcr(fakeImage(), 'image/jpeg')
    if (result?.type === 'simple') {
      expect(result.category).toBe('Food')
      expect(result.subCategory).toBeUndefined()
    }
  })

  // ── Multi-item receipt ─────────────────────────────────────────────────────

  it('parses a multi-item receipt into a MultiItemReceiptResult', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({
        type: 'multi',
        items: [
          { item: 'Eggs', amount: 3.5, category: 'Groceries', subCategory: 'Supermarket' },
          { item: 'Bread', amount: 2.5, category: 'Groceries', subCategory: 'Supermarket' },
          { item: 'Milk', amount: 4.0, category: 'Groceries', subCategory: 'Supermarket' },
        ],
        total: 10.0,
        date: '14/05/2026',
      }),
    )

    const result = await parseReceiptWithOcr(fakeImage(), 'image/jpeg')
    expect(result?.type).toBe('multi')
    if (result?.type === 'multi') {
      expect(result.items).toHaveLength(3)
      expect(result.total).toBe(1000) // $10.00 → 1000 cents
      expect(result.date).toBe('14/05/2026')
      expect(result.items[0]?.item).toBe('Eggs')
      expect(result.items[0]?.amount).toBe(350)
      expect(result.items[0]?.category).toBe('Groceries')
    }
  })

  it('computes total from items when total is missing in multi receipt', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({
        type: 'multi',
        items: [
          { item: 'Item A', amount: 5.0, category: 'Other', subCategory: null },
          { item: 'Item B', amount: 3.0, category: 'Other', subCategory: null },
        ],
        date: null,
      }),
    )

    const result = await parseReceiptWithOcr(fakeImage(), 'image/jpeg')
    if (result?.type === 'multi') {
      expect(result.total).toBe(800) // 500 + 300 cents
    }
  })

  it('handles WebP MIME type', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({ type: 'simple', item: 'Test', amount: 1.0, category: null, subCategory: null, date: null }),
    )

    const result = await parseReceiptWithOcr(fakeImage(), 'image/webp')
    expect(result).not.toBeNull()
    expect(result?.type).toBe('simple')
  })

  it('handles PNG MIME type', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({ type: 'simple', item: 'Test', amount: 1.0, category: null, subCategory: null, date: null }),
    )

    const result = await parseReceiptWithOcr(fakeImage(), 'image/png')
    expect(result).not.toBeNull()
  })

  // ── Error / unreadable ────────────────────────────────────────────────────

  it('returns an error result for unreadable images', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({ type: 'error', reason: 'Image is blurry and unreadable' }),
    )

    const result = await parseReceiptWithOcr(fakeImage(), 'image/jpeg')
    expect(result?.type).toBe('error')
    if (result?.type === 'error') {
      expect(result.reason).toBe('Image is blurry and unreadable')
    }
  })

  it('returns null when response contains no JSON', async () => {
    mockGenerateContent.mockResolvedValueOnce(makeResponse('Sorry, I cannot process this.'))

    const result = await parseReceiptWithOcr(fakeImage(), 'image/jpeg')
    expect(result).toBeNull()
  })

  it('returns null when type field is missing from JSON', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      jsonResponse({ item: 'Something', amount: 10 }),
    )

    const result = await parseReceiptWithOcr(fakeImage(), 'image/jpeg')
    expect(result).toBeNull()
  })

  // ── Rate limit ────────────────────────────────────────────────────────────

  it('throws OcrRateLimitError on HTTP 429', async () => {
    const { GoogleGenerativeAIFetchError } = await import('@google/generative-ai')
    const err = new GoogleGenerativeAIFetchError('Too Many Requests', 429, 'Too Many Requests')
    mockGenerateContent.mockRejectedValueOnce(err)

    await expect(parseReceiptWithOcr(fakeImage(), 'image/jpeg')).rejects.toThrow(OcrRateLimitError)
  })

  it('rethrows non-429 errors as-is', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('Network failure'))
    await expect(parseReceiptWithOcr(fakeImage(), 'image/jpeg')).rejects.toThrow('Network failure')
  })

  it('throws when GEMINI_API_KEY is not set', async () => {
    delete process.env['GEMINI_API_KEY']
    await expect(parseReceiptWithOcr(fakeImage(), 'image/jpeg')).rejects.toThrow('GEMINI_API_KEY')
  })

  // ── JSON in markdown fences ───────────────────────────────────────────────

  it('extracts JSON when wrapped in markdown code fences', async () => {
    const wrapped =
      '```json\n{"type":"simple","item":"Kopi","amount":1.5,"category":"Food","subCategory":"Hawker","date":"14/05/2026"}\n```'
    mockGenerateContent.mockResolvedValueOnce(makeResponse(wrapped))

    const result = await parseReceiptWithOcr(fakeImage(), 'image/jpeg')
    expect(result?.type).toBe('simple')
    if (result?.type === 'simple') {
      expect(result.amount).toBe(150)
    }
  })
})

// ---------------------------------------------------------------------------
// simpleReceiptToParseResult adapter
// ---------------------------------------------------------------------------

describe('simpleReceiptToParseResult', () => {
  it('converts a SimpleReceiptResult to a ParseResult with tier=3', () => {
    const receipt = {
      type: 'simple' as const,
      item: 'Chicken Rice',
      amount: 450,
      category: 'Food' as const,
      subCategory: 'Hawker' as const,
      date: '14/05/2026',
    }

    const parsed = simpleReceiptToParseResult(receipt)
    expect(parsed.tier).toBe(3)
    expect(parsed.confidence).toBe(0.85)
    expect(parsed.amount).toBe(450)
    expect(parsed.item).toBe('Chicken Rice')
    expect(parsed.category).toBe('Food')
    expect(parsed.subCategory).toBe('Hawker')
    expect(parsed.date).toBe('14/05/2026')
  })

  it('handles a result without category', () => {
    const receipt = {
      type: 'simple' as const,
      item: 'Mystery Item',
      amount: 1000,
    }

    const parsed = simpleReceiptToParseResult(receipt)
    expect(parsed.category).toBeUndefined()
    expect(parsed.subCategory).toBeUndefined()
    expect(parsed.date).toBeUndefined()
  })
})
