/**
 * Parsing for the values typed into the Edit flow (amount and date).
 */

import { parseWalletText } from './ingest.js'

export type EditAmount = { amountCents: number; currency: string }

/**
 * Reads "16.20", "€12", "EUR 12" or "12 eur". The amount may be in any
 * currency; the caller converts it to SGD. Anything else (extra words,
 * refunds, zero) is rejected.
 */
export function parseEditAmount(text: string): EditAmount | null {
  const parsed = parseWalletText(text)
  if (parsed === null) return null
  if (parsed.merchant === '') return { amountCents: parsed.amountCents, currency: parsed.currency }
  // "12 eur": the code follows the number, so it lands in the merchant slot.
  if (parsed.currency === 'SGD' && /^[A-Za-z]{3}$/.test(parsed.merchant)) {
    return { amountCents: parsed.amountCents, currency: parsed.merchant.toUpperCase() }
  }
  return null
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function fmt(d: Date): string {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

/**
 * Reads "today", "yesterday", "DD/MM" or "DD/MM/YYYY" and returns DD/MM/YYYY,
 * or null for junk, impossible dates and dates in the future.
 */
export function parseEditDate(text: string, now: Date = new Date()): string | null {
  const input = text.trim().toLowerCase()
  if (input === 'today') return fmt(now)
  if (input === 'yesterday') {
    const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    return fmt(y)
  }

  const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(input)
  if (m === null) return null
  const day = Number(m[1])
  const month = Number(m[2])
  const year = m[3] !== undefined ? Number(m[3]) : now.getFullYear()

  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (date.getTime() > today.getTime()) return null
  return fmt(date)
}
