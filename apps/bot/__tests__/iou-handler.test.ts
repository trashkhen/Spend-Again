import { describe, it, expect } from 'vitest'
import { detectIouIntent } from '../src/handlers/iou.js'

describe('detectIouIntent', () => {
  it('detects lent pattern — they_owe_me', () => {
    const r = detectIouIntent('lent Ben $12')
    expect(r?.type).toBe('they_owe_me')
    expect(r?.personName).toBe('Ben')
    expect((r as { amountCents: number })?.amountCents).toBe(1200)
  })

  it('detects "Ben owes me" — they_owe_me', () => {
    const r = detectIouIntent('Ben owes me $8.50')
    expect(r?.type).toBe('they_owe_me')
    expect(r?.personName).toBe('Ben')
    expect((r as { amountCents: number })?.amountCents).toBe(850)
  })

  it('detects "paid $12 for Ben" — paid_for_ambiguous', () => {
    const r = detectIouIntent('paid $12 for Ben')
    expect(r?.type).toBe('paid_for_ambiguous')
    expect(r?.personName).toBe('Ben')
    expect((r as { amountCents: number })?.amountCents).toBe(1200)
  })

  it('detects "I owe Sarah $8" — i_owe_them', () => {
    const r = detectIouIntent('I owe Sarah $8')
    expect(r?.type).toBe('i_owe_them')
    expect(r?.personName).toBe('Sarah')
    expect((r as { amountCents: number })?.amountCents).toBe(800)
  })

  it('detects "Sarah lent me $20" — i_owe_them', () => {
    const r = detectIouIntent('Sarah lent me $20')
    expect(r?.type).toBe('i_owe_them')
    expect(r?.personName).toBe('Sarah')
  })

  it('detects "Ben paid me back" — repayment', () => {
    const r = detectIouIntent('Ben paid me back')
    expect(r?.type).toBe('repayment')
    expect(r?.personName).toBe('Ben')
  })

  it('detects "paid Ben back" — repayment', () => {
    const r = detectIouIntent('paid Ben back')
    expect(r?.type).toBe('repayment')
    expect(r?.personName).toBe('Ben')
  })

  it('returns null for a normal expense', () => {
    expect(detectIouIntent('$12 chicken rice')).toBeNull()
    expect(detectIouIntent('grab home 15.30')).toBeNull()
  })
})
