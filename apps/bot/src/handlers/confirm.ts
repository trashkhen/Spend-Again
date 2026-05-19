import type { Context } from 'grammy'
import { saveMapping } from '@spend-again/parser'
import type { Category, SubCategory } from '@spend-again/shared'
import {
  DEFAULT_CATEGORY,
  DEFAULT_SUB_CATEGORY,
  MSG_SAVED,
  MSG_SAVE_FAILED,
  MSG_CONFIRM_EDIT,
  MSG_CONFIRM_CANCELLED,
  MSG_NO_PENDING_EXPENSE,
  MSG_NOT_REGISTERED,
  MSG_LEARN_PROMPT,
  MSG_LEARN_SAVED,
  MSG_LEARN_DECLINED,
  MSG_LEARN_FAILED,
  MSG_LEARN_ITEM_MISSING,
  MSG_BUDGET_WARNING,
} from '@spend-again/shared'
import { apiClient, tokenStore, userIdStore } from '../lib/api-client.js'
import type { CreateTransactionInput } from '../lib/api-client.js'
import { pendingConfirmations } from './expense.js'

// Tracks which month a budget alert was already sent for each user (MM/YYYY)
const budgetAlertSentStore = new Map<number, string>()

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTodayDDMMYYYY(): string {
  const now = new Date()
  const dd = String(now.getDate()).padStart(2, '0')
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const yyyy = String(now.getFullYear())
  return `${dd}/${mm}/${yyyy}`
}

async function checkAndSendBudgetAlert(ctx: Context, telegramId: number, userId: string): Promise<void> {
  const now = new Date()
  const monthKey = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`

  if (budgetAlertSentStore.get(telegramId) === monthKey) return

  const [summary, budgetData] = await Promise.all([
    apiClient.getSpendingSummary(userId),
    apiClient.getBudget(),
  ])

  if (summary === null || budgetData === null || budgetData.monthlyBudget === null) return

  const spentPct = (summary.totalCents / budgetData.monthlyBudget) * 100
  if (spentPct < budgetData.budgetAlertPct) return

  const spentStr = (summary.totalCents / 100).toFixed(2)
  const budgetStr = (budgetData.monthlyBudget / 100).toFixed(2)
  const pctRounded = Math.round(spentPct)

  await ctx.reply(MSG_BUDGET_WARNING(spentStr, budgetStr, pctRounded), { parse_mode: 'Markdown' })
  budgetAlertSentStore.set(telegramId, monthKey)
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function confirmHandler(ctx: Context): Promise<void> {
  const callbackData = ctx.callbackQuery?.data
  const telegramId = ctx.from?.id
  const chatId = ctx.chat?.id

  if (callbackData === undefined || telegramId === undefined || chatId === undefined) {
    return
  }

  // Always acknowledge the callback query to dismiss the spinner
  await ctx.answerCallbackQuery()

  if (callbackData === 'confirm_yes') {
    await handleConfirmYes(ctx, telegramId, chatId)
    return
  }

  if (callbackData === 'confirm_edit') {
    await handleConfirmEdit(ctx, chatId)
    return
  }

  if (callbackData === 'confirm_no') {
    await handleConfirmNo(ctx, chatId)
    return
  }
}

// ── confirm_yes ───────────────────────────────────────────────────────────────

async function handleConfirmYes(
  ctx: Context,
  telegramId: number,
  chatId: number,
): Promise<void> {
  const result = pendingConfirmations.get(chatId)
  if (result === undefined) {
    await ctx.editMessageText(MSG_NO_PENDING_EXPENSE)
    return
  }

  const token = tokenStore.get(telegramId)
  if (token === undefined) {
    const dashboardUrl = process.env['DASHBOARD_URL'] ?? 'http://localhost:5173'
    await ctx.editMessageText(MSG_NOT_REGISTERED(dashboardUrl))
    return
  }

  // Set token on API client for this request
  apiClient.setToken(token)

  // Resolve the database UUID for this user (stored at /start login)
  const userId = userIdStore.get(telegramId)
  if (userId === undefined) {
    const dashboardUrl = process.env['DASHBOARD_URL'] ?? 'http://localhost:5173'
    await ctx.editMessageText(MSG_NOT_REGISTERED(dashboardUrl))
    return
  }

  const category: Category =
    result.category !== undefined ? result.category : (DEFAULT_CATEGORY as Category)
  const subCategory: SubCategory =
    result.subCategory !== undefined ? result.subCategory : (DEFAULT_SUB_CATEGORY as SubCategory)

  const txInput: CreateTransactionInput = {
    userId,
    amountCents: result.amount,
    item: result.item,
    category,
    subCategory,
    date: result.date ?? getTodayDDMMYYYY(),
    source: 'bot',
    tier: result.tier,
    confidence: result.confidence,
  }

  const saved = await apiClient.createTransaction(txInput)

  // Clear pending confirmation regardless of save outcome
  pendingConfirmations.delete(chatId)

  if (saved !== null) {
    await ctx.editMessageText(MSG_SAVED)

    // Tier 3 results (Gemini-resolved) — offer to remember the mapping
    if (result.tier === 3) {
      await ctx.reply(MSG_LEARN_PROMPT(result.item, category, subCategory), {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Yes, remember it \u{1F9E0}',
                callback_data: `learn_yes|${encodeURIComponent(result.item)}|${category}|${subCategory}`,
              },
              { text: 'No thanks', callback_data: 'learn_no' },
            ],
          ],
        },
      })
    }

    await checkAndSendBudgetAlert(ctx, telegramId, userId)
  } else {
    await ctx.editMessageText(MSG_SAVE_FAILED)
  }
}

// ── confirm_edit ──────────────────────────────────────────────────────────────

async function handleConfirmEdit(ctx: Context, chatId: number): Promise<void> {
  // Clear the pending confirmation so the next message starts fresh
  pendingConfirmations.delete(chatId)
  await ctx.editMessageText(MSG_CONFIRM_EDIT)
}

// ── confirm_no ────────────────────────────────────────────────────────────────

async function handleConfirmNo(ctx: Context, chatId: number): Promise<void> {
  pendingConfirmations.delete(chatId)
  await ctx.editMessageText(MSG_CONFIRM_CANCELLED)
}

// ── learn_yes / learn_no (Tier-3 remember prompt) ─────────────────────────────

export async function learnHandler(ctx: Context): Promise<void> {
  const callbackData = ctx.callbackQuery?.data
  if (callbackData === undefined) return

  await ctx.answerCallbackQuery()

  if (callbackData === 'learn_no') {
    await ctx.editMessageText(MSG_LEARN_DECLINED)
    return
  }

  if (callbackData.startsWith('learn_yes|')) {
    const parts = callbackData.split('|')
    const itemName = decodeURIComponent(parts[1] ?? '')
    const category = (parts[2] ?? DEFAULT_CATEGORY) as Category
    const subCategory = (parts[3] ?? DEFAULT_SUB_CATEGORY) as SubCategory

    if (itemName.length === 0) {
      await ctx.editMessageText(MSG_LEARN_ITEM_MISSING)
      return
    }

    try {
      await saveMapping(itemName, category, subCategory, 'user')
      await ctx.editMessageText(MSG_LEARN_SAVED(itemName, category, subCategory))
    } catch {
      await ctx.editMessageText(MSG_LEARN_FAILED)
    }
  }
}
