import { createLogger } from '@spend-again/shared'
import { tokenStore } from './api-client.js'

const log = createLogger('bot:dev-mode')

type DevLoginResult = { token: string; userId: string }

/**
 * Calls the API's dev-login endpoint and pre-populates the tokenStore for
 * the given Telegram user ID. Only meaningful in non-production environments
 * where the API exposes POST /api/auth/dev-login.
 *
 * Returns the token + userId on success, or null on failure.
 */
export async function initDevMode(
  apiUrl: string,
  telegramId: number,
): Promise<DevLoginResult | null> {
  try {
    const res = await fetch(`${apiUrl}/api/auth/dev-login`, { method: 'POST' })

    if (!res.ok) {
      log.warn({ status: res.status }, 'dev-login non-ok — dev mode not active')
      return null
    }

    const body = (await res.json()) as DevLoginResult
    tokenStore.set(telegramId, body.token)
    log.info({ userId: body.userId, telegramId }, 'Test user linked')
    return body
  } catch (err) {
    log.warn({ err }, 'Failed to reach API for dev-login')
    return null
  }
}
