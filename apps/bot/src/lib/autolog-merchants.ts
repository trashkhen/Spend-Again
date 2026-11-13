/**
 * Remembers which merchant each auto-logged transaction came from, so that
 * correcting its category with Edit can teach the bot that merchant.
 *
 * In-memory and bounded: an edit usually follows the capture within minutes,
 * and losing the link (restart, eviction) only means that one correction
 * is not learned.
 */

const MAX_REMEMBERED = 500

/** txId → merchant name as Apple Pay reported it. Insertion-ordered. */
const merchants = new Map<string, string>()

export function rememberAutologMerchant(txId: string, merchant: string): void {
  if (merchant.length === 0) return
  merchants.set(txId, merchant)
  if (merchants.size > MAX_REMEMBERED) {
    const oldest = merchants.keys().next().value
    if (oldest !== undefined) merchants.delete(oldest)
  }
}

export function autologMerchantFor(txId: string): string | undefined {
  return merchants.get(txId)
}

/** Test hook. */
export function clearAutologMerchants(): void {
  merchants.clear()
}
