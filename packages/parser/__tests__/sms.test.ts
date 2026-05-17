import { describe, expect, it } from 'vitest'
import { parseFromSMS } from '../src/sms.js'

// ---------------------------------------------------------------------------
// DBS SMS formats
// ---------------------------------------------------------------------------

describe('parseFromSMS — DBS', () => {
  it('parses DBS "was charged to Card ending" format', () => {
    const result = parseFromSMS(
      'DBS: SGD 25.00 was charged to Card ending 1234 at GRAB on 12 May 2026',
    )
    expect(result).not.toBeNull()
    expect(result?.amount).toBe(2500)
    expect(result?.item).toBe('GRAB')
    expect(result?.category).toBe('Transport')
    expect(result?.subCategory).toBe('Grab')
    expect(result?.date).toBe('12/05/2026')
  })

  it('parses DBS format with decimal cents', () => {
    const result = parseFromSMS(
      'DBS: SGD 8.50 was charged to Card ending 5678 at NTUC',
    )
    expect(result).not.toBeNull()
    expect(result?.amount).toBe(850)
    expect(result?.item).toBe('NTUC')
    expect(result?.category).toBe('Groceries')
    expect(result?.subCategory).toBe('Supermarket')
  })

  it('parses DBS Multiplier: SGD spent at format', () => {
    const result = parseFromSMS('DBS Multiplier: SGD 15.00 spent at FOODPANDA')
    expect(result).not.toBeNull()
    expect(result?.amount).toBe(1500)
    expect(result?.item).toBe('FOODPANDA')
    expect(result?.category).toBe('Food')
    expect(result?.subCategory).toBe('Delivery')
  })

  it('parses DBS format with integer amount', () => {
    const result = parseFromSMS(
      'DBS: SGD 100 was charged to Card ending 9999 at SHOPEE',
    )
    expect(result).not.toBeNull()
    expect(result?.amount).toBe(10000)
    expect(result?.item).toBe('SHOPEE')
    expect(result?.category).toBe('Shopping')
    expect(result?.subCategory).toBe('Online Shopping')
  })
})

// ---------------------------------------------------------------------------
// OCBC SMS formats
// ---------------------------------------------------------------------------

