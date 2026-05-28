import type { Context } from 'grammy'
import type { Category } from '@spend-again/shared'
import {
  MSG_NOT_REGISTERED,
  MSG_RECENT_HEADER,
  MSG_RECENT_EMPTY,
  CATEGORY_EMOJI,
  occurredOnToDisplay,
} from '@spend-again/shared'
import { apiClient, tokenStore, userIdStore } from '../lib/api-client.js'
import { DASHBOARD_URL } from '../lib/env.js'

export async function recentHandler(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id
  if (telegramId === undefined) return

  const token = tokenStore.get(telegramId)
  if (token === undefined) {
    await ctx.reply(MSG_NOT_REGISTERED(DASHBOARD_URL))
    return
  }

  apiClient.setToken(token)
  const userId = userIdStore.get(telegramId)
  if (userId === undefined) {
    // Token exists but UUID mapping was lost (e.g. bot restarted). Force re-link
    // rather than querying with a numeric Telegram ID that can never match the
    // transactions.user_id UUID column.
    await ctx.reply(MSG_NOT_REGISTERED(DASHBOARD_URL))
    return
  }
  const transactions = await apiClient.getRecentTransactions(userId, 5)

  if (transactions.length === 0) {
    await ctx.reply(MSG_RECENT_EMPTY)
    return
  }

  const lines = transactions.map((tx) => {
    const emoji = CATEGORY_EMOJI[tx.category as Category] ?? '\u{1F4B0}'
    return `${emoji} S$${tx.amount} — ${tx.item} (${occurredOnToDisplay(tx.occurredOn)})`
  })

  await ctx.reply(MSG_RECENT_HEADER + '\n' + lines.join('\n'))
}
