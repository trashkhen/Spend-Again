import type { Context, NextFunction } from 'grammy'
import { createLogger } from '@spend-again/shared'

const log = createLogger('bot:dedupe')

type DeduperOptions = {
  /** How long an update_id is remembered. */
  ttlMs?: number
  /** Upper bound on remembered ids; the oldest are evicted first. */
  maxEntries?: number
}

/**
 * grammY middleware that drops updates whose `update_id` was already seen.
 *
 * Telegram redelivers a webhook update when it does not get a timely 200, and
 * the bot would otherwise handle it twice (two confirmation prompts, or a
 * duplicate save). State is in-memory, which is enough for a single instance.
 */
export function createUpdateDeduper(
  { ttlMs = 5 * 60_000, maxEntries = 1000 }: DeduperOptions = {},
) {
  // Map iterates in insertion order, so the oldest entries come first.
  const seen = new Map<number, number>()

  return async (ctx: Context, next: NextFunction): Promise<void> => {
    const id = ctx.update.update_id
    const now = Date.now()

    for (const [oldId, seenAt] of seen) {
      if (now - seenAt <= ttlMs && seen.size <= maxEntries) break
      seen.delete(oldId)
    }

    if (seen.has(id)) {
      log.warn({ updateId: id }, 'Dropping redelivered update')
      return
    }
    seen.set(id, now)

    await next()
  }
}
