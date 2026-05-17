import { findMapping, upsertMapping } from '@spend-again/db'
import type { Category, SubCategory } from '@spend-again/shared'
import type { ParseResult } from './regex.js'

/**
 * Looks up a learned mapping for the given item name (case-insensitive).
 * Returns a tier-2 ParseResult if a match is found, otherwise null.
 */
export async function lookupItem(itemName: string): Promise<ParseResult | null> {
  const normalized = itemName.toLowerCase()
  const mapping = await findMapping(normalized)

  if (mapping === null) return null

  return {
    // amount and date are not stored in learned mappings — caller must supply them
    amount: 0,
    item: itemName,
    category: mapping.category,
    subCategory: mapping.subCategory,
    confidence: mapping.confidence,
    tier: 2,
  }
}

/**
 * Persists a category mapping for the given item name (normalized to lowercase).
 * Delegates to upsertMapping, which increments usage_count on conflict.
 */
export async function saveMapping(
  itemName: string,
  category: Category,
  subCategory: SubCategory,
  source: 'regex' | 'gemini' | 'user',
): Promise<void> {
  const normalized = itemName.toLowerCase()
  await upsertMapping(normalized, category, subCategory, source)
}
