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
import { createLogger } from '@spend-again/shared'
import { bot } from './bot.js'
import { initDevMode } from './lib/dev-mode.js'

const log = createLogger('bot')
const isProduction = process.env['NODE_ENV'] === 'production'

// ── Dev mode: pre-register test user ────────────────────────────────────────
// Set DEV_TELEGRAM_ID to your real Telegram user ID (numeric) to automatically
// link all your bot messages to the test user, bypassing the login flow.
// A localhost fallback is intentional here — production code paths read
// API_URL via requireEnv (no defaults) and will throw if it's missing.
const devTelegramId = process.env['DEV_TELEGRAM_ID']
if (!isProduction && devTelegramId !== undefined) {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const result = await initDevMode(apiUrl, Number(devTelegramId))
  if (result === null) {
    log.warn('Dev mode init failed — bot will require normal auth')
  }
}
const webhookUrl = process.env['WEBHOOK_URL']
const port = Number(process.env['PORT'] ?? 3002)

if (isProduction && webhookUrl !== undefined && webhookUrl.length > 0) {
  // ── Webhook mode ────────────────────────────────────────────────────────────
  // Set the webhook with Telegram, then start an HTTP server to receive updates.

  await bot.api.setWebhook(webhookUrl)
  log.info({ webhookUrl }, 'Webhook set')

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
    log.info({ port }, 'Webhook server listening')
  })
} else {
  // ── Long-polling mode (development) ────────────────────────────────────────
  log.info('Starting in long-polling mode (development)')
  await bot.start()
}
