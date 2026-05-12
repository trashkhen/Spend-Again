import type { CommandContext, Context } from 'grammy'

export async function helpHandler(ctx: CommandContext<Context>): Promise<void> {
  await ctx.reply(
    'Available commands:\n\n' +
      '/start — Welcome message\n' +
      '/help — Show this help\n\n' +
      'More commands coming soon (expense logging, history, and more).',
  )
}
