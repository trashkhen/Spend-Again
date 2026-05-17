import { createHmac, createHash, timingSafeEqual } from 'node:crypto'

const AUTH_EXPIRY_SECONDS = 24 * 60 * 60 // 24 hours

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
  const botToken = process.env['BOT_TOKEN'] ?? ''
  if (!botToken) return false

  const { hash, ...rest } = data

  if (!hash) return false

  // Step 1: Build data-check string
  const dataCheckString = Object.entries(rest)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')

  // Step 2: HMAC-SHA256 using SHA256(bot_token) as key
  const secretKey = createHash('sha256').update(botToken).digest()
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
