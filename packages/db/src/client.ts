import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { requireEnv } from '@spend-again/shared'
import * as schema from './schema.js'

const connectionString = requireEnv('DATABASE_URL')

const sql = postgres(connectionString)
export const db = drizzle(sql, { schema })
export type Database = typeof db
