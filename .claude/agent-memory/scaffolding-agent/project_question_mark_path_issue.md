---
name: Project path contains '?' character — known tool breakage
description: The project root '/Users/khen/Desktop/Spend Again?' has a '?' that breaks Vite, Vitest, esbuild, and Node.js ESM URL resolution
type: project
---

The project root directory is `/Users/khen/Desktop/Spend Again?`. The `?` character is a URL query string separator and causes breakage in tools that convert filesystem paths to `file://` URLs internally.

**Why:** Vite (config bundler), Vitest, esbuild's `externalize-deps` plugin, and Node.js ESM `import()` all use `pathToFileURL()` which encodes `?` as `%3F`. This corrupts the path when used as a resolver root or module URL, causing "Failed to resolve entry" and "module not found" errors.

**How to apply:**

1. `apps/dashboard` build uses a custom `build.cjs` (CJS programmatic Vite API) instead of the Vite CLI. CJS `require()` uses filesystem paths, not URLs, bypassing the encoding issue. The build script also pre-resolves `react`, `react-dom`, `react/jsx-runtime`, `react/jsx-dev-runtime`, and `react-dom/client` to absolute paths.

2. `apps/dashboard/vite.config.js` must have ZERO top-level `import` statements from npm packages. Any import from `vite` or plugins in the config file gets processed by Vite's esbuild config bundler which fails with the `?`-path bug.

3. `apps/dashboard/index.html` must use `./src/main.tsx` (relative path), NOT `/src/main.tsx` (absolute path). Vite resolves absolute paths as URLs, which fails with `?` in the project root.

4. Vitest warnings like "The project root contains the '?' character" are expected and harmless — vitest runs correctly despite the warning.

5. When adding new Vite-based apps or tools, always use the programmatic API via a `.cjs` build script rather than the CLI.

6. pnpm v11 requires `pnpm approve-builds --all` to be run once after initial install to approve esbuild's post-install scripts. Without this, `pnpm install` exits with `ERR_PNPM_IGNORED_BUILDS` which causes turbo to fail.
