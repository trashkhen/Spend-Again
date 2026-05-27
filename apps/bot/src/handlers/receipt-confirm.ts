import type { Context } from 'grammy'
import type { Category, SubCategory } from '@spend-again/shared'
import {
  DEFAULT_CATEGORY,
  DEFAULT_SUB_CATEGORY,
  MSG_NOT_REGISTERED,
  MSG_RECEIPT_SAVED,
  MSG_RECEIPT_PARTIAL_SAVE,
  MSG_RECEIPT_SAVE_TOTAL_FAILURE,
  MSG_RECEIPT_CANCELLED,
  MSG_RECEIPT_NO_PENDING,
} from '@spend-again/shared'
import { apiClient, tokenStore, userIdStore } from '../lib/api-client.js'
import type { CreateTransactionInput } from '../lib/api-client.js'
import { pendingReceiptResults } from './receipt.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTodayDDMMYYYY(): string {
  const now = new Date()
  const dd = String(now.getDate()).padStart(2, '0')
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const yyyy = String(now.getFullYear())
  return `${dd}/${mm}/${yyyy}`
}

// ---------------------------------------------------------------------------
// Main callback query handler
// ---------------------------------------------------------------------------

/**
 * Handles callback queries prefixed with `receipt_`.
 * Registered in bot.ts for `receipt_confirm_all` and `receipt_cancel`.
 */
export async function receiptConfirmHandler(ctx: Context): Promise<void> {
  const callbackData = ctx.callbackQuery?.data
  const telegramId = ctx.from?.id
  const chatId = ctx.chat?.id

  if (callbackData === undefined || telegramId === undefined || chatId === undefined) return

  await ctx.answerCallbackQuery()

  if (callbackData === 'receipt_cancel') {
    pendingReceiptResults.delete(chatId)
    await ctx.editMessageText(MSG_RECEIPT_CANCELLED)
    return
  }

  if (callbackData === 'receipt_confirm_all') {
    await handleConfirmAll(ctx, telegramId, chatId)
    return
  }
}

// ---------------------------------------------------------------------------
// Save all items from a multi-item receipt
// ---------------------------------------------------------------------------

async function handleConfirmAll(
  ctx: Context,
  telegramId: number,
  chatId: number,
): Promise<void> {
  const receipt = pendingReceiptResults.get(chatId)
  if (receipt === undefined) {
    await ctx.editMessageText(MSG_RECEIPT_NO_PENDING)
    return
  }

  const token = tokenStore.get(telegramId)
  if (token === undefined) {
    const dashboardUrl = process.env['DASHBOARD_URL'] ?? 'https://spend-again-dashboard.vercel.app'
    await ctx.editMessageText(MSG_NOT_REGISTERED(dashboardUrl))
    return
  }

  const userId = userIdStore.get(telegramId)
  if (userId === undefined) {
    const dashboardUrl = process.env['DASHBOARD_URL'] ?? 'https://spend-again-dashboard.vercel.app'
    await ctx.editMessageText(MSG_NOT_REGISTERED(dashboardUrl))
    return
  }

  apiClient.setToken(token)

  const date = receipt.date ?? getTodayDDMMYYYY()
  const savedIds: string[] = []
  const failedItems: string[] = []

  for (const lineItem of receipt.items) {
    const category: Category =
      lineItem.category !== undefined ? lineItem.category : (DEFAULT_CATEGORY as Category)
    const subCategory: SubCategory =
      lineItem.subCategory !== undefined
        ? lineItem.subCategory
        : (DEFAULT_SUB_CATEGORY as SubCategory)

    const txInput: CreateTransactionInput = {
      userId,
      amountCents: lineItem.amount,
      item: lineItem.item,
      category,
      subCategory,
      date,
      source: 'bot',
      tier: 3,
      confidence: 0.85,
    }

    const saved = await apiClient.createTransaction(txInput)
    if (saved !== null) {
      savedIds.push(saved.id)
    } else {
      failedItems.push(lineItem.item)
    }
  }

  // Clear the pending receipt regardless of outcome
  pendingReceiptResults.delete(chatId)

  // Build a summary reply
  if (failedItems.length === 0) {
    await ctx.editMessageText(MSG_RECEIPT_SAVED(savedIds.length))
  } else if (savedIds.length > 0) {
    // Partial success
    await ctx.editMessageText(MSG_RECEIPT_PARTIAL_SAVE(savedIds.length, failedItems))
  } else {
    // Total failure
    await ctx.editMessageText(MSG_RECEIPT_SAVE_TOTAL_FAILURE)
  }
}
