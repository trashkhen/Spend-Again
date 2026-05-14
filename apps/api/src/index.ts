import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { healthRouter } from './routes/health.js'
import { createTransactionsRouter } from './routes/transactions.js'
import { createAuthRouter } from './routes/auth.js'
import { createAnalyticsRouter } from './routes/analytics.js'
import { globalErrorHandler } from './middleware/error-handler.js'
import { rateLimitMiddleware } from './middleware/rate-limit.js'
import { db } from './lib/db.js'

const app = new Hono()

// ── Global error handler ──────────────────────────────────────────────────────
app.onError(globalErrorHandler)

// ── Rate limiting on all API routes ──────────────────────────────────────────
// Applied after auth middleware so userId is available for per-user limits.
// The health endpoint is intentionally excluded (it's public and cheap).
app.use('/api/*', rateLimitMiddleware)

// ── Routes ────────────────────────────────────────────────────────────────────
app.route('/', healthRouter)
app.route('/api/transactions', createTransactionsRouter(db))
app.route('/api/auth', createAuthRouter(db))
app.route('/api/analytics', createAnalyticsRouter(db))

const port = Number(process.env['PORT'] ?? 3001)

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API server running on port ${info.port}`)
})
