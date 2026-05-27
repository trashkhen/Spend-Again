import { SignJWT, jwtVerify } from 'jose'
import { requireEnv } from '@spend-again/shared'

const secret = new TextEncoder().encode(requireEnv('JWT_SECRET'))

const ALGORITHM = 'HS256'
const ISSUER = 'spend-again'
const EXPIRY = '30d'

export type JWTPayload = {
  userId: string
  telegramId?: string
}

/**
 * Signs a JWT containing userId and optional telegramId claims.
 * Token expires in 30 days.
 */
export async function signJWT(payload: JWTPayload): Promise<string> {
  return new SignJWT({ userId: payload.userId, telegramId: payload.telegramId })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .sign(secret)
}

/**
 * Verifies a JWT and returns the payload, or null if invalid/expired.
 */
export async function verifyJWT(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER })

    if (typeof payload['userId'] !== 'string') return null

    const result: JWTPayload = { userId: payload['userId'] }

    if (typeof payload['telegramId'] === 'string') {
      result.telegramId = payload['telegramId']
    }

    return result
  } catch {
    return null
  }
}
