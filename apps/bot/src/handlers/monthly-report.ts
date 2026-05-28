import type { Context } from 'grammy'
import { tokenStore, userIdStore, apiClient } from '../lib/api-client.js'
import { DASHBOARD_URL } from '../lib/env.js'
import { MSG_NOT_REGISTERED } from '@spend-again/shared'

function currentMonthYear(): { month: string; year: string } {
  const now = new Date()
  return {
    month: String(now.getMonth() + 1).padStart(2, '0'),
    year: String(now.getFullYear()),
  }
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export async function monthlyReportHandler(ctx: Context): Promise<void> {
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
    await ctx.reply(MSG_NOT_REGISTERED(DASHBOARD_URL))
    return
  }
  const { month, year } = currentMonthYear()
  const monthName = MONTH_NAMES[Number(month) - 1] ?? month

  await ctx.reply(`\u{23F3} Fetching your ${monthName} report...`)

  const [summary, breakdown, budgetData] = await Promise.all([
    apiClient.getSpendingSummary(userId, month, year),
    apiClient.getCategoryBreakdown(userId, month, year),
    apiClient.getBudget(),
  ])

  if (summary === null || breakdown === null) {
    await ctx.reply(`Aiyah, cannot load your report lah! \u{1F615} Please try again.`)
    return
  }

  if (summary.count === 0) {
    await ctx.reply(
      `\u{1F4CA} *${monthName} ${year} Report*\n\n` +
        `No expenses logged yet lah! Start tracking now. \u{1F609}`,
      { parse_mode: 'Markdown' },
    )
    return
  }

  const avgCents = summary.totalCents / summary.count

  // Category breakdown lines (skip zero-spend categories)
  const lines = breakdown.breakdown.map((b) => {
    const pct =
      breakdown.grandTotalCents > 0
        ? ((b.totalCents / breakdown.grandTotalCents) * 100).toFixed(1)
        : '0.0'
    return `  \u{2022} ${b.category}: *S$${b.total}* (${pct}%)`
  })

  const budgetStr = budgetData?.monthlyBudget != null
    ? ` / S$${(budgetData.monthlyBudget / 100).toFixed(2)}`
    : ''

  const report =
    `\u{1F4CA} *${monthName} ${year} Report*\n\n` +
    `\u{1F4B0} Total spent: *S$${summary.total}*${budgetStr}\n` +
    `\u{1F522} Transactions: ${summary.count}\n` +
    `\u{1F4C9} Average per expense: *S$${(avgCents / 100).toFixed(2)}*\n\n` +
    `*By Category:*\n` +
    lines.join('\n')

  await ctx.reply(report, { parse_mode: 'Markdown' })
}
