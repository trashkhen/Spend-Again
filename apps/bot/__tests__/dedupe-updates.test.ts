import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Context } from 'grammy'
import { createUpdateDeduper } from '../src/lib/dedupe-updates.js'

function ctxFor(updateId: number): Context {
  return { update: { update_id: updateId } } as unknown as Context
}

describe('createUpdateDeduper', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('passes a new update through to the next handler', async () => {
    const dedupe = createUpdateDeduper()
    const next = vi.fn().mockResolvedValue(undefined)

    await dedupe(ctxFor(1), next)

    expect(next).toHaveBeenCalledTimes(1)
  })

  it('drops a redelivered update_id', async () => {
    const dedupe = createUpdateDeduper()
    const next = vi.fn().mockResolvedValue(undefined)

    await dedupe(ctxFor(1), next)
    await dedupe(ctxFor(1), next)

    expect(next).toHaveBeenCalledTimes(1)
  })

  it('drops a redelivery that arrives while the first is still running', async () => {
    const dedupe = createUpdateDeduper()
    let release: () => void = () => {}
    const slow = vi.fn().mockReturnValue(new Promise<void>((r) => { release = r }))
    const second = vi.fn().mockResolvedValue(undefined)

    const first = dedupe(ctxFor(1), slow)
    await dedupe(ctxFor(1), second)
    release()
    await first

    expect(second).not.toHaveBeenCalled()
  })

  it('treats different update_ids independently', async () => {
    const dedupe = createUpdateDeduper()
    const next = vi.fn().mockResolvedValue(undefined)

    await dedupe(ctxFor(1), next)
    await dedupe(ctxFor(2), next)

    expect(next).toHaveBeenCalledTimes(2)
  })

  it('forgets an update_id after the TTL', async () => {
    vi.useFakeTimers()
    const dedupe = createUpdateDeduper({ ttlMs: 1000 })
    const next = vi.fn().mockResolvedValue(undefined)

    await dedupe(ctxFor(1), next)
    vi.advanceTimersByTime(1001)
    await dedupe(ctxFor(1), next)

    expect(next).toHaveBeenCalledTimes(2)
  })

  it('evicts the oldest ids once maxEntries is exceeded', async () => {
    const dedupe = createUpdateDeduper({ maxEntries: 2 })
    const next = vi.fn().mockResolvedValue(undefined)

    await dedupe(ctxFor(1), next)
    await dedupe(ctxFor(2), next)
    await dedupe(ctxFor(3), next) // pushes id 1 out
    await dedupe(ctxFor(1), next)

    expect(next).toHaveBeenCalledTimes(4)
  })
})
