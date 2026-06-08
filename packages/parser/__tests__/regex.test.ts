import { describe, expect, it } from 'vitest'
import { parseWithRegex } from '../src/regex.js'

describe('parseWithRegex', () => {
  // -------------------------------------------------------------------------
  // Amount extraction
  // -------------------------------------------------------------------------

  it('parses dollar-prefixed integer amount', () => {
    const result = parseWithRegex('$10 chicken rice')
    expect(result).not.toBeNull()
    expect(result?.amount).toBe(1000)
    expect(result?.item).toBe('chicken rice')
  })

  it('parses bare decimal amount with preposition', () => {
    const result = parseWithRegex('5.50 for lunch at Amoy')
    expect(result).not.toBeNull()
    expect(result?.amount).toBe(550)
    expect(result?.item).toBe('lunch at Amoy')
  })

  it('parses S$ prefix', () => {
    const result = parseWithRegex('S$8.50 bubble tea')
    expect(result).not.toBeNull()
    expect(result?.amount).toBe(850)
    expect(result?.item).toBe('bubble tea')
  })

  it('parses SGD prefix (with space)', () => {
    const result = parseWithRegex('SGD 25 grab')
    expect(result).not.toBeNull()
    expect(result?.amount).toBe(2500)
  })

  it('parses SGD prefix (no space)', () => {
    const result = parseWithRegex('SGD25 grab')
    expect(result).not.toBeNull()
    expect(result?.amount).toBe(2500)
  })

  it('parses bare integer amount', () => {
    const result = parseWithRegex('15 for dinner')
    expect(result).not.toBeNull()
    expect(result?.amount).toBe(1500)
    expect(result?.item).toBe('dinner')
  })

  it('handles amount with single decimal digit', () => {
    const result = parseWithRegex('$3.5 kopi')
    expect(result).not.toBeNull()
    expect(result?.amount).toBe(350)
  })

  it('handles zero cents decimal', () => {
    const result = parseWithRegex('$20.00 groceries')
    expect(result).not.toBeNull()
    expect(result?.amount).toBe(2000)
  })

  // -------------------------------------------------------------------------
  // SG_ITEM_MAP lookups
  // -------------------------------------------------------------------------

  it('maps NTUC to Groceries / Supermarket', () => {
    const result = parseWithRegex('$12 at NTUC')
    expect(result).not.toBeNull()
    expect(result?.amount).toBe(1200)
    expect(result?.item).toBe('NTUC')
    expect(result?.category).toBe('Groceries')
    expect(result?.subCategory).toBe('Supermarket')
  })

  it('maps grab to Transport / Grab', () => {
    const result = parseWithRegex('SGD 25 grab')
    expect(result).not.toBeNull()
    expect(result?.category).toBe('Transport')
    expect(result?.subCategory).toBe('Grab')
  })

  it('maps hawker to Food / Hawker', () => {
    const result = parseWithRegex('$4.50 hawker')
    expect(result).not.toBeNull()
    expect(result?.category).toBe('Food')
    expect(result?.subCategory).toBe('Hawker')
  })

  it('maps cold storage (multi-word key) to Groceries / Supermarket', () => {
    const result = parseWithRegex('$35 cold storage')
    expect(result).not.toBeNull()
    expect(result?.category).toBe('Groceries')
    expect(result?.subCategory).toBe('Supermarket')
  })

  it('returns no category for unknown item', () => {
    const result = parseWithRegex('$8.50 thingamajig at random place')
    expect(result).not.toBeNull()
    expect(result?.category).toBeUndefined()
    expect(result?.subCategory).toBeUndefined()
  })

  // -------------------------------------------------------------------------
  // Date extraction
  // -------------------------------------------------------------------------

  it('extracts DD/MM/YYYY date from input', () => {
    const result = parseWithRegex('$10 lunch 12/05/2026')
    expect(result).not.toBeNull()
    expect(result?.date).toBe('12/05/2026')
  })

  it('extracts "yesterday" as a date', () => {
    const result = parseWithRegex('$5 kopi yesterday')
    expect(result).not.toBeNull()
    // Just verify a date was set in DD/MM/YYYY format
    expect(result?.date).toMatch(/^\d{2}\/\d{2}\/\d{4}$/)
  })

  it('extracts "today" as a date', () => {
    const result = parseWithRegex('$3 milo today')
    expect(result).not.toBeNull()
    expect(result?.date).toMatch(/^\d{2}\/\d{2}\/\d{4}$/)
  })

  it('returns undefined date when no date cue present', () => {
    const result = parseWithRegex('$10 chicken rice')
    expect(result).not.toBeNull()
    expect(result?.date).toBeUndefined()
  })

  it('parses natural language "D Month" date and strips it from item', () => {
    const result = parseWithRegex('$10 grab 5 June')
    expect(result).not.toBeNull()
    expect(result?.amount).toBe(1000)
    expect(result?.item).toBe('grab')
    expect(result?.date).toMatch(/^05\/06\/\d{4}$/)
  })

  it('parses natural language "D MonthAbbr" date', () => {
    const result = parseWithRegex('$8 lunch 3 Jan')
    expect(result).not.toBeNull()
    expect(result?.date).toMatch(/^03\/01\/\d{4}$/)
    expect(result?.item).toBe('lunch')
  })

  it('parses natural language "Month D" date', () => {
    const result = parseWithRegex('$12 NTUC June 5')
    expect(result).not.toBeNull()
    expect(result?.date).toMatch(/^05\/06\/\d{4}$/)
    expect(result?.item).toBe('NTUC')
  })

  it('parses natural language date with ordinal suffix', () => {
    const result = parseWithRegex('$5 kopi 1st Jan')
    expect(result).not.toBeNull()
    expect(result?.date).toMatch(/^01\/01\/\d{4}$/)
    expect(result?.item).toBe('kopi')
  })

  // -------------------------------------------------------------------------
  // Tier and confidence
  // -------------------------------------------------------------------------

  it('sets tier to 1', () => {
    const result = parseWithRegex('$5 milo')
    expect(result?.tier).toBe(1)
  })

  it('has higher confidence when category is resolved', () => {
    const withCat = parseWithRegex('$12 ntuc')
    const withoutCat = parseWithRegex('$12 random place')
    expect(withCat?.confidence).toBeGreaterThan(withoutCat?.confidence ?? 1)
  })

  // -------------------------------------------------------------------------
  // Null / empty cases
  // -------------------------------------------------------------------------

  it('returns null for empty string', () => {
    expect(parseWithRegex('')).toBeNull()
  })

  it('returns null for whitespace-only string', () => {
    expect(parseWithRegex('   ')).toBeNull()
  })

  it('returns null when no amount present', () => {
    expect(parseWithRegex('lunch at Amoy')).toBeNull()
  })

  it('returns null for text with no parseable number', () => {
    expect(parseWithRegex('bought stuff')).toBeNull()
  })
})
