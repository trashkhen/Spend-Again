import { InlineKeyboard } from 'grammy'
import type { SpaceWithTotal } from '@spend-again/shared'

export function buildSpaceListKeyboard(spaces: SpaceWithTotal[], hasActive: boolean): InlineKeyboard {
  const kb = new InlineKeyboard()
  for (const s of spaces) {
    kb.text(`${s.emoji ?? '📦'} ${s.name}`, `space_activate:${s.id}`).row()
  }
  kb.text('➕ New Space', 'space_new')
  if (hasActive) kb.row().text('🏠 Main only', 'space_clear')
  kb.row().text('📂 Archived Spaces', 'space_show_archived')
  return kb
}

export function buildSpaceActiveKeyboard(spaceId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('🛑 Stop using space', 'space_clear')
    .row()
    .text('📊 View total', `space_total:${spaceId}`)
    .row()
    .text('💤 Deactivate', `space_deactivate:${spaceId}`)
    .text('🗑 Delete', `space_delete_confirm:${spaceId}`)
}

export function buildSpaceCreatedKeyboard(spaceId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Set active', `space_activate:${spaceId}`)
    .text('Not now', 'space_created_skip')
}

export function buildSpaceBudgetChoiceKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Yes', 'space_budget_choice:yes')
    .text('❌ No', 'space_budget_choice:no')
}

export function buildSpaceNameEmojiConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Yes, use this', 'space_name_confirm')
    .text('✏️ Edit name', 'space_name_edit')
}

export function buildSpaceDeleteConfirmKeyboard(spaceId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('⚠️ Yes, delete', `space_delete_final:${spaceId}`)
    .text('Cancel', 'space_delete_cancel')
}

export function buildSpaceArchivedListKeyboard(archivedSpaces: SpaceWithTotal[]): InlineKeyboard {
  const kb = new InlineKeyboard()
  for (const s of archivedSpaces) {
    kb.text(`${s.emoji ?? '📦'} ${s.name}`, `space_archived_view:${s.id}`).row()
  }
  kb.text('← Back to active', 'space_back_to_active')
  return kb
}

export function buildSpaceArchivedItemKeyboard(spaceId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('♻️ Reactivate', `space_reactivate:${spaceId}`)
    .text('🗑 Delete', `space_delete_confirm:${spaceId}`)
}
