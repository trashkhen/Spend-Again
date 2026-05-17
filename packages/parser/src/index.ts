// Parser package entry point
import { parseWithRegex } from './regex.js'
import { lookupItem } from './learned.js'
import { parseWithGemini } from './gemini.js'

export type { ParseResult } from './regex.js'
export { parseWithRegex } from './regex.js'
export { parseWithGemini, GeminiRateLimitError, buildPrompt } from './gemini.js'
export { lookupItem, saveMapping } from './learned.js'

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
 * Tier 2 — Learned mappings (DB): looks up item → category from past
 *   corrections/confirmations. If found, merges with any amount/date from
 *   the Tier 1 partial result.
 *
 * Tier 3 — Gemini LLM: called only when both previous tiers fail to produce
 *   a fully-resolved result.
 */
export async function parse(input: string): Promise<ReturnType<typeof parseWithRegex>> {
  // Tier 1: regex — no I/O
  const tier1 = parseWithRegex(input)

  if (tier1 !== null && tier1.category !== undefined) {
    // Fully resolved by regex
    return tier1
  }

  // Tier 2: learned mappings
  // Use the item extracted by regex (if any) — it's already stripped of
  // amounts, dates, and prepositions, which improves lookup accuracy.
  const itemToLookup = tier1?.item ?? input
  const tier2 = await lookupItem(itemToLookup)

  if (tier2 !== null) {
    // Merge: prefer tier1 amount/date when available; take category from tier2
    return {
      ...tier2,
      amount: tier1 !== null && tier1.amount !== 0 ? tier1.amount : tier2.amount,
      item: tier1?.item ?? tier2.item,
      ...(tier1?.date !== undefined ? { date: tier1.date } : {}),
    }
  }

  // Tier 3: Gemini LLM — only when tiers 1 and 2 both fail
  return parseWithGemini(input)
}
