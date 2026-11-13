import { daysBetween, fmtShortDate, isoToLocalDate } from './format'
import type { SpaceWithTotal } from './api'

export type SpaceTimeline = {
  /** Short human label, e.g. "Day 3 of 8 · 5 days left". */
  label: string
  phase: 'upcoming' | 'ongoing' | 'ended' | 'open'
  daysElapsed: number | null
  daysLeft: number | null
  totalDays: number | null
  range: string | null
}

export function spaceTimeline(space: Pick<SpaceWithTotal, 'startDate' | 'endDate'>, now: Date = new Date()): SpaceTimeline {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const { startDate, endDate } = space

  if (!startDate) {
    return { label: 'No dates set', phase: 'open', daysElapsed: null, daysLeft: null, totalDays: null, range: null }
  }

  const start = isoToLocalDate(startDate)
  const sameYear = !endDate || startDate.slice(0, 4) === endDate.slice(0, 4)
  const range = endDate
    ? `${fmtShortDate(startDate, !sameYear)} – ${fmtShortDate(endDate, true)}`
    : `From ${fmtShortDate(startDate, true)}`

  if (today < start) {
    const n = daysBetween(today, start)
    return { label: `Starts in ${n} day${n === 1 ? '' : 's'}`, phase: 'upcoming', daysElapsed: 0, daysLeft: null, totalDays: null, range }
  }

  if (!endDate) {
    const elapsed = daysBetween(start, today) + 1
    return { label: `Day ${elapsed}`, phase: 'ongoing', daysElapsed: elapsed, daysLeft: null, totalDays: null, range }
  }

  const end = isoToLocalDate(endDate)
  const totalDays = daysBetween(start, end) + 1
  if (today > end) {
    return { label: `Ended ${fmtShortDate(endDate)}`, phase: 'ended', daysElapsed: totalDays, daysLeft: 0, totalDays, range }
  }
  const elapsed = daysBetween(start, today) + 1
  const left = totalDays - elapsed
  return {
    label: left === 0 ? `Last day · day ${elapsed} of ${totalDays}` : `Day ${elapsed} of ${totalDays} · ${left} day${left === 1 ? '' : 's'} left`,
    phase: 'ongoing',
    daysElapsed: elapsed,
    daysLeft: left,
    totalDays,
    range,
  }
}

export type BudgetState = {
  pct: number          // may exceed 100
  remaining: number    // SGD, negative when over
  tone: 'ok' | 'warn' | 'over'
}

export function spaceBudgetState(space: Pick<SpaceWithTotal, 'budgetCents' | 'spentCents'>): BudgetState | null {
  if (space.budgetCents == null || space.budgetCents <= 0) return null
  const pct = Math.round((space.spentCents / space.budgetCents) * 100)
  return {
    pct,
    remaining: (space.budgetCents - space.spentCents) / 100,
    tone: pct > 100 ? 'over' : pct >= 85 ? 'warn' : 'ok',
  }
}
