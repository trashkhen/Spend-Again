/** Shared display formatters (SGD amounts, short dates). */

export function fmtSGD(amount: number): string {
  return `S$${amount.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Compact axis label: S$950, S$1.2k, S$14k. */
export function fmtSGDCompact(amount: number): string {
  const abs = Math.abs(amount)
  if (abs >= 10_000) return `S$${Math.round(amount / 1000)}k`
  if (abs >= 1_000) return `S$${(amount / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return `S$${Math.round(amount)}`
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** YYYY-MM-DD → "12 Nov" (or "12 Nov 2025" when withYear). */
export function fmtShortDate(iso: string, withYear = false): string {
  const [y, m, d] = iso.split('-')
  const month = MONTHS_SHORT[parseInt(m ?? '1', 10) - 1] ?? ''
  const day = parseInt(d ?? '1', 10)
  return withYear ? `${day} ${month} ${y ?? ''}` : `${day} ${month}`
}

/** YYYY-MM-DD → local Date at midnight. */
export function isoToLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map((p) => parseInt(p, 10))
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

/** Whole days between two local dates (b - a). */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}
