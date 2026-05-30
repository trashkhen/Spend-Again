import { CATEGORY_MAP } from '@spend-again/shared'
import type { Category, SubCategory } from '@spend-again/shared'

export type StructuredEdit = {
  amountCents: number
  item: string
  category: Category
  subCategory: SubCategory
}

const CATEGORIES = Object.keys(CATEGORY_MAP) as Category[]

function matchCategory(token: string): Category | undefined {
  return CATEGORIES.find((c) => c.toLowerCase() === token.toLowerCase())
}

export function parseStructuredEdit(input: string): StructuredEdit | null {
  const tokens = input.trim().split(/\s+/)
  if (tokens.length < 3) return null

  const price = parseFloat(tokens[0] ?? '')
  if (isNaN(price) || price <= 0) return null
  const amountCents = Math.round(price * 100)

  // Try pattern: [price] [...item] [category] [subCategory]
  const last = tokens[tokens.length - 1] ?? ''
  const secondLast = tokens[tokens.length - 2] ?? ''

  const catFromSecondLast = matchCategory(secondLast)
  if (catFromSecondLast !== undefined && tokens.length >= 4) {
    // last token is sub-category
    const itemTokens = tokens.slice(1, tokens.length - 2)
    if (itemTokens.length === 0) return null
    return {
      amountCents,
      item: itemTokens.join(' '),
      category: catFromSecondLast,
      subCategory: last as SubCategory,
    }
  }

  // Try pattern: [price] [...item] [category]
  const catFromLast = matchCategory(last)
  if (catFromLast !== undefined && tokens.length >= 3) {
    const itemTokens = tokens.slice(1, tokens.length - 1)
    if (itemTokens.length === 0) return null
    const defaultSub = (CATEGORY_MAP[catFromLast][0] ?? 'Other') as SubCategory
    return {
      amountCents,
      item: itemTokens.join(' '),
      category: catFromLast,
      subCategory: defaultSub,
    }
  }

  return null
}
