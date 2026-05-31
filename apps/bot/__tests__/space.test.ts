import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies
vi.mock('../src/lib/api-client.js', () => ({
  apiClient: {
    listSpaces: vi.fn(),
    getActiveSpace: vi.fn(),
    setActiveSpace: vi.fn(),
    createSpace: vi.fn(),
    setToken: vi.fn(),
  },
  tokenStore: {
    get: vi.fn().mockReturnValue('eyJ.fake.token'),
  },
}))

vi.mock('@spend-again/parser', () => ({
  parseSpaceWithGemini: vi.fn(),
}))

import {
  spaceCommandHandler,
  spaceCallbackHandler,
  handlePendingSpaceCreate,
  handlePendingSpaceBudgetInput,
  pendingSpaceCreate,
  pendingSpaceDetails,
  pendingSpaceBudgetInput,
} from '../src/handlers/space.js'
import { apiClient } from '../src/lib/api-client.js'
import { parseSpaceWithGemini } from '@spend-again/parser'

function makeCtx(overrides: any = {}) {
  const replies: Array<{ text: string; options?: any }> = []
  const editReplies: Array<{ text: string; options?: any }> = []
  
  return {
    from: { id: 123456789, first_name: 'Tester', username: 'tester' },
    chat: { id: 987654321 },
    message: overrides.message || { text: '' },
    callbackQuery: overrides.callbackQuery || undefined,
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    reply: vi.fn().mockImplementation((text: string, options?: any) => {
      replies.push({ text, options })
      return Promise.resolve()
    }),
    editMessageText: vi.fn().mockImplementation((text: string, options?: any) => {
      editReplies.push({ text, options })
      return Promise.resolve()
    }),
    _replies: replies,
    _editReplies: editReplies,
    ...overrides,
  }
}

