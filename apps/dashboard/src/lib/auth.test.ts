import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { getTelegramDisplayName } from './auth'

function b64url(obj: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url')
}

describe('getTelegramDisplayName', () => {
  const store = new Map<string, string>()
  beforeEach(() => {
    store.clear()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v) },
        removeItem: (k: string) => { store.delete(k) },
      },
    })
  })
  afterEach(() => { store.clear() })

  test('falls back to "User" with nothing stored', () => {
    expect(getTelegramDisplayName()).toBe('User')
  })

  test('reads the first name from the login token (works in any browser)', () => {
    store.set('spend_again_token', `h.${b64url({ userId: 'u', firstName: 'Khen' })}.s`)
    expect(getTelegramDisplayName()).toBe('Khen')
  })

  test('decodes non-ASCII names', () => {
    store.set('spend_again_token', `h.${b64url({ userId: 'u', firstName: '凯文 😀' })}.s`)
    expect(getTelegramDisplayName()).toBe('凯文 😀')
  })

  test('prefers a name stored from the bot link, then token username', () => {
    store.set('spend_again_token', `h.${b64url({ userId: 'u', username: 'khen_w' })}.s`)
    expect(getTelegramDisplayName()).toBe('khen_w')
    store.set('spend_again_tg_first_name', 'Stored')
    expect(getTelegramDisplayName()).toBe('Stored')
  })
})
