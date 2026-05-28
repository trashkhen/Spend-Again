/**
 * Natural language spending query handler.
 *
 * Routes to keyword-based handlers for simple known patterns, and falls back to
 * Gemini for arbitrary date-range queries like "show me my spending trend for the
 * past 2 weeks" or "breakdown of expenditure last month by category".
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import type { Context } from 'grammy'
import { GEMINI_MODEL, createLogger, getTodayDDMMYYYY, parseDDMMYYYY, fmtShortDate, fmtSGD, amountToCents } from '@spend-again/shared'
import type { ApiTransaction } from '@spend-again/shared'
import { waitForGeminiRpmBudget } from '@spend-again/parser'
import { tokenStore, userIdStore, apiClient } from '../lib/api-client.js'

const log = createLogger('bot:query')

// ── Date helpers ─────────────────────────────────────────────────────────────

function currentMonthYear(): { month: string; year: string } {
  const now = new Date()
  return {
    month: String(now.getMonth() + 1).padStart(2, '0'),
    year: String(now.getFullYear()),
  }
}

// ── Keyword query classifier ─────────────────────────────────────────────────

type KeywordIntent =
  | { type: 'monthly_total'; category?: string }
  | { type: 'top_expense'; period: 'week' | 'month' }
  | { type: 'category_breakdown' }
  | { type: 'unknown' }

function classifyQuery(text: string): KeywordIntent {
  const lower = text.toLowerCase()

  const categoryMatch =
    /(?:spend(?:ing)?|spent)(?:\s+on)?\s+(food|groceries?|transport(?:ation)?|shopping|entertainment|health|education|travel|utilities|finance|housing)/i.exec(
      text,
    ) ??
    /(food|groceries?|transport(?:ation)?|shopping|entertainment|health|education|travel|utilities|finance|housing)\s+(?:spend(?:ing)?|spent|budget|expenses?)/i.exec(
      text,
    )

  if (categoryMatch !== null) {
    const rawCategory = (categoryMatch[1] ?? '').toLowerCase()
    return { type: 'monthly_total', category: normalizeCategoryKeyword(rawCategory) }
  }

  if (
    /how\s+much|total\s+spend(?:ing)?|spend(?:ing)?\s+this\s+month|monthly\s+spend(?:ing)?/i.test(lower)
  ) {
    return { type: 'monthly_total' }
  }

  if (/biggest|top\s+expense|most\s+expensive|largest\s+spend/i.test(lower)) {
    const period = /this\s+week|week/i.test(lower) ? 'week' : 'month'
    return { type: 'top_expense', period }
  }

  if (
    /breakdown|by\s+category|category\s+(?:split|summary)|show\s+(?:my\s+)?spending/i.test(lower) &&
    !/past|last\s+\d|trend/i.test(lower)
  ) {
    return { type: 'category_breakdown' }
  }

  return { type: 'unknown' }
}

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

// ── Gemini-powered intent parser ─────────────────────────────────────────────

type GeminiQueryIntent = {
  intent: 'summary' | 'breakdown' | 'trend' | 'category_total' | 'unknown'
  dateRange: { start: string; end: string } | null
  category: string | null
}

async function parseQueryWithGemini(text: string): Promise<GeminiQueryIntent | null> {
  const apiKey = process.env['GEMINI_API_KEY']
  if (!apiKey) return null

  const today = getTodayDDMMYYYY()

  const prompt =
    `You are a spending query intent parser for a Singapore expense tracker. ` +
    `Today is ${today} (DD/MM/YYYY).\n\n` +
    `Return ONLY a JSON object with these exact fields:\n` +
    `{\n` +
    `  "intent": "summary" | "breakdown" | "trend" | "category_total" | "unknown",\n` +
    `  "dateRange": { "start": "DD/MM/YYYY", "end": "DD/MM/YYYY" } | null,\n` +
    `  "category": string | null\n` +
    `}\n\n` +
    `Intent definitions:\n` +
    `- summary: user wants total spend amount for a period\n` +
    `- breakdown: user wants spending split by category\n` +
    `- trend: user wants day-by-day spending over a period\n` +
    `- category_total: user wants total for one specific category\n` +
    `- unknown: cannot determine intent\n\n` +
    `Date range rules (null means use current month):\n` +
    `- "past X weeks" → start = today minus X*7 days, end = today\n` +
    `- "past X days" → start = today minus X days, end = today\n` +
    `- "past month" or "last month" → start = 30 days ago, end = today\n` +
    `- "this month" → start = first day of current month, end = today\n` +
    `- "past 2 months" → start = 60 days ago, end = today\n` +
    `- No date mentioned → null\n\n` +
    `Valid categories: Food, Transport, Groceries, Shopping, Entertainment, Health, Education, Travel, Utilities, Finance, Housing, Other\n\n` +
    `Query: "${text}"\n\n` +
    `Return ONLY the JSON object, no markdown, no explanation.`

  try {
    await waitForGeminiRpmBudget()
    const client = new GoogleGenerativeAI(apiKey)
    const model = client.getGenerativeModel({ model: GEMINI_MODEL })
    const result = await model.generateContent(prompt)
    const raw = result.response.text()

    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start === -1 || end === -1) return null

    const parsed = JSON.parse(raw.slice(start, end + 1)) as GeminiQueryIntent
    return parsed
  } catch (err) {
    log.error({ err }, 'Gemini parse error')
    return null
  }
}

// ── Transaction aggregation helpers ─────────────────────────────────────────

function filterByDateRange(txs: ApiTransaction[], start: string, end: string): ApiTransaction[] {
  const startDate = parseDDMMYYYY(start)
  const endDate = parseDDMMYYYY(end)
  if (!startDate || !endDate) return txs
  return txs.filter((tx) => {
    const d = parseDDMMYYYY(tx.date)
    return d !== null && d >= startDate && d <= endDate
  })
}

function buildSummaryReply(txs: ApiTransaction[], start: string, end: string): string {
  const filtered = filterByDateRange(txs, start, end)
  const totalCents = filtered.reduce((sum, tx) => sum + amountToCents(tx.amount), 0)

  if (filtered.length === 0) {
    return `No expenses found between ${fmtShortDate(start)} and ${fmtShortDate(end)} leh! \u{1F44D}`
  }

  const avgCents = totalCents / filtered.length
  return (
    `\u{1F4CA} Spending summary (${fmtShortDate(start)} – ${fmtShortDate(end)}):\n\n` +
    `\u{1F4B0} Total: *${fmtSGD(totalCents)}*\n` +
    `\u{1F522} Transactions: ${filtered.length}\n` +
    `\u{1F4C9} Average per expense: *${fmtSGD(Math.round(avgCents))}*`
  )
}

function buildBreakdownReply(txs: ApiTransaction[], start: string, end: string): string {
  const filtered = filterByDateRange(txs, start, end)
  if (filtered.length === 0) {
    return `No expenses found between ${fmtShortDate(start)} and ${fmtShortDate(end)} leh! \u{1F44D}`
  }

  const byCategory = new Map<string, number>()
  for (const tx of filtered) {
    byCategory.set(tx.category, (byCategory.get(tx.category) ?? 0) + amountToCents(tx.amount))
  }

  const grandTotal = filtered.reduce((sum, tx) => sum + amountToCents(tx.amount), 0)
  const sorted = [...byCategory.entries()].sort((a, b) => b[1] - a[1])

  const lines = sorted.map(([cat, cents]) => {
    const pct = ((cents / grandTotal) * 100).toFixed(1)
    return `  \u{2022} ${cat}: *${fmtSGD(cents)}* (${pct}%)`
  })

  return (
    `\u{1F4CA} Breakdown (${fmtShortDate(start)} – ${fmtShortDate(end)}):\n\n` +
    lines.join('\n') +
    `\n\n\u{1F4B0} Grand total: *${fmtSGD(grandTotal)}*`
  )
}

function buildTrendReply(txs: ApiTransaction[], start: string, end: string): string {
  const filtered = filterByDateRange(txs, start, end)
  if (filtered.length === 0) {
    return `No expenses found between ${fmtShortDate(start)} and ${fmtShortDate(end)} leh! \u{1F44D}`
  }

  const byDay = new Map<string, number>()
  for (const tx of filtered) {
    byDay.set(tx.date, (byDay.get(tx.date) ?? 0) + amountToCents(tx.amount))
  }

  const startDate = parseDDMMYYYY(start)
  const endDate = parseDDMMYYYY(end)
  if (!startDate || !endDate) return buildSummaryReply(txs, start, end)

  // Build ordered day list
  const lines: string[] = []
  const cur = new Date(startDate)
  while (cur <= endDate) {
    const dd = String(cur.getDate()).padStart(2, '0')
    const mm = String(cur.getMonth() + 1).padStart(2, '0')
    const yyyy = String(cur.getFullYear())
    const key = `${dd}/${mm}/${yyyy}`
    const cents = byDay.get(key) ?? 0
    if (cents > 0) {
      lines.push(`  ${dd}/${mm}: *${fmtSGD(cents)}*`)
    }
    cur.setDate(cur.getDate() + 1)
  }

  if (lines.length === 0) {
    return `No spending recorded between ${fmtShortDate(start)} and ${fmtShortDate(end)} leh!`
  }

  const totalCents = filtered.reduce((sum, tx) => sum + amountToCents(tx.amount), 0)
  return (
    `\u{1F4C8} Spending trend (${fmtShortDate(start)} – ${fmtShortDate(end)}):\n\n` +
    lines.join('\n') +
    `\n\n\u{1F4B0} Total: *${fmtSGD(totalCents)}*`
  )
}

function buildCategoryTotalReply(
  txs: ApiTransaction[],
  category: string,
  start: string,
  end: string,
): string {
  const filtered = filterByDateRange(txs, start, end).filter(
    (tx) => tx.category.toLowerCase() === category.toLowerCase(),
  )

  if (filtered.length === 0) {
    return `No *${category}* expenses between ${fmtShortDate(start)} and ${fmtShortDate(end)} leh! \u{1F44D}`
  }

  const totalCents = filtered.reduce((sum, tx) => sum + amountToCents(tx.amount), 0)
  return (
    `\u{1F4CA} *${category}* spending (${fmtShortDate(start)} – ${fmtShortDate(end)}):\n\n` +
    `\u{1F4B0} Total: *${fmtSGD(totalCents)}*\n` +
    `\u{1F522} Transactions: ${filtered.length}`
  )
}

// ── Keyword-based response formatters ────────────────────────────────────────

async function handleMonthlyTotal(userId: string, category: string | undefined): Promise<string> {
  const { month, year } = currentMonthYear()

  if (category !== undefined) {
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

// ── looksLikeQuery ────────────────────────────────────────────────────────────

export function looksLikeQuery(text: string): boolean {
  return /how\s+much|biggest|top\s+expense|most\s+expensive|breakdown|by\s+category|spend(?:ing)?\s+this\s+(week|month)|category\s+(split|summary)|show\s+(?:my\s+)?spending|what(?:'s|\s+is)\s+my|show\s+me\s+my|expenditure|past\s+\d+\s+(week|day|month)|last\s+\d+\s+(week|day|month)|spending\s+trend|spending\s+history|my\s+spend(?:ing)?/i.test(
    text,
  )
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function queryHandler(ctx: Context): Promise<void> {
  const text = ctx.message?.text
  const telegramId = ctx.from?.id

  if (text === undefined || telegramId === undefined) return

  const token = tokenStore.get(telegramId)
  if (token === undefined) {
    const dashboardUrl = process.env['DASHBOARD_URL'] ?? 'https://spend-again-dashboard.vercel.app'
    await ctx.reply(
      `Eh, you haven't registered yet leh! \u{1F64F}\n` +
        `Please sign up at ${dashboardUrl} first, then come back here lor.`,
    )
    return
  }

  apiClient.setToken(token)
  const userId = userIdStore.get(telegramId) ?? String(telegramId)

  const intent = classifyQuery(text)

  // Fast path: recognized keyword intent
  if (intent.type !== 'unknown') {
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
    }

    await ctx.reply(reply!, { parse_mode: 'Markdown' })
    return
  }

  // Slow path: try Gemini for arbitrary natural language queries
  await ctx.reply(`Give me a moment lah, thinking... \u{1F914}`)

  const geminiIntent = await parseQueryWithGemini(text)

  if (geminiIntent === null || geminiIntent.intent === 'unknown') {
    await ctx.reply(
      `Sorry lah, I don't understand. \u{1F914}\n\n` +
        `Try asking about your spending, like:\n` +
        `  \u{2022} "How much did I spend this month?"\n` +
        `  \u{2022} "Show my spending breakdown"\n` +
        `  \u{2022} "Show me my spending trend for the past 2 weeks"\n` +
        `  \u{2022} "Breakdown of expenditure last month by category"`,
      { parse_mode: 'Markdown' },
    )
    return
  }

  // Resolve date range (null = use current month range)
  let start: string
  let end: string

  if (geminiIntent.dateRange !== null) {
    start = geminiIntent.dateRange.start
    end = geminiIntent.dateRange.end
  } else {
    // Default: first day of current month to today
    const now = new Date()
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const yyyy = String(now.getFullYear())
    start = `01/${mm}/${yyyy}`
    end = getTodayDDMMYYYY()
  }

  // Fetch all transactions and aggregate locally
  const allTxs = await apiClient.getAllTransactions(userId)
  let reply: string

  switch (geminiIntent.intent) {
    case 'summary':
      reply = buildSummaryReply(allTxs, start, end)
      break
    case 'breakdown':
      reply = buildBreakdownReply(allTxs, start, end)
      break
    case 'trend':
      reply = buildTrendReply(allTxs, start, end)
      break
    case 'category_total':
      reply = buildCategoryTotalReply(allTxs, geminiIntent.category ?? 'Other', start, end)
      break
    default:
      reply =
        `Sorry lah, I don't understand. \u{1F914}\n\n` +
        `Try asking about your spending, like:\n` +
        `  \u{2022} "How much did I spend this month?"\n` +
        `  \u{2022} "Show my spending breakdown"\n` +
        `  \u{2022} "Show me my spending trend for the past 2 weeks"`
  }

  await ctx.reply(reply, { parse_mode: 'Markdown' })
}
