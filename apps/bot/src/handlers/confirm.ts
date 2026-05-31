import { randomBytes } from 'node:crypto'
import type { Context } from 'grammy'
import { createLogger, getTodayDDMMYYYY } from '@spend-again/shared'
import type { Category, SubCategory } from '@spend-again/shared'
import { parseWithRegex } from '@spend-again/parser'
import {
  DEFAULT_CATEGORY,
  DEFAULT_SUB_CATEGORY,
  MSG_SAVED,
  MSG_SAVE_FAILED,
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
import { DASHBOARD_URL } from '../lib/env.js'
import { pendingConfirmations } from './expense.js'
import { pendingInlineEdits } from './inline-edit.js'

const log = createLogger('bot:confirm')

// Tracks which month a budget alert was already sent for each user (MM/YYYY)
const budgetAlertSentStore = new Map<number, string>()

// ── Pending "learn this mapping" prompts ──────────────────────────────────────
//
// Telegram caps inline-keyboard callback_data at 64 bytes. Previously the bot
// jammed item/category/subCategory into the callback string, which broke when
// any field had non-ASCII characters or just exceeded the budget. Now we stash
// the trio in-memory keyed by a short random id and put only `learn_yes|<id>`
// on the wire (~22 bytes total, well under the limit).
//
// TTL eviction (10 min) prevents stale prompts from accumulating if a user
// never taps a button.
type PendingLearn = {
  item: string
  // The key actually stored in learned_mappings — equals the regex-extracted
  // item (or raw input when regex found no amount). Must match what Tier 2
  // looks up next time so the cache actually hits.
  lookupKey: string
  category: Category
  subCategory: SubCategory
  createdAt: number
  telegramId: number
}
export const pendingLearnPrompts = new Map<string, PendingLearn>()
const PENDING_LEARN_TTL_MS = 10 * 60 * 1000

function evictStaleLearnPrompts(now: number): void {
  for (const [id, entry] of pendingLearnPrompts) {
    if (now - entry.createdAt > PENDING_LEARN_TTL_MS) pendingLearnPrompts.delete(id)
  }
}

function makeLearnId(): string {
  // 6 bytes → 12 hex chars; collision-resistant for the volume we ever hold.
  return randomBytes(6).toString('hex')
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function checkAndSendBudgetAlert(ctx: Context, telegramId: number, userId: string): Promise<void> {
  try {
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
  } catch (err) {
    log.error({ err }, 'checkAndSendBudgetAlert error')
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function confirmHandler(ctx: Context): Promise<void> {
  const callbackData = ctx.callbackQuery?.data
  const telegramId = ctx.from?.id
  const chatId = ctx.chat?.id

  if (callbackData === undefined || telegramId === undefined || chatId === undefined) {
    return
  }

  if (callbackData === 'confirm_space_skip') {
    const entry = pendingConfirmations.get(chatId)
    if (entry) {
      pendingConfirmations.set(chatId, {
        ...entry,
        activeSpaceId: undefined,
        activeSpaceName: undefined,
        suggestedSpaceId: undefined,
        suggestedSpaceName: undefined,
      })
    }
    await ctx.answerCallbackQuery('Will log to main dashboard only.')
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
  const entry = pendingConfirmations.get(chatId)
  if (entry === undefined) {
    await ctx.editMessageText(MSG_NO_PENDING_EXPENSE)
    return
  }
  const { result, rawInput } = entry

  const token = tokenStore.get(telegramId)
  if (token === undefined) {
    await ctx.editMessageText(MSG_NOT_REGISTERED(DASHBOARD_URL))
    return
  }

  // Set token on API client for this request
  apiClient.setToken(token)

  // Resolve the database UUID for this user (stored at /start login)
  const userId = userIdStore.get(telegramId)
  if (userId === undefined) {
    await ctx.editMessageText(MSG_NOT_REGISTERED(DASHBOARD_URL))
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

  if (saved !== null) {
    // Clear pending FIRST so re-taps are no-ops
    pendingConfirmations.delete(chatId)

    await ctx.editMessageText(MSG_SAVED)

    // Attach to space if active or suggested
    const spaceIdToAttach = entry.activeSpaceId ?? entry.suggestedSpaceId
    if (spaceIdToAttach && saved.id) {
      try {
        await apiClient.attachTransactionToSpace(saved.id, spaceIdToAttach)
      } catch (err) {
        log.error({ err }, 'attachTransactionToSpace failed')
      }
    }

    // Tier 3 results (Gemini-resolved) — offer to remember the mapping.
    // lookupKey = what Tier 2 will search for next time (regex-extracted item,
    // or full raw input when regex found no amount). Saving under this key
    // ensures the cache actually hits instead of relying on Gemini's item name
    // which may differ from what the regex extractor produces.
    if (result.tier === 3) {
      const now = Date.now()
      evictStaleLearnPrompts(now)
      const learnId = makeLearnId()
      const lookupKey = parseWithRegex(rawInput)?.item ?? rawInput
      pendingLearnPrompts.set(learnId, {
        item: result.item,
        lookupKey,
        category,
        subCategory,
        createdAt: now,
        telegramId,
      })
      await ctx.reply(MSG_LEARN_PROMPT(result.item, category, subCategory), {
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Yes, remember it \u{1F9E0}', callback_data: `learn_yes|${learnId}` },
              { text: 'No thanks', callback_data: 'learn_no' },
            ],
          ],
        },
      })
    }

    await checkAndSendBudgetAlert(ctx, telegramId, userId)
  } else {
    pendingConfirmations.delete(chatId)
    await ctx.editMessageText(MSG_SAVE_FAILED)
  }
}

// ── confirm_edit ──────────────────────────────────────────────────────────────

async function handleConfirmEdit(ctx: Context, chatId: number): Promise<void> {
  pendingInlineEdits.add(chatId)
  await ctx.editMessageText(
    `No worries! Send the corrected details:\n\`[price] [item] [category] [sub-category]\`\n\nExample: \`3.50 coffee Food Cafe\`\n\nSub-category is optional.`,
    { parse_mode: 'Markdown' },
  )
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
    const id = callbackData.slice('learn_yes|'.length)
    const pending = pendingLearnPrompts.get(id)
    pendingLearnPrompts.delete(id)

    if (pending === undefined) {
      // Expired (>10 min), bot restarted, or duplicate tap.
      await ctx.editMessageText(MSG_LEARN_ITEM_MISSING)
      return
    }

    const token = tokenStore.get(pending.telegramId)
    if (!token) {
      await ctx.editMessageText(MSG_NOT_REGISTERED(DASHBOARD_URL))
      return
    }
    apiClient.setToken(token)

    try {
      // Save under lookupKey (not pending.item) so the DB key matches what
      // Tier 2 will search for next time the same input arrives.
      const ok = await apiClient.saveLearnedMapping(pending.lookupKey, pending.category, pending.subCategory)
      if (!ok) throw new Error('save failed')
      await ctx.editMessageText(MSG_LEARN_SAVED(pending.item, pending.category, pending.subCategory))
    } catch {
      await ctx.editMessageText(MSG_LEARN_FAILED)
    }
  }
}
