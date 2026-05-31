import type { Context } from 'grammy'
import { createLogger } from '@spend-again/shared'
import { apiClient, tokenStore } from '../lib/api-client.js'
import { buildSpaceListKeyboard, buildSpaceActiveKeyboard, buildSpaceCreatedKeyboard } from '../keyboards/space.js'

const log = createLogger('bot:space')

export const pendingSpaceCreate = new Set<number>()

function parseSpaceCreate(text: string): {
  name: string
  emoji?: string
  budgetCents?: number
  startDate?: string
  endDate?: string
} | null {
  const nameMatch = text.match(
    /^(?:create\s+(?:a\s+)?(?:space\s+)?(?:called\s+)?|new\s+space\s+)(.+?)(?:\s+from\s|\s+budget\s|\s*$)/i,
  )
  if (!nameMatch?.[1]) return null
  const name = nameMatch[1].trim()

  const budgetMatch = text.match(/budget\s+(?:S?\$|SGD\s*)?(\d+(?:\.\d{1,2})?)/i)
  const budgetCents = budgetMatch?.[1] ? Math.round(parseFloat(budgetMatch[1]) * 100) : undefined

  const dateRangeMatch = text.match(
    /from\s+(\d{1,2}\/\d{1,2}(?:\/\d{4})?)\s+to\s+(\d{1,2}\/\d{1,2}(?:\/\d{4})?)/i,
  )
  let startDate: string | undefined
  let endDate: string | undefined
  if (dateRangeMatch?.[1] && dateRangeMatch?.[2]) {
    const year = new Date().getFullYear()
    const parseDateStr = (s: string): string => {
      const parts = s.split('/')
      const d = parts[0]?.padStart(2, '0') ?? '01'
      const m = parts[1]?.padStart(2, '0') ?? '01'
      const y = parts[2] ?? String(year)
      return `${y}-${m}-${d}`
    }
    startDate = parseDateStr(dateRangeMatch[1])
    endDate = parseDateStr(dateRangeMatch[2])
  }

  return { name, budgetCents, startDate, endDate }
}

async function ensureToken(telegramId: number): Promise<string | undefined> {
  return tokenStore.get(telegramId)
}

export async function spaceCommandHandler(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id
  const chatId = ctx.chat?.id
  if (!telegramId || !chatId) return

  const token = await ensureToken(telegramId)
  if (!token) { await ctx.reply('Please /start to register first.'); return }
  apiClient.setToken(token)

  const arg = typeof ctx.match === 'string' ? ctx.match.trim() : ''

  if (arg) {
    const spaces = await apiClient.listSpaces()
    const match = spaces.find(
      s => s.name.toLowerCase().includes(arg.toLowerCase()) && s.status === 'active',
    )
    if (match) {
      await apiClient.setActiveSpace(match.id)
      const label = `${match.emoji ?? '📦'} ${match.name}`
      await ctx.reply(
        `${label} is now active.\n\nNew expenses will be logged to Main Dashboard + ${match.name}`,
        { reply_markup: buildSpaceActiveKeyboard(match.id) },
      )
      return
    }
    await ctx.reply(`No active space found matching "${arg}".`)
  }

  const [spaces, activeSpace] = await Promise.all([
    apiClient.listSpaces(),
    apiClient.getActiveSpace(),
  ])

  const activeLabel = activeSpace ? `${activeSpace.emoji ?? '📦'} ${activeSpace.name}` : 'None'
  const activeSpaces = spaces.filter(s => s.status === 'active')

  await ctx.reply(
    `Active space: ${activeLabel}\n\nChoose a space:`,
    { reply_markup: buildSpaceListKeyboard(activeSpaces, activeSpace !== null) },
  )
}

export async function spaceCallbackHandler(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data
  const telegramId = ctx.from?.id
  const chatId = ctx.chat?.id
  if (!data || !telegramId || !chatId) return

  await ctx.answerCallbackQuery()

  const token = await ensureToken(telegramId)
  if (!token) return
  apiClient.setToken(token)

  if (data.startsWith('space_activate:')) {
    const spaceId = data.slice('space_activate:'.length)
    await apiClient.setActiveSpace(spaceId)
    const spaces = await apiClient.listSpaces()
    const space = spaces.find(s => s.id === spaceId)
    const label = space ? `${space.emoji ?? '📦'} ${space.name}` : 'Space'
    await ctx.editMessageText(
      `${label} is now active.\n\nNew expenses will be tagged to this space automatically.`,
      { reply_markup: buildSpaceActiveKeyboard(spaceId) },
    )
    return
  }

  if (data === 'space_clear') {
    await apiClient.setActiveSpace(null)
    await ctx.editMessageText('Switched to Main only. New expenses go to main dashboard.')
    return
  }

  if (data === 'space_new') {
    pendingSpaceCreate.add(chatId)
    await ctx.editMessageText(
      'Send me the space details:\n\nExamples:\n• `Bali Trip from 03/06 to 08/06 budget $500`\n• `JB Weekend budget $250`\n• `NUS Semester`',
      { parse_mode: 'Markdown' },
    )
    return
  }

  if (data.startsWith('space_total:')) {
    const spaceId = data.slice('space_total:'.length)
    const spaces = await apiClient.listSpaces()
    const space = spaces.find(s => s.id === spaceId)
    if (!space) { await ctx.editMessageText('Space not found.'); return }
    const label = `${space.emoji ?? '📦'} ${space.name}`
    const budgetLine = space.budgetCents != null
      ? `\nBudget: S$${space.budget}\nRemaining: S$${((space.budgetCents - space.spentCents) / 100).toFixed(2)}`
      : ''
    await ctx.editMessageText(
      `${label}\nSpent: S$${space.spent} (${space.transactionCount} transactions)${budgetLine}`,
      { reply_markup: buildSpaceActiveKeyboard(spaceId) },
    )
    return
  }

  if (data === 'space_created_skip') {
    await ctx.editMessageText('Space created. Use /space to activate it later.')
  }
}

export async function handlePendingSpaceCreate(ctx: Context): Promise<boolean> {
  const text = ctx.message?.text
  const telegramId = ctx.from?.id
  const chatId = ctx.chat?.id
  if (!text || !telegramId || !chatId) return false
  if (!pendingSpaceCreate.has(chatId)) return false

  pendingSpaceCreate.delete(chatId)

  const token = await ensureToken(telegramId)
  if (!token) return false
  apiClient.setToken(token)

  const parsed = parseSpaceCreate(text)
  if (!parsed) {
    await ctx.reply(
      'Could not parse space details. Try: `Bali Trip from 03/06 to 08/06 budget $500`',
      { parse_mode: 'Markdown' },
    )
    return true
  }

  const space = await apiClient.createSpace(parsed)
  if (!space) {
    await ctx.reply('Could not create space. Please try again.')
    return true
  }

  const dateRange =
    parsed.startDate && parsed.endDate ? `\nDates: ${parsed.startDate} – ${parsed.endDate}` : ''
  const budgetLine = parsed.budgetCents
    ? `\nBudget: S$${(parsed.budgetCents / 100).toFixed(2)}`
    : ''
  const label = `${space.emoji ?? '📦'} ${space.name}`

  await ctx.reply(
    `Created ${label}${dateRange}${budgetLine}\n\nSet as active space?`,
    { reply_markup: buildSpaceCreatedKeyboard(space.id) },
  )
  return true
}

// Suppress unused import warning — log is used for future debug statements
void log
