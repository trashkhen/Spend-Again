import { Bot, InlineKeyboard } from 'grammy'
import { createLogger } from '@spend-again/shared'
import { BOT_TOKEN, API_URL, DASHBOARD_URL } from './lib/env.js'
import { startHandler } from './handlers/start.js'
import { helpHandler } from './handlers/help.js'
import { expenseHandler } from './handlers/expense.js'
import { confirmHandler, learnHandler } from './handlers/confirm.js'
import { recentHandler } from './handlers/recent.js'
import { receiptHandler } from './handlers/receipt.js'
import { receiptConfirmHandler } from './handlers/receipt-confirm.js'
import { queryHandler, looksLikeQuery } from './handlers/query.js'
import { editCommandHandler, editSelectHandler, handlePendingEdit, pendingEdits } from './handlers/edit.js'
import { handlePendingInlineEdit, pendingInlineEdits } from './handlers/inline-edit.js'
import {
  recurringCommandHandler,
  addRecurringStart,
  handlePendingRecurring,
  recCategoryHandler,
  recSubCategoryHandler,
  recFrequencyHandler,
  recToggleHandler,
  recDeleteHandler,
  recDeleteConfirmHandler,
  pendingRecurring,
} from './handlers/recurring.js'
import { monthlyReportHandler } from './handlers/monthly-report.js'
import {
  spaceCommandHandler,
  spaceCallbackHandler,
  handlePendingSpaceCreate,
  pendingSpaceCreate,
  pendingSpaceBudgetInput,
  handlePendingSpaceBudgetInput,
  pendingSpaceNameEdit,
  handlePendingSpaceNameEdit,
  pendingSpaceNameConfirm,
} from './handlers/space.js'
import {
  iouHandler, iouCallbackHandler, handlePendingPartialRepay,
  pendingPartialRepay, detectIouIntent, iouCommandHandler, pendingIouNew,
} from './handlers/iou.js'
import { tokenStore, loginViaTelegram } from './lib/api-client.js'

const log = createLogger('bot')

export const bot = new Bot(BOT_TOKEN)

// ── Global error handler ──────────────────────────────────────────────────────
bot.catch((err) => {
  log.error({ err: err.error }, 'Unhandled error')
  err.ctx
    .reply(
      `Eh, something went wrong leh! \u{1F625}\n` +
      `Please try again in a moment. If problem continues, type /help.`,
    )
    .catch(() => { })
})

// ── Commands ──────────────────────────────────────────────────────────────────

bot.command('start', startHandler)
bot.command('help', helpHandler)
bot.command('recent', recentHandler)
bot.command('edit', editCommandHandler)
bot.command('recurring', recurringCommandHandler)
bot.command('space', spaceCommandHandler)
bot.command('iou', iouCommandHandler)
bot.hears('💸 IOUs', iouCommandHandler)

// ── Inline keyboard callback handlers ────────────────────────────────────────

bot.callbackQuery(/^confirm_/, confirmHandler)
bot.callbackQuery(/^learn_/, learnHandler)
bot.callbackQuery(/^receipt_/, receiptConfirmHandler)
bot.callbackQuery(/^edit_select:/, editSelectHandler)
bot.callbackQuery('add_recurring', addRecurringStart)
bot.callbackQuery(/^rec_cat:/, recCategoryHandler)
bot.callbackQuery(/^rec_sub:/, recSubCategoryHandler)
bot.callbackQuery(/^rec_freq:/, recFrequencyHandler)
bot.callbackQuery(/^rec_toggle:/, recToggleHandler)
bot.callbackQuery(/^rec_delete:/, recDeleteHandler)
bot.callbackQuery(/^rec_delete_yes:/, recDeleteConfirmHandler)
bot.callbackQuery('rec_delete_cancel', recDeleteConfirmHandler)
bot.callbackQuery(/^space_/, spaceCallbackHandler)
bot.callbackQuery(/^iou_/, iouCallbackHandler)

// ── Reply keyboard button handlers ────────────────────────────────────────────

