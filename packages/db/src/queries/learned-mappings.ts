import { eq, sql } from 'drizzle-orm'
import type { Category, SubCategory } from '@spend-again/shared'
import { db } from '../client.js'
import { learnedMappings } from '../schema.js'

export type MappingResult = {
  category: Category
  subCategory: SubCategory
  confidence: number
}

/**
 * Looks up a learned mapping by normalized (lowercase) item name.
 * Returns null when no matching row is found.
 */
export async function findMapping(itemName: string): Promise<MappingResult | null> {
  const normalized = itemName.toLowerCase()

  const rows = await db
    .select({
      category: learnedMappings.category,
      subCategory: learnedMappings.subCategory,
      confidence: learnedMappings.confidence,
    })
    .from(learnedMappings)
    .where(eq(learnedMappings.itemName, normalized))
    .limit(1)

  const row = rows[0]
  if (row === undefined) return null

  return {
    category: row.category as Category,
    subCategory: row.subCategory as SubCategory,
    confidence: Number(row.confidence),
  }
}

/**
 * Inserts a new learned mapping, or increments usage_count + refreshes
 * updated_at if a row with the same normalized item name already exists.
 */
export async function upsertMapping(
  itemName: string,
  category: Category,
  subCategory: SubCategory,
  source: 'regex' | 'gemini' | 'user',
  confidence: number = 0.5,
): Promise<void> {
  const normalized = itemName.toLowerCase()

  await db
    .insert(learnedMappings)
    .values({
      itemName: normalized,
      category,
      subCategory,
      source,
      confidence: String(confidence),
    })
    .onConflictDoUpdate({
      target: learnedMappings.itemName,
      set: {
        usageCount: sql`${learnedMappings.usageCount} + 1`,
        updatedAt: sql`now()`,
      },
    })
}
