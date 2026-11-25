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
vi.mock('@spend-again/parser', () => ({ convertToSGD: vi.fn() }))

import {
  editSelectHandler,
  editFieldHandler,
  editCategoryHandler,
  editSubCategoryHandler,
  handlePendingEdit,
  editSessions,
} from '../src/handlers/edit.js'
import { rememberAutologMerchant, clearAutologMerchants } from '../src/lib/autolog-merchants.js'
import { apiClient, tokenStore, userIdStore } from '../src/lib/api-client.js'
import { convertToSGD } from '@spend-again/parser'

const CHAT = 281882561

const TX = {
  id: 'tx-1',
  userId: 'u-1',
  amountCents: 1200,
  amount: '12.00',
  item: 'Bus',
  category: 'Transport',
  subCategory: 'MRT/Bus',
  occurredOn: '2026-11-20',
  source: 'bot',
  createdAt: '',
  updatedAt: '',
}

function makeCtx(opts: { data?: string; text?: string } = {}) {
  return {
    from: { id: CHAT },
    chat: { id: CHAT },
    ...(opts.data !== undefined ? { callbackQuery: { data: opts.data } } : {}),
    ...(opts.text !== undefined ? { message: { text: opts.text } } : {}),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
  }
}

async function openEdit(): Promise<void> {
  await editSelectHandler(makeCtx({ data: 'edit_select:tx-1' }) as never)
}

function lastText(ctx: ReturnType<typeof makeCtx>): string {
  const call = ctx.editMessageText.mock.calls.at(-1) ?? ctx.reply.mock.calls.at(-1)
  return String(call?.[0])
}

beforeEach(() => {
  vi.clearAllMocks()
  clearAutologMerchants()
  editSessions.clear()
  tokenStore.clear()
  userIdStore.clear()
  tokenStore.set(CHAT, 'jwt')
  userIdStore.set(CHAT, 'u-1')
  vi.mocked(apiClient.getRecentTransactions).mockResolvedValue([TX] as never)
  vi.mocked(apiClient.updateTransaction).mockResolvedValue({ id: 'tx-1' })
  vi.mocked(apiClient.saveLearnedMapping).mockResolvedValue(true)
})

describe('opening an edit', () => {
  it('shows the transaction with a field picker', async () => {
    const ctx = makeCtx({ data: 'edit_select:tx-1' })
    await editSelectHandler(ctx as never)
    const text = String(ctx.reply.mock.calls[0]?.[0])
    expect(text).toContain('S$12.00')
    expect(text).toContain('Bus')
    expect(text).toContain('Transport / MRT/Bus')
    expect(text).toContain('20/11/2026')
    expect(editSessions.get(CHAT)?.awaiting).toBeNull()
  })

  it('says so when the transaction no longer exists', async () => {
    vi.mocked(apiClient.getRecentTransactions).mockResolvedValue([])
    const ctx = makeCtx({ data: 'edit_select:tx-1' })
    await editSelectHandler(ctx as never)
    expect(editSessions.has(CHAT)).toBe(false)
    expect(String(ctx.reply.mock.calls[0]?.[0])).toContain("Can't find")
  })
})

