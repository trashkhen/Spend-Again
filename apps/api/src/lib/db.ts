/**
 * Re-exports the Drizzle DB client from @spend-again/db.
 * This thin wrapper allows API routes to import from a single
 * local path and makes testing with a mock DB straightforward.
 */
export { db } from '@spend-again/db'
export type { Database as DbClient } from '@spend-again/db'
