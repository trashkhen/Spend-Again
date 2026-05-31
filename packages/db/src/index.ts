export { db } from './client.js'
export type { Database } from './client.js'
export {
  debtPayments,
  debts,
  learnedMappings,
  people,
  recurringPayments,
  spaces,
  transactions,
  transactionSpaces,
  userCustomCategories,
  users,
} from './schema.js'
export type {
  Debt,
  DebtPayment,
  LearnedMapping,
  NewDebt,
  NewDebtPayment,
  NewLearnedMapping,
  NewPerson,
  NewRecurringPayment,
  NewSpace,
  NewTransaction,
  NewTransactionSpace,
  NewUser,
  NewUserCustomCategory,
  Person,
  RecurringPayment,
  Space,
  Transaction,
  TransactionSpace,
  User,
  UserCustomCategory,
} from './schema.js'
export { findMapping, upsertMapping } from './queries/learned-mappings.js'
export type { MappingResult } from './queries/learned-mappings.js'
