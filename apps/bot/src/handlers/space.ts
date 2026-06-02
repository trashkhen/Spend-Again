import type { Context } from 'grammy'
import { createLogger } from '@spend-again/shared'
import { parseSpaceWithGemini } from '@spend-again/parser'
import type { ParsedSpaceResult } from '@spend-again/parser'
import { apiClient, tokenStore } from '../lib/api-client.js'
import {
  buildSpaceListKeyboard,
  buildSpaceActiveKeyboard,
  buildSpaceCreatedKeyboard,
  buildSpaceBudgetChoiceKeyboard,
  buildSpaceNameEmojiConfirmKeyboard,
  buildSpaceDeleteConfirmKeyboard,
  buildSpaceArchivedListKeyboard,
  buildSpaceArchivedItemKeyboard,
} from '../keyboards/space.js'

const log = createLogger('bot:space')

export const pendingSpaceCreate = new Set<number>()

type PendingSpaceDetails = {
  name: string
  emoji?: string | null
  startDate?: string | null
  endDate?: string | null
}
export const pendingSpaceDetails = new Map<number, PendingSpaceDetails>()
export const pendingSpaceBudgetInput = new Map<number, PendingSpaceDetails>()

type PendingNameConfirm = PendingSpaceDetails & { budgetCents?: number | null }
export const pendingSpaceNameConfirm = new Map<number, PendingNameConfirm>()
export const pendingSpaceNameEdit = new Set<number>()

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

  return {
    name,
    ...(budgetCents !== undefined ? { budgetCents } : {}),
    ...(startDate !== undefined ? { startDate } : {}),
    ...(endDate !== undefined ? { endDate } : {}),
  }
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

  const raw = typeof ctx.match === 'string' ? ctx.match.trim() : ''
  const arg = raw === '📦 Spaces' ? '' : raw

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
    return
  }

  if (data.startsWith('space_budget_choice:')) {
    const choice = data.slice('space_budget_choice:'.length)
    const details = pendingSpaceDetails.get(chatId)
    pendingSpaceDetails.delete(chatId)

    if (!details) {
      await ctx.editMessageText('Session expired. Please try creating a space again.')
      return
    }

    if (choice === 'no') {
      await ctx.editMessageText('Proceeding with no budget...')
      await createSpaceAndPrompt(ctx, {
        name: details.name,
        emoji: details.emoji ?? null,
        ...(details.startDate ? { startDate: details.startDate } : {}),
        ...(details.endDate ? { endDate: details.endDate } : {}),
      })
      return
    }

    if (choice === 'yes') {
      pendingSpaceBudgetInput.set(chatId, {
        name: details.name,
        emoji: details.emoji,
        startDate: details.startDate,
        endDate: details.endDate,
      })
      await ctx.editMessageText('Input amount e.g. 800')
      return
    }
  }

  // Name+emoji confirmation
  if (data === 'space_name_confirm') {
    const details = pendingSpaceNameConfirm.get(chatId)
    pendingSpaceNameConfirm.delete(chatId)
    if (!details) { await ctx.editMessageText('Session expired. Please try creating a space again.'); return }
    if (details.budgetCents !== undefined && details.budgetCents !== null) {
      await ctx.editMessageText('Creating space…')
      await createSpaceAndPrompt(ctx, {
        name: details.name,
        emoji: details.emoji,
        budgetCents: details.budgetCents,
        ...(details.startDate ? { startDate: details.startDate } : {}),
        ...(details.endDate ? { endDate: details.endDate } : {}),
      })
      return
    }
    pendingSpaceDetails.set(chatId, {
      name: details.name,
      emoji: details.emoji,
      startDate: details.startDate,
      endDate: details.endDate,
    })
    const label = details.emoji ? `${details.emoji} ${details.name}` : details.name
    await ctx.editMessageText(
      `Got it! Do you want to set a budget for *${label}*?`,
      { parse_mode: 'Markdown', reply_markup: buildSpaceBudgetChoiceKeyboard() },
    )
    return
  }

  if (data === 'space_name_edit') {
    const details = pendingSpaceNameConfirm.get(chatId)
    if (!details) { await ctx.editMessageText('Session expired. Please try creating a space again.'); return }
    pendingSpaceNameEdit.add(chatId)
    const fallback = `📦 ${details.name}`
    await ctx.editMessageText(
      `No problem! I suggest: *${fallback}*\n\nSend a new name (you can start with an emoji, e.g. "🎓 NUS Sem 2").`,
      { parse_mode: 'Markdown' },
    )
    return
  }

  // Deactivate
  if (data.startsWith('space_deactivate:')) {
    const spaceId = data.slice('space_deactivate:'.length)
    const ok = await apiClient.updateSpace(spaceId, { status: 'archived' })
    await ctx.editMessageText(
      ok ? 'Space deactivated. Use /space → 📂 Archived Spaces to reactivate.' : 'Could not deactivate. Try again.',
    )
    return
  }

  // Delete — first confirmation step
  if (data.startsWith('space_delete_confirm:')) {
    const spaceId = data.slice('space_delete_confirm:'.length)
    await ctx.editMessageText(
      'Permanently delete this space? Transactions are kept.',
      { reply_markup: buildSpaceDeleteConfirmKeyboard(spaceId) },
    )
    return
  }

  // Delete — final confirm
  if (data.startsWith('space_delete_final:')) {
    const spaceId = data.slice('space_delete_final:'.length)
    const ok = await apiClient.hardDeleteSpace(spaceId)
    await ctx.editMessageText(ok ? '✅ Space permanently deleted.' : 'Could not delete. Try again.')
    return
  }

  if (data === 'space_delete_cancel') {
    await ctx.editMessageText('Cancelled.')
    return
  }

  // Archived spaces list
  if (data === 'space_show_archived') {
    const allSpaces = await apiClient.listSpaces()
    const archived = allSpaces.filter(s => s.status === 'archived')
    if (archived.length === 0) {
      await ctx.editMessageText('No archived spaces.')
      return
    }
    await ctx.editMessageText('Archived spaces:', { reply_markup: buildSpaceArchivedListKeyboard(archived) })
    return
  }

  if (data.startsWith('space_archived_view:')) {
    const spaceId = data.slice('space_archived_view:'.length)
    const allSpaces = await apiClient.listSpaces()
    const space = allSpaces.find(s => s.id === spaceId)
    if (!space) { await ctx.editMessageText('Space not found.'); return }
    const label = `${space.emoji ?? '📦'} ${space.name}`
    await ctx.editMessageText(
      `${label}\nStatus: archived\nSpent: S$${space.spent} (${space.transactionCount} transactions)`,
      { reply_markup: buildSpaceArchivedItemKeyboard(spaceId) },
    )
    return
  }

  if (data.startsWith('space_reactivate:')) {
    const spaceId = data.slice('space_reactivate:'.length)
    const space = await apiClient.updateSpace(spaceId, { status: 'active' })
    const label = space ? `${space.emoji ?? '📦'} ${space.name}` : 'Space'
    await ctx.editMessageText(`♻️ ${label} reactivated! Use /space to activate it.`)
    return
  }

  if (data === 'space_back_to_active') {
    const [allSpaces, activeSpace] = await Promise.all([apiClient.listSpaces(), apiClient.getActiveSpace()])
    const activeLabel = activeSpace ? `${activeSpace.emoji ?? '📦'} ${activeSpace.name}` : 'None'
    const activeSpaces = allSpaces.filter(s => s.status === 'active')
    await ctx.editMessageText(
      `Active space: ${activeLabel}\n\nChoose a space:`,
      { reply_markup: buildSpaceListKeyboard(activeSpaces, activeSpace !== null) },
    )
    return
  }
}