describe('Space Handler Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pendingSpaceCreate.clear()
    pendingSpaceDetails.clear()
    pendingSpaceBudgetInput.clear()
  })

  describe('spaceCommandHandler', () => {
    it('should list spaces and active space', async () => {
      vi.mocked(apiClient.listSpaces).mockResolvedValue([
        { id: 's1', name: 'Bali', status: 'active', emoji: '📦', budgetCents: null, startDate: null, endDate: null, spentCents: 0, spent: '0', transactionCount: 0, userId: 'u1', budget: null, createdAt: '', updatedAt: '' },
      ])
      vi.mocked(apiClient.getActiveSpace).mockResolvedValue(null)

      const ctx = makeCtx()
      await spaceCommandHandler(ctx as any)

      expect(ctx.reply).toHaveBeenCalled()
      expect(ctx._replies[0]?.text).toContain('Active space: None')
      expect(ctx._replies[0]?.text).toContain('Choose a space:')
    })
  })

  describe('spaceCallbackHandler', () => {
    it('should start the pending create state when space_new is triggered', async () => {
      const ctx = makeCtx({ callbackQuery: { data: 'space_new' } })
      
      await spaceCallbackHandler(ctx as any)
      
      expect(pendingSpaceCreate.has(ctx.chat.id)).toBe(true)
      expect(ctx.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('Send me the space details:'),
        expect.any(Object)
      )
    })

    it('should create space with no budget when choice is "no"', async () => {
      pendingSpaceDetails.set(987654321, {
        name: 'Bali Trip',
        startDate: '2026-06-23',
        endDate: '2026-06-27',
      })

      vi.mocked(apiClient.createSpace).mockResolvedValue({
        id: 's2', name: 'Bali Trip', emoji: '📦'
      } as any)

      const ctx = makeCtx({ callbackQuery: { data: 'space_budget_choice:no' } })

      await spaceCallbackHandler(ctx as any)

      expect(ctx.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('Proceeding with no budget...'),
      )
      expect(apiClient.createSpace).toHaveBeenCalledWith({
        name: 'Bali Trip',
        startDate: '2026-06-23',
        endDate: '2026-06-27',
      })
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Created 📦 Bali Trip'),
        expect.any(Object)
      )
    })

    it('should enter budget input state when choice is "yes"', async () => {
      pendingSpaceDetails.set(987654321, {
        name: 'Bali Trip',
        startDate: '2026-06-23',
        endDate: '2026-06-27',
      })

      const ctx = makeCtx({ callbackQuery: { data: 'space_budget_choice:yes' } })

      await spaceCallbackHandler(ctx as any)

      expect(pendingSpaceBudgetInput.has(987654321)).toBe(true)
      expect(ctx.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('Input amount e.g. 800'),
      )
    })
  })

  describe('handlePendingSpaceCreate', () => {
    it('should call Gemini parser and create space directly if budget is present', async () => {
      pendingSpaceCreate.add(987654321)
      
      vi.mocked(parseSpaceWithGemini).mockResolvedValue({
        name: 'Bali Trip',
        budgetCents: 50000,
        startDate: '2026-06-23',
        endDate: '2026-06-27',
      })

      vi.mocked(apiClient.createSpace).mockResolvedValue({
        id: 's3', name: 'Bali Trip', emoji: '🌴'
      } as any)

      const ctx = makeCtx({ message: { text: "Bali Trip from 23/06 to 27/06 budget $500" } })

      const handled = await handlePendingSpaceCreate(ctx as any)

      expect(handled).toBe(true)
      expect(parseSpaceWithGemini).toHaveBeenCalled()
      expect(apiClient.createSpace).toHaveBeenCalledWith({
        name: 'Bali Trip',
        budgetCents: 50000,
        startDate: '2026-06-23',
        endDate: '2026-06-27',
      })
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Created 🌴 Bali Trip'),
        expect.any(Object)
      )
    })

    it('should prompt user if no budget is found in input', async () => {
      pendingSpaceCreate.add(987654321)
      
      vi.mocked(parseSpaceWithGemini).mockResolvedValue({
        name: 'Bali Trip',
        budgetCents: null,
        startDate: '2026-06-23',
        endDate: '2026-06-27',
      })

      const ctx = makeCtx({ message: { text: "Bali Trip for 5 days from 23 june" } })

      const handled = await handlePendingSpaceCreate(ctx as any)

      expect(handled).toBe(true)
      expect(apiClient.createSpace).not.toHaveBeenCalled()
      expect(pendingSpaceDetails.has(987654321)).toBe(true)
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Do you want to set a budget?'),
        expect.any(Object)
      )
    })
  })

  describe('handlePendingSpaceBudgetInput', () => {
    it('should parse budget and create space with that budget', async () => {
      pendingSpaceBudgetInput.set(987654321, {
        name: 'Bali Trip',
        startDate: '2026-06-23',
        endDate: '2026-06-27',
      })

      vi.mocked(apiClient.createSpace).mockResolvedValue({
        id: 's4', name: 'Bali Trip', emoji: '🌴'
      } as any)

      const ctx = makeCtx({ message: { text: '800' } })

      const handled = await handlePendingSpaceBudgetInput(ctx as any)

      expect(handled).toBe(true)
      expect(apiClient.createSpace).toHaveBeenCalledWith({
        name: 'Bali Trip',
        budgetCents: 80000,
        startDate: '2026-06-23',
        endDate: '2026-06-27',
      })
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Created 🌴 Bali Trip'),
        expect.any(Object)
      )
    })

    it('should default to no budget if invalid budget is sent', async () => {
      pendingSpaceBudgetInput.set(987654321, {
        name: 'Bali Trip',
        startDate: '2026-06-23',
        endDate: '2026-06-27',
      })

      vi.mocked(apiClient.createSpace).mockResolvedValue({
        id: 's4', name: 'Bali Trip', emoji: '🌴'
      } as any)

      const ctx = makeCtx({ message: { text: 'no budget thanks' } })

      const handled = await handlePendingSpaceBudgetInput(ctx as any)

      expect(handled).toBe(true)
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Invalid budget amount. Proceeding with no budget...'),
      )
      expect(apiClient.createSpace).toHaveBeenCalledWith({
        name: 'Bali Trip',
        startDate: '2026-06-23',
        endDate: '2026-06-27',
      })
    })
  })
})
