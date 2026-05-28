import type { Context } from 'grammy'
import type { Category } from '@spend-again/shared'
import {
  MSG_NOT_REGISTERED,
  MSG_RECENT_HEADER,
  MSG_RECENT_EMPTY,
  CATEGORY_EMOJI,
} from '@spend-again/shared'
import { apiClient, tokenStore, userIdStore } from '../lib/api-client.js'

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
  const userId = userIdStore.get(telegramId) ?? String(telegramId)
  const transactions = await apiClient.getRecentTransactions(userId, 5)

  if (transactions.length === 0) {
    await ctx.reply(MSG_RECENT_EMPTY)
    return
  }

  const lines = transactions.map((tx) => {
    const emoji = CATEGORY_EMOJI[tx.category as Category] ?? '\u{1F4B0}'
    const [yyyy, mm, dd] = tx.occurredOn.split('-')
    const shortDate = `${dd ?? ''}/${mm ?? ''}`
    return `${emoji} S$${tx.amount} — ${tx.item} (${shortDate})`
  })

  await ctx.reply(MSG_RECENT_HEADER + '\n' + lines.join('\n'))
}