describe('parseFromSMS — OCBC', () => {
  it('parses OCBC "S$ charged to VISA ending" format', () => {
    const result = parseFromSMS(
      'OCBC: S$25.00 charged to VISA ending 4321 at GRAB',
    )
    expect(result).not.toBeNull()
    expect(result?.amount).toBe(2500)
    expect(result?.item).toBe('GRAB')
    expect(result?.category).toBe('Transport')
    expect(result?.subCategory).toBe('Grab')
  })

  it('parses OCBC format with decimal amount', () => {
    const result = parseFromSMS(
      'OCBC: S$12.90 charged to Mastercard ending 1111 at COLD STORAGE',
    )
    expect(result).not.toBeNull()
    expect(result?.amount).toBe(1290)
    expect(result?.item).toBe('COLD STORAGE')
    expect(result?.category).toBe('Groceries')
    expect(result?.subCategory).toBe('Supermarket')
  })

  it('parses OCBC Alert "Card ending was used for SGD" format', () => {
    const result = parseFromSMS(
      'OCBC Alert: Card ending 2222 was used for SGD30.00 at NETFLIX',
    )
    expect(result).not.toBeNull()
    expect(result?.amount).toBe(3000)
    expect(result?.item).toBe('NETFLIX')
    expect(result?.category).toBe('Entertainment')
    expect(result?.subCategory).toBe('Subscriptions')
  })

  it('parses OCBC format with unknown merchant (no category)', () => {
    const result = parseFromSMS(
      'OCBC: S$5.50 charged to VISA ending 3333 at RANDOM CAFE XYZ',
    )
    expect(result).not.toBeNull()
    expect(result?.amount).toBe(550)
    expect(result?.item).toBe('RANDOM CAFE XYZ')
    expect(result?.category).toBeUndefined()
    expect(result?.subCategory).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// UOB SMS formats
// ---------------------------------------------------------------------------

describe('parseFromSMS — UOB', () => {
  it('parses UOB "card ending has been charged SGD at" format', () => {
    const result = parseFromSMS(
      'UOB: Your card ending 6789 has been charged SGD18.00 at GOJEK',
    )
    expect(result).not.toBeNull()
    expect(result?.amount).toBe(1800)
    expect(result?.item).toBe('GOJEK')
    expect(result?.category).toBe('Transport')
    expect(result?.subCategory).toBe('Gojek')
  })

  it('parses UOB "$SGD debited from your account for" format', () => {
    const result = parseFromSMS(
      'UOB: $SGD 45.00 debited from your savings for LAZADA',
    )
    expect(result).not.toBeNull()
    expect(result?.amount).toBe(4500)
    expect(result?.item).toBe('LAZADA')
    expect(result?.category).toBe('Shopping')
    expect(result?.subCategory).toBe('Online Shopping')
  })

  it('parses UOB format with integer amount', () => {
    const result = parseFromSMS(
      'UOB: Your card ending 0001 has been charged SGD50 at GIANT',
    )
    expect(result).not.toBeNull()
    expect(result?.amount).toBe(5000)
    expect(result?.item).toBe('GIANT')
    expect(result?.category).toBe('Groceries')
    expect(result?.subCategory).toBe('Supermarket')
  })
})

// ---------------------------------------------------------------------------
// Non-financial messages
// ---------------------------------------------------------------------------

describe('parseFromSMS — non-financial messages', () => {
  it('returns null for OTP SMS', () => {
    expect(parseFromSMS('Your OTP is 123456. Do not share with anyone.')).toBeNull()
  })

  it('returns null for promotional SMS', () => {
    expect(
      parseFromSMS('Great news! Get 50% cashback this weekend at all DBS merchants.'),
    ).toBeNull()
  })

  it('returns null for generic bank alert (no amount)', () => {
    expect(
      parseFromSMS('DBS: Your account has been successfully updated.'),
    ).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseFromSMS('')).toBeNull()
  })

  it('returns null for whitespace-only string', () => {
    expect(parseFromSMS('   ')).toBeNull()
  })

  it('returns null for unrecognised format', () => {
    expect(parseFromSMS('You have a new message from +65 9999 0000')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Merchant lookup edge cases
// ---------------------------------------------------------------------------

describe('parseFromSMS — merchant lookup', () => {
  it('resolves GRAB (uppercase) to Transport/Grab via SG_ITEM_MAP', () => {
    const result = parseFromSMS(
      'DBS: SGD 14.00 was charged to Card ending 1234 at GRAB',
    )
    expect(result?.category).toBe('Transport')
    expect(result?.subCategory).toBe('Grab')
  })

  it('returns category undefined for unknown merchant', () => {
    const result = parseFromSMS(
      'DBS: SGD 10.00 was charged to Card ending 1234 at UNKNOWN MERCHANT',
    )
    expect(result).not.toBeNull()
    expect(result?.category).toBeUndefined()
    expect(result?.subCategory).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// ParseResult shape
// ---------------------------------------------------------------------------

describe('parseFromSMS — result shape', () => {
  it('sets tier to 1', () => {
    const result = parseFromSMS(
      'DBS: SGD 5.00 was charged to Card ending 1234 at GRAB',
    )
    expect(result?.tier).toBe(1)
  })

  it('sets confidence to 0.95', () => {
    const result = parseFromSMS(
      'DBS: SGD 5.00 was charged to Card ending 1234 at GRAB',
    )
    expect(result?.confidence).toBe(0.95)
  })

  it('omits date when not present in SMS', () => {
    const result = parseFromSMS(
      'DBS Multiplier: SGD 7.50 spent at KOPITIAM',
    )
    expect(result?.date).toBeUndefined()
  })
})
