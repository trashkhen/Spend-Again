import {
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').unique(),
  telegramId: text('telegram_id').unique(),
  telegramUsername: text('telegram_username'),
  monthlyBudget: integer('monthly_budget'),
  budgetAlertPct: integer('budget_alert_pct').default(100),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  amountCents: integer('amount_cents').notNull(),
  item: text('item').notNull(),
  category: text('category').notNull(),
  subCategory: text('sub_category').notNull(),
  date: text('date').notNull(), // stored as DD/MM/YYYY
  source: text('source').notNull(), // manual/bot/sms/ocr
  tier: integer('tier'),
  confidence: numeric('confidence', { precision: 4, scale: 3 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const learnedMappings = pgTable('learned_mappings', {
  id: uuid('id').primaryKey().defaultRandom(),
  itemName: text('item_name').notNull().unique(), // normalized lowercase
  category: text('category').notNull(),
  subCategory: text('sub_category').notNull(),
  confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull().default('0.5'),
  source: text('source').notNull(), // regex/gemini/user
  usageCount: integer('usage_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Transaction = typeof transactions.$inferSelect
export type NewTransaction = typeof transactions.$inferInsert
export type LearnedMapping = typeof learnedMappings.$inferSelect
export type NewLearnedMapping = typeof learnedMappings.$inferInsert
