import type { CommandContext, Context } from 'grammy'

export async function startHandler(ctx: CommandContext<Context>): Promise<void> {
  await ctx.reply(
    'Welcome to Spend Again? \u{1F1F8}\u{1F1EC}\n' +
      'Track your spending effortlessly. Send me an expense like:\n' +
      "'$8.50 for chicken rice at Maxwell'\n\n" +
      'Type /help to see all commands.',
  )
}
