import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CurrencyConversionError } from '@spend-again/shared'
import { detectCurrency, convertToSGD, clearCurrencyRateCache } from '../src/currency.js'

describe('detectCurrency', () => {
  it('detects convert-list words case-insensitively', () => {
    expect(detectCurrency('5.60 euro pasta')).toMatchObject({ kind: 'convert', code: 'EUR' })
    expect(detectCurrency('5.60 EURO pasta')).toMatchObject({ kind: 'convert', code: 'EUR' })
    expect(detectCurrency('100 yen snack')).toMatchObject({ kind: 'convert', code: 'JPY' })
    expect(detectCurrency('20 ringgit teh tarik')).toMatchObject({ kind: 'convert', code: 'MYR' })
    expect(detectCurrency('10 pounds fish and chips')).toMatchObject({ kind: 'convert', code: 'GBP' })
    expect(detectCurrency('15 usd burger')).toMatchObject({ kind: 'convert', code: 'USD' })
  })

  it('detects convert-list symbols', () => {
    expect(detectCurrency('€5.60 pasta')).toMatchObject({ kind: 'convert', code: 'EUR' })
    expect(detectCurrency('£10 fish and chips')).toMatchObject({ kind: 'convert', code: 'GBP' })
    expect(detectCurrency('¥100 snack')).toMatchObject({ kind: 'convert', code: 'JPY' })
  })

  it('detects hint-list words without resolving a code', () => {
    expect(detectCurrency('50 baht grab')).toMatchObject({ kind: 'hint' })
    expect(detectCurrency('1000 won kimchi')).toMatchObject({ kind: 'hint' })
    expect(detectCurrency('30 dirham shawarma')).toMatchObject({ kind: 'hint' })
  })

  it('does not false-positive on "wonton" (no word boundary around the hint word)', () => {
    expect(detectCurrency('$5 wonton mee')).toBeUndefined()
  })

  it('returns undefined when no currency indicator is present', () => {
    expect(detectCurrency('5.60 chicken rice yesterday')).toBeUndefined()
    expect(detectCurrency('$10 lunch')).toBeUndefined()
    expect(detectCurrency('SGD 25 grab')).toBeUndefined()
  })
})

describe('convertToSGD', () => {
  const originalFetch = global.fetch
  const mockFetch = vi.fn()

  beforeEach(() => {
    global.fetch = mockFetch as unknown as typeof fetch
    process.env['EXCHANGERATE_API_KEY'] = 'test-fx-key'
    clearCurrencyRateCache()
    mockFetch.mockReset()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  function okResponse(body: unknown): { ok: boolean; status: number; json: () => Promise<unknown> } {
    return { ok: true, status: 200, json: () => Promise.resolve(body) }
  }

  it('converts using the fetched SGD rate and rounds to the nearest cent', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ result: 'success', conversion_rates: { SGD: 1.4384 } }),
    )

    const result = await convertToSGD(560, 'EUR')

    expect(result.rate).toBe(1.4384)
    expect(result.convertedCents).toBe(Math.round(560 * 1.4384))
    expect(mockFetch).toHaveBeenCalledOnce()
    expect(mockFetch).toHaveBeenCalledWith('https://v6.exchangerate-api.com/v6/test-fx-key/latest/EUR')
  })

  it('caches the rate for the same currency and day — second call does not re-fetch', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ result: 'success', conversion_rates: { SGD: 1.4384 } }),
    )

    await convertToSGD(560, 'EUR')
    const second = await convertToSGD(1000, 'EUR')

    expect(mockFetch).toHaveBeenCalledOnce()
    expect(second.rate).toBe(1.4384)
    expect(second.convertedCents).toBe(Math.round(1000 * 1.4384))
  })

  it('does not share the cache across different currencies', async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse({ result: 'success', conversion_rates: { SGD: 1.4384 } }))
      .mockResolvedValueOnce(okResponse({ result: 'success', conversion_rates: { SGD: 0.0091 } }))

    const eur = await convertToSGD(560, 'EUR')
    const jpy = await convertToSGD(10000, 'JPY')

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(eur.rate).toBe(1.4384)
    expect(jpy.rate).toBe(0.0091)
  })

  it('throws CurrencyConversionError when EXCHANGERATE_API_KEY is not set', async () => {
    delete process.env['EXCHANGERATE_API_KEY']

    await expect(convertToSGD(560, 'EUR')).rejects.toThrow(CurrencyConversionError)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('throws CurrencyConversionError when fetch rejects (network failure)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'))

    await expect(convertToSGD(560, 'EUR')).rejects.toThrow(CurrencyConversionError)
  })

  it('throws CurrencyConversionError on a non-OK HTTP response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({}) })

    await expect(convertToSGD(560, 'EUR')).rejects.toThrow(CurrencyConversionError)
  })

  it('throws CurrencyConversionError when the API reports a non-success result', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ result: 'error', 'error-type': 'unsupported-code' }))

    await expect(convertToSGD(560, 'XYZ')).rejects.toThrow(CurrencyConversionError)
  })

  it('throws CurrencyConversionError when conversion_rates has no SGD entry', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ result: 'success', conversion_rates: { USD: 1.09 } }))

    await expect(convertToSGD(560, 'EUR')).rejects.toThrow(CurrencyConversionError)
  })
})
