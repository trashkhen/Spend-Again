import { describe, it, expect, vi } from 'vitest'

// Prevent @spend-again/db from throwing "DATABASE_URL is required" at module
// init. advanceByFrequency is pure and never touches the DB.
vi.mock('@spend-again/db', () => ({
  db: {},
  recurringPayments: {},
}))

import { advanceByFrequency } from '../src/services/recurring.js'

describe('advanceByFrequency', () => {
  it('advances weekly by 7 days', () => {
    expect(advanceByFrequency('2026-06-01', 'weekly')).toBe('2026-06-08')
  })
  it('advances fortnightly by 14 days', () => {
    expect(advanceByFrequency('2026-06-01', 'fortnightly')).toBe('2026-06-15')
  })
  it('advances monthly by 1 calendar month', () => {
    expect(advanceByFrequency('2026-01-31', 'monthly')).toBe('2026-02-28')
  })
  it('advances quarterly by 3 months', () => {
    expect(advanceByFrequency('2026-01-15', 'quarterly')).toBe('2026-04-15')
  })
  it('advances yearly by 1 year', () => {
    expect(advanceByFrequency('2026-06-01', 'yearly')).toBe('2027-06-01')
  })
})
