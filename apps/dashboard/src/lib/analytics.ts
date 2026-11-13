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
  return computePeriodComparison(currentTotal, previousTotal, monthShortName(previousMonth, previousYear))
}

/** Same as computeMonthComparison but with a caller-supplied label for the previous period (e.g. "2025"). */
export function computePeriodComparison(
  currentTotal: number,
  previousTotal: number,
  previousLabel: string,
): MonthComparison {
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

// ── Period-aware helpers (month / whole year / all time) ──────────────────────

/**
 * A reporting period. `null` means "all" for that dimension:
 *   { month: 11, year: 2026 }   → November 2026
 *   { month: null, year: 2026 } → the whole of 2026
 *   { month: null, year: null } → all time
 */
export type Period = {
  month: number | null
  year: number | null
}

export type PeriodKind = 'month' | 'year' | 'all'

export function periodKind(period: Period): PeriodKind {
  if (period.year === null) return 'all'
  if (period.month === null) return 'year'
  return 'month'
}

/**
 * Builds a Period from the dashboard's string filters ('' = all).
 * A month without a year means that month of the current year, mirroring the API.
 */
export function periodFromFilters(month: string, year: string, now: Date = new Date()): Period {
  const m = parseInt(month, 10)
  const y = parseInt(year, 10)
  const parsedMonth = Number.isFinite(m) && m >= 1 && m <= 12 ? m : null
  const parsedYear = Number.isFinite(y) ? y : null
  if (parsedMonth !== null && parsedYear === null) {
    return { month: parsedMonth, year: now.getFullYear() }
  }
  return { month: parsedYear === null ? null : parsedMonth, year: parsedYear }
}

export function periodLabel(period: Period): string {
  const kind = periodKind(period)
  if (kind === 'all') return 'All time'
  if (kind === 'year') return String(period.year)
  return new Date(period.year ?? 0, (period.month ?? 1) - 1, 1)
    .toLocaleString('en-SG', { month: 'long', year: 'numeric' })
}

/** The period immediately before this one, or null for all time. */
export function previousPeriodOf(period: Period): Period | null {
  const kind = periodKind(period)
  if (kind === 'all' || period.year === null) return null
  if (kind === 'year') return { month: null, year: period.year - 1 }
  const prev = previousMonthOf(period.month ?? 1, period.year)
  return { month: prev.month, year: prev.year }
}

/** Short label used in comparison badges: "Oct" for months, "2025" for years. */
export function periodShortLabel(period: Period): string {
  if (period.year === null) return 'all time'
  if (period.month === null) return String(period.year)
  return monthShortName(period.month, period.year)
}

export function isInPeriod(occurredOn: string, period: Period): boolean {
  const p = parseDate(occurredOn)
  if (period.year !== null && p.year !== period.year) return false
  if (period.month !== null && p.month !== period.month) return false
  return true
}

export function filterByPeriod(transactions: ApiTransaction[], period: Period): ApiTransaction[] {
  return transactions.filter((tx) => isInPeriod(tx.occurredOn, period))
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 1)
  return Math.floor((d.getTime() - start.getTime()) / 86_400_000) + 1
}

/**
 * Number of days the period's spending should be averaged over.
 * The in-progress month/year only counts days elapsed so far; all-time spans
 * from the earliest transaction to today.
 */
export function periodDayCount(
  period: Period,
  transactions: ApiTransaction[],
  now: Date = new Date(),
): number {
  const kind = periodKind(period)
  if (kind === 'month' && period.year !== null && period.month !== null) {
    const isCurrent = period.month === now.getMonth() + 1 && period.year === now.getFullYear()
    return isCurrent ? now.getDate() : new Date(period.year, period.month, 0).getDate()
  }
  if (kind === 'year' && period.year !== null) {
    if (period.year === now.getFullYear()) return dayOfYear(now)
    return isLeapYear(period.year) ? 366 : 365
  }
  // all time
  let earliest: Date | null = null
  for (const tx of transactions) {
    const p = parseDate(tx.occurredOn)
    const d = new Date(p.year, p.month - 1, p.day)
    if (earliest === null || d < earliest) earliest = d
  }
  if (earliest === null) return 0
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.max(1, Math.round((today.getTime() - earliest.getTime()) / 86_400_000) + 1)
}

