export { db } from './client.js'
export type { Database } from './client.js'
export {
  learnedMappings,
  transactions,
  userCustomCategories,
  users,
} from './schema.js'
export type {
  LearnedMapping,
  NewLearnedMapping,
  NewTransaction,
  NewUser,
  NewUserCustomCategory,
  Transaction,
  User,
  UserCustomCategory,
} from './schema.js'
export { findMapping, upsertMapping } from './queries/learned-mappings.js'
export type { MappingResult } from './queries/learned-mappings.js'
