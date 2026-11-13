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
import type { InlineKeyboard } from 'grammy'
import { createServer } from 'node:http'
import { createLogger, requireEnv } from '@spend-again/shared'
import { bot } from './bot.js'
import { initDevMode } from './lib/dev-mode.js'
import { createApiClient, ingestLogin } from './lib/api-client.js'
import { processIngest } from './lib/ingest.js'
import type { IngestDeps } from './lib/ingest.js'
import { createRequestHandler } from './server.js'

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

// ── Auto-capture (/ingest) wiring ────────────────────────────────────────────
const ingestDeps: IngestDeps = {
  send: async (chatId: number, text: string, keyboard?: InlineKeyboard) => {
    await bot.api.sendMessage(chatId, text, keyboard !== undefined ? { reply_markup: keyboard } : {})
  },
  makeClient: (token) => createApiClient(token),
  now: () => Date.now(),
}
const ingestHandlers = {
  login: (key: string) => ingestLogin(key),
  process: (auth: Parameters<typeof processIngest>[0], req: Parameters<typeof processIngest>[1]) =>
    processIngest(auth, req, ingestDeps),
  now: () => Date.now(),
}

if (isProduction && webhookUrl !== undefined && webhookUrl.length > 0) {
  // ── Webhook mode ────────────────────────────────────────────────────────────
  const webhookSecret = requireEnv('WEBHOOK_SECRET_TOKEN')

  await bot.api.setWebhook(webhookUrl, { secret_token: webhookSecret })
  log.info({ webhookUrl }, 'Webhook set')

  // 'return' acks Telegram with a 200 when a handler runs long (e.g. a slow
  // Gemini call). The handler keeps going and replies via the Bot API, and
  // Telegram does not redeliver the update. The default 'throw' sent a 500,
  // which made Telegram retry and the bot handle the message twice.
  const handleUpdate = webhookCallback(bot, 'http', { onTimeout: 'return', timeoutMilliseconds: 10_000 })

  const server = createServer(
    createRequestHandler({ ...ingestHandlers, webhook: { secret: webhookSecret, handle: handleUpdate } }),
  )

  server.listen(port, () => {
    log.info({ port }, 'Webhook server listening')
  })
} else {
  // ── Long-polling mode (development) ────────────────────────────────────────
  // /ingest is still served so the Apple Pay Shortcut can be tested locally.
  createServer(createRequestHandler(ingestHandlers)).listen(port, () => {
    log.info({ port }, 'Ingest server listening (no webhook)')
  })
  log.info('Starting in long-polling mode (development)')
  await bot.start()
}
