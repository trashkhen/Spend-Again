import { InlineKeyboard } from 'grammy'

export function buildConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Correct', 'confirm_yes')
    .text('✏️ Edit', 'confirm_edit')
    .text('❌ Cancel', 'confirm_no')
}
