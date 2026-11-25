import { describe, it, expect, beforeEach } from 'vitest'
import { rememberAutologMerchant, autologMerchantFor, clearAutologMerchants } from '../src/lib/autolog-merchants.js'

beforeEach(() => {
  clearAutologMerchants()
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
