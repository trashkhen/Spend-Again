import type { Context } from 'grammy'
import { parseStructuredEdit } from '../lib/parse-structured-edit.js'
import { pendingConfirmations, buildConfirmationMessage } from './expense.js'
import { buildConfirmKeyboard } from '../keyboards/confirm.js'

export const pendingInlineEdits = new Set<number>()

export async function handlePendingInlineEdit(ctx: Context): Promise<void> {
  const text = ctx.message?.text
  const chatId = ctx.chat?.id
  if (text === undefined || chatId === undefined) return

  // Allow any command (e.g. /cancel, /help) to escape the inline-edit loop
  if (text.startsWith('/')) {
    pendingInlineEdits.delete(chatId)
    return
  }

  const parsed = parseStructuredEdit(text)
  if (parsed === null) {
    await ctx.reply(
      `Hmm, format not right leh\u{1F914} Try:\n\`[price] [item] [category] [sub-category]\`\n\nExample: \`3.50 coffee Food Cafe\`\n\nSub-category is optional.`,
      { parse_mode: 'Markdown' },
    )
    return // keep pendingInlineEdits for retry
  }

  pendingInlineEdits.delete(chatId)

  const existing = pendingConfirmations.get(chatId)
  if (existing === undefined) {
    await ctx.reply('No pending transaction found leh. Start again!')
    return
  }

  existing.amount = parsed.amountCents
  existing.item = parsed.item
  existing.category = parsed.category
  existing.subCategory = parsed.subCategory

  const msg = buildConfirmationMessage(existing)
  await ctx.reply(msg, { reply_markup: buildConfirmKeyboard() })
}
