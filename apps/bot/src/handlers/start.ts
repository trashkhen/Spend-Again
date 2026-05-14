import type { CommandContext, Context } from 'grammy'
import { MSG_WELCOME } from '@spend-again/shared'
import { mainKeyboard } from '../keyboards/main.js'

export async function startHandler(ctx: CommandContext<Context>): Promise<void> {
  const dashboardUrl = process.env['DASHBOARD_URL'] ?? 'http://localhost:5173'
  await ctx.reply(MSG_WELCOME(dashboardUrl), { reply_markup: mainKeyboard })
}
