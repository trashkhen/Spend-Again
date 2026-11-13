/**
 * Auth helpers — JWT storage and retrieval.
 * Token is persisted in localStorage and attached as Bearer in API requests.
 */

const TOKEN_KEY = 'spend_again_token'
const USER_ID_KEY = 'spend_again_user_id'
const TELEGRAM_FIRST_NAME_KEY = 'spend_again_tg_first_name'
const TELEGRAM_USERNAME_KEY = 'spend_again_tg_username'

export type StoredAuth = {
  token: string
  userId: string
}

export function storeAuth(auth: StoredAuth): void {
  localStorage.setItem(TOKEN_KEY, auth.token)
  localStorage.setItem(USER_ID_KEY, auth.userId)
}

export function storeTelegramProfile({ firstName, username }: { firstName?: string | null; username?: string | null }): void {
  if (firstName) localStorage.setItem(TELEGRAM_FIRST_NAME_KEY, firstName)
  else localStorage.removeItem(TELEGRAM_FIRST_NAME_KEY)
  if (username) localStorage.setItem(TELEGRAM_USERNAME_KEY, username)
  else localStorage.removeItem(TELEGRAM_USERNAME_KEY)
}

/** Reads a string claim from the stored JWT (no signature check — display only). */
function tokenClaim(name: string): string | null {
  const token = localStorage.getItem(TOKEN_KEY)
  const part = token?.split('.')[1]
  if (!part) return null
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'))
    // JWT payloads are UTF-8; atob gives bytes, so decode for non-ASCII names.
    const bytes = Uint8Array.from(json, (ch) => ch.charCodeAt(0))
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
    const value = payload[name]
    return typeof value === 'string' && value.trim() ? value.trim() : null
  } catch {
    return null
  }
}

/**
 * The name the header greets the user with. The login token itself carries the
 * Telegram first name, so this works in any browser the user logs in from —
 * not only the one that received the bot link's ?name= param.
 */
export function getTelegramDisplayName(): string {
  return (
    localStorage.getItem(TELEGRAM_FIRST_NAME_KEY) ??
    tokenClaim('firstName') ??
    localStorage.getItem(TELEGRAM_USERNAME_KEY) ??
    tokenClaim('username') ??
    'User'
  )
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function getUserId(): string | null {
  return localStorage.getItem(USER_ID_KEY)
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_ID_KEY)
  localStorage.removeItem(TELEGRAM_FIRST_NAME_KEY)
  localStorage.removeItem(TELEGRAM_USERNAME_KEY)
}

export function isAuthenticated(): boolean {
  const token = getToken()
  if (!token) return false

  // Basic JWT expiry check — decode payload without signature verification
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return false
    const payloadPart = parts[1]
    if (!payloadPart) return false
    const payload = JSON.parse(atob(payloadPart)) as Record<string, unknown>
    const exp = payload['exp']
    if (typeof exp === 'number') {
      return Date.now() / 1000 < exp
    }
    return true
  } catch {
    return false
  }
}

/**
 * Returns the Authorization header value for API requests.
 */
export function authHeader(): Record<string, string> {
  const token = getToken()
  if (!token) return {}
  return { Authorization: `Bearer ${token}` }
}
