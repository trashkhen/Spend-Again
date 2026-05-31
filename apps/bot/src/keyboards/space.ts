import { InlineKeyboard } from 'grammy'
import type { SpaceWithTotal } from '@spend-again/shared'

export function buildSpaceListKeyboard(spaces: SpaceWithTotal[], hasActive: boolean): InlineKeyboard {
  const kb = new InlineKeyboard()
  for (const s of spaces) {
    kb.text(`${s.emoji ?? '📦'} ${s.name}`, `space_activate:${s.id}`).row()
  }
  kb.text('➕ New Space', 'space_new')
  if (hasActive) kb.row().text('🏠 Main only', 'space_clear')
  return kb
}

export function buildSpaceActiveKeyboard(spaceId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('🛑 Stop using space', 'space_clear')
    .row()
    .text('📊 View total', `space_total:${spaceId}`)
}

export function buildSpaceCreatedKeyboard(spaceId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Set active', `space_activate:${spaceId}`)
    .text('Not now', 'space_created_skip')
}
