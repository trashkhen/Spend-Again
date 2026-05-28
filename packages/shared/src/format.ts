export function centsToDecimalString(cents: number): string {
  return (cents / 100).toFixed(2)
}

export function parseCents(raw: string): number {
  const dot = raw.indexOf('.')
  if (dot === -1) return parseInt(raw, 10) * 100
  const int = raw.slice(0, dot)
  const dec = raw.slice(dot + 1).padEnd(2, '0').slice(0, 2)
  return parseInt(int, 10) * 100 + parseInt(dec, 10)
}

export function amountToCents(decimal: string): number {
  const n = Number.parseFloat(decimal)
  return Math.round(n * 100)
}

export function fmtSGD(cents: number): string {
  return `S$${centsToDecimalString(cents)}`
}
