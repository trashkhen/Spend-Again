/**
 * Bot entry point.
 *
 * In production (NODE_ENV=production) the bot uses webhook mode:
 *   - `WEBHOOK_URL` must be set to the public HTTPS URL of the bot service.
 *   - `WEBHOOK_SECRET_TOKEN` must be set to a random 32–256 char secret.
 *   - `PORT` controls which port the webhook HTTP server listens on.
 *
 * In development the bot falls back to long-polling (no webhook required).
 */

import { webhookCallback } from 'grammy'
import { timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { createLogger, requireEnv } from '@spend-again/shared'
import { bot } from './bot.js'
import { initDevMode } from './lib/dev-mode.js'

const log = createLogger('bot')

const nodeEnv = requireEnv('NODE_ENV')
if (nodeEnv !== 'production' && nodeEnv !== 'development' && nodeEnv !== 'test') {
  throw new Error(`NODE_ENV must be "production", "development", or "test", got "${nodeEnv}"`)
}
const isProduction = nodeEnv === 'production'

// ── Dev mode: pre-register test user ────────────────────────────────────────
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
  const webhookSecret = requireEnv('WEBHOOK_SECRET_TOKEN')

  await bot.api.setWebhook(webhookUrl, { secret_token: webhookSecret })
  log.info({ webhookUrl }, 'Webhook set')

  const handleUpdate = webhookCallback(bot, 'http')

  const server = createServer(async (req, res) => {
    if (req.method === 'POST') {
      const provided = req.headers['x-telegram-bot-api-secret-token']
      const providedValid =
        typeof provided === 'string' &&
        provided.length === webhookSecret.length &&
        timingSafeEqual(Buffer.from(provided), Buffer.from(webhookSecret))
      if (!providedValid) {
        res.writeHead(403)
        res.end('Forbidden')
        return
      }
      await handleUpdate(req, res).catch((err: unknown) => {
        log.error({ err }, 'handleUpdate threw')
        if (!res.writableEnded) {
          res.writeHead(500)
          res.end()
        }
      })
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
