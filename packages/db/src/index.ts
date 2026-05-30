export { db } from './client.js'
export type { Database } from './client.js'
export {
  learnedMappings,
  recurringPayments,
  transactions,
  userCustomCategories,
  users,
} from './schema.js'
export type {
  LearnedMapping,
  NewLearnedMapping,
  NewRecurringPayment,
  NewTransaction,
  NewUser,
  NewUserCustomCategory,
  RecurringPayment,
  Transaction,
  User,
  UserCustomCategory,
} from './schema.js'
export { findMapping, upsertMapping } from './queries/learned-mappings.js'
export type { MappingResult } from './queries/learned-mappings.js'
