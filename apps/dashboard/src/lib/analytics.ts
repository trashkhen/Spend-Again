/**
 * Client-side analytics computations over raw ApiTransaction arrays.
 * All monetary values are computed from the decimal string `amount` field.
 */

import type { ApiTransaction } from './api'

/** Parse decimal amount string to a number */
function parseAmount(amount: string): number {
  return parseFloat(amount)
}

/** Parse YYYY-MM-DD (occurredOn) string to { day, month, year } */
function parseDate(occurredOn: string): { day: number; month: number; year: number } {
  const parts = occurredOn.split('-')
  return {
    year: parseInt(parts[0] ?? '2026', 10),
    month: parseInt(parts[1] ?? '1', 10),
    day: parseInt(parts[2] ?? '1', 10),
  }
}

// ── Monthly spend (last 6 months) ─────────────────────────────────────────────

export type MonthlySpend = {
  label: string // e.g. "Dec 2025"
  total: number // in SGD
}

export type MonthComparison = {
  label: string
  tone: 'up' | 'down' | 'flat'
}

export function previousMonthOf(month: number, year: number): { month: number; year: number } {
  if (month <= 1) return { month: 12, year: year - 1 }
  return { month: month - 1, year }
}

function formatSGDDelta(amount: number): string {
  return `S$${amount.toLocaleString('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function monthShortName(month: number, year: number): string {
  return new Date(year, month - 1, 1).toLocaleString('en-SG', { month: 'short' })
}

export function computeMonthComparison(
  currentTotal: number,
  previousTotal: number,
  previousMonth: number,
  previousYear: number,
): MonthComparison {
  const previousLabel = monthShortName(previousMonth, previousYear)
  const delta = Math.round((currentTotal - previousTotal) * 100) / 100
  if (previousTotal === 0 && currentTotal > 0) {
    return { label: `New vs ${previousLabel}`, tone: 'up' }
  }
  if (delta === 0) {
    return { label: `Same vs ${previousLabel}`, tone: 'flat' }
  }
  const direction = delta > 0 ? '↑' : '↓'
  return {
    label: `${direction} ${formatSGDDelta(Math.abs(delta))} vs ${previousLabel}`,
    tone: delta > 0 ? 'up' : 'down',
  }
}

export function computeMonthlySpend(transactions: ApiTransaction[]): MonthlySpend[] {
  const now = new Date()
  const result: MonthlySpend[] = []

  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const month = d.getMonth() + 1
    const year = d.getFullYear()

    const total = transactions
      .filter((tx) => {
        const p = parseDate(tx.occurredOn)
        return p.month === month && p.year === year
      })
      .reduce((sum, tx) => sum + parseAmount(tx.amount), 0)

    const label = d.toLocaleString('en-SG', { month: 'short', year: 'numeric' })
    result.push({ label, total: Math.round(total * 100) / 100 })
  }

  return result
}

// ── Category breakdown (current month) ────────────────────────────────────────

export type CategorySpend = {
  name: string
  total: number
  percentage: number
  count: number
}

export function computeCategoryBreakdown(
  transactions: ApiTransaction[],
  month?: number,
  year?: number,
): CategorySpend[] {
  const now = new Date()
  const targetMonth = month ?? (now.getMonth() + 1)
  const targetYear = year ?? now.getFullYear()

  const current = transactions.filter((tx) => {
    const p = parseDate(tx.occurredOn)
    return p.month === targetMonth && p.year === targetYear
  })

  const map = new Map<string, number>()
  const countMap = new Map<string, number>()
  for (const tx of current) {
    map.set(tx.category, (map.get(tx.category) ?? 0) + parseAmount(tx.amount))
    countMap.set(tx.category, (countMap.get(tx.category) ?? 0) + 1)
  }

  const grandTotal = Array.from(map.values()).reduce((a, b) => a + b, 0)
  if (grandTotal === 0) return []

  return Array.from(map.entries())
    .map(([name, total]) => ({
      name,
      total: Math.round(total * 100) / 100,
      percentage: Math.round((total / grandTotal) * 1000) / 10,
      count: countMap.get(name) ?? 0,
    }))
    .sort((a, b) => b.total - a.total)
}

// ── Daily trend (current month) ───────────────────────────────────────────────

export type DailySpend = {
  day: number   // day-of-month
  total: number // SGD
}

export function computeDailyTrend(
  transactions: ApiTransaction[],
  month?: number,
  year?: number,
): DailySpend[] {
  const now = new Date()
  const targetMonth = month ?? (now.getMonth() + 1)
  const targetYear = year ?? now.getFullYear()

  const current = transactions.filter((tx) => {
    const p = parseDate(tx.occurredOn)
    return p.month === targetMonth && p.year === targetYear
  })

  const map = new Map<number, number>()
  for (const tx of current) {
    const { day } = parseDate(tx.occurredOn)
    map.set(day, (map.get(day) ?? 0) + parseAmount(tx.amount))
  }

  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate()
  const isCurrentMonth = targetMonth === now.getMonth() + 1 && targetYear === now.getFullYear()
  const upToDay = isCurrentMonth ? now.getDate() : daysInMonth

  const result: DailySpend[] = []
  for (let d = 1; d <= upToDay; d++) {
    result.push({ day: d, total: Math.round((map.get(d) ?? 0) * 100) / 100 })
  }
  return result
}

// ── Summary KPIs (current month) ──────────────────────────────────────────────

export type SpendingSummary = {
  totalThisMonth: number
  averageDaily: number
  topCategory: string | null
  transactionCount: number
}

export function computeSummary(
  transactions: ApiTransaction[],
  month?: number,
  year?: number,
): SpendingSummary {
  const now = new Date()
  const targetMonth = month ?? (now.getMonth() + 1)
  const targetYear = year ?? now.getFullYear()

  const current = transactions.filter((tx) => {
    const p = parseDate(tx.occurredOn)
    return p.month === targetMonth && p.year === targetYear
  })

  const totalThisMonth = current.reduce((sum, tx) => sum + parseAmount(tx.amount), 0)
  const isCurrentMonth = targetMonth === now.getMonth() + 1 && targetYear === now.getFullYear()
  const daysElapsed = isCurrentMonth
    ? now.getDate()
    : new Date(targetYear, targetMonth, 0).getDate()
  const averageDaily = daysElapsed > 0 ? totalThisMonth / daysElapsed : 0

  const catMap = new Map<string, number>()
  for (const tx of current) {
    catMap.set(tx.category, (catMap.get(tx.category) ?? 0) + parseAmount(tx.amount))
  }
  let topCategory: string | null = null
  let topAmount = 0
  for (const [cat, amt] of catMap.entries()) {
    if (amt > topAmount) { topAmount = amt; topCategory = cat }
  }

  return {
    totalThisMonth: Math.round(totalThisMonth * 100) / 100,
    averageDaily: Math.round(averageDaily * 100) / 100,
    topCategory,
    transactionCount: current.length,
  }
}
