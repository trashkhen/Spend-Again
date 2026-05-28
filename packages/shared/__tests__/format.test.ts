import { describe, it, expect } from 'vitest'
import { parseCents, centsToDecimalString, amountToCents, fmtSGD } from '../src/format.js'

describe('parseCents', () => {
  it('parses integer-only input', () => {
    expect(parseCents('5')).toBe(500)
    expect(parseCents('100')).toBe(10000)
    expect(parseCents('0')).toBe(0)
  })

  it('parses one-decimal input by padding cents', () => {
    expect(parseCents('5.5')).toBe(550)
    expect(parseCents('10.5')).toBe(1050)
  })

  it('parses two-decimal input', () => {
    expect(parseCents('5.50')).toBe(550)
    expect(parseCents('10.50')).toBe(1050)
    expect(parseCents('0.01')).toBe(1)
    expect(parseCents('19.99')).toBe(1999)
  })

  it('truncates fractional cents beyond two decimals', () => {
    expect(parseCents('5.555')).toBe(555)
    expect(parseCents('10.999')).toBe(1099)
  })

  it('handles leading-zero magnitudes like ".50"', () => {
    expect(parseCents('.50')).toBe(50)
  })

  it('handles negative whole numbers', () => {
    expect(parseCents('-5')).toBe(-500)
    expect(parseCents('-100')).toBe(-10000)
  })

  it('handles negative decimal amounts (refund/correction cases)', () => {
    // Regression: pre-fix parseCents('-5.50') returned -450 because the decimal
    // part ignored the sign. Now it returns -550.
    expect(parseCents('-5.50')).toBe(-550)
    expect(parseCents('-0.01')).toBe(-1)
    expect(parseCents('-19.99')).toBe(-1999)
  })

  it('is the inverse of centsToDecimalString for round-trip values', () => {
    for (const cents of [0, 1, 50, 100, 550, 1050, 100000, -1, -50, -1999]) {
      expect(parseCents(centsToDecimalString(cents))).toBe(cents)
    }
  })
})

describe('centsToDecimalString', () => {
  it('formats integer cents as decimal string with two fraction digits', () => {
    expect(centsToDecimalString(0)).toBe('0.00')
    expect(centsToDecimalString(1)).toBe('0.01')
    expect(centsToDecimalString(1050)).toBe('10.50')
    expect(centsToDecimalString(100000)).toBe('1000.00')
  })
})

describe('amountToCents', () => {
  it('converts decimal string to integer cents', () => {
    expect(amountToCents('5.50')).toBe(550)
    expect(amountToCents('10.00')).toBe(1000)
    expect(amountToCents('0.01')).toBe(1)
  })
})

describe('fmtSGD', () => {
  it('prefixes amount with S$', () => {
    expect(fmtSGD(1050)).toBe('S$10.50')
    expect(fmtSGD(0)).toBe('S$0.00')
  })
})
