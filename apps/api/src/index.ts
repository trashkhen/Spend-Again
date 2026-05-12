import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { healthRouter } from './routes/health.js'

const app = new Hono()
app.route('/', healthRouter)

const port = Number(process.env['PORT'] ?? 3001)

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API server running on port ${info.port}`)
})
