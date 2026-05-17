import { tokenStore } from './api-client.js'

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
      console.warn(`[dev-mode] dev-login returned ${res.status} — dev mode not active`)
      return null
    }

    const body = (await res.json()) as DevLoginResult
    tokenStore.set(telegramId, body.token)
    console.log(`[dev-mode] Test user linked — userId: ${body.userId}, telegramId: ${telegramId}`)
    return body
  } catch (err) {
    console.warn('[dev-mode] Failed to reach API for dev-login:', err)
    return null
  }
}
