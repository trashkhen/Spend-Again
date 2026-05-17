/**
 * Natural language spending query handler.
 *
 * Intercepts conversational questions about spending (e.g. "how much did I spend
 * on food this month?") and responds with a formatted answer fetched from the
 * analytics API.
 *
 * Uses simple keyword matching — no AI call required for routing.
 */

import type { Context } from 'grammy'
import { tokenStore, apiClient } from '../lib/api-client.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns the current month (MM) and year (YYYY) as strings. */
function currentMonthYear(): { month: string; year: string } {
  const now = new Date()
  return {
    month: String(now.getMonth() + 1).padStart(2, '0'),
    year: String(now.getFullYear()),
  }
}

// ── Query classifier ─────────────────────────────────────────────────────────

type QueryIntent =
  | { type: 'monthly_total'; category?: string }
  | { type: 'top_expense'; period: 'week' | 'month' }
  | { type: 'category_breakdown' }
  | { type: 'unknown' }

/** Classify the user's message into a structured intent via keyword matching. */
function classifyQuery(text: string): QueryIntent {
  const lower = text.toLowerCase()

  // "how much did I spend on food" / "food spending" / "spend on transport"
  const categoryMatch =
    /(?:spend(?:ing)?|spent)(?:\s+on)?\s+(food|groceries?|transport(?:ation)?|shopping|entertainment|health|education|travel|utilities|finance|housing)/i.exec(
      text,
    ) ??
    /(food|groceries?|transport(?:ation)?|shopping|entertainment|health|education|travel|utilities|finance|housing)\s+(?:spend(?:ing)?|spent|budget|expenses?)/i.exec(
      text,
    )

  if (categoryMatch !== null) {
    const rawCategory = (categoryMatch[1] ?? '').toLowerCase()
    const category = normalizeCategoryKeyword(rawCategory)
    return { type: 'monthly_total', category }
  }

  // "how much did I spend" / "total spend" / "spending this month"
  if (
    /how\s+much|total\s+spend(?:ing)?|spend(?:ing)?\s+this\s+month|monthly\s+spend(?:ing)?/i.test(
      lower,
    )
  ) {
    return { type: 'monthly_total' }
  }

  // "biggest expense this week" / "top expense" / "most expensive"
  if (
    /biggest|top\s+expense|most\s+expensive|largest\s+spend/i.test(lower)
  ) {
    const period = /this\s+week|week/i.test(lower) ? 'week' : 'month'
    return { type: 'top_expense', period }
  }

  // "breakdown" / "by category" / "category split" / "show my spending"
  if (
    /breakdown|by\s+category|category\s+(?:split|summary)|show\s+(?:my\s+)?spending/i.test(lower)
  ) {
    return { type: 'category_breakdown' }
  }

  return { type: 'unknown' }
}

/** Map user-typed category keywords to canonical category names. */
function normalizeCategoryKeyword(raw: string): string {
  const map: Record<string, string> = {
    food: 'Food',
    groceries: 'Groceries',
    grocery: 'Groceries',
    transport: 'Transport',
    transportation: 'Transport',
    shopping: 'Shopping',
    entertainment: 'Entertainment',
    health: 'Health',
    education: 'Education',
    travel: 'Travel',
    utilities: 'Utilities',
    finance: 'Finance',
    housing: 'Housing',
  }
  return map[raw] ?? raw
}

// ── Response formatters ──────────────────────────────────────────────────────

async function handleMonthlyTotal(
  userId: string,
  category: string | undefined,
): Promise<string> {
  const { month, year } = currentMonthYear()

  if (category !== undefined) {
    // Get breakdown and filter to the requested category
    const breakdown = await apiClient.getCategoryBreakdown(userId, month, year)
    if (breakdown === null) {
      return `Aiyah, cannot fetch your ${category} spending lah! \u{1F615} Please try again.`
    }
    const cat = breakdown.breakdown.find(
      (b) => b.category.toLowerCase() === category.toLowerCase(),
    )
    if (cat === undefined || cat.totalCents === 0) {
      return `No ${category} expenses this month leh! \u{1F44D} Keep it up!`
    }
    return (
      `\u{1F4CA} Your *${cat.category}* spending this month (${month}/${year}):\n\n` +
      `\u{1F4B0} Total: *S$${cat.total}*\n` +
      `\u{1F522} Transactions: ${cat.count}`
    )
  }

  const summary = await apiClient.getSpendingSummary(userId, month, year)
  if (summary === null) {
    return `Aiyah, cannot fetch your spending lah! \u{1F615} Please try again.`
  }

  if (summary.count === 0) {
    return `You haven't logged any expenses this month leh! \u{1F609} Start tracking now!`
  }

  const avgCents = summary.totalCents / summary.count
  return (
    `\u{1F4CA} Your spending this month (${month}/${year}):\n\n` +
    `\u{1F4B0} Total: *S$${summary.total}*\n` +
    `\u{1F522} Transactions: ${summary.count}\n` +
    `\u{1F4C9} Average per expense: *S$${(avgCents / 100).toFixed(2)}*`
  )
}

