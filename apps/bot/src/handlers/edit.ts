import { InlineKeyboard } from 'grammy'
import type { Context } from 'grammy'
import {
  MSG_NOT_REGISTERED,
  CATEGORY_EMOJI,
  fmtSGD,
  occurredOnToDisplay,
} from '@spend-again/shared'
import type { Category } from '@spend-again/shared'
import { parseStructuredEdit } from '../lib/parse-structured-edit.js'
import { apiClient, tokenStore, userIdStore } from '../lib/api-client.js'
import { DASHBOARD_URL } from '../lib/env.js'

export const pendingEdits = new Map<number, string>() // chatId → txId

const EDIT_FORMAT_HINT =
  `Send the updated details:\n\`[price] [item] [category] [sub-category]\`\n\nExample: \`3.50 iced coffee Food Cafe\`\n\nSub-category is optional.`

export async function editCommandHandler(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id
  const chatId = ctx.chat?.id
  if (telegramId === undefined || chatId === undefined) return

  const token = tokenStore.get(telegramId)
  if (token === undefined) {
    await ctx.reply(MSG_NOT_REGISTERED(DASHBOARD_URL))
    return
  }

  apiClient.setToken(token)
  const userId = userIdStore.get(telegramId)
  if (userId === undefined) {
    await ctx.reply(MSG_NOT_REGISTERED(DASHBOARD_URL))
    return
  }

  const txs = await apiClient.getRecentTransactions(userId, 5)
  if (txs.length === 0) {
    await ctx.reply('No recent transactions to edit lah! \u{1F605}')
    return
  }

  const keyboard = new InlineKeyboard()
  for (const tx of txs) {
    const emoji = CATEGORY_EMOJI[tx.category as Category] ?? '\u{1F4B0}'
    const label = `${emoji} ${fmtSGD(tx.amountCents)} ${tx.item} (${occurredOnToDisplay(tx.occurredOn)})`
    keyboard.text(label, `edit_select:${tx.id}`).row()
  }

  await ctx.reply('Which transaction to edit?', { reply_markup: keyboard })
}

export async function editSelectHandler(ctx: Context): Promise<void> {
  const callbackData = ctx.callbackQuery?.data
  const chatId = ctx.chat?.id
  if (callbackData === undefined || chatId === undefined) return
  await ctx.answerCallbackQuery()

  const txId = callbackData.replace('edit_select:', '')
  pendingEdits.set(chatId, txId)
  await ctx.reply(EDIT_FORMAT_HINT, { parse_mode: 'Markdown' })
}

export async function handlePendingEdit(ctx: Context): Promise<boolean> {
  const text = ctx.message?.text
  const chatId = ctx.chat?.id
  const telegramId = ctx.from?.id
  if (text === undefined || chatId === undefined || telegramId === undefined) return false

  const txId = pendingEdits.get(chatId)
  if (txId === undefined) return false

  if (text.startsWith('/')) {
    pendingEdits.delete(chatId)
    return false
  }

  const parsed = parseStructuredEdit(text)
  if (parsed === null) {
    await ctx.reply(
      `Hmm, format not right leh \u{1F914} Try:\n\`[price] [item] [category] [sub-category]\`\n\nExample: \`3.50 iced coffee Food Cafe\``,
      { parse_mode: 'Markdown' },
    )
    return true // consumed — keep pendingEdits for retry
  }

  const token = tokenStore.get(telegramId)
  if (token === undefined) {
    pendingEdits.delete(chatId)
    await ctx.reply(MSG_NOT_REGISTERED(DASHBOARD_URL))
    return true
  }

  apiClient.setToken(token)
  const updated = await apiClient.updateTransaction(txId, {
    amountCents: parsed.amountCents,
    item: parsed.item,
    category: parsed.category,
    subCategory: parsed.subCategory,
    source: 'bot',
  })

  pendingEdits.delete(chatId)

  if (updated === null) {
    await ctx.reply('Aiyah, could not update the transaction. Try again later lah! \u{1F625}')
    return true
  }

  await ctx.reply(
    `Updated! \u{2705} ${fmtSGD(parsed.amountCents)} ${parsed.item} (${parsed.category}/${parsed.subCategory})`,
  )
  return true
}
