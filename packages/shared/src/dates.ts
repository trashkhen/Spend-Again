/** Convert DD/MM/YYYY → YYYY-MM-DD. Throws on malformed input. */
export function ddmmyyyyToIso(date: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date)
  if (!m) throw new Error(`Invalid DD/MM/YYYY date: "${date}"`)
  return `${m[3]}-${m[2]}-${m[1]}`
}

export function getTodayDDMMYYYY(): string {
  const now = new Date()
  return `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()}`
}

export function getYesterdayDDMMYYYY(): string {
  const now = new Date()
  now.setDate(now.getDate() - 1)
  return `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()}`
}

export function parseDDMMYYYY(s: string): Date | null {
  const parts = s.split('/')
  if (parts.length !== 3) return null
  const [dd, mm, yyyy] = parts
  if (!dd || !mm || !yyyy) return null
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd))
}

export function fmtShortDate(s: string): string {
  const parts = s.split('/')
  if (parts.length !== 3) return s
  return `${parts[0]}/${parts[1]}`
}

/**
 * Parse a YYYY-MM-DD ISO date string as local midnight (not UTC midnight).
 * Matches the behaviour of parseDDMMYYYY so date comparisons are timezone-safe.
 */
export function parseYYYYMMDD(date: string): Date | null {
  const parts = date.split('-')
  if (parts.length !== 3) return null
  const [yyyy, mm, dd] = parts
  if (!yyyy || !mm || !dd) return null
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd))
}

/**
 * Convert a YYYY-MM-DD occurredOn value to DD/MM display format.
 * e.g. "2026-05-13" → "13/05"
 */
export function occurredOnToDisplay(occurredOn: string): string {
  const [, mm, dd] = occurredOn.split('-')
  return `${dd ?? ''}/${mm ?? ''}`
}

/**
 * Convert a YYYY-MM-DD occurredOn value to DD/MM/YYYY display format.
 * e.g. "2026-05-13" → "13/05/2026"
 */
export function occurredOnToFullDisplay(occurredOn: string): string {
  const [yyyy, mm, dd] = occurredOn.split('-')
  return `${dd ?? ''}/${mm ?? ''}/${yyyy ?? ''}`
}

/** Returns [startIso, endIso) ISO date strings for a given YYYY-MM month. */
export function monthRange(yearStr: string, monthStr: string): { startIso: string; endIso: string } {
  const y = Number(yearStr)
  const m = Number(monthStr)
  const start = new Date(Date.UTC(y, m - 1, 1))
  const end = new Date(Date.UTC(y, m, 1))
  return {
    startIso: start.toISOString().slice(0, 10),
    endIso: end.toISOString().slice(0, 10),
  }
}
