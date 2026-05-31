import { InlineKeyboard } from 'grammy'

export function buildConfirmKeyboard(hasSpaceSuggestion = false): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text('✅ Confirm', 'confirm_yes')
    .text('✏️ Edit', 'confirm_edit')
    .text('❌ Cancel', 'confirm_no')
  if (hasSpaceSuggestion) {
    kb.row().text('🏠 Main only', 'confirm_space_skip')
  }
  return kb
}
