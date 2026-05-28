import type { Category } from './categories.js'

export const CATEGORY_EMOJI: Record<Category, string> = {
  Food: '\u{1F35C}',
  Transport: '\u{1F697}',
  Groceries: '\u{1F6D2}',
  Shopping: '\u{1F6CD}',
  Entertainment: '\u{1F3AE}',
  Health: '\u{1F48A}',
  Education: '\u{1F4DA}',
  Travel: '\u{2708}',
  Utilities: '\u{1F4A1}',
  Finance: '\u{1F4B3}',
  Housing: '\u{1F3E0}',
  Other: '\u{1F4B0}',
}

export function emojiFor(category: string | undefined): string {
  if (!category) return CATEGORY_EMOJI.Other
  return CATEGORY_EMOJI[category as Category] ?? CATEGORY_EMOJI.Other
}
