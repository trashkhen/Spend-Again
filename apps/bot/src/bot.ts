import { Bot } from 'grammy'
import { startHandler } from './handlers/start.js'
import { helpHandler } from './handlers/help.js'
import { expenseHandler } from './handlers/expense.js'
import { confirmHandler, learnHandler } from './handlers/confirm.js'
import { recentHandler } from './handlers/recent.js'
import { receiptHandler } from './handlers/receipt.js'
import { receiptConfirmHandler } from './handlers/receipt-confirm.js'
import { tokenStore } from './lib/api-client.js'

const token = process.env['BOT_TOKEN']
if (!token) throw new Error('BOT_TOKEN is required')

export const bot = new Bot(token)

// ── Commands ──────────────────────────────────────────────────────────────────

bot.command('start', startHandler)
bot.command('help', helpHandler)
bot.command('recent', recentHandler)

// ── Inline keyboard callback handlers ────────────────────────────────────────

bot.callbackQuery(/^confirm_/, confirmHandler)
bot.callbackQuery(/^learn_/, learnHandler)
bot.callbackQuery(/^receipt_/, receiptConfirmHandler)

// ── Reply keyboard button handlers ────────────────────────────────────────────

bot.hears('📊 Dashboard', async (ctx) => {
  const telegramId = ctx.from?.id
  const dashboardUrl = process.env['DASHBOARD_URL'] ?? 'http://localhost:5173'

  if (telegramId === undefined) {
    await ctx.reply(`Visit the dashboard: ${dashboardUrl}`)
    return
  }

  const jwtToken = tokenStore.get(telegramId)
  const url =
    jwtToken !== undefined
      ? `${dashboardUrl}?token=${encodeURIComponent(jwtToken)}`
      : dashboardUrl

  await ctx.reply(`📊 Open your dashboard:\n${url}`)
})

bot.hears('📝 Recent', recentHandler)

bot.hears('❓ Help', (ctx) => helpHandler(ctx as Parameters<typeof helpHandler>[0]))

// ── Photo / receipt handler ───────────────────────────────────────────────────

bot.on('message:photo', receiptHandler)
bot.on('message:document', receiptHandler)

// ── Expense text message handler ──────────────────────────────────────────────

bot.on('message:text', expenseHandler)