describe('editing the amount', () => {
  it('converts a foreign amount to SGD and saves only the amount', async () => {
    vi.mocked(convertToSGD).mockResolvedValue({ convertedCents: 1760, rate: 1.4667 })
    await openEdit()
    await editFieldHandler(makeCtx({ data: 'ef:amount' }) as never)
    const ctx = makeCtx({ text: '12 EUR' })
    expect(await handlePendingEdit(ctx as never)).toBe(true)

    expect(convertToSGD).toHaveBeenCalledWith(1200, 'EUR')
    expect(apiClient.updateTransaction).toHaveBeenCalledWith('tx-1', { amountCents: 1760 })
    const text = lastText(ctx)
    expect(text).toContain('€12.00 → S$17.60')
    expect(editSessions.get(CHAT)?.amountCents).toBe(1760)
    expect(editSessions.get(CHAT)?.awaiting).toBeNull()
  })

  it('saves an SGD amount without any conversion', async () => {
    await openEdit()
    await editFieldHandler(makeCtx({ data: 'ef:amount' }) as never)
    await handlePendingEdit(makeCtx({ text: '16.20' }) as never)
    expect(convertToSGD).not.toHaveBeenCalled()
    expect(apiClient.updateTransaction).toHaveBeenCalledWith('tx-1', { amountCents: 1620 })
  })

  it('keeps waiting when the text is not an amount', async () => {
    await openEdit()
    await editFieldHandler(makeCtx({ data: 'ef:amount' }) as never)
    const ctx = makeCtx({ text: 'lunch' })
    expect(await handlePendingEdit(ctx as never)).toBe(true)
    expect(apiClient.updateTransaction).not.toHaveBeenCalled()
    expect(editSessions.get(CHAT)?.awaiting).toBe('amount')
  })

  it('saves nothing when the rate lookup fails', async () => {
    vi.mocked(convertToSGD).mockRejectedValue(new Error('down'))
    await openEdit()
    await editFieldHandler(makeCtx({ data: 'ef:amount' }) as never)
    const ctx = makeCtx({ text: '12 EUR' })
    await handlePendingEdit(ctx as never)
    expect(apiClient.updateTransaction).not.toHaveBeenCalled()
    expect(String(ctx.reply.mock.calls[0]?.[0])).toContain("Couldn't convert")
    expect(editSessions.get(CHAT)?.awaiting).toBe('amount')
  })

  it('does not change the shown amount when the save fails', async () => {
    vi.mocked(apiClient.updateTransaction).mockResolvedValue(null)
    await openEdit()
    await editFieldHandler(makeCtx({ data: 'ef:amount' }) as never)
    await handlePendingEdit(makeCtx({ text: '16.20' }) as never)
    expect(editSessions.get(CHAT)?.amountCents).toBe(1200)
  })
})

describe('editing the name', () => {
  it('saves the new name', async () => {
    await openEdit()
    await editFieldHandler(makeCtx({ data: 'ef:name' }) as never)
    await handlePendingEdit(makeCtx({ text: 'Bus to Amsterdam' }) as never)
    expect(apiClient.updateTransaction).toHaveBeenCalledWith('tx-1', {
      item: 'Bus to Amsterdam',
      description: 'Bus to Amsterdam',
    })
    expect(editSessions.get(CHAT)?.item).toBe('Bus to Amsterdam')
  })
})

describe('editing the date', () => {
  it('saves yesterday from the button', async () => {
    await openEdit()
    await editFieldHandler(makeCtx({ data: 'ef:date' }) as never)
    await editFieldHandler(makeCtx({ data: 'ef:d_yday' }) as never)
    const call = vi.mocked(apiClient.updateTransaction).mock.calls[0]
    expect(call?.[1]).toEqual({ date: expect.stringMatching(/^\d{2}\/\d{2}\/\d{4}$/) })
  })

  it('saves a typed date', async () => {
    await openEdit()
    await editFieldHandler(makeCtx({ data: 'ef:date' }) as never)
    await handlePendingEdit(makeCtx({ text: '01/11/2026' }) as never)
    expect(apiClient.updateTransaction).toHaveBeenCalledWith('tx-1', { date: '01/11/2026' })
    expect(editSessions.get(CHAT)?.occurredOn).toBe('2026-11-01')
  })

  it('rejects a future or invalid date and keeps waiting', async () => {
    await openEdit()
    await editFieldHandler(makeCtx({ data: 'ef:date' }) as never)
    await handlePendingEdit(makeCtx({ text: '31/02/2026' }) as never)
    await handlePendingEdit(makeCtx({ text: '01/01/2099' }) as never)
    expect(apiClient.updateTransaction).not.toHaveBeenCalled()
    expect(editSessions.get(CHAT)?.awaiting).toBe('date')
  })
})

