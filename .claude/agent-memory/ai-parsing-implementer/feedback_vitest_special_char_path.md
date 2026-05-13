---
name: Vitest fails when project dir contains special characters
description: The project directory "Spend Again?" with a literal ? breaks vite-node's /@vite/env module loading; fix is a pnpm patch
type: feedback
---

When the project root directory contains `?` (our case: "Spend Again?"), vite-node URL-encodes it to `%3F` when building `/@fs/` module URLs. This breaks the `/@vite/env` module lookup unconditionally called by `createVitestExecutor` in ALL vitest pool types (forks, threads, vmForks, vmThreads).

**Root cause:** `vite-node/dist/client.mjs` `DEFAULT_REQUEST_STUBS` intercepts `/@vite/client` but not `/@vite/env`. Vitest always calls `runner.executeId("/@vite/env")` at startup; without a stub, it falls through to `fetchModule` → vite server → `/@fs/<encoded-path>` → file not found.

**Fix applied:** `pnpm patch` on `vite-node@3.2.4` adding `/@vite/env` and `@vite/env` to `DEFAULT_REQUEST_STUBS` in both `client.mjs` and `client.cjs`. The patch is committed to `package.json` `patchedDependencies` and lives at `patches/vite-node@3.2.4.patch`.

**Vitest config used:** `packages/parser/vitest.config.ts` with `pool: 'vmForks'` and `environment: 'node'`. The pool choice doesn't actually matter given the patch, but vmForks is correct for pure Node.js tests.

**How to apply:** If a new developer reinstalls, `pnpm install` applies the patch automatically. The `vitest.config.ts` with `environment: 'node'` should remain in place. Do NOT remove the patch.

Also upgraded vitest from `^2.0.0` to `^3.0.0` in `packages/parser/package.json` as part of investigating the issue (v2 has same problem, v3 was tested).
