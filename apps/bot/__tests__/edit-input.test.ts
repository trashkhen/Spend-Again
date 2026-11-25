import { describe, it, expect } from 'vitest'
import { parseEditAmount, parseEditDate } from '../src/lib/edit-input.js'

describe('parseEditAmount', () => {
  it('reads a plain number as SGD', () => {
    expect(parseEditAmount('16.20')).toEqual({ amountCents: 1620, currency: 'SGD' })
  })

  it('reads a currency symbol before the number', () => {
    expect(parseEditAmount('€12')).toEqual({ amountCents: 1200, currency: 'EUR' })
    expect(parseEditAmount('S$8.50')).toEqual({ amountCents: 850, currency: 'SGD' })
  })

  it('reads a currency code before or after the number', () => {
    expect(parseEditAmount('EUR 12')).toEqual({ amountCents: 1200, currency: 'EUR' })
    expect(parseEditAmount('12 eur')).toEqual({ amountCents: 1200, currency: 'EUR' })
    expect(parseEditAmount('12.50 usd')).toEqual({ amountCents: 1250, currency: 'USD' })
  })

  it('rejects text, zero, negatives and trailing words', () => {
    expect(parseEditAmount('lunch')).toBeNull()
    expect(parseEditAmount('0')).toBeNull()
    expect(parseEditAmount('-5')).toBeNull()
    expect(parseEditAmount('12 for lunch')).toBeNull()
    expect(parseEditAmount('')).toBeNull()
  })
})

describe('parseEditDate', () => {
  const now = new Date(2026, 10, 26) // 26/11/2026

  it('accepts DD/MM/YYYY', () => {
    expect(parseEditDate('25/11/2026', now)).toBe('25/11/2026')
  })

  it('fills in the current year for DD/MM', () => {
    expect(parseEditDate('3/11', now)).toBe('03/11/2026')
  })

  it('understands today and yesterday', () => {
    expect(parseEditDate('today', now)).toBe('26/11/2026')
    expect(parseEditDate('Yesterday', now)).toBe('25/11/2026')
  })

  it('rejects impossible dates, future dates and junk', () => {
    expect(parseEditDate('31/02/2026', now)).toBeNull()
    expect(parseEditDate('27/11/2026', now)).toBeNull()
    expect(parseEditDate('next week', now)).toBeNull()
    expect(parseEditDate('', now)).toBeNull()
  })
})
