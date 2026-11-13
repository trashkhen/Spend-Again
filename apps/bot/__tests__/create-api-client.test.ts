import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApiClient } from '../src/lib/api-client.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('createApiClient', () => {
  it('builds a client bound to the given token', () => {
    vi.stubEnv('API_URL', 'https://api.example.com')
    expect(createApiClient('capture-token').getToken()).toBe('capture-token')
  })

  it('adds https:// to a scheme-less API_URL, like the shared client does', async () => {
    vi.stubEnv('API_URL', 'api.example.com')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await createApiClient('capture-token').deleteTransaction('tx-1')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/api/transactions/tx-1',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ Authorization: 'Bearer capture-token' }),
      }),
    )
  })

  it('deleteTransaction returns false when the API says not found', async () => {
    vi.stubEnv('API_URL', 'https://api.example.com')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })))
    expect(await createApiClient('t').deleteTransaction('missing')).toBe(false)
  })
})
