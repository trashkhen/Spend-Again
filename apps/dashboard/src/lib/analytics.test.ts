import { describe, expect, test } from 'vitest'
import {
  computeMonthComparison,
  computePeriodCategoryBreakdown,
  computePeriodSummary,
  periodDayCount,
  periodFromFilters,
  periodLabel,
  previousMonthOf,
  previousPeriodOf,
} from './analytics'
import type { ApiTransaction } from './api'

function tx(occurredOn: string, amount: string, category = 'Food'): ApiTransaction {
  return {
    id: `${occurredOn}-${amount}-${category}`,
    userId: 'u1',
    amountCents: Math.round(parseFloat(amount) * 100),
    amount,
    item: 'item',
    description: null,
    category,
    subCategory: 'Other',
    occurredOn,
    source: 'manual',
    createdAt: `${occurredOn}T00:00:00Z`,
    updatedAt: `${occurredOn}T00:00:00Z`,
    spaceId: null,
  }
}

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

describe('periodFromFilters', () => {
  const now = new Date(2026, 10, 13)
  test('month + year → that month', () => {
    expect(periodFromFilters('11', '2026', now)).toEqual({ month: 11, year: 2026 })
  })
  test('"All months" + year → whole year', () => {
    expect(periodFromFilters('', '2026', now)).toEqual({ month: null, year: 2026 })
  })
  test('"All months" + "All years" → all time', () => {
    expect(periodFromFilters('', '', now)).toEqual({ month: null, year: null })
  })
  test('month without year → that month this year (mirrors the API)', () => {
    expect(periodFromFilters('03', '', now)).toEqual({ month: 3, year: 2026 })
  })
})

describe('periodLabel / previousPeriodOf', () => {
  test('labels each kind of period', () => {
    expect(periodLabel({ month: 11, year: 2026 })).toBe('November 2026')
    expect(periodLabel({ month: null, year: 2026 })).toBe('2026')
    expect(periodLabel({ month: null, year: null })).toBe('All time')
  })
  test('previous period', () => {
    expect(previousPeriodOf({ month: 1, year: 2026 })).toEqual({ month: 12, year: 2025 })
    expect(previousPeriodOf({ month: null, year: 2026 })).toEqual({ month: null, year: 2025 })
    expect(previousPeriodOf({ month: null, year: null })).toBeNull()
  })
})

describe('computePeriodSummary', () => {
  const now = new Date(2026, 10, 13)
  const data = [
    tx('2026-11-02', '10.00', 'Food'),
    tx('2026-10-15', '100.00', 'Housing'),
    tx('2026-01-05', '20.00', 'Food'),
    tx('2025-12-31', '5.00', 'Transport'),
  ]

  test('whole year includes every month of that year, not just the current one', () => {
    const s = computePeriodSummary(data, { month: null, year: 2026 }, now)
    expect(s.total).toBe(130)
    expect(s.transactionCount).toBe(3)
    expect(s.topCategory).toBe('Housing')
    // 13 Nov 2026 is day 317 of the year
    expect(s.averageDaily).toBe(Math.round((130 / 317) * 100) / 100)
  })

  test('all time includes every transaction', () => {
    const s = computePeriodSummary(data, { month: null, year: null }, now)
    expect(s.total).toBe(135)
    expect(s.transactionCount).toBe(4)
  })

  test('single month only counts that month', () => {
    const s = computePeriodSummary(data, { month: 11, year: 2026 }, now)
    expect(s.total).toBe(10)
    expect(s.averageDaily).toBe(Math.round((10 / 13) * 100) / 100)
  })
})

describe('periodDayCount', () => {
  const now = new Date(2026, 10, 13)
  test('past full year uses 365/366', () => {
    expect(periodDayCount({ month: null, year: 2024 }, [], now)).toBe(366)
    expect(periodDayCount({ month: null, year: 2025 }, [], now)).toBe(365)
  })
  test('all time spans earliest transaction → today', () => {
    expect(periodDayCount({ month: null, year: null }, [tx('2026-11-01', '1.00')], now)).toBe(13)
  })
})

describe('computePeriodCategoryBreakdown', () => {
  test('aggregates across the whole year', () => {
    const rows = computePeriodCategoryBreakdown(
      [tx('2026-01-01', '30.00', 'Food'), tx('2026-06-01', '10.00', 'Transport'), tx('2025-06-01', '99.00', 'Food')],
      { month: null, year: 2026 },
    )
    expect(rows.map((r) => [r.name, r.total, r.percentage])).toEqual([
      ['Food', 30, 75],
      ['Transport', 10, 25],
    ])
  })
})
