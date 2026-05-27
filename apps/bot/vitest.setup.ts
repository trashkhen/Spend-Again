// Vitest global setup: provide required env vars BEFORE any test module loads.
// apps/bot/src/lib/env.ts hard-fails at import time if BOT_TOKEN or API_URL
// is missing, so we set defaults here. Individual tests may override these in
// beforeAll/beforeEach as needed (but BOT_TOKEN cannot be unset for the
// duration of the module — it's captured at first import).
process.env['BOT_TOKEN'] ??= 'test-bot-token-do-not-use-in-prod'
process.env['API_URL'] ??= 'http://localhost:3001'
