import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @google/generative-ai to avoid real API calls (also prevents errors
// when GEMINI_API_KEY is not set at import time).
// ---------------------------------------------------------------------------

vi.mock('@google/generative-ai', () => {
  class GoogleGenerativeAI {
    constructor(_apiKey: string) {}
    getGenerativeModel(_opts: { model: string }) {
      return { generateContent: vi.fn() }
    }
  }
  class GoogleGenerativeAIFetchError extends Error {}
  return { GoogleGenerativeAI, GoogleGenerativeAIFetchError }
})

// ---------------------------------------------------------------------------
// Import module under test and the two tier modules so we can spy on them.
// ---------------------------------------------------------------------------

import * as RegexModule from '../src/regex.js'
import * as GeminiModule from '../src/gemini.js'
import * as CurrencyModule from '../src/currency.js'
import { parse } from '../src/index.js'
import type { ParseResult, LookupFn } from '../src/index.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTier1Full(): ParseResult {
  return {
    amount: 1200,
    item: 'NTUC groceries',
    category: 'Groceries',
    subCategory: 'Supermarket',
    date: '12/05/2026',
    confidence: 0.9,
    tier: 1,
  }
}

function makeTier1Partial(): ParseResult {
  // Amount extracted but no category (item not in SG_ITEM_MAP)
  return {
    amount: 800,
    item: 'lunch',
    confidence: 0.7,
    tier: 1,
  }
}

function makeTier2Result(item: string): { category: 'Shopping'; subCategory: 'Home & Living'; confidence: number } {
  return {
    category: 'Shopping',
    subCategory: 'Home & Living',
    confidence: 0.85,
  }
}

