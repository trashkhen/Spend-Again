import { SG_ITEM_MAP, getTodayDDMMYYYY, getYesterdayDDMMYYYY, parseCents } from '@spend-again/shared'
import type { Category, SubCategory } from '@spend-again/shared'

export type ParseResult = {
  amount: number // integer cents
  item: string
  description?: string // original input minus price, set by caller
  category?: Category
  subCategory?: SubCategory
  date?: string // DD/MM/YYYY
  confidence: number // 0–1
  tier: 1 | 2 | 3
}

// Matches currency prefix amounts: $10, S$10, SGD 10, SGD10, $10.50, etc.
// Also matches bare numbers: 10, 10.50 (no prefix)
const AMOUNT_REGEX =
  /(?:S\$|SGD\s*|\$)\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:SGD|sgd)/i

// Bare number pattern — only used as fallback when no currency prefix found
const BARE_AMOUNT_REGEX = /^(\d+(?:\.\d{1,2})?)(?:\s|$)/

// DD/MM/YYYY date pattern
const DATE_REGEX = /\b(\d{2}\/\d{2}\/\d{4})\b/

// Relative date keywords
const YESTERDAY_REGEX = /\byesterday\b/i
const TODAY_REGEX = /\btoday\b/i

// Natural language date patterns: "5 June", "5th Jun", "June 5", "Jun 5th", etc.
const DAY_MONTH_REGEX = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i
const MONTH_DAY_REGEX = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
}

// Prepositions/connectors to strip when extracting item text
const LEADING_PREPOSITIONS = /^(?:for|on|at|from)\s+/i


function lookupItem(
  itemText: string,
): { category: Category; subCategory: SubCategory } | undefined {
  const normalized = itemText.toLowerCase().trim()

  // Exact match first
  const exact = SG_ITEM_MAP[normalized]
  if (exact !== undefined) {
    return exact
  }

  // Check if any key is contained within the item text (multi-word keys like "cold storage")
  // Sort by key length descending to prefer longer (more specific) matches
  const sortedKeys = Object.keys(SG_ITEM_MAP).sort((a, b) => b.length - a.length)
  for (const key of sortedKeys) {
    if (normalized.includes(key)) {
      const entry = SG_ITEM_MAP[key]
      if (entry !== undefined) {
        return entry
      }
    }
  }

  return undefined
}

function naturalDateToDDMMYYYY(day: number, monthStr: string): string | undefined {
  const month = MONTH_NAMES[monthStr.toLowerCase()]
  if (month === undefined || day < 1 || day > 31) return undefined
  const year = new Date().getFullYear()
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`
}

function extractDate(input: string): string | undefined {
  const dateMatch = DATE_REGEX.exec(input)
  if (dateMatch !== null) {
    return dateMatch[1]
  }
  if (YESTERDAY_REGEX.test(input)) {
    return getYesterdayDDMMYYYY()
  }
  if (TODAY_REGEX.test(input)) {
    return getTodayDDMMYYYY()
  }
  // Natural language: "5 June", "5th Jun", etc.
  const dayMonthMatch = DAY_MONTH_REGEX.exec(input)
  if (dayMonthMatch !== null && dayMonthMatch[1] !== undefined && dayMonthMatch[2] !== undefined) {
    const result = naturalDateToDDMMYYYY(parseInt(dayMonthMatch[1], 10), dayMonthMatch[2])
    if (result !== undefined) return result
  }
  // Natural language: "June 5", "Jun 5th", etc.
  const monthDayMatch = MONTH_DAY_REGEX.exec(input)
  if (monthDayMatch !== null && monthDayMatch[1] !== undefined && monthDayMatch[2] !== undefined) {
    const result = naturalDateToDDMMYYYY(parseInt(monthDayMatch[2], 10), monthDayMatch[1])
    if (result !== undefined) return result
  }
  return undefined
}

export function parseWithRegex(input: string): ParseResult | null {
  if (input.trim().length === 0) {
    return null
  }

  let amountCents: number | null = null
  let remainingText = input.trim()

  // Try currency-prefixed / suffixed amount first
  const prefixMatch = AMOUNT_REGEX.exec(remainingText)
  if (prefixMatch !== null) {
    // Group 1 = prefix form ($10, S$10, SGD10), group 2 = suffix form (10 SGD)
    const rawAmount = prefixMatch[1] ?? prefixMatch[2]
    if (rawAmount !== undefined) {
      amountCents = parseCents(rawAmount)
      // Remove the matched amount token from the remaining text
      remainingText =
        remainingText.slice(0, prefixMatch.index) +
        remainingText.slice(prefixMatch.index + prefixMatch[0].length)
      remainingText = remainingText.trim()
    }
  } else {
    // Fall back to bare number at the start of the string
    const bareMatch = BARE_AMOUNT_REGEX.exec(remainingText)
    if (bareMatch !== null && bareMatch[1] !== undefined) {
      amountCents = parseCents(bareMatch[1])
      remainingText = remainingText.slice(bareMatch[0].length).trim()
    }
  }

  if (amountCents === null) {
    return null
  }

  // Extract date keywords / patterns from remaining text, then remove them
  const date = extractDate(remainingText)
  if (date !== undefined) {
    remainingText = remainingText
      .replace(DATE_REGEX, '')
      .replace(YESTERDAY_REGEX, '')
      .replace(TODAY_REGEX, '')
      .replace(DAY_MONTH_REGEX, '')
      .replace(MONTH_DAY_REGEX, '')
      .trim()
  }

  // Strip leading prepositions (e.g. "for lunch" → "lunch", "at NTUC" → "NTUC")
  remainingText = remainingText.replace(LEADING_PREPOSITIONS, '').trim()

  // Clean up extra whitespace
  remainingText = remainingText.replace(/\s{2,}/g, ' ').trim()

  const item = remainingText.length > 0 ? remainingText : input.trim()

  // SG_ITEM_MAP lookup for category/subCategory
  const mapping = lookupItem(item)

  const result: ParseResult = {
    amount: amountCents,
    item,
    confidence: mapping !== undefined ? 0.9 : 0.7,
    tier: 1,
  }

  if (date !== undefined) {
    result.date = date
  }

  if (mapping !== undefined) {
    result.category = mapping.category
    result.subCategory = mapping.subCategory
  }

  return result
}