async function createSpaceAndPrompt(
  ctx: Context,
  payload: { name: string; emoji?: string | null; budgetCents?: number; startDate?: string; endDate?: string }
): Promise<void> {
  const space = await apiClient.createSpace({
    name: payload.name,
    ...(payload.emoji ? { emoji: payload.emoji } : {}),
    ...(payload.budgetCents !== undefined ? { budgetCents: payload.budgetCents } : {}),
    ...(payload.startDate ? { startDate: payload.startDate } : {}),
    ...(payload.endDate ? { endDate: payload.endDate } : {}),
  })
  if (!space) {
    await ctx.reply('Could not create space. Please try again.')
    return
  }
  const label = `${space.emoji ?? '📦'} ${space.name}`
  const dateRange = payload.startDate && payload.endDate
    ? `\nDates: ${payload.startDate} – ${payload.endDate}` : ''
  const budgetLine = payload.budgetCents
    ? `\nBudget: S$${(payload.budgetCents / 100).toFixed(2)}` : ''
  await ctx.reply(
    `Created ${label}${dateRange}${budgetLine}\n\nSet as active space?`,
    { reply_markup: buildSpaceCreatedKeyboard(space.id) },
  )
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

  // Try parsing with Gemini first for dynamic range and extraction
  let parsed: ParsedSpaceResult | null = null
  try {
    parsed = await parseSpaceWithGemini(text)
  } catch (err) {
    log.error({ err }, 'Gemini space parsing failed')
  }

  // Fallback to regex if Gemini returned null or failed
  if (!parsed) {
    parsed = parseSpaceCreate(text)
  }

  if (!parsed) {
    await ctx.reply(
      'Could not parse space details. Try: `Bali Trip from 03/06 to 08/06 budget $500`',
      { parse_mode: 'Markdown' },
    )
    return true
  }

  // Always show name+emoji confirmation before proceeding
  const emoji = parsed.emoji ?? null
  const suggestionLabel = emoji ? `${emoji} ${parsed.name}` : `📦 ${parsed.name}`
  const datesLine = parsed.startDate && parsed.endDate
    ? `\nDates: ${parsed.startDate} – ${parsed.endDate}` : ''

  pendingSpaceNameConfirm.set(chatId, {
    name: parsed.name,
    emoji,
    startDate: parsed.startDate ?? null,
    endDate: parsed.endDate ?? null,
    budgetCents: parsed.budgetCents ?? null,
  })

  await ctx.reply(
    `Here's what I got:\n*${suggestionLabel}*${datesLine}\n\nUse this name and emoji?`,
    { parse_mode: 'Markdown', reply_markup: buildSpaceNameEmojiConfirmKeyboard() },
  )
  return true
}