export type PeriodSummary = {
  total: number
  averageDaily: number
  topCategory: string | null
  transactionCount: number
}

export function computePeriodSummary(
  transactions: ApiTransaction[],
  period: Period,
  now: Date = new Date(),
): PeriodSummary {
  const current = filterByPeriod(transactions, period)
  const total = current.reduce((sum, tx) => sum + parseAmount(tx.amount), 0)
  const days = periodDayCount(period, current, now)

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
    total: Math.round(total * 100) / 100,
    averageDaily: days > 0 ? Math.round((total / days) * 100) / 100 : 0,
    topCategory,
    transactionCount: current.length,
  }
}

export function computePeriodCategoryBreakdown(
  transactions: ApiTransaction[],
  period: Period,
): CategorySpend[] {
  const current = filterByPeriod(transactions, period)
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

/** Spend per calendar month of a year (Jan–Dec), in SGD. */
export function computeMonthTotalsForYear(
  transactions: ApiTransaction[],
  year: number,
): { month: number; label: string; total: number }[] {
  const totals = new Array<number>(12).fill(0)
  for (const tx of transactions) {
    const p = parseDate(tx.occurredOn)
    if (p.year !== year) continue
    totals[p.month - 1] = (totals[p.month - 1] ?? 0) + parseAmount(tx.amount)
  }
  return totals.map((total, i) => ({
    month: i + 1,
    label: new Date(year, i, 1).toLocaleString('en-SG', { month: 'short' }),
    total: Math.round(total * 100) / 100,
  }))
}

/** Spend per weekday (Mon → Sun) across the given transactions, in SGD. */
export function computeWeekdaySpend(
  transactions: ApiTransaction[],
): { day: string; total: number; count: number }[] {
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const totals = new Array<number>(7).fill(0)
  const counts = new Array<number>(7).fill(0)
  for (const tx of transactions) {
    const p = parseDate(tx.occurredOn)
    // JS getDay: 0 = Sunday → shift so Monday = 0
    const idx = (new Date(p.year, p.month - 1, p.day).getDay() + 6) % 7
    totals[idx] = (totals[idx] ?? 0) + parseAmount(tx.amount)
    counts[idx] = (counts[idx] ?? 0) + 1
  }
  return names.map((day, i) => ({
    day,
    total: Math.round((totals[i] ?? 0) * 100) / 100,
    count: counts[i] ?? 0,
  }))
}

/** Largest individual transactions, biggest first. */
export function topTransactions(transactions: ApiTransaction[], n: number): ApiTransaction[] {
  return [...transactions]
    .sort((a, b) => parseAmount(b.amount) - parseAmount(a.amount))
    .slice(0, n)
}

/** Running total by day of month — used for the "pace vs budget" chart. */
export function computeCumulativeDaily(
  transactions: ApiTransaction[],
  month: number,
  year: number,
  now: Date = new Date(),
): { day: number; total: number; cumulative: number }[] {
  // computeDailyTrend uses the real clock; pass through by filtering manually to honour `now`.
  const map = new Map<number, number>()
  for (const tx of transactions) {
    const p = parseDate(tx.occurredOn)
    if (p.month !== month || p.year !== year) continue
    map.set(p.day, (map.get(p.day) ?? 0) + parseAmount(tx.amount))
  }
  const daysInMonth = new Date(year, month, 0).getDate()
  const isCurrent = month === now.getMonth() + 1 && year === now.getFullYear()
  const upToDay = isCurrent ? now.getDate() : daysInMonth
  const result: { day: number; total: number; cumulative: number }[] = []
  let running = 0
  for (let d = 1; d <= upToDay; d++) {
    const total = map.get(d) ?? 0
    running += total
    result.push({ day: d, total: Math.round(total * 100) / 100, cumulative: Math.round(running * 100) / 100 })
  }
  return result
}
