import { Bot, InlineKeyboard } from 'grammy'
import { createLogger, requireEnv } from '@spend-again/shared'
import { startHandler } from './handlers/start.js'
import { helpHandler } from './handlers/help.js'
import { expenseHandler } from './handlers/expense.js'
import { confirmHandler, learnHandler } from './handlers/confirm.js'
import { recentHandler } from './handlers/recent.js'
import { receiptHandler } from './handlers/receipt.js'
import { receiptConfirmHandler } from './handlers/receipt-confirm.js'
import { queryHandler, looksLikeQuery } from './handlers/query.js'
import { monthlyReportHandler } from './handlers/monthly-report.js'
import { tokenStore, loginViaTelegram } from './lib/api-client.js'

const log = createLogger('bot')

const token = requireEnv('BOT_TOKEN')

export const bot = new Bot(token)

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

// ── Inline keyboard callback handlers ────────────────────────────────────────

bot.callbackQuery(/^confirm_/, confirmHandler)
bot.callbackQuery(/^learn_/, learnHandler)
bot.callbackQuery(/^receipt_/, receiptConfirmHandler)

// ── Reply keyboard button handlers ────────────────────────────────────────────

bot.hears('🌐 Bring me to Site', async (ctx) => {
  const from = ctx.from
  const dashboardUrl = process.env['DASHBOARD_URL'] ?? 'https://spend-again-dashboard.vercel.app'
  const apiUrl = requireEnv('API_URL')

  if (from === undefined) {
    await ctx.reply(`Visit the dashboard: ${dashboardUrl}`)
    return
  }

  // Use cached token; re-authenticate if missing (e.g., after bot restart)
  let jwtToken = tokenStore.get(from.id)
  if (jwtToken === undefined) {
    const auth = await loginViaTelegram(from, apiUrl)
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

bot.hears('❓ Help', (ctx) => helpHandler(ctx as Parameters<typeof helpHandler>[0]))

// ── Photo / receipt handler ───────────────────────────────────────────────────

bot.on('message:photo', receiptHandler)
bot.on('message:document', receiptHandler)

// ── Text message handler — route to query or expense ─────────────────────────

bot.on('message:text', async (ctx) => {
  const text = ctx.message.text ?? ''
  if (!text.startsWith('/') && looksLikeQuery(text)) {
    await queryHandler(ctx)
  } else {
    await expenseHandler(ctx)
  }
})
