import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import * as schema from '@spend-again/db/schema'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = resolve(__dirname, '../../../../packages/db/drizzle')

// Import schema as a namespace via the dedicated `./schema` subpath export. We
// deliberately avoid the `@spend-again/db` barrel because it imports the
// process-wide db client, which throws if DATABASE_URL is unset (and our
// integration test uses a separate TEST_DATABASE_URL).

export type IntegrationDb = ReturnType<typeof drizzle<typeof schema>>

const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL']

export function requireTestDatabaseUrl(): string {
  if (!TEST_DATABASE_URL) {
    throw new Error(
      'TEST_DATABASE_URL is required for integration tests. ' +
        'Point it at a disposable Postgres instance (NOT prod).',
    )
  }
  return TEST_DATABASE_URL
}

export async function setupTestDb(): Promise<{
  db: IntegrationDb
  cleanup: () => Promise<void>
}> {
  const url = requireTestDatabaseUrl()
  const sql = postgres(url, { max: 2 })
  const db = drizzle(sql, { schema })
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR })
  // Wipe all tables for a clean slate per test run
  await sql`TRUNCATE users, transactions, learned_mappings RESTART IDENTITY CASCADE`
  return {
    db,
    cleanup: async () => {
      await sql.end()
    },
  }
}
