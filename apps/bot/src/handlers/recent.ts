import type { Context } from 'grammy'
import type { Category } from '@spend-again/shared'
import {
  MSG_NOT_REGISTERED,
  MSG_RECENT_HEADER,
  MSG_RECENT_EMPTY,
} from '@spend-again/shared'
import { apiClient, tokenStore } from '../lib/api-client.js'

const CATEGORY_EMOJI: Record<Category, string> = {
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

export async function recentHandler(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id
  if (telegramId === undefined) return

  const token = tokenStore.get(telegramId)
  if (token === undefined) {
    const dashboardUrl = process.env['DASHBOARD_URL'] ?? 'http://localhost:5173'
    await ctx.reply(MSG_NOT_REGISTERED(dashboardUrl))
    return
  }

  apiClient.setToken(token)
  const transactions = await apiClient.getRecentTransactions(String(telegramId), 5)

  if (transactions.length === 0) {
    await ctx.reply(MSG_RECENT_EMPTY)
    return
  }

  const lines = transactions.map((tx) => {
    const emoji = CATEGORY_EMOJI[tx.category as Category] ?? '\u{1F4B0}'
    const amount = `S$${(tx.amount / 100).toFixed(2)}`
    return `${emoji} ${amount} — ${tx.item} (${tx.date})`
  })

  await ctx.reply(MSG_RECENT_HEADER + '\n' + lines.join('\n'))
}
