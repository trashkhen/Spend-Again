import type { Context } from 'grammy'
import { MSG_NOT_REGISTERED, MSG_AUTOLOG_SETUP, MSG_AUTOLOG_KEY_FAILED } from '@spend-again/shared'
import { apiClient, tokenStore, loginViaTelegram } from '../lib/api-client.js'
import { DASHBOARD_URL } from '../lib/env.js'
import { resolveIngestUrl } from '../lib/ingest-url.js'

/** Cached token, or a fresh login when the store was emptied by a restart. */
async function resolveToken(ctx: Context): Promise<string | undefined> {
  const from = ctx.from
  if (from === undefined) return undefined
  const cached = tokenStore.get(from.id)
  if (cached !== undefined) return cached
  const auth = await loginViaTelegram(from)
  return auth?.token
}

/**
 * /autolog — mints a personal capture key for the Apple Pay Shortcut and
 * shows it once. Running it again replaces (revokes) the previous key.
 */
export async function autologCommandHandler(ctx: Context): Promise<void> {
  const token = await resolveToken(ctx)
  if (token === undefined) {
    await ctx.reply(MSG_NOT_REGISTERED(DASHBOARD_URL))
    return
  }

  apiClient.setToken(token)
  const key = await apiClient.createIngestKey()
  if (key === null) {
    await ctx.reply(MSG_AUTOLOG_KEY_FAILED)
    return
  }

  // The key goes only to the user's chat — never to logs.
  await ctx.reply(MSG_AUTOLOG_SETUP(resolveIngestUrl(process.env), key), { parse_mode: 'Markdown' })
}

/** Delete button under an auto-logged expense (`autolog_del:<txId>`). */
export async function autologDeleteHandler(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data
  if (data === undefined) return
  await ctx.answerCallbackQuery()

  const token = await resolveToken(ctx)
  if (token === undefined) {
    await ctx.reply(MSG_NOT_REGISTERED(DASHBOARD_URL))
    return
  }

  apiClient.setToken(token)
  const deleted = await apiClient.deleteTransaction(data.replace('autolog_del:', ''))
  if (!deleted) {
    await ctx.reply(`Couldn't delete leh \u{1F625} Try /edit instead.`)
    return
  }
  await ctx.editMessageText('\u{1F5D1} Deleted')
}
