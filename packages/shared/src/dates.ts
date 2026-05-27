/** Convert DD/MM/YYYY → YYYY-MM-DD. Throws on malformed input. */
export function ddmmyyyyToIso(date: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date)
  if (!m) throw new Error(`Invalid DD/MM/YYYY date: "${date}"`)
  return `${m[3]}-${m[2]}-${m[1]}`
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
