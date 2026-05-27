// Runs before any other import in the integration test file. Sibling imports
// execute in source order, so by importing this module first we guarantee the
// stub env vars are in place before @spend-again/db's client.ts evaluates its
// top-level DATABASE_URL check.
//
// The router factories injected with TEST_DATABASE_URL via setupTestDb() never
// touch the production db client, so a stub connection string is fine here —
// postgres-js connects lazily and the stub URL is never dialed.
if (!process.env['DATABASE_URL']) {
  process.env['DATABASE_URL'] = 'postgresql://stub:stub@127.0.0.1:1/stub'
}
