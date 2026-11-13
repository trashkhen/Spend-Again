import { createHmac, createHash, timingSafeEqual } from 'node:crypto'
import { requireEnv } from '@spend-again/shared'

const AUTH_EXPIRY_SECONDS = 24 * 60 * 60 // 24 hours

const BOT_TOKEN = requireEnv('BOT_TOKEN')

/**
 * Validates Telegram Login Widget data according to Telegram's spec:
 * https://core.telegram.org/widgets/login#checking-authorization
 *
 * Steps:
 * 1. Extract `hash` from data object
 * 2. Sort remaining key=value pairs alphabetically, join with newline
 * 3. Compute HMAC-SHA256 of the data-check-string using SHA256(BOT_TOKEN) as key
 * 4. Compare computed hash with provided hash (constant-time)
 * 5. Verify auth_date is within 24 hours
 */
export function verifyTelegramAuth(data: Record<string, string>): boolean {
  const { hash, ...rest } = data

  if (!hash) return false

  // Step 1: Build data-check string
  const dataCheckString = Object.entries(rest)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')

  // Step 2: HMAC-SHA256 using SHA256(bot_token) as key
  const secretKey = createHash('sha256').update(BOT_TOKEN).digest()
  const computedHmac = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

  // Step 3: Constant-time comparison to prevent timing attacks
  const computedBuf = Buffer.from(computedHmac, 'hex')
  const providedBuf = Buffer.from(hash, 'hex')

  if (computedBuf.length !== providedBuf.length) return false
  if (!timingSafeEqual(computedBuf, providedBuf)) return false

  // Step 4: Check auth_date freshness
  const authDate = rest['auth_date']
  if (!authDate) return false

  const authTimestamp = parseInt(authDate, 10)
  if (isNaN(authTimestamp)) return false

  const nowSeconds = Math.floor(Date.now() / 1000)
  if (nowSeconds - authTimestamp > AUTH_EXPIRY_SECONDS) return false

  return true
}

const BOT_PROOF_MAX_SKEW_SECONDS = 300

/**
 * Verifies that a request was signed by the bot service: an HMAC-SHA256 of
 * `<payload>\n<ts>` keyed with SHA256(BOT_TOKEN), the same secret Telegram
 * login uses. `ts` (unix seconds) must be within 5 minutes of now, so a
 * captured request cannot be replayed later.
 *
 * Used where a secret that lives outside the bot (e.g. an auto-capture key
 * pasted into a phone Shortcut) must not be enough on its own.
 */
export function verifyBotProof(payload: string, ts: number, sig: string): boolean {
  const nowSeconds = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSeconds - ts) > BOT_PROOF_MAX_SKEW_SECONDS) return false

  const secretKey = createHash('sha256').update(BOT_TOKEN).digest()
  const expected = createHmac('sha256', secretKey).update(`${payload}\n${ts}`).digest()
  const provided = Buffer.from(sig, 'hex')

  if (provided.length !== expected.length) return false
  return timingSafeEqual(expected, provided)
}
