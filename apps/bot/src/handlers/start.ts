import { createHmac, createHash } from 'node:crypto'
import { InlineKeyboard } from 'grammy'
import type { CommandContext, Context } from 'grammy'
import { MSG_WELCOME } from '@spend-again/shared'
import { mainKeyboard } from '../keyboards/main.js'
import { tokenStore, userIdStore } from '../lib/api-client.js'

const API_URL = process.env['API_URL'] ?? 'http://localhost:3001'
console.log(`[start] API_URL = ${API_URL}`)

/**
 * Authenticates the Telegram user against the API using the same HMAC-SHA256
 * hash the Telegram Login Widget would produce. The bot token IS the secret,
 * so we can generate a valid hash for any user the bot has context for.
 */
async function loginViaTelegram(from: NonNullable<Context['from']>): Promise<{ token: string; userId: string } | null> {
  const botToken = process.env['BOT_TOKEN'] ?? ''
  if (!botToken) return null

  const authDate = Math.floor(Date.now() / 1000)

  // Build fields exactly as the API's verifyTelegramAuth() expects
  const fields: Record<string, string> = {
    id: String(from.id),
    auth_date: String(authDate),
  }
  if (from.first_name) fields['first_name'] = from.first_name
  if (from.last_name) fields['last_name'] = from.last_name
  if (from.username) fields['username'] = from.username

  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n')

  const secret = createHash('sha256').update(botToken).digest()
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex')

  try {
    const body: Record<string, string | number> = {
      id: String(from.id),
      auth_date: authDate, // API schema expects number
      hash,
    }
    if (from.first_name) body['first_name'] = from.first_name
    if (from.last_name) body['last_name'] = from.last_name
    if (from.username) body['username'] = from.username

    const res = await fetch(`${API_URL}/api/auth/telegram-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      console.error('[start] API login failed:', res.status, await res.text())
      return null
    }

    const result = (await res.json()) as { token: string; userId: string }
    return { token: result.token, userId: result.userId }
  } catch (err) {
    console.error('[start] API login error:', err)
    return null
  }
}

export async function startHandler(ctx: CommandContext<Context>): Promise<void> {
  const from = ctx.from
  const dashboardUrl = process.env['DASHBOARD_URL'] ?? 'https://spend-again-dashboard.vercel.app'

  let authedUrl = dashboardUrl
  if (from !== undefined) {
    const auth = await loginViaTelegram(from)
    if (auth !== null) {
      tokenStore.set(from.id, auth.token)
      userIdStore.set(from.id, auth.userId)
      authedUrl = `${dashboardUrl}/auth?token=${encodeURIComponent(auth.token)}`
      console.log(`[start] Authenticated user ${from.id} (${from.username ?? 'no username'})`)
    } else {
      console.warn(`[start] Could not obtain token for user ${from.id} (API_URL=${API_URL}) — dashboard link will have no token`)
    }
  }

  await ctx.reply(MSG_WELCOME(authedUrl), { reply_markup: mainKeyboard })

  if (authedUrl.includes('/auth?token=')) {
    const keyboard = new InlineKeyboard().url('🌐 Open Dashboard', authedUrl)
    await ctx.reply('Already logged in — tap below to open your dashboard lah 👇', { reply_markup: keyboard })
  } else {
    await ctx.reply('Use the 🌐 Bring me to Site button below to open your dashboard lor.')
  }
}
