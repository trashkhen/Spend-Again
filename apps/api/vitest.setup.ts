// Vitest global setup: provide required env vars BEFORE any test module loads.
// jwt.ts and telegram-auth.ts now hard-fail at import time if their env vars
// are missing, so we set them here. Integration tests override these with
// their own values in beforeAll/beforeEach as needed.
process.env['JWT_SECRET'] ??= 'test-secret-do-not-use-in-prod'
process.env['BOT_TOKEN'] ??= 'test-bot-token-do-not-use-in-prod'
