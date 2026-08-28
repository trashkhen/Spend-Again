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

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  MYR: 'RM',
  THB: '฿',
  IDR: 'Rp',
  KRW: '₩',
  CNY: '¥',
  RMB: '¥',
  VND: '₫',
  INR: '₹',
  PHP: '₱',
}

/**
 * Format cents in a foreign currency for display, e.g. fmtCurrency(560, 'EUR') → "€5.60".
 * Falls back to "CODE amount" (e.g. "AED 50.00") when no symbol is known for the code.
 */
export function fmtCurrency(cents: number, code: string): string {
  const symbol = CURRENCY_SYMBOLS[code]
  const decimal = centsToDecimalString(cents)
  return symbol !== undefined ? `${symbol}${decimal}` : `${code} ${decimal}`
}
