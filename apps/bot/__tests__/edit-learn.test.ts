import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/lib/api-client.js', () => ({
  tokenStore: new Map<number, string>(),
  userIdStore: new Map<number, string>(),
  apiClient: {
    setToken: vi.fn(),
    updateTransaction: vi.fn(),
    saveLearnedMapping: vi.fn(),
    getRecentTransactions: vi.fn(),
  },
}))

import { handlePendingEdit, pendingEdits } from '../src/handlers/edit.js'
import { rememberAutologMerchant, autologMerchantFor, clearAutologMerchants } from '../src/lib/autolog-merchants.js'
import { apiClient, tokenStore } from '../src/lib/api-client.js'

const CHAT = 281882561

function makeCtx(text: string) {
  return {
    from: { id: CHAT },
    chat: { id: CHAT },
    message: { text },
    reply: vi.fn().mockResolvedValue(undefined),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  clearAutologMerchants()
  pendingEdits.clear()
  tokenStore.clear()
  tokenStore.set(CHAT, 'jwt')
  vi.mocked(apiClient.updateTransaction).mockResolvedValue({ id: 'tx-1' })
  vi.mocked(apiClient.saveLearnedMapping).mockResolvedValue(true)
})

describe('editing an auto-logged expense teaches the bot that merchant', () => {
  it('saves the corrected category under the merchant Apple Pay reported', async () => {
    rememberAutologMerchant('tx-1', 'Zxqv Trading Pte Ltd')
    pendingEdits.set(CHAT, 'tx-1')
    const ctx = makeCtx('5.00 kopi Food Cafe')

    await handlePendingEdit(ctx as never)

    expect(apiClient.updateTransaction).toHaveBeenCalledWith('tx-1', expect.objectContaining({ category: 'Food', subCategory: 'Cafe' }))
    expect(apiClient.saveLearnedMapping).toHaveBeenCalledWith('zxqv trading pte ltd', 'Food', 'Cafe')
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Updated'))
  })

  it('learns nothing when the edited expense was typed by hand', async () => {
    pendingEdits.set(CHAT, 'tx-manual')
    await handlePendingEdit(makeCtx('5.00 kopi Food Cafe') as never)
    expect(apiClient.saveLearnedMapping).not.toHaveBeenCalled()
  })

  it('learns nothing when the update itself failed', async () => {
    rememberAutologMerchant('tx-1', 'Zxqv Trading Pte Ltd')
    pendingEdits.set(CHAT, 'tx-1')
    vi.mocked(apiClient.updateTransaction).mockResolvedValue(null)
    await handlePendingEdit(makeCtx('5.00 kopi Food Cafe') as never)
    expect(apiClient.saveLearnedMapping).not.toHaveBeenCalled()
  })

  it('still confirms the edit when saving the mapping throws', async () => {
    rememberAutologMerchant('tx-1', 'Zxqv Trading Pte Ltd')
    pendingEdits.set(CHAT, 'tx-1')
    vi.mocked(apiClient.saveLearnedMapping).mockRejectedValue(new Error('boom'))
    const ctx = makeCtx('5.00 kopi Food Cafe')
    await handlePendingEdit(ctx as never)
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Updated'))
  })
})

describe('autolog merchant memory', () => {
  it('does not remember an empty merchant name', () => {
    rememberAutologMerchant('tx-1', '')
    expect(autologMerchantFor('tx-1')).toBeUndefined()
  })

  it('forgets the oldest entry beyond 500', () => {
    for (let i = 0; i <= 500; i++) rememberAutologMerchant(`tx-${i}`, `Shop ${i}`)
    expect(autologMerchantFor('tx-0')).toBeUndefined()
    expect(autologMerchantFor('tx-1')).toBe('Shop 1')
    expect(autologMerchantFor('tx-500')).toBe('Shop 500')
  })
})
