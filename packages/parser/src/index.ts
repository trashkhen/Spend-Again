// Parser package entry point
import { parseWithRegex } from './regex.js'
import { parseWithGemini, waitForGeminiRpmBudget } from './gemini.js'
import { convertToSGD } from './currency.js'
import type { ParseResult } from './regex.js'
import type { Category, SubCategory } from '@spend-again/shared'

export type { ParseResult } from './regex.js'
export { parseWithRegex } from './regex.js'
export { parseWithGemini, buildPrompt, waitForGeminiRpmBudget, parseSpaceWithGemini } from './gemini.js'
export type { ParsedSpaceResult } from './gemini.js'
export { GeminiRateLimitError, OcrRateLimitError, CurrencyConversionError } from '@spend-again/shared'
export { convertToSGD, detectCurrency } from './currency.js'
export type { CurrencyDetection } from './currency.js'

export type LookupResult = { category: Category; subCategory: SubCategory; confidence: number }
export type LookupFn = (itemName: string) => Promise<LookupResult | null>

/**
 * Single conversion point: if a tier reported a non-SGD currency, convert
 * the amount to SGD cents and attach display-only original-amount fields.
 * Applied identically regardless of which tier (1, 2, or 3) resolved the
 * result, so callers never need tier-specific conversion logic.
 */
async function applyCurrencyConversion(result: ParseResult): Promise<ParseResult> {
  const { currency, ...rest } = result

  if (currency === undefined || currency === 'SGD') {
    return result
  }

  const { convertedCents, rate } = await convertToSGD(rest.amount, currency)

  return {
    ...rest,
    amount: convertedCents,
    originalAmount: rest.amount,
    originalCurrency: currency,
    exchangeRate: rate,
  }
}

/**
 * Unified 3-tier expense parser.
 *
 * Tier 1 — Regex: fast, no I/O. Returns a result with tier=1.
 *   - If the result has a category, we're done.
 *   - If the result has an amount but no category, we continue to Tier 2
 *     using the extracted item name.
 *   - If regex returns null (no amount found), we continue to Tier 2
 *     using the raw input string.
 *
 * Tier 2 — Learned mappings (via injected lookupItem): looks up item → category
 *   from past corrections/confirmations. If found, merges with any amount/date
 *   from the Tier 1 partial result.
 *
 * Tier 3 — Gemini LLM: called only when both previous tiers fail to produce
 *   a fully-resolved result.
 *
 * Currency conversion (see applyCurrencyConversion) is applied once, after
 * whichever tier resolves the result — a tier reports amount/currency in the
 * ORIGINAL currency; conversion to SGD cents always happens here, last.
 */
export async function parse(
  input: string,
  opts: { lookupItem: LookupFn },
): Promise<ParseResult | null> {
  // Tier 1: regex — no I/O
  const tier1 = parseWithRegex(input)

  if (tier1 !== null && tier1.category !== undefined) {
    // Fully resolved by regex
    return applyCurrencyConversion(tier1)
  }

  // Tier 2: learned mappings via injected lookup function
  // Use the item extracted by regex (if any) — it's already stripped of
  // amounts, dates, and prepositions, which improves lookup accuracy.
  const itemToLookup = tier1?.item ?? input
  const tier2 = await opts.lookupItem(itemToLookup)

  if (tier2 !== null) {
    // Merge: prefer tier1 amount/date/currency when available; take category from tier2
    const mergedAmount = tier1 !== null && tier1.amount !== 0 ? tier1.amount : 0
    // Guard: don't accept a zero merged amount when the raw input clearly
    // contains a number (e.g. Tier-1 bailed out on a hint-list currency it
    // can't convert) — fall through to Tier-3 instead of silently saving $0.
    if (mergedAmount !== 0 || !/\d/.test(input)) {
      const merged: ParseResult = {
        amount: mergedAmount,
        item: tier1?.item ?? input,
        category: tier2.category,
        subCategory: tier2.subCategory,
        confidence: tier2.confidence,
        tier: 2,
        ...(tier1?.date !== undefined ? { date: tier1.date } : {}),
        ...(tier1?.currency !== undefined ? { currency: tier1.currency } : {}),
      }
      return applyCurrencyConversion(merged)
    }
    // else: fall through to Tier-3 below
  }

  // Tier 3: Gemini LLM — only when tiers 1 and 2 both fail
  await waitForGeminiRpmBudget()
  const tier3 = await parseWithGemini(input)
  if (tier3 === null) {
    return null
  }
  // If Tier-1 confidently detected a currency (convert-list match) but
  // couldn't resolve a category, and Gemini's own re-parse of the raw
  // input didn't report a currency, trust Tier-1's deterministic
  // detection rather than silently treating the amount as SGD.
  if (tier3.currency === undefined && tier1?.currency !== undefined) {
    tier3.currency = tier1.currency
  }
  return applyCurrencyConversion(tier3)
}