export async function handlePendingSpaceBudgetInput(ctx: Context): Promise<boolean> {
  const text = ctx.message?.text
  const telegramId = ctx.from?.id
  const chatId = ctx.chat?.id
  if (!text || !telegramId || !chatId) return false
  if (!pendingSpaceBudgetInput.has(chatId)) return false

  const details = pendingSpaceBudgetInput.get(chatId)
  if (!details) return false

  pendingSpaceBudgetInput.delete(chatId)

  const token = await ensureToken(telegramId)
  if (!token) return false
  apiClient.setToken(token)

  // Parse numeric budget from input (e.g. "800", "$800", "SGD 800")
  const amountMatch = text.match(/(?:S?\$|SGD\s*)?(\d+(?:\.\d{1,2})?)/i)
  const amount = amountMatch?.[1] ? parseFloat(amountMatch[1]) : NaN

  if (isNaN(amount) || amount <= 0) {
    await ctx.reply('Invalid budget amount. Proceeding with no budget...')
    await createSpaceAndPrompt(ctx, {
      name: details.name,
      emoji: details.emoji ?? null,
      ...(details.startDate ? { startDate: details.startDate } : {}),
      ...(details.endDate ? { endDate: details.endDate } : {}),
    })
    return true
  }

  const budgetCents = Math.round(amount * 100)
  await createSpaceAndPrompt(ctx, {
    name: details.name,
    emoji: details.emoji ?? null,
    budgetCents,
    ...(details.startDate ? { startDate: details.startDate } : {}),
    ...(details.endDate ? { endDate: details.endDate } : {}),
  })

  return true
}

export async function handlePendingSpaceNameEdit(ctx: Context): Promise<boolean> {
  const text = ctx.message?.text
  const telegramId = ctx.from?.id
  const chatId = ctx.chat?.id
  if (!text || !telegramId || !chatId) return false
  if (!pendingSpaceNameEdit.has(chatId)) return false

  pendingSpaceNameEdit.delete(chatId)
  const details = pendingSpaceNameConfirm.get(chatId)
  pendingSpaceNameConfirm.delete(chatId)

  if (!details) {
    await ctx.reply('Session expired. Please type /space to start over.')
    return true
  }

  // Parse optional leading emoji
  const emojiMatch = text.match(/^(\p{Emoji_Presentation}|\p{Emoji}️)/u)
  const emoji = emojiMatch?.[0] ?? null
  const name = emoji ? text.slice(emoji.length).trim() : text.trim()

  if (!name) {
    await ctx.reply('Name cannot be empty. Please try creating a space again with /space.')
    return true
  }

  const token = await ensureToken(telegramId)
  if (!token) return true
  apiClient.setToken(token)

  pendingSpaceDetails.set(chatId, {
    name,
    emoji,
    startDate: details.startDate ?? null,
    endDate: details.endDate ?? null,
  })

  const label = emoji ? `${emoji} ${name}` : name
  await ctx.reply(
    `Got it! Do you want to set a budget for *${label}*?`,
    { parse_mode: 'Markdown', reply_markup: buildSpaceBudgetChoiceKeyboard() },
  )
  return true
}

// Suppress unused import warning — log is used for future debug statements
void log
