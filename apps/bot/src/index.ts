/**
 * Bot entry point.
 *
 * In production (NODE_ENV=production) the bot uses webhook mode:
 *   - `WEBHOOK_URL` must be set to the public HTTPS URL of the bot service.
 *   - `PORT` controls which port the webhook HTTP server listens on.
 *
 * In development the bot falls back to long-polling (no webhook required).
 */

import { webhookCallback } from 'grammy'
import { createServer } from 'node:http'
import { bot } from './bot.js'
import { initDevMode } from './lib/dev-mode.js'

const isProduction = process.env['NODE_ENV'] === 'production'

// ── Dev mode: pre-register test user ────────────────────────────────────────
// Set DEV_TELEGRAM_ID to your real Telegram user ID (numeric) to automatically
// link all your bot messages to the test user, bypassing the login flow.
const devTelegramId = process.env['DEV_TELEGRAM_ID']
if (!isProduction && devTelegramId !== undefined) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const result = await initDevMode(apiUrl, Number(devTelegramId))
  if (result === null) {
    console.warn('[bot] Dev mode init failed — bot will require normal auth')
  }
}
const webhookUrl = process.env['WEBHOOK_URL']
const port = Number(process.env['PORT'] ?? 3002)

if (isProduction && webhookUrl !== undefined && webhookUrl.length > 0) {
  // ── Webhook mode ────────────────────────────────────────────────────────────
  // Set the webhook with Telegram, then start an HTTP server to receive updates.

  await bot.api.setWebhook(webhookUrl)
  console.log(`[bot] Webhook set to ${webhookUrl}`)

  const handleUpdate = webhookCallback(bot, 'http')

  const server = createServer(async (req, res) => {
    if (req.method === 'POST') {
      await handleUpdate(req, res)
    } else {
      res.writeHead(200)
      res.end('Spend Again? Bot — webhook active')
    }
  })

  server.listen(port, () => {
    console.log(`[bot] Webhook server listening on port ${port}`)
  })
} else {
  // ── Long-polling mode (development) ────────────────────────────────────────
  console.log('[bot] Starting in long-polling mode (development)')
  await bot.start()
}
