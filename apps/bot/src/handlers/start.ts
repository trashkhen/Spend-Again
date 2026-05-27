import { InlineKeyboard } from 'grammy'
import type { CommandContext, Context } from 'grammy'
import { MSG_WELCOME, createLogger, requireEnv } from '@spend-again/shared'
import { mainKeyboard } from '../keyboards/main.js'
import { loginViaTelegram } from '../lib/api-client.js'

const log = createLogger('bot:start')

export async function startHandler(ctx: CommandContext<Context>): Promise<void> {
  const from = ctx.from
  const dashboardUrl = process.env['DASHBOARD_URL'] ?? 'https://spend-again-dashboard.vercel.app'
  const apiUrl = requireEnv('API_URL')

  let authedUrl = dashboardUrl
  if (from !== undefined) {
    const auth = await loginViaTelegram(from, apiUrl)
    if (auth !== null) {
      authedUrl = `${dashboardUrl}/auth?token=${encodeURIComponent(auth.token)}`
      log.info({ telegramId: from.id, username: from.username ?? null }, 'Authenticated user')
    } else {
      log.warn({ telegramId: from.id, apiUrl }, 'Could not obtain token — dashboard link will have no token')
    }
  }

  await ctx.reply(MSG_WELCOME(authedUrl), { reply_markup: mainKeyboard, parse_mode: 'HTML' })

  if (authedUrl.includes('/auth?token=')) {
    const keyboard = new InlineKeyboard().url('🌐 Open Dashboard', authedUrl)
    await ctx.reply('Your dashboard is ready lah 👇', { reply_markup: keyboard })
  } else {
    await ctx.reply('Use the 🌐 Bring me to Site button below to open your dashboard lor.')
  }
}