describe('editing the category with buttons', () => {
  it('saves category and sub-category from two taps', async () => {
    await openEdit()
    await editFieldHandler(makeCtx({ data: 'ef:cat' }) as never)
    await editCategoryHandler(makeCtx({ data: 'ec:0' }) as never) // Food
    await editSubCategoryHandler(makeCtx({ data: 'es:2' }) as never) // Cafe
    expect(apiClient.updateTransaction).toHaveBeenCalledWith('tx-1', {
      category: 'Food',
      subCategory: 'Cafe',
    })
    expect(editSessions.get(CHAT)?.category).toBe('Food')
  })

  it('offers every category as a button', async () => {
    await openEdit()
    const ctx = makeCtx({ data: 'ef:cat' })
    await editFieldHandler(ctx as never)
    const markup = JSON.stringify(ctx.editMessageText.mock.calls[0]?.[1])
    for (const cat of ['Food', 'Groceries', 'Transport', 'Housing', 'Other']) {
      expect(markup).toContain(cat)
    }
  })

  it('teaches the bot the merchant when an auto-logged entry is recategorised', async () => {
    rememberAutologMerchant('tx-1', 'Zxqv Trading Pte Ltd')
    await openEdit()
    await editCategoryHandler(makeCtx({ data: 'ec:0' }) as never)
    await editSubCategoryHandler(makeCtx({ data: 'es:2' }) as never)
    expect(apiClient.saveLearnedMapping).toHaveBeenCalledWith('zxqv trading pte ltd', 'Food', 'Cafe')
  })

  it('learns nothing for a hand-typed expense or a failed save', async () => {
    await openEdit()
    await editCategoryHandler(makeCtx({ data: 'ec:0' }) as never)
    await editSubCategoryHandler(makeCtx({ data: 'es:2' }) as never)
    expect(apiClient.saveLearnedMapping).not.toHaveBeenCalled()

    rememberAutologMerchant('tx-1', 'Zxqv')
    vi.mocked(apiClient.updateTransaction).mockResolvedValue(null)
    await editCategoryHandler(makeCtx({ data: 'ec:0' }) as never)
    await editSubCategoryHandler(makeCtx({ data: 'es:2' }) as never)
    expect(apiClient.saveLearnedMapping).not.toHaveBeenCalled()
  })

  it('still confirms the change when saving the mapping throws', async () => {
    rememberAutologMerchant('tx-1', 'Zxqv')
    vi.mocked(apiClient.saveLearnedMapping).mockRejectedValue(new Error('boom'))
    await openEdit()
    await editCategoryHandler(makeCtx({ data: 'ec:0' }) as never)
    await editSubCategoryHandler(makeCtx({ data: 'es:2' }) as never)
    expect(editSessions.get(CHAT)?.category).toBe('Food')
  })
})

describe('session lifecycle', () => {
  it('does not swallow a normal message when no field is awaited', async () => {
    await openEdit()
    expect(await handlePendingEdit(makeCtx({ text: '5 kopi' }) as never)).toBe(false)
  })

  it('does nothing when there is no edit open', async () => {
    expect(await handlePendingEdit(makeCtx({ text: '5 kopi' }) as never)).toBe(false)
  })

  it('a command ends the edit and passes through', async () => {
    await openEdit()
    await editFieldHandler(makeCtx({ data: 'ef:amount' }) as never)
    expect(await handlePendingEdit(makeCtx({ text: '/recent' }) as never)).toBe(false)
    expect(editSessions.has(CHAT)).toBe(false)
  })

  it('asks to start again when a button is tapped after the session timed out', async () => {
    await openEdit()
    const s = editSessions.get(CHAT)
    if (s !== undefined) s.expiresAt = Date.now() - 1
    const ctx = makeCtx({ data: 'ef:amount' })
    await editFieldHandler(ctx as never)
    expect(String(ctx.reply.mock.calls[0]?.[0])).toContain('timed out')
  })

  it('Done closes the edit', async () => {
    await openEdit()
    await editFieldHandler(makeCtx({ data: 'ef:done' }) as never)
    expect(editSessions.has(CHAT)).toBe(false)
  })
})
