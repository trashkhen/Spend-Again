import { createHash, randomBytes } from 'node:crypto'

/**
 * Auto-capture keys let a phone automation (e.g. an Apple Pay Shortcut) log
 * expenses without a Telegram login. Only the SHA-256 digest is persisted, so
 * a database leak does not expose usable keys.
 */

const KEY_PREFIX = 'sa_'

/** SHA-256 hex digest of a capture key — the value stored on `users`. */
export function hashIngestKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/** Mints a new capture key and its storable hash. */
export function generateIngestKey(): { key: string; hash: string } {
  const key = `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`
  return { key, hash: hashIngestKey(key) }
}
