import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/lib/api-client.js', () => ({
  loginViaTelegram: vi.fn(),
  tokenStore: new Map<number, string>(),
  userIdStore: new Map<number, string>(),
  apiClient: {
    setToken: vi.fn(),
    getLearnedMapping: vi.fn().mockResolvedValue(null),
  },
}))

vi.mock('../src/keyboards/confirm.js', () => ({
  buildConfirmKeyboard: vi.fn().mockReturnValue({ inline_keyboard: [] }),
}))

import { handlePendingInlineEdit, pendingInlineEdits } from '../src/handlers/inline-edit.js'
import { pendingConfirmations } from '../src/handlers/expense.js'
import type { PendingConfirmation } from '../src/handlers/expense.js'
import type { ParseResult } from '@spend-again/parser'

const TELEGRAM_ID = 281882561

function makeCtx(text: string) {
  return {
    from: { id: TELEGRAM_ID, first_name: 'khen', username: 'trashkhen' },
    chat: { id: TELEGRAM_ID },
    message: { text },
    reply: vi.fn().mockResolvedValue(undefined),
  }
}

describe('handlePendingInlineEdit — regression: stale conversion note after manual edit', () => {
  beforeEach(() => {
    pendingConfirmations.clear()
    pendingInlineEdits.clear()
    vi.clearAllMocks()
  })

  it('clears originalAmount/originalCurrency/exchangeRate when the amount is manually overwritten', async () => {
    // Seed a pending confirmation whose result went through currency conversion:
    // €5.60 was converted to S$8.05 (display-only conversion fields set).
    const converted: ParseResult = {
      amount: 805,
      item: 'pasta',
      category: 'Food',
      subCategory: 'Restaurant',
      confidence: 0.8,
      tier: 1,
      originalAmount: 560,
      originalCurrency: 'EUR',
      exchangeRate: 1.4384,
    }
    const entry: PendingConfirmation = { result: converted, rawInput: '5.60 euro pasta' }
    pendingConfirmations.set(TELEGRAM_ID, entry)
    pendingInlineEdits.add(TELEGRAM_ID)

    // User manually retypes a completely different SGD amount via structured edit.
    const ctx = makeCtx('3.50 coffee Food Cafe')
    await handlePendingInlineEdit(ctx as never)

    // The stale conversion fields must be gone from the stored result.
    const updated = pendingConfirmations.get(TELEGRAM_ID)
    expect(updated?.result.originalAmount).toBeUndefined()
    expect(updated?.result.originalCurrency).toBeUndefined()
    expect(updated?.result.exchangeRate).toBeUndefined()
    expect(updated?.result.amount).toBe(350)

    // The reply message must not contain the stale conversion note (the
    // EUR original amount, or the conversion arrow glyph).
    expect(ctx.reply).toHaveBeenCalled()
    const [msg] = ctx.reply.mock.calls[0] as [string, unknown]
    expect(msg).not.toContain('EUR')
    expect(msg).not.toContain('\u{2192}')
  })
})
