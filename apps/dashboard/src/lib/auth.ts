/**
 * Auth helpers — JWT storage and retrieval.
 * Token is persisted in localStorage and attached as Bearer in API requests.
 */

const TOKEN_KEY = 'spend_again_token'
const USER_ID_KEY = 'spend_again_user_id'

export type StoredAuth = {
  token: string
  userId: string
}

export function storeAuth(auth: StoredAuth): void {
  localStorage.setItem(TOKEN_KEY, auth.token)
  localStorage.setItem(USER_ID_KEY, auth.userId)
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
