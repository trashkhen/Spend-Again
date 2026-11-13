import { InlineKeyboard } from 'grammy'

/**
 * Buttons under an auto-logged expense. Edit reuses the existing
 * `edit_select:` flow; Delete is handled by the autolog handler.
 */
export function buildAutologKeyboard(txId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('\u{270F}\u{FE0F} Edit', `edit_select:${txId}`)
    .text('\u{1F5D1} Delete', `autolog_del:${txId}`)
}
