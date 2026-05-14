/**
 * Client-side analytics computations over raw ApiTransaction arrays.
 * All monetary values are computed from the decimal string `amount` field.
 */

import type { ApiTransaction } from './api'

/** Parse decimal amount string to a number */
function parseAmount(amount: string): number {
  return parseFloat(amount)
}

/** Parse DD/MM/YYYY string to { day, month, year } */
function parseDate(date: string): { day: number; month: number; year: number } {
  const parts = date.split('/')
  return {
    day: parseInt(parts[0] ?? '1', 10),
    month: parseInt(parts[1] ?? '1', 10),
    year: parseInt(parts[2] ?? '2026', 10),
  }
}

// ── Monthly spend (last 6 months) ─────────────────────────────────────────────

export type MonthlySpend = {
  label: string // e.g. "Dec 2025"
  total: number // in SGD
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
        const p = parseDate(tx.date)
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
}

export function computeCategoryBreakdown(transactions: ApiTransaction[]): CategorySpend[] {
  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  const current = transactions.filter((tx) => {
    const p = parseDate(tx.date)
    return p.month === currentMonth && p.year === currentYear
  })

  const map = new Map<string, number>()
  for (const tx of current) {
    map.set(tx.category, (map.get(tx.category) ?? 0) + parseAmount(tx.amount))
  }

  const grandTotal = Array.from(map.values()).reduce((a, b) => a + b, 0)
  if (grandTotal === 0) return []

  return Array.from(map.entries())
    .map(([name, total]) => ({
      name,
      total: Math.round(total * 100) / 100,
      percentage: Math.round((total / grandTotal) * 1000) / 10,
    }))
    .sort((a, b) => b.total - a.total)
}

// ── Daily trend (current month) ───────────────────────────────────────────────

export type DailySpend = {
  day: number   // day-of-month
  total: number // SGD
}

export function computeDailyTrend(transactions: ApiTransaction[]): DailySpend[] {
  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  const current = transactions.filter((tx) => {
    const p = parseDate(tx.date)
    return p.month === currentMonth && p.year === currentYear
  })

  const map = new Map<number, number>()
  for (const tx of current) {
    const { day } = parseDate(tx.date)
    map.set(day, (map.get(day) ?? 0) + parseAmount(tx.amount))
  }

  // Fill all days in the month up to today
  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate()
  const upToDay = now.getDate()
  const result: DailySpend[] = []
  for (let d = 1; d <= Math.min(daysInMonth, upToDay); d++) {
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

export function computeSummary(transactions: ApiTransaction[]): SpendingSummary {
  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  const current = transactions.filter((tx) => {
    const p = parseDate(tx.date)
    return p.month === currentMonth && p.year === currentYear
  })

  const totalThisMonth = current.reduce((sum, tx) => sum + parseAmount(tx.amount), 0)
  const daysElapsed = now.getDate()
  const averageDaily = daysElapsed > 0 ? totalThisMonth / daysElapsed : 0

  const catMap = new Map<string, number>()
  for (const tx of current) {
    catMap.set(tx.category, (catMap.get(tx.category) ?? 0) + parseAmount(tx.amount))
  }
  let topCategory: string | null = null
  let topAmount = 0
  for (const [cat, amt] of catMap.entries()) {
    if (amt > topAmount) {
      topAmount = amt
      topCategory = cat
    }
  }

  return {
    totalThisMonth: Math.round(totalThisMonth * 100) / 100,
    averageDaily: Math.round(averageDaily * 100) / 100,
    topCategory,
    transactionCount: current.length,
  }
}
