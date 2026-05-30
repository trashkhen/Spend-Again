import { createLogger } from '@spend-again/shared'
import { createRecurringService } from '../services/recurring.js'
import { createTransactionService } from '../services/transactions.js'
import type { DbClient } from './db.js'

const log = createLogger('api:recurring-cron')
const INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours

export function startRecurringCron(db: DbClient): void {
  const run = async () => {
    try {
      log.info('running recurring payments check')
      const recurringService = createRecurringService(db)
      const txService = createTransactionService(db)
      await recurringService.processOverdue(txService)
      log.info('recurring payments check complete')
    } catch (err) {
      log.error({ err }, 'recurring cron error')
    }
  }

  void run()
  setInterval(() => void run(), INTERVAL_MS)
}
