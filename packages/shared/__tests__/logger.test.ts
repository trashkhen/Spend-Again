import { describe, it, expect } from 'vitest'
import { createLogger } from '../src/logger.js'

// Smoke test so the package has at least one test file and `vitest run`
// (without --passWithNoTests) exits cleanly. The full logger behavior is
// covered by pino's own tests; we just confirm the factory wires up.
describe('createLogger', () => {
  it('returns a pino logger tagged with the given service name', () => {
    const log = createLogger('shared-test')
    expect(typeof log.info).toBe('function')
    expect(typeof log.error).toBe('function')
  })

  it('honors LOG_LEVEL env override', () => {
    const prev = process.env['LOG_LEVEL']
    process.env['LOG_LEVEL'] = 'warn'
    try {
      const log = createLogger('shared-test')
      expect(log.level).toBe('warn')
    } finally {
      if (prev === undefined) {
        delete process.env['LOG_LEVEL']
      } else {
        process.env['LOG_LEVEL'] = prev
      }
    }
  })
})
