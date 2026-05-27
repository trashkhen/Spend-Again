/** Convert DD/MM/YYYY → YYYY-MM-DD. Throws on malformed input. */
export function ddmmyyyyToIso(date: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date)
  if (!m) throw new Error(`Invalid DD/MM/YYYY date: "${date}"`)
  return `${m[3]}-${m[2]}-${m[1]}`
}
