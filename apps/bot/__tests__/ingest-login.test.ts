import { describe, it, expect, vi, afterEach } from 'vitest'
import { createHash, createHmac } from 'node:crypto'
import { ingestLogin } from '../src/lib/api-client.js'

const KEY = `sa_${'a'.repeat(43)}`
const AUTH = { token: 'jwt', userId: 'user-uuid', telegramId: '281882561' }

function stubFetch(response: Response | Error): ReturnType<typeof vi.fn> {
  const mock = response instanceof Error ? vi.fn().mockRejectedValue(response) : vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', mock)
  return mock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ingestLogin', () => {
  it('signs the request with the bot token so the API can tell it came from the bot', async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify(AUTH), { status: 200 }))

    const result = await ingestLogin(KEY, 'https://api.example.com')

    expect(result).toEqual({ ok: true, auth: AUTH })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/api/auth/ingest-login')
    const body = JSON.parse(init.body as string) as { key: string; ts: number; sig: string }
    expect(body.key).toBe(KEY)
    expect(Math.abs(body.ts - Math.floor(Date.now() / 1000))).toBeLessThanOrEqual(2)
    const secret = createHash('sha256').update(process.env['BOT_TOKEN'] ?? '').digest()
    expect(body.sig).toBe(createHmac('sha256', secret).update(`${KEY}\n${body.ts}`).digest('hex'))
  })

  it('reports an unknown or replaced key as invalid', async () => {
    stubFetch(new Response('{}', { status: 401 }))
    expect(await ingestLogin(KEY, 'https://api.example.com')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('reports a malformed key (400) as invalid', async () => {
    stubFetch(new Response('{}', { status: 400 }))
    expect(await ingestLogin(KEY, 'https://api.example.com')).toEqual({ ok: false, reason: 'invalid' })
  })

  it.each([500, 502, 503, 429])('reports API status %i as unavailable, not as a bad key', async (status) => {
    stubFetch(new Response('{}', { status }))
    expect(await ingestLogin(KEY, 'https://api.example.com')).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('reports a network failure as unavailable', async () => {
    stubFetch(new Error('ECONNREFUSED'))
    expect(await ingestLogin(KEY, 'https://api.example.com')).toEqual({ ok: false, reason: 'unavailable' })
  })
})