async function handleTopExpense(userId: string, period: 'week' | 'month'): Promise<string> {
  const result = await apiClient.getTopExpense(userId, period)
  if (result === null) {
    return `Aiyah, cannot fetch your expenses lah! \u{1F615} Please try again.`
  }
  if (result.transaction === null) {
    return `No expenses ${period === 'week' ? 'this week' : 'this month'} leh! \u{1F44D}`
  }

  const tx = result.transaction
  const periodLabel = period === 'week' ? 'this week' : 'this month'
  return (
    `\u{1F3C6} Your biggest expense ${periodLabel}:\n\n` +
    `\u{1F4B0} *S$${tx.amount}* — ${tx.item}\n` +
    `\u{1F4C2} Category: ${tx.category}/${tx.subCategory}\n` +
    `\u{1F4C5} Date: ${tx.date}`
  )
}

async function handleCategoryBreakdown(userId: string): Promise<string> {
  const { month, year } = currentMonthYear()
  const breakdown = await apiClient.getCategoryBreakdown(userId, month, year)
  if (breakdown === null) {
    return `Aiyah, cannot fetch your breakdown lah! \u{1F615} Please try again.`
  }

  if (breakdown.breakdown.length === 0) {
    return `No expenses logged this month leh! \u{1F609} Start tracking now!`
  }

  const lines = breakdown.breakdown.map((b) => {
    const pct =
      breakdown.grandTotalCents > 0
        ? ((b.totalCents / breakdown.grandTotalCents) * 100).toFixed(1)
        : '0.0'
    return `  \u{2022} ${b.category}: *S$${b.total}* (${pct}%)`
  })

  return (
    `\u{1F4CA} Spending breakdown for ${month}/${year}:\n\n` +
    lines.join('\n') +
    `\n\n\u{1F4B0} Grand total: *S$${breakdown.grandTotal}*`
  )
}

// ── Main handler ─────────────────────────────────────────────────────────────

/**
 * Returns true if this message looks like a spending query (not an expense entry).
 * Called by bot.ts to route messages before the expenseHandler sees them.
 */
export function looksLikeQuery(text: string): boolean {
  return /how\s+much|biggest|top\s+expense|most\s+expensive|breakdown|by\s+category|spend(?:ing)?\s+this\s+(week|month)|category\s+(split|summary)|show\s+(?:my\s+)?spending|what(?:'s|\s+is)\s+my/i.test(
    text,
  )
}

export async function queryHandler(ctx: Context): Promise<void> {
  const text = ctx.message?.text
  const telegramId = ctx.from?.id

  if (text === undefined || telegramId === undefined) return

  // Check auth
  const token = tokenStore.get(telegramId)
  if (token === undefined) {
    const dashboardUrl = process.env['DASHBOARD_URL'] ?? 'http://localhost:5173'
    await ctx.reply(
      `Eh, you haven't registered yet leh! \u{1F64F}\n` +
        `Please sign up at ${dashboardUrl} first, then come back here lor.`,
    )
    return
  }

  apiClient.setToken(token)

  // Use telegramId as userId placeholder (same convention as expense/confirm handlers)
  const userId = String(telegramId)
  const intent = classifyQuery(text)

  let reply: string

  switch (intent.type) {
    case 'monthly_total':
      reply = await handleMonthlyTotal(userId, intent.category)
      break

    case 'top_expense':
      reply = await handleTopExpense(userId, intent.period)
      break

    case 'category_breakdown':
      reply = await handleCategoryBreakdown(userId)
      break

    case 'unknown':
    default:
      reply =
        `Sorry lah, I don't understand. \u{1F914}\n\n` +
        `Try asking about your spending, like:\n` +
        `  \u{2022} "How much did I spend this month?"\n` +
        `  \u{2022} "What's my biggest expense this week?"\n` +
        `  \u{2022} "Show my spending breakdown"\n` +
        `  \u{2022} "How much on food this month?"`
      break
  }

  await ctx.reply(reply, { parse_mode: 'Markdown' })
}
