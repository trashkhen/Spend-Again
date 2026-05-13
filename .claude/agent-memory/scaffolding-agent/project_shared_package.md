---
name: Project: packages/shared internals
description: Type names, category list, SG_ITEM_MAP size, and export conventions established in Task 1.2
type: project
---

Task 1.2 populated `packages/shared` with the following canonical files:

- `src/types.ts` — exports `Transaction`, `User`, `LearnedMapping`; re-exports `Category` and `SubCategory` from categories.ts
- `src/categories.ts` — exports `Category` (12-member union), `SubCategory` (union), `CATEGORIES` readonly array, `CATEGORY_MAP` (Record<Category, readonly SubCategory[]>)
- `src/sg-mappings.ts` — exports `MappingEntry` type and `SG_ITEM_MAP` (81 entries, Record<string, MappingEntry>)
- `src/constants.ts` — exports CURRENCY, DATE_FORMAT, APP_NAME, GEMINI_MODEL, GEMINI_RPM_LIMIT, DEFAULT_CATEGORY, DEFAULT_SUB_CATEGORY
- `src/index.ts` — barrel-exports all of the above via `export * from './xxx.js'`

**Exact 12 Category members:** Food, Groceries, Transport, Shopping, Entertainment, Health, Education, Travel, Utilities, Finance, Housing, Other

**SubCategory 'Other' is shared** — it appears in every category's sub-list and is a single union member.

**Import path convention:** `.js` extensions required (NodeNext module resolution, ESM).

**Why:** Task 1.2 spec; build verified clean with `pnpm --filter shared build`.

**How to apply:** Any downstream package importing from shared should use `@spend-again/shared` as the package name; when listing categories enumerate the 12 above; SG_ITEM_MAP keys are lowercase normalized strings.
