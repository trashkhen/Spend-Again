import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/lib/api-client.js', () => ({
  apiClient: {
    setToken: vi.fn(),
    saveLearnedMapping: vi.fn().mockResolvedValue(true),
    createTransaction: vi.fn(),
    getSpendingSummary: vi.fn().mockResolvedValue(null),
    getBudget: vi.fn().mockResolvedValue(null),
  },
  tokenStore: new Map<number, string>(),
  userIdStore: new Map<number, string>(),
}))

vi.mock('../src/handlers/expense.js', () => ({
  pendingConfirmations: new Map(),
}))

import { confirmHandler, learnHandler, pendingLearnPrompts } from '../src/handlers/confirm.js'
import { apiClient, tokenStore, userIdStore } from '../src/lib/api-client.js'
import { pendingConfirmations } from '../src/handlers/expense.js'

const TELEGRAM_ID = 281882561
const USER_UUID = '11111111-2222-3333-4444-555555555555'
const FAKE_TOKEN = 'eyJ.fake.jwt'

function makeCtx(data: string) {
  return {
    callbackQuery: { data },
    from: { id: TELEGRAM_ID },
    chat: { id: TELEGRAM_ID },
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
  }
}

describe('learn prompt — callback_data stays within Telegram 64-byte limit', () => {
  beforeEach(() => {
    tokenStore.clear()
    userIdStore.clear()
    pendingConfirmations.clear()
    pendingLearnPrompts.clear()
    vi.clearAllMocks()
  })

  it('keeps the callback_data short even for very long item names', async () => {
    tokenStore.set(TELEGRAM_ID, FAKE_TOKEN)
    userIdStore.set(TELEGRAM_ID, USER_UUID)
    const longItem = 'A' .repeat(200) + ' premium artisan handcrafted thing'
    pendingConfirmations.set(TELEGRAM_ID, {
      amount: 9900,
      item: longItem,
      category: 'Shopping' as never,
      subCategory: 'Other' as never,
      date: '21/05/2026',
      tier: 3,
      confidence: 0.8,
    } as never)
    vi.mocked(apiClient.createTransaction).mockResolvedValue({ id: 'tx-1' } as never)

    const ctx = makeCtx('confirm_yes')
    await confirmHandler(ctx as never)

    // The learn prompt reply happens after the save.
    const learnReplyCall = ctx.reply.mock.calls[0]
    expect(learnReplyCall).toBeDefined()
    const opts = learnReplyCall?.[1] as {
      reply_markup: { inline_keyboard: Array<Array<{ callback_data: string }>> }
    }
    const yesButton = opts.reply_markup.inline_keyboard[0]?.[0]
    expect(yesButton).toBeDefined()
    // 'learn_yes|' (10) + 12 hex chars = 22 bytes, comfortably under 64.
    expect(Buffer.byteLength(yesButton!.callback_data, 'utf8')).toBeLessThanOrEqual(64)
    expect(yesButton!.callback_data).toMatch(/^learn_yes\|[0-9a-f]{12}$/)

    // The map should hold the long item by the same id.
    expect(pendingLearnPrompts.size).toBe(1)
    const stored = [...pendingLearnPrompts.values()][0]
    expect(stored?.item).toBe(longItem)
  })

  it('round-trips: learnHandler retrieves the stored mapping and calls saveLearnedMapping via apiClient', async () => {
    tokenStore.set(TELEGRAM_ID, FAKE_TOKEN)
    pendingLearnPrompts.set('deadbeef0000', {
      item: 'LV Hoodie',
      category: 'Shopping' as never,
      subCategory: 'Other' as never,
      createdAt: Date.now(),
      telegramId: TELEGRAM_ID,
    })

    const ctx = makeCtx('learn_yes|deadbeef0000')
    await learnHandler(ctx as never)

    expect(apiClient.saveLearnedMapping).toHaveBeenCalledWith('LV Hoodie', 'Shopping', 'Other')
    expect(pendingLearnPrompts.size).toBe(0)
  })

  it('shows item-missing message when the id is unknown (expired / restart)', async () => {
    const ctx = makeCtx('learn_yes|unknownid0000')
    await learnHandler(ctx as never)

    expect(apiClient.saveLearnedMapping).not.toHaveBeenCalled()
    expect(ctx.editMessageText).toHaveBeenCalledWith(expect.stringMatching(/.+/))
  })
})
