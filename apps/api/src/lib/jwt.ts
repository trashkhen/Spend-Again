import { SignJWT, jwtVerify } from 'jose'
import { requireEnv } from '@spend-again/shared'

const KNOWN_WEAK_SECRETS = [
  'test-secret-do-not-use-in-prod',
  'dev-secret',
  'secret',
  'change-me',
  'your-secret-here',
]

/**
 * Throws if `raw` is too short or matches a known dev default.
 * Call this at startup in non-test environments.
 */
export function validateJwtSecret(raw: string): void {
  if (KNOWN_WEAK_SECRETS.includes(raw)) {
    throw new Error(
      'JWT_SECRET must not be a known dev default. Generate one with: openssl rand -hex 32',
    )
  }
  if (raw.length < 32) {
    throw new Error(
      'JWT_SECRET must be at least 32 characters. Generate one with: openssl rand -hex 32',
    )
  }
}

// Capture NODE_ENV at module load time so that test files that temporarily
// set NODE_ENV = 'development' (e.g. to exercise dev-login routes) don't
// accidentally trigger the production validation guard.
const IS_TEST_ENV = process.env['NODE_ENV'] === 'test'

// Resolve JWT_SECRET lazily so importing this module from tests that don't
// exercise auth doesn't require the env var. Production still hard-fails at
// first sign/verify call.
let _secret: Uint8Array | undefined
function secret(): Uint8Array {
  if (_secret === undefined) {
    const raw = requireEnv('JWT_SECRET')
    if (!IS_TEST_ENV) {
      validateJwtSecret(raw)
    }
    _secret = new TextEncoder().encode(raw)
  }
  return _secret
}

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
    .sign(secret())
}

/**
 * Verifies a JWT and returns the payload, or null if invalid/expired.
 */
export async function verifyJWT(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER })

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
