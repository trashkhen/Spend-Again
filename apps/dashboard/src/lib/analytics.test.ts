import { describe, expect, test } from 'vitest'
import { computeMonthComparison, previousMonthOf } from './analytics'

describe('previousMonthOf', () => {
  test('returns previous month in the same year', () => {
    expect(previousMonthOf(6, 2026)).toEqual({ month: 5, year: 2026 })
  })

  test('wraps January to December of the previous year', () => {
    expect(previousMonthOf(1, 2026)).toEqual({ month: 12, year: 2025 })
  })
})

describe('computeMonthComparison', () => {
  test('formats an increase against the previous month', () => {
    expect(computeMonthComparison(624.67, 600, 5, 2026)).toEqual({
      label: '↑ S$24.67 vs May',
      tone: 'up',
    })
  })

  test('formats a decrease against the previous month', () => {
    expect(computeMonthComparison(510, 600, 5, 2026)).toEqual({
      label: '↓ S$90.00 vs May',
      tone: 'down',
    })
  })

  test('handles no previous spending without pretending there is a delta', () => {
    expect(computeMonthComparison(24.67, 0, 5, 2026)).toEqual({
      label: 'New vs May',
      tone: 'up',
    })
  })

  test('handles equal month totals', () => {
    expect(computeMonthComparison(600, 600, 5, 2026)).toEqual({
      label: 'Same vs May',
      tone: 'flat',
    })
  })
})
