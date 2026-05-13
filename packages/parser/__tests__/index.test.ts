import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// We need to prevent @spend-again/db from throwing at import time (it reads
// DATABASE_URL synchronously in client.ts). Mock it before any module that
// transitively imports it is loaded.
// ---------------------------------------------------------------------------

const { mockFindMapping, mockUpsertMapping } = vi.hoisted(() => ({
  mockFindMapping: vi.fn(),
  mockUpsertMapping: vi.fn(),
}))

vi.mock('@spend-again/db', () => ({
  findMapping: mockFindMapping,
  upsertMapping: mockUpsertMapping,
}))

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
// Import module under test and the three tier modules so we can spy on them.
// ---------------------------------------------------------------------------

import * as RegexModule from '../src/regex.js'
import * as LearnedModule from '../src/learned.js'
import * as GeminiModule from '../src/gemini.js'
import { parse } from '../src/index.js'
import type { ParseResult } from '../src/index.js'

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

function makeTier2Result(item: string): ParseResult {
  return {
    amount: 0,
    item,
    category: 'Shopping',
    subCategory: 'Home & Living',
    confidence: 0.85,
    tier: 2,
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
  let spyLookup: ReturnType<typeof vi.spyOn>
  let spyGemini: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetAllMocks()
    spyRegex = vi.spyOn(RegexModule, 'parseWithRegex')
    spyLookup = vi.spyOn(LearnedModule, 'lookupItem')
    spyGemini = vi.spyOn(GeminiModule, 'parseWithGemini')
  })

  // -------------------------------------------------------------------------
  // 1. Tier 1 fully resolves — Tier 2 and Tier 3 must NOT be called
  // -------------------------------------------------------------------------

  it('returns tier-1 result immediately when regex resolves with a category', async () => {
    const tier1 = makeTier1Full()
    spyRegex.mockReturnValueOnce(tier1)

    const result = await parse('$12 at NTUC')

    expect(result).toEqual(tier1)
    expect(result?.tier).toBe(1)
    expect(spyLookup).not.toHaveBeenCalled()
    expect(spyGemini).not.toHaveBeenCalled()
  })

  it('tier-1 result has a confidence score', async () => {
    spyRegex.mockReturnValueOnce(makeTier1Full())

    const result = await parse('$12 at NTUC')

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
    spyLookup.mockResolvedValueOnce(tier2)

    const result = await parse('$8 lunch at Daiso')

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
    spyLookup.mockResolvedValueOnce(null)
    spyGemini.mockResolvedValueOnce(null)

    await parse('$8 lunch at Daiso')

    // Tier 2 should be called with tier1.item ('lunch'), not raw input
    expect(spyLookup).toHaveBeenCalledWith('lunch')
  })

  it('merged result carries tier-1 date when tier-2 resolves', async () => {
    const tier1: ParseResult = { ...makeTier1Partial(), date: '10/05/2026' }
    const tier2 = makeTier2Result('lunch')
    spyRegex.mockReturnValueOnce(tier1)
    spyLookup.mockResolvedValueOnce(tier2)

    const result = await parse('$8 lunch yesterday')

    expect(result?.date).toBe('10/05/2026')
  })

  it('confidence is present when tier-2 resolves', async () => {
    spyRegex.mockReturnValueOnce(makeTier1Partial())
    spyLookup.mockResolvedValueOnce(makeTier2Result('lunch'))

    const result = await parse('$8 lunch')

    expect(typeof result?.confidence).toBe('number')
  })

  // -------------------------------------------------------------------------
  // 3. Tier 1 returns null → Tier 2 called with raw input
  // -------------------------------------------------------------------------

  it('calls tier-2 with raw input when tier-1 returns null', async () => {
    spyRegex.mockReturnValueOnce(null)
    spyLookup.mockResolvedValueOnce(null)
    spyGemini.mockResolvedValueOnce(null)

    await parse('laksa at unknown place')

    expect(spyLookup).toHaveBeenCalledWith('laksa at unknown place')
  })

  it('returns tier-2 result (with raw input lookup) when tier-1 returns null', async () => {
    const tier2: ParseResult = {
      amount: 0,
      item: 'laksa at unknown place',
      category: 'Food',
      subCategory: 'Hawker',
      confidence: 0.8,
      tier: 2,
    }
    spyRegex.mockReturnValueOnce(null)
    spyLookup.mockResolvedValueOnce(tier2)

    const result = await parse('laksa at unknown place')

    expect(result?.category).toBe('Food')
    expect(result?.tier).toBe(2)
    expect(spyGemini).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 4. Tier 1 partial, Tier 2 null → falls through to Tier 3
  // -------------------------------------------------------------------------

  it('falls through to tier-3 when tier-1 partial and tier-2 returns null', async () => {
    spyRegex.mockReturnValueOnce(makeTier1Partial())
    spyLookup.mockResolvedValueOnce(null)
    spyGemini.mockResolvedValueOnce(makeTier3Result())

    const result = await parse('$8 laksa at unknown place')

    expect(result?.tier).toBe(3)
    expect(spyGemini).toHaveBeenCalledWith('$8 laksa at unknown place')
  })

  it('passes the original raw input to Gemini (not the extracted item)', async () => {
    spyRegex.mockReturnValueOnce(makeTier1Partial())
    spyLookup.mockResolvedValueOnce(null)
    spyGemini.mockResolvedValueOnce(makeTier3Result())

    await parse('$8 laksa at unknown place')

    expect(spyGemini).toHaveBeenCalledWith('$8 laksa at unknown place')
  })

  it('tier-3 result includes a confidence score', async () => {
    spyRegex.mockReturnValueOnce(null)
    spyLookup.mockResolvedValueOnce(null)
    spyGemini.mockResolvedValueOnce(makeTier3Result())

    const result = await parse('$8 laksa at unknown place')

    expect(typeof result?.confidence).toBe('number')
  })

  // -------------------------------------------------------------------------
  // 5. All three tiers return null → parse() returns null
  // -------------------------------------------------------------------------

  it('returns null when all three tiers fail', async () => {
    spyRegex.mockReturnValueOnce(null)
    spyLookup.mockResolvedValueOnce(null)
    spyGemini.mockResolvedValueOnce(null)

    const result = await parse('gibberish input')

    expect(result).toBeNull()
  })

  // -------------------------------------------------------------------------
  // 6. Tier field correctness on each path
  // -------------------------------------------------------------------------

  it('result tier is 1 when regex resolves fully', async () => {
    spyRegex.mockReturnValueOnce(makeTier1Full())

    const result = await parse('$12 NTUC')

    expect(result?.tier).toBe(1)
  })

  it('result tier is 2 when learned mapping resolves', async () => {
    spyRegex.mockReturnValueOnce(makeTier1Partial())
    spyLookup.mockResolvedValueOnce(makeTier2Result('lunch'))

    const result = await parse('$8 lunch')

    expect(result?.tier).toBe(2)
  })

  it('result tier is 3 when Gemini resolves', async () => {
    spyRegex.mockReturnValueOnce(null)
    spyLookup.mockResolvedValueOnce(null)
    spyGemini.mockResolvedValueOnce(makeTier3Result())

    const result = await parse('$8 laksa at unknown')

    expect(result?.tier).toBe(3)
  })
})
