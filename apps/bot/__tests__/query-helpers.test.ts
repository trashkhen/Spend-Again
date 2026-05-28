import { describe, it, expect, vi } from 'vitest'

// Stub out the api-client module so query.ts can be imported without side-effects.
vi.mock('../src/lib/api-client.js', () => ({
  loginViaTelegram: vi.fn(),
  tokenStore: new Map<number, string>(),
  userIdStore: new Map<number, string>(),
  apiClient: {
    setToken: vi.fn(),
  },
}))

// Stub @spend-again/parser (imported transitively via query.ts through @spend-again/parser)
vi.mock('@spend-again/parser', () => ({
  waitForGeminiRpmBudget: vi.fn().mockResolvedValue(undefined),
}))

import { filterByDateRange, buildTrendReply } from '../src/handlers/query.js'
import type { ApiTransaction } from '@spend-again/shared'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTx(occurredOn: string, amount = '10.00', id = occurredOn): ApiTransaction {
  return {
    id,
    userId: 'user-1',
    amountCents: Math.round(parseFloat(amount) * 100),
    amount,
    item: 'test item',
    category: 'Food',
    subCategory: 'Hawker',
    occurredOn,
    source: 'bot',
    createdAt: `${occurredOn}T00:00:00Z`,
    updatedAt: `${occurredOn}T00:00:00Z`,
  }
}

const TX_MAY_12 = makeTx('2026-05-12', '5.00', 'tx-1')
const TX_MAY_13 = makeTx('2026-05-13', '8.50', 'tx-2')
const TX_MAY_14 = makeTx('2026-05-14', '12.00', 'tx-3')
const TX_MAY_20 = makeTx('2026-05-20', '3.00', 'tx-4')

// ── filterByDateRange ─────────────────────────────────────────────────────────

describe('filterByDateRange', () => {
  it('returns only transactions within the date range', () => {
    const txs = [TX_MAY_12, TX_MAY_13, TX_MAY_14, TX_MAY_20]
    const result = filterByDateRange(txs, '13/05/2026', '14/05/2026')
    expect(result).toHaveLength(2)
    expect(result.map((tx) => tx.occurredOn)).toEqual(['2026-05-13', '2026-05-14'])
  })

  it('includes boundary days (start and end are inclusive)', () => {
    const txs = [TX_MAY_12, TX_MAY_13, TX_MAY_14, TX_MAY_20]

    const startResult = filterByDateRange(txs, '12/05/2026', '12/05/2026')
    expect(startResult).toHaveLength(1)
    expect(startResult[0]?.occurredOn).toBe('2026-05-12')

    const endResult = filterByDateRange(txs, '20/05/2026', '20/05/2026')
    expect(endResult).toHaveLength(1)
    expect(endResult[0]?.occurredOn).toBe('2026-05-20')
  })

  it('excludes transactions outside the range', () => {
    const txs = [TX_MAY_12, TX_MAY_20]
    const result = filterByDateRange(txs, '13/05/2026', '19/05/2026')
    expect(result).toHaveLength(0)
  })

  it('returns all transactions when date range covers everything', () => {
    const txs = [TX_MAY_12, TX_MAY_13, TX_MAY_14, TX_MAY_20]
    const result = filterByDateRange(txs, '12/05/2026', '20/05/2026')
    expect(result).toHaveLength(4)
  })

  it('returns all txs unchanged when start or end is invalid', () => {
    const txs = [TX_MAY_12, TX_MAY_13]
    expect(filterByDateRange(txs, 'bad-date', '14/05/2026')).toEqual(txs)
    expect(filterByDateRange(txs, '12/05/2026', 'bad-date')).toEqual(txs)
  })
})

// ── buildTrendReply ───────────────────────────────────────────────────────────

describe('buildTrendReply', () => {
  it('groups transactions by day and uses occurredOn (YYYY-MM-DD) keys', () => {
    const txs = [TX_MAY_12, TX_MAY_13, TX_MAY_14]
    const reply = buildTrendReply(txs, '12/05/2026', '14/05/2026')

    // Should have one line per day with spending
    expect(reply).toContain('12/05')
    expect(reply).toContain('13/05')
    expect(reply).toContain('14/05')
  })

  it('sums amounts for transactions on the same day', () => {
    const tx13a = makeTx('2026-05-13', '5.00', 'tx-a')
    const tx13b = makeTx('2026-05-13', '3.50', 'tx-b')
    const txs = [tx13a, tx13b]
    const reply = buildTrendReply(txs, '13/05/2026', '13/05/2026')
    // 5.00 + 3.50 = 8.50 → 850 cents → S$8.50
    expect(reply).toContain('S$8.50')
  })

  it('returns a no-expenses message when all transactions are outside the range', () => {
    const txs = [TX_MAY_20]
    const reply = buildTrendReply(txs, '12/05/2026', '14/05/2026')
    expect(reply).toMatch(/no expenses/i)
  })

  it('returns a no-expenses message when the list is empty', () => {
    const reply = buildTrendReply([], '12/05/2026', '14/05/2026')
    expect(reply).toMatch(/no expenses/i)
  })

  it('does not show days with zero spending', () => {
    // Only MAY_13 is in the range; MAY_12 is in range but has no tx on day 12
    const txs = [TX_MAY_13]
    const reply = buildTrendReply(txs, '12/05/2026', '14/05/2026')
    // 13/05 should appear, but 12/05 and 14/05 should not (zero spending)
    expect(reply).toContain('13/05')
    expect(reply).not.toContain('12/05:')
    expect(reply).not.toContain('14/05:')
  })
})
