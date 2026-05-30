import { parseStructuredEdit } from '../src/lib/parse-structured-edit.js'

describe('parseStructuredEdit', () => {
  it('parses price + item + category + subCategory', () => {
    const result = parseStructuredEdit('3.50 iced coffee Food Cafe')
    expect(result).toMatchObject({
      amountCents: 350,
      item: 'iced coffee',
      category: 'Food',
      subCategory: 'Cafe',
    })
  })

  it('parses price + item + category (no subCategory, uses first default)', () => {
    const result = parseStructuredEdit('15.30 grab home Transport')
    expect(result).not.toBeNull()
    expect(result?.amountCents).toBe(1530)
    expect(result?.item).toBe('grab home')
    expect(result?.category).toBe('Transport')
  })

  it('returns null for fewer than 3 tokens', () => {
    expect(parseStructuredEdit('3.50 Food')).toBeNull()
  })

  it('returns null for invalid price', () => {
    expect(parseStructuredEdit('abc coffee Food')).toBeNull()
  })

  it('returns null when no valid category found', () => {
    expect(parseStructuredEdit('3.50 coffee Nonsense')).toBeNull()
  })

  it('is case-insensitive for category', () => {
    const result = parseStructuredEdit('5 kopi food')
    expect(result?.category).toBe('Food')
  })
})