function makeTier3Result(): ParseResult {
  return {
    amount: 850,
    item: 'Laksa at unknown hawker',
    category: 'Food',
    subCategory: 'Hawker',
    date: '12/05/2026',
    confidence: 0.85,
    tier: 3,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parse() — unified 3-tier orchestration', () => {
  let spyRegex: ReturnType<typeof vi.spyOn>
  let spyGemini: ReturnType<typeof vi.spyOn>
  let spyConvert: ReturnType<typeof vi.spyOn>
  let mockLookupItem: ReturnType<typeof vi.fn>
  let lookupItem: LookupFn

  beforeEach(() => {
    vi.resetAllMocks()
    spyRegex = vi.spyOn(RegexModule, 'parseWithRegex')
    spyGemini = vi.spyOn(GeminiModule, 'parseWithGemini')
    spyConvert = vi.spyOn(CurrencyModule, 'convertToSGD')
    mockLookupItem = vi.fn()
    lookupItem = mockLookupItem as unknown as LookupFn
  })

  // -------------------------------------------------------------------------
  // 1. Tier 1 fully resolves — Tier 2 and Tier 3 must NOT be called
  // -------------------------------------------------------------------------

  it('returns tier-1 result immediately when regex resolves with a category', async () => {
    const tier1 = makeTier1Full()
    spyRegex.mockReturnValueOnce(tier1)

    const result = await parse('$12 at NTUC', { lookupItem })

    expect(result).toEqual(tier1)
    expect(result?.tier).toBe(1)
    expect(mockLookupItem).not.toHaveBeenCalled()
    expect(spyGemini).not.toHaveBeenCalled()
  })

  it('tier-1 result has a confidence score', async () => {
    spyRegex.mockReturnValueOnce(makeTier1Full())

    const result = await parse('$12 at NTUC', { lookupItem })

    expect(typeof result?.confidence).toBe('number')
  })

  // -------------------------------------------------------------------------
  // 2. Tier 1 partial (amount but no category) → Tier 2 resolves
  //    Result should merge tier1 amount with tier2 category; Tier 3 NOT called
  // -------------------------------------------------------------------------

  it('uses tier-2 category when tier-1 extracts amount but no category', async () => {
    const tier1 = makeTier1Partial()
    const tier2 = makeTier2Result('lunch')
    spyRegex.mockReturnValueOnce(tier1)
    mockLookupItem.mockResolvedValueOnce(tier2)

    const result = await parse('$8 lunch at Daiso', { lookupItem })

    expect(result).not.toBeNull()
    expect(result?.tier).toBe(2)
    // Amount comes from tier1
    expect(result?.amount).toBe(800)
    // Category comes from tier2
    expect(result?.category).toBe('Shopping')
    expect(result?.subCategory).toBe('Home & Living')
    expect(spyGemini).not.toHaveBeenCalled()
  })

  it('tier-2 lookup uses the item name extracted by tier-1', async () => {
    const tier1 = makeTier1Partial()
    spyRegex.mockReturnValueOnce(tier1)
    mockLookupItem.mockResolvedValueOnce(null)
    spyGemini.mockResolvedValueOnce(null)

    await parse('$8 lunch at Daiso', { lookupItem })

    // Tier 2 should be called with tier1.item ('lunch'), not raw input
    expect(mockLookupItem).toHaveBeenCalledWith('lunch')
  })

  it('merged result carries tier-1 date when tier-2 resolves', async () => {
    const tier1: ParseResult = { ...makeTier1Partial(), date: '10/05/2026' }
    const tier2 = makeTier2Result('lunch')
    spyRegex.mockReturnValueOnce(tier1)
    mockLookupItem.mockResolvedValueOnce(tier2)

    const result = await parse('$8 lunch yesterday', { lookupItem })

    expect(result?.date).toBe('10/05/2026')
  })

  it('confidence is present when tier-2 resolves', async () => {
    spyRegex.mockReturnValueOnce(makeTier1Partial())
    mockLookupItem.mockResolvedValueOnce(makeTier2Result('lunch'))

    const result = await parse('$8 lunch', { lookupItem })

    expect(typeof result?.confidence).toBe('number')
  })

  // -------------------------------------------------------------------------
  // 3. Tier 1 returns null → Tier 2 called with raw input
  // -------------------------------------------------------------------------

  it('calls tier-2 with raw input when tier-1 returns null', async () => {
    spyRegex.mockReturnValueOnce(null)
    mockLookupItem.mockResolvedValueOnce(null)
    spyGemini.mockResolvedValueOnce(null)

    await parse('laksa at unknown place', { lookupItem })

    expect(mockLookupItem).toHaveBeenCalledWith('laksa at unknown place')
  })

  it('returns tier-2 result (with raw input lookup) when tier-1 returns null', async () => {
    const tier2 = { category: 'Food' as const, subCategory: 'Hawker' as const, confidence: 0.8 }
    spyRegex.mockReturnValueOnce(null)
    mockLookupItem.mockResolvedValueOnce(tier2)

    const result = await parse('laksa at unknown place', { lookupItem })

    expect(result?.category).toBe('Food')
    expect(result?.tier).toBe(2)
    expect(spyGemini).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 4. Tier 1 partial, Tier 2 null → falls through to Tier 3
  // -------------------------------------------------------------------------

  it('falls through to tier-3 when tier-1 partial and tier-2 returns null', async () => {
    spyRegex.mockReturnValueOnce(makeTier1Partial())
    mockLookupItem.mockResolvedValueOnce(null)
    spyGemini.mockResolvedValueOnce(makeTier3Result())

    const result = await parse('$8 laksa at unknown place', { lookupItem })

    expect(result?.tier).toBe(3)
    expect(spyGemini).toHaveBeenCalledWith('$8 laksa at unknown place')
  })

  it('passes the original raw input to Gemini (not the extracted item)', async () => {
    spyRegex.mockReturnValueOnce(makeTier1Partial())
    mockLookupItem.mockResolvedValueOnce(null)
    spyGemini.mockResolvedValueOnce(makeTier3Result())

    await parse('$8 laksa at unknown place', { lookupItem })

    expect(spyGemini).toHaveBeenCalledWith('$8 laksa at unknown place')
  })

  it('tier-3 result includes a confidence score', async () => {
    spyRegex.mockReturnValueOnce(null)
    mockLookupItem.mockResolvedValueOnce(null)
    spyGemini.mockResolvedValueOnce(makeTier3Result())

    const result = await parse('$8 laksa at unknown place', { lookupItem })

    expect(typeof result?.confidence).toBe('number')
  })

  // -------------------------------------------------------------------------
  // 5. All three tiers return null → parse() returns null
  // -------------------------------------------------------------------------

  it('returns null when all three tiers fail', async () => {
    spyRegex.mockReturnValueOnce(null)
    mockLookupItem.mockResolvedValueOnce(null)
    spyGemini.mockResolvedValueOnce(null)

    const result = await parse('gibberish input', { lookupItem })

    expect(result).toBeNull()
  })

  // -------------------------------------------------------------------------
  // 6. Tier field correctness on each path
  // -------------------------------------------------------------------------

  it('result tier is 1 when regex resolves fully', async () => {
    spyRegex.mockReturnValueOnce(makeTier1Full())

    const result = await parse('$12 NTUC', { lookupItem })

    expect(result?.tier).toBe(1)
  })

  it('result tier is 2 when learned mapping resolves', async () => {
    spyRegex.mockReturnValueOnce(makeTier1Partial())
    mockLookupItem.mockResolvedValueOnce(makeTier2Result('lunch'))

    const result = await parse('$8 lunch', { lookupItem })

    expect(result?.tier).toBe(2)
  })

  it('result tier is 3 when Gemini resolves', async () => {
    spyRegex.mockReturnValueOnce(null)
    mockLookupItem.mockResolvedValueOnce(null)
    spyGemini.mockResolvedValueOnce(makeTier3Result())

    const result = await parse('$8 laksa at unknown', { lookupItem })

    expect(result?.tier).toBe(3)
  })

  // -------------------------------------------------------------------------
  // 7. Currency conversion — single point, regardless of which tier resolved
  // -------------------------------------------------------------------------

  describe('currency conversion', () => {
    it('converts a tier-1 result carrying a currency field', async () => {
      const tier1: ParseResult = { ...makeTier1Full(), currency: 'EUR' }
      spyRegex.mockReturnValueOnce(tier1)
      spyConvert.mockResolvedValueOnce({ convertedCents: 1727, rate: 1.4384 })

      const result = await parse('12 euro NTUC', { lookupItem })

      expect(spyConvert).toHaveBeenCalledWith(1200, 'EUR')
      expect(result?.amount).toBe(1727)
      expect(result?.originalAmount).toBe(1200)
      expect(result?.originalCurrency).toBe('EUR')
      expect(result?.exchangeRate).toBe(1.4384)
      expect(result?.currency).toBeUndefined()
    })

    it('does not call convertToSGD when no currency is set', async () => {
      spyRegex.mockReturnValueOnce(makeTier1Full())

      await parse('$12 NTUC', { lookupItem })

      expect(spyConvert).not.toHaveBeenCalled()
    })

    it('converts a tier-2 merged result carrying tier-1 currency through', async () => {
      const tier1: ParseResult = { ...makeTier1Partial(), currency: 'EUR' }
      spyRegex.mockReturnValueOnce(tier1)
      mockLookupItem.mockResolvedValueOnce(makeTier2Result('lunch'))
      spyConvert.mockResolvedValueOnce({ convertedCents: 1150, rate: 1.4384 })

      const result = await parse('8 euro lunch', { lookupItem })

      expect(spyConvert).toHaveBeenCalledWith(800, 'EUR')
      expect(result?.tier).toBe(2)
      expect(result?.amount).toBe(1150)
      expect(result?.originalCurrency).toBe('EUR')
    })

    it('converts a tier-3 gemini result carrying a currency field', async () => {
      spyRegex.mockReturnValueOnce(null)
      mockLookupItem.mockResolvedValueOnce(null)
      spyGemini.mockResolvedValueOnce({ ...makeTier3Result(), currency: 'THB' })
      spyConvert.mockResolvedValueOnce({ convertedCents: 143, rate: 0.0398 })

      const result = await parse('50 baht taxi', { lookupItem })

      expect(spyConvert).toHaveBeenCalledWith(850, 'THB')
      expect(result?.tier).toBe(3)
      expect(result?.amount).toBe(143)
      expect(result?.originalCurrency).toBe('THB')
    })

    it('propagates CurrencyConversionError instead of returning a result', async () => {
      const { CurrencyConversionError } = await import('@spend-again/shared')
      const tier1: ParseResult = { ...makeTier1Full(), currency: 'EUR' }
      spyRegex.mockReturnValueOnce(tier1)
      spyConvert.mockRejectedValueOnce(new CurrencyConversionError('rate service down'))

      await expect(parse('12 euro NTUC', { lookupItem })).rejects.toThrow(CurrencyConversionError)
    })

    // -----------------------------------------------------------------------
    // Regression: Fix 1 — Tier-1's detected currency must not be silently
    // dropped when Gemini's Tier-3 re-parse fails to redetect it.
    // -----------------------------------------------------------------------

    it('falls back to tier-1 currency when tier-3 (Gemini) omits it after fallthrough', async () => {
      // Tier-1 detects EUR but can't resolve a category.
      const tier1: ParseResult = { amount: 560, item: 'pasta', currency: 'EUR', confidence: 0.7, tier: 1 }
      spyRegex.mockReturnValueOnce(tier1)
      // Tier-2 misses.
      mockLookupItem.mockResolvedValueOnce(null)
      // Tier-3 re-parses the raw input from scratch and (imperfectly) omits currency entirely.
      spyGemini.mockResolvedValueOnce({
        amount: 560,
        item: 'pasta',
        category: 'Food',
        subCategory: 'Restaurant',
        confidence: 0.8,
        tier: 3,
      })
      spyConvert.mockResolvedValueOnce({ convertedCents: 806, rate: 1.4384 })

      const result = await parse('5.60 euro pasta', { lookupItem })

      // Tier-1's EUR detection must be what gets converted, not silently dropped.
      expect(spyConvert).toHaveBeenCalledWith(560, 'EUR')
      expect(result?.originalCurrency).toBe('EUR')
      expect(result?.originalAmount).toBe(560)
      expect(result?.amount).toBe(806)
    })
  })

  // -------------------------------------------------------------------------
  // Regression: Fix 3 — a hint-list currency bailout must not let a learned
  // Tier-2 mapping produce a silent $0 transaction when the raw input
  // clearly contains a number.
  // -------------------------------------------------------------------------

  describe('zero-amount tier-2 guard (hint-list currency bailout)', () => {
    it('falls through to tier-3 instead of returning a zero-amount tier-2 result when input has a digit', async () => {
      // Tier-1 bails out entirely (hint-list currency it can't confidently convert).
      spyRegex.mockReturnValueOnce(null)
      // Tier-2 hits a learned mapping keyed on the raw string (previously confirmed verbatim).
      mockLookupItem.mockResolvedValueOnce({ category: 'Transport', subCategory: 'Grab', confidence: 0.9 })
      // Tier-3 (Gemini) should be reached and determine the real amount/currency.
      spyGemini.mockResolvedValueOnce({
        amount: 50,
        item: 'grab',
        category: 'Transport',
        subCategory: 'Grab',
        currency: 'THB',
        confidence: 0.85,
        tier: 3,
      })
      spyConvert.mockResolvedValueOnce({ convertedCents: 199, rate: 0.0398 })

      const result = await parse('50 baht grab', { lookupItem })

      // The zero-amount tier-2 merge must have been rejected, and Tier-3 reached instead.
      expect(spyGemini).toHaveBeenCalledWith('50 baht grab')
      expect(result?.tier).toBe(3)
      expect(result?.amount).toBe(199)
    })

    it('still returns the tier-2 result directly when the raw input has no digit at all', async () => {
      // Pre-existing legitimate case: no number anywhere in input, so a zero
      // amount is not a red flag — should NOT fall through to tier-3.
      const tier2 = { category: 'Food' as const, subCategory: 'Hawker' as const, confidence: 0.8 }
      spyRegex.mockReturnValueOnce(null)
      mockLookupItem.mockResolvedValueOnce(tier2)

      const result = await parse('laksa at unknown place', { lookupItem })

      expect(result?.category).toBe('Food')
      expect(result?.tier).toBe(2)
      expect(result?.amount).toBe(0)
      expect(spyGemini).not.toHaveBeenCalled()
    })
  })
})
