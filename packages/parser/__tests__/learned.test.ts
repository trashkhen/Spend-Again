import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Declare mocks via vi.hoisted so they are available when vi.mock factory runs.
// vi.mock calls are hoisted to the top of the file by the Vitest transformer,
// which means plain `const` declarations above them are NOT yet initialised.
// vi.hoisted() runs before the hoisted vi.mock factories, making it safe.
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
// Import module under test AFTER mock registration.
// ---------------------------------------------------------------------------

import { lookupItem, saveMapping } from '../src/learned.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('lookupItem', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns a tier-2 ParseResult when a mapping is found', async () => {
    mockFindMapping.mockResolvedValueOnce({
      category: 'Shopping',
      subCategory: 'Home & Living',
      confidence: 0.9,
    })

    const result = await lookupItem('daiso')

    expect(result).not.toBeNull()
    expect(result?.category).toBe('Shopping')
    expect(result?.subCategory).toBe('Home & Living')
    expect(result?.confidence).toBe(0.9)
    expect(result?.tier).toBe(2)
  })

  it('returns null when no mapping exists', async () => {
    mockFindMapping.mockResolvedValueOnce(null)

    const result = await lookupItem('unknownplace')

    expect(result).toBeNull()
  })

  it('normalizes item name to lowercase before calling findMapping', async () => {
    mockFindMapping.mockResolvedValueOnce(null)

    await lookupItem('DAISO')

    expect(mockFindMapping).toHaveBeenCalledWith('daiso')
  })

  it('normalizes mixed-case item name to lowercase', async () => {
    mockFindMapping.mockResolvedValueOnce(null)

    await lookupItem('ColdStorage')

    expect(mockFindMapping).toHaveBeenCalledWith('coldstorage')
  })

  it('preserves original item name in the returned ParseResult', async () => {
    mockFindMapping.mockResolvedValueOnce({
      category: 'Groceries',
      subCategory: 'Supermarket',
      confidence: 0.8,
    })

    const result = await lookupItem('NTUC')

    expect(result?.item).toBe('NTUC')
  })
})

describe('saveMapping', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockUpsertMapping.mockResolvedValue(undefined)
  })

  it('calls upsertMapping with normalized (lowercase) item name', async () => {
    await saveMapping('Daiso', 'Shopping', 'Home & Living', 'gemini')

    expect(mockUpsertMapping).toHaveBeenCalledWith(
      'daiso',
      'Shopping',
      'Home & Living',
      'gemini',
    )
  })

  it('normalizes fully uppercase item name to lowercase', async () => {
    await saveMapping('NTUC', 'Groceries', 'Supermarket', 'user')

    expect(mockUpsertMapping).toHaveBeenCalledWith(
      'ntuc',
      'Groceries',
      'Supermarket',
      'user',
    )
  })

  it('passes the source argument through to upsertMapping', async () => {
    await saveMapping('grab', 'Transport', 'Grab', 'regex')

    expect(mockUpsertMapping).toHaveBeenCalledWith('grab', 'Transport', 'Grab', 'regex')
  })

  it('calls upsertMapping exactly once', async () => {
    await saveMapping('kopi', 'Food', 'Hawker', 'gemini')

    expect(mockUpsertMapping).toHaveBeenCalledOnce()
  })
})
