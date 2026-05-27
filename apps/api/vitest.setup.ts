// Vitest global setup: provide required env vars BEFORE any test module loads.
// jwt.ts now hard-fails at import time if JWT_SECRET is missing, so we set it
// here. Integration tests override this with their own secret in beforeAll.
process.env['JWT_SECRET'] ??= 'test-secret-do-not-use-in-prod'
