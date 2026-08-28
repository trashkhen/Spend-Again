import { describe, expect, it } from 'vitest'
import { formatMultiReceipt } from '../src/handlers/receipt.js'
import type { MultiItemReceiptResult } from '@spend-again/parser/ocr'

function makeReceipt(overrides: Partial<MultiItemReceiptResult> = {}): MultiItemReceiptResult {
  return {
    type: 'multi',
    items: [
      { item: 'Bread', amount: 431, category: 'Groceries', subCategory: 'Supermarket' },
      { item: 'Milk', amount: 360, category: 'Groceries', subCategory: 'Supermarket' },
    ],
    total: 791,
    ...overrides,
  }
}

describe('formatMultiReceipt', () => {
  it('includes a currency conversion line when the receipt was converted', () => {
    const msg = formatMultiReceipt(
      makeReceipt({ originalTotal: 550, originalCurrency: 'EUR', exchangeRate: 1.4384 }),
    )

    expect(msg).toContain('€5.50')
    expect(msg).toContain('S$7.91')
    expect(msg).toContain('1 EUR = 1.4384 SGD')
  })

  it('omits the conversion line when there was no conversion', () => {
    const msg = formatMultiReceipt(makeReceipt())

    expect(msg).not.toContain('→')
  })

  it('still lists every item and the total', () => {
    const msg = formatMultiReceipt(makeReceipt())

    expect(msg).toContain('Bread')
    expect(msg).toContain('Milk')
    expect(msg).toContain('S$7.91')
  })
})