bot.hears('🌐 Bring me to Site', async (ctx) => {
  const from = ctx.from
  const dashboardUrl = DASHBOARD_URL

  if (from === undefined) {
    await ctx.reply(`Visit the dashboard: ${dashboardUrl}`)
    return
  }

  // Use cached token; re-authenticate if missing (e.g., after bot restart)
  let jwtToken = tokenStore.get(from.id)
  if (jwtToken === undefined) {
    const auth = await loginViaTelegram(from, API_URL)
    if (auth !== null) {
      jwtToken = auth.token
    }
  }

  const url =
    jwtToken !== undefined
      ? `${dashboardUrl}/auth?token=${encodeURIComponent(jwtToken)}`
      : dashboardUrl

  if (url.startsWith('https://')) {
    const keyboard = new InlineKeyboard().url('🌐 Open Dashboard', url)
    await ctx.reply('Your dashboard is ready! Tap below lah \u{1F447}', { reply_markup: keyboard })
  } else {
    await ctx.reply(`\u{1F310} Eh your dashboard link:\n${url}`)
  }
})

bot.hears('📊 Monthly Report', monthlyReportHandler)

bot.hears('📝 Recents', recentHandler)

bot.hears('📦 Spaces', spaceCommandHandler)

bot.hears('❓ Help', (ctx) => helpHandler(ctx as Parameters<typeof helpHandler>[0]))

// ── Photo / receipt handler ───────────────────────────────────────────────────

bot.on('message:photo', receiptHandler)
bot.on('message:document', receiptHandler)

// ── Text message handler — route to query or expense ─────────────────────────

bot.on('message:text', async (ctx) => {
  const chatId = ctx.chat?.id
  const text = ctx.message.text ?? ''

  // Pending recurring add flow
  if (chatId !== undefined && pendingRecurring.has(chatId)) {
    const consumed = await handlePendingRecurring(ctx)
    if (consumed) return
  }

  // Pending /space name edit flow
  if (chatId !== undefined && pendingSpaceNameEdit.has(chatId)) {
    const consumed = await handlePendingSpaceNameEdit(ctx)
    if (consumed) return
  }

  // Clear stale name-confirm entry if user sends a message instead of tapping the button
  if (chatId !== undefined && pendingSpaceNameConfirm.has(chatId)
      && !pendingSpaceNameEdit.has(chatId)) {
    pendingSpaceNameConfirm.delete(chatId)
  }

  // Pending /space create flow
  if (chatId !== undefined && pendingSpaceCreate.has(chatId)) {
    const consumed = await handlePendingSpaceCreate(ctx)
    if (consumed) return
  }

  // Pending /space budget input flow
  if (chatId !== undefined && pendingSpaceBudgetInput.has(chatId)) {
    const consumed = await handlePendingSpaceBudgetInput(ctx)
    if (consumed) return
  }

  // Pending IOU partial repayment flow
  if (chatId !== undefined && pendingPartialRepay.has(chatId)) {
    const consumed = await handlePendingPartialRepay(ctx)
    if (consumed) return
  }

  // Pending /edit flow (editing a saved transaction)
  if (chatId !== undefined && pendingEdits.has(chatId)) {
    await handlePendingEdit(ctx)
    return
  }

  // Pending inline-edit flow (correcting a parsed transaction before save)
  if (chatId !== undefined && pendingInlineEdits.has(chatId)) {
    await handlePendingInlineEdit(ctx)
    return
  }

  // Pending /iou new entry flow
  if (chatId !== undefined && pendingIouNew.has(chatId)) {
    pendingIouNew.delete(chatId)
    await iouHandler(ctx)
    return
  }

  // IOU intent check — before expenseHandler
  if (!text.startsWith('/')) {
    const iouIntent = detectIouIntent(text)
    if (iouIntent !== null) {
      await iouHandler(ctx)
      return
    }
  }

  if (!text.startsWith('/') && looksLikeQuery(text)) {
    await queryHandler(ctx)
  } else {
    await expenseHandler(ctx)
  }
})
