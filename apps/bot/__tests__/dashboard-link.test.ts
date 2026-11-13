import { describe, expect, it } from 'vitest'
import { buildDashboardAuthUrl, escapeHrefForTelegramHtml } from '../src/lib/dashboard-link.js'

describe('buildDashboardAuthUrl', () => {
  it('includes the token, first name and username', () => {
    const url = buildDashboardAuthUrl('https://dash.example', 'a.b.c', { first_name: 'Khen Wei', username: 'khen_w' })
    const parsed = new URL(url)
    expect(parsed.pathname).toBe('/auth')
    expect(parsed.searchParams.get('token')).toBe('a.b.c')
    expect(parsed.searchParams.get('name')).toBe('Khen Wei')
    expect(parsed.searchParams.get('username')).toBe('khen_w')
  })

  it('omits profile params when Telegram gives none', () => {
    expect(buildDashboardAuthUrl('https://dash.example', 'tok', {})).toBe('https://dash.example/auth?token=tok')
  })

  it('encodes names with URL-special characters', () => {
    const url = buildDashboardAuthUrl('https://dash.example', 'tok', { first_name: 'A&B=C 😀' })
    expect(new URL(url).searchParams.get('name')).toBe('A&B=C 😀')
  })
})

describe('escapeHrefForTelegramHtml', () => {
  it('escapes ampersands so Telegram HTML parsing does not reject the link', () => {
    expect(escapeHrefForTelegramHtml('https://x/auth?token=t&name=Bo')).toBe('https://x/auth?token=t&amp;name=Bo')
  })
})
