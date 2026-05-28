export function centsToDecimalString(cents: number): string {
  return (cents / 100).toFixed(2)
}

export function parseCents(raw: string): number {
  const negative = raw.startsWith('-')
  const body = negative ? raw.slice(1) : raw
  const dot = body.indexOf('.')
  const magnitude =
    dot === -1
      ? parseInt(body, 10) * 100
      : parseInt(body.slice(0, dot) || '0', 10) * 100 +
        parseInt(body.slice(dot + 1).padEnd(2, '0').slice(0, 2), 10)
  return negative ? -magnitude : magnitude
}

export function amountToCents(decimal: string): number {
  const n = Number.parseFloat(decimal)
  return Math.round(n * 100)
}

export function fmtSGD(cents: number): string {
  return `S$${centsToDecimalString(cents)}`
}
