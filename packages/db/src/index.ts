export { db } from './client.js'
export type { Database } from './client.js'
export {
  learnedMappings,
  recurringPayments,
  spaces,
  transactions,
  transactionSpaces,
  userCustomCategories,
  users,
} from './schema.js'
export type {
  LearnedMapping,
  NewLearnedMapping,
  NewRecurringPayment,
  NewSpace,
  NewTransaction,
  NewTransactionSpace,
  NewUser,
  NewUserCustomCategory,
  RecurringPayment,
  Space,
  Transaction,
  TransactionSpace,
  User,
  UserCustomCategory,
} from './schema.js'
export { findMapping, upsertMapping } from './queries/learned-mappings.js'
export type { MappingResult } from './queries/learned-mappings.js'
