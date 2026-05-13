import { SG_ITEM_MAP } from '@spend-again/shared'
import type { Category, SubCategory } from '@spend-again/shared'
import type { ParseResult } from './regex.js'

// ---------------------------------------------------------------------------
// Amount helpers
// ---------------------------------------------------------------------------

/**
 * Convert a decimal-string dollar amount (e.g. "25.00", "8.5") to integer cents.
 */
function parseCents(raw: string): number {
  const dotIndex = raw.indexOf('.')
  if (dotIndex === -1) {
    return parseInt(raw, 10) * 100
  }
  const intPart = raw.slice(0, dotIndex)
  const decPart = raw.slice(dotIndex + 1).padEnd(2, '0').slice(0, 2)
  return parseInt(intPart, 10) * 100 + parseInt(decPart, 10)
}

// ---------------------------------------------------------------------------
// SG_ITEM_MAP lookup
// ---------------------------------------------------------------------------

function lookupMerchant(
  merchant: string,
): { category: Category; subCategory: SubCategory } | undefined {
  const normalized = merchant.toLowerCase().trim()

  // Exact match first
  const exact = SG_ITEM_MAP[normalized]
  if (exact !== undefined) return exact

  // Substring match — prefer longer keys (more specific)
  const sortedKeys = Object.keys(SG_ITEM_MAP).sort((a, b) => b.length - a.length)
  for (const key of sortedKeys) {
    if (normalized.includes(key)) {
      const entry = SG_ITEM_MAP[key]
      if (entry !== undefined) return entry
    }
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/** Parse a DD MMM YYYY or DD/MM/YYYY date from SMS text and return DD/MM/YYYY. */
const MONTH_MAP: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

/** Attempt to extract a date from an SMS string, returning DD/MM/YYYY or undefined. */
function extractSMSDate(input: string): string | undefined {
  // DD/MM/YYYY
  const slashMatch = /\b(\d{2}\/\d{2}\/\d{4})\b/.exec(input)
  if (slashMatch !== null) return slashMatch[1]

  // "on DD MMM YYYY" or "on DD MMM" (e.g. "on 12 May 2026", "on 12 May")
  const longMatch = /\bon\s+(\d{1,2})\s+([A-Za-z]{3,9})(?:\s+(\d{4}))?\b/.exec(input)
  if (longMatch !== null) {
    const day = longMatch[1]!.padStart(2, '0')
    const monthAbbr = longMatch[2]!.slice(0, 3).toLowerCase()
    const month = MONTH_MAP[monthAbbr]
    if (month !== undefined) {
      const year = longMatch[3] ?? new Date().getFullYear().toString()
      return `${day}/${month}/${year}`
    }
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Bank-specific SMS pattern definitions
// ---------------------------------------------------------------------------

/**
 * A pattern captures amount (as dollar string) and merchant (trimmed string)
 * from a raw SMS body. Returns null when the pattern does not match.
 */
type SMSMatch = { amountStr: string; merchant: string; date?: string }

function tryDBS(input: string): SMSMatch | null {
  // "DBS: SGD 25.00 was charged to Card ending 1234 at GRAB on 12 May 2026"
  const pattern1 =
    /^DBS:\s*SGD\s*([\d.]+)\s+was charged to (?:Card|card) ending \d{4} at ([^.]+?)(?:\s+on\s+(.+))?\.?\s*$/i
  const m1 = pattern1.exec(input)
  if (m1 !== null) {
    const merchant = (m1[2] ?? '').trim()
    const dateRaw = m1[3] !== undefined ? m1[3].trim() : undefined
    const date = dateRaw !== undefined ? extractSMSDate(`on ${dateRaw}`) : undefined
    return { amountStr: m1[1]!, merchant, ...(date !== undefined ? { date } : {}) }
  }

  // "DBS Multiplier: SGD 25.00 spent at GRAB"
  const pattern2 = /^DBS\s+\w+:\s*SGD\s*([\d.]+)\s+spent at (.+?)\.?\s*$/i
  const m2 = pattern2.exec(input)
  if (m2 !== null) {
    return { amountStr: m2[1]!, merchant: (m2[2] ?? '').trim() }
  }

  return null
}

function tryOCBC(input: string): SMSMatch | null {
  // "OCBC: S$25.00 charged to VISA ending 1234 at GRAB"
  const pattern1 =
    /^OCBC:\s*S\$([\d.]+)\s+charged to \S+ ending \d{4} at (.+?)\.?\s*$/i
  const m1 = pattern1.exec(input)
  if (m1 !== null) {
    return { amountStr: m1[1]!, merchant: (m1[2] ?? '').trim() }
  }

  // "OCBC Alert: Card ending 1234 was used for SGD25.00 at GRAB"
  const pattern2 =
    /^OCBC\s+Alert:\s*Card ending \d{4} was used for SGD([\d.]+)\s+at (.+?)\.?\s*$/i
  const m2 = pattern2.exec(input)
  if (m2 !== null) {
    return { amountStr: m2[1]!, merchant: (m2[2] ?? '').trim() }
  }

  return null
}

function tryUOB(input: string): SMSMatch | null {
  // "UOB: Your card ending 1234 has been charged SGD25.00 at GRAB"
  const pattern1 =
    /^UOB:\s*Your card ending \d{4} has been charged SGD([\d.]+)\s+at (.+?)\.?\s*$/i
  const m1 = pattern1.exec(input)
  if (m1 !== null) {
    return { amountStr: m1[1]!, merchant: (m1[2] ?? '').trim() }
  }

  // "UOB: $SGD 25.00 debited from your account for GRAB"
  const pattern2 =
    /^UOB:\s*\$SGD\s+([\d.]+)\s+debited from your \S+ for (.+?)\.?\s*$/i
  const m2 = pattern2.exec(input)
  if (m2 !== null) {
    return { amountStr: m2[1]!, merchant: (m2[2] ?? '').trim() }
  }

  return null
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a bank-forwarded SMS string into a ParseResult.
 *
 * Tries DBS, OCBC, and UOB patterns in order. Returns null for non-financial
 * messages (OTPs, marketing, etc.).
 *
 * Note: ParseResult does not carry a `source` field. Callers that persist
 * expenses to the database should tag the source as "sms" separately.
 */
export function parseFromSMS(input: string): ParseResult | null {
  const trimmed = input.trim()
  if (trimmed.length === 0) return null

  const matched = tryDBS(trimmed) ?? tryOCBC(trimmed) ?? tryUOB(trimmed)
  if (matched === null) return null

  const amount = parseCents(matched.amountStr)
  const merchant = matched.merchant
  const mapping = lookupMerchant(merchant)

  const result: ParseResult = {
    amount,
    item: merchant,
    confidence: 0.95,
    tier: 1,
  }

  if (matched.date !== undefined) {
    result.date = matched.date
  }

  if (mapping !== undefined) {
    result.category = mapping.category
    result.subCategory = mapping.subCategory
  }

  return result
}
