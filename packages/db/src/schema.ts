import {
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
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
  description: text('description'),
  occurredOn: date('occurred_on', { mode: 'string' }).notNull(),
  source: text('source').notNull(), // manual/bot/sms/ocr
  tier: integer('tier'),
  confidence: numeric('confidence', { precision: 4, scale: 3 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userOccurredIdx: index('transactions_user_occurred_idx')
    .on(table.userId, table.occurredOn),
}))

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

export const userCustomCategories = pgTable('user_custom_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  category: text('category').notNull(),
  subCategory: text('sub_category').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniq: uniqueIndex('user_custom_categories_unique').on(table.userId, table.category, table.subCategory),
}))

export const recurringPayments = pgTable('recurring_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  amountCents: integer('amount_cents').notNull(),
  category: text('category').notNull(),
  subCategory: text('sub_category').notNull(),
  description: text('description'),
  frequency: text('frequency').notNull(), // 'weekly'|'fortnightly'|'monthly'|'quarterly'|'yearly'
  nextDueDate: date('next_due_date', { mode: 'string' }).notNull(), // YYYY-MM-DD
  isActive: integer('is_active').notNull().default(1), // 1=active, 0=paused
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Transaction = typeof transactions.$inferSelect
export type NewTransaction = typeof transactions.$inferInsert
export type LearnedMapping = typeof learnedMappings.$inferSelect
export type NewLearnedMapping = typeof learnedMappings.$inferInsert
export type UserCustomCategory = typeof userCustomCategories.$inferSelect
export type NewUserCustomCategory = typeof userCustomCategories.$inferInsert
export type RecurringPayment = typeof recurringPayments.$inferSelect
export type NewRecurringPayment = typeof recurringPayments.$inferInsert
