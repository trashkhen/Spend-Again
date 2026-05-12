import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import * as schema from './schema.js'

const connectionString = process.env['DATABASE_URL']
if (!connectionString) throw new Error('DATABASE_URL is required')

const sql = postgres(connectionString, { max: 1 })
const db = drizzle(sql, { schema })

await migrate(db, { migrationsFolder: './drizzle' })
console.log('Migrations complete')
await sql.end()
