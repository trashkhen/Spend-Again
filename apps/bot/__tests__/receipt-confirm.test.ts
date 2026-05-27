import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/lib/api-client.js', () => ({
  apiClient: {
    setToken: vi.fn(),
    createTransaction: vi.fn(),
  },
  tokenStore: new Map<number, string>(),
  userIdStore: new Map<number, string>(),
}))

vi.mock('../src/handlers/receipt.js', () => ({
  pendingReceiptResults: new Map(),
}))

import { receiptConfirmHandler } from '../src/handlers/receipt-confirm.js'
import { apiClient, tokenStore, userIdStore } from '../src/lib/api-client.js'
import { pendingReceiptResults } from '../src/handlers/receipt.js'

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
  }
}

describe('receiptConfirmHandler — uses DB UUID, not telegram id', () => {
  beforeEach(() => {
    tokenStore.clear()
    userIdStore.clear()
    pendingReceiptResults.clear()
    vi.clearAllMocks()
  })

  it('passes the DB UUID (from userIdStore) as userId, not the telegram id', async () => {
    tokenStore.set(TELEGRAM_ID, FAKE_TOKEN)
    userIdStore.set(TELEGRAM_ID, USER_UUID)
    pendingReceiptResults.set(TELEGRAM_ID, {
      date: '21/05/2026',
      items: [
        { item: 'Chicken rice', amount: 550, category: 'Food' as never, subCategory: 'Hawker' as never },
      ],
      totalAmount: 550,
    } as never)

    vi.mocked(apiClient.createTransaction).mockResolvedValue({ id: 'tx-1' } as never)

    const ctx = makeCtx('receipt_confirm_all')
    await receiptConfirmHandler(ctx as never)

    expect(apiClient.createTransaction).toHaveBeenCalledOnce()
    const arg = vi.mocked(apiClient.createTransaction).mock.calls[0]?.[0]
    expect(arg?.userId).toBe(USER_UUID)
    expect(arg?.userId).not.toBe(String(TELEGRAM_ID))
  })

  it('shows not-registered message when userIdStore is missing', async () => {
    tokenStore.set(TELEGRAM_ID, FAKE_TOKEN)
    pendingReceiptResults.set(TELEGRAM_ID, {
      date: '21/05/2026',
      items: [{ item: 'X', amount: 100, category: 'Food' as never, subCategory: 'Hawker' as never }],
      totalAmount: 100,
    } as never)

    const ctx = makeCtx('receipt_confirm_all')
    await receiptConfirmHandler(ctx as never)

    expect(ctx.editMessageText).toHaveBeenCalledWith(expect.stringContaining("haven't registered"))
    expect(apiClient.createTransaction).not.toHaveBeenCalled()
  })
})
