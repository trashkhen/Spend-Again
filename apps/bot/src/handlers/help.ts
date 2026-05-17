import type { CommandContext, Context } from 'grammy'
import { MSG_HELP } from '@spend-again/shared'

export async function helpHandler(ctx: CommandContext<Context>): Promise<void> {
  await ctx.reply(MSG_HELP)
}
