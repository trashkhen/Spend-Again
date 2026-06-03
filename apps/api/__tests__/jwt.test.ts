import { describe, it, expect } from 'vitest'
import { validateJwtSecret } from '../src/lib/jwt.js'

describe('validateJwtSecret', () => {
  it('accepts a strong secret', () => {
    expect(() => validateJwtSecret('a'.repeat(32))).not.toThrow()
    expect(() => validateJwtSecret('super-long-random-secret-value-that-is-fine')).not.toThrow()
  })

  it('throws when secret is shorter than 32 chars', () => {
    expect(() => validateJwtSecret('short')).toThrow(
      'JWT_SECRET must be at least 32 characters',
    )
    expect(() => validateJwtSecret('a'.repeat(31))).toThrow(
      'JWT_SECRET must be at least 32 characters',
    )
  })

  it('accepts a secret that is exactly 32 chars', () => {
    expect(() => validateJwtSecret('a'.repeat(32))).not.toThrow()
  })

  it('throws for each known dev default', () => {
    const weak = [
      'test-secret-do-not-use-in-prod',
      'dev-secret',
      'secret',
      'change-me',
      'your-secret-here',
    ]
    for (const s of weak) {
      expect(() => validateJwtSecret(s)).toThrow('must not be a known dev default')
    }
  })
})
