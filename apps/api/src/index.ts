import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { healthRouter } from './routes/health.js'
import { createTransactionsRouter } from './routes/transactions.js'
import { db } from './lib/db.js'

const app = new Hono()

app.route('/', healthRouter)
app.route('/api/transactions', createTransactionsRouter(db))

const port = Number(process.env['PORT'] ?? 3001)

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API server running on port ${info.port}`)
})
