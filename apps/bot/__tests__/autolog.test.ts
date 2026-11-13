import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/lib/api-client.js', () => ({
  loginViaTelegram: vi.fn(),
  tokenStore: new Map<number, string>(),
  userIdStore: new Map<number, string>(),
  apiClient: {
    setToken: vi.fn(),
    createIngestKey: vi.fn(),
    deleteTransaction: vi.fn(),
  },
  createApiClient: vi.fn(),
}))

import { autologCommandHandler, autologDeleteHandler } from '../src/handlers/autolog.js'
import { resolveIngestUrl } from '../src/lib/ingest-url.js'
import { apiClient, createApiClient, loginViaTelegram, tokenStore } from '../src/lib/api-client.js'

const TELEGRAM_ID = 281882561
const KEY = `sa_${'k'.repeat(43)}`

function makeCtx(data?: string, chatType = 'private') {
  return {
    from: { id: TELEGRAM_ID, first_name: 'khen' },
    chat: { id: TELEGRAM_ID, type: chatType },
    callbackQuery: data !== undefined ? { data } : undefined,
    reply: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
  }
}

/** The per-request client the handlers must use instead of the shared one. */
const own = { createIngestKey: vi.fn(), deleteTransaction: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  tokenStore.clear()
  tokenStore.set(TELEGRAM_ID, 'jwt')
  vi.mocked(createApiClient).mockReturnValue(own as never)
})

describe('resolveIngestUrl', () => {
  it('prefers an explicit INGEST_URL', () => {
    expect(resolveIngestUrl({ INGEST_URL: 'https://capture.example.com/ingest', WEBHOOK_URL: 'https://bot.example.com/hook' }))
      .toBe('https://capture.example.com/ingest')
  })
  it('derives it from the webhook origin, dropping the webhook path', () => {
    expect(resolveIngestUrl({ WEBHOOK_URL: 'https://bot.up.railway.app/telegram/hook' }))
      .toBe('https://bot.up.railway.app/ingest')
  })
  it('falls back to localhost on the configured port', () => {
    expect(resolveIngestUrl({ PORT: '4000' })).toBe('http://localhost:4000/ingest')
    expect(resolveIngestUrl({})).toBe('http://localhost:3002/ingest')
  })
  it('falls back to localhost when WEBHOOK_URL is not a valid URL', () => {
    expect(resolveIngestUrl({ WEBHOOK_URL: 'not a url' })).toBe('http://localhost:3002/ingest')
  })
})

describe('/autolog', () => {
  it('replies with the new key and the ingest URL', async () => {
    own.createIngestKey.mockResolvedValue(KEY)
    const ctx = makeCtx()

    await autologCommandHandler(ctx as never)

    expect(createApiClient).toHaveBeenCalledWith('jwt')
    expect(apiClient.setToken).not.toHaveBeenCalled()
    expect(ctx.reply).toHaveBeenCalledOnce()
    const text = ctx.reply.mock.calls[0]?.[0] as string
    expect(text).toContain(KEY)
    expect(text).toContain(resolveIngestUrl(process.env))
    expect(text).toContain('/autolog')
  })

  it('logs in again when the token store is empty after a restart', async () => {
    tokenStore.clear()
    vi.mocked(loginViaTelegram).mockResolvedValue({ token: 'fresh', userId: 'u' })
    own.createIngestKey.mockResolvedValue(KEY)
    const ctx = makeCtx()

    await autologCommandHandler(ctx as never)

    expect(createApiClient).toHaveBeenCalledWith('fresh')
    expect((ctx.reply.mock.calls[0]?.[0] as string)).toContain(KEY)
  })

  it('tells an unregistered user to sign up and mints nothing', async () => {
    tokenStore.clear()
    vi.mocked(loginViaTelegram).mockResolvedValue(null)
    const ctx = makeCtx()

    await autologCommandHandler(ctx as never)

    expect(own.createIngestKey).not.toHaveBeenCalled()
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("haven't registered"))
  })

  it.each(['group', 'supergroup', 'channel'])('refuses in a %s chat so the key is never shown to other people', async (type) => {
    own.createIngestKey.mockResolvedValue(KEY)
    const ctx = makeCtx(undefined, type)

    await autologCommandHandler(ctx as never)

    expect(own.createIngestKey).not.toHaveBeenCalled()
    expect(apiClient.createIngestKey).not.toHaveBeenCalled()
    expect(createApiClient).not.toHaveBeenCalled()
    const text = ctx.reply.mock.calls[0]?.[0] as string
    expect(text).not.toContain('sa_')
    expect(text).toContain('private chat')
  })

  it('asks to retry, without any key, when the API fails', async () => {
    own.createIngestKey.mockResolvedValue(null)
    const ctx = makeCtx()

    await autologCommandHandler(ctx as never)

    const text = ctx.reply.mock.calls[0]?.[0] as string
    expect(text).not.toContain('sa_')
    expect(text.toLowerCase()).toContain('try again')
  })
})

describe('Delete button on an auto-logged expense', () => {
  it('deletes that transaction and replaces the message', async () => {
    own.deleteTransaction.mockResolvedValue(true)
    const ctx = makeCtx('autolog_del:tx-42')

    await autologDeleteHandler(ctx as never)

    expect(ctx.answerCallbackQuery).toHaveBeenCalled()
    expect(createApiClient).toHaveBeenCalledWith('jwt')
    expect(apiClient.setToken).not.toHaveBeenCalled()
    expect(own.deleteTransaction).toHaveBeenCalledWith('tx-42')
    expect(ctx.editMessageText).toHaveBeenCalledWith(expect.stringContaining('Deleted'))
  })

  it('leaves the message alone and says so when the delete fails', async () => {
    own.deleteTransaction.mockResolvedValue(false)
    const ctx = makeCtx('autolog_del:tx-42')

    await autologDeleteHandler(ctx as never)

    expect(ctx.editMessageText).not.toHaveBeenCalled()
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Couldn't delete"))
  })

  it('does nothing destructive when the user is not logged in', async () => {
    tokenStore.clear()
    vi.mocked(loginViaTelegram).mockResolvedValue(null)
    const ctx = makeCtx('autolog_del:tx-42')

    await autologDeleteHandler(ctx as never)

    expect(own.deleteTransaction).not.toHaveBeenCalled()
  })
})
