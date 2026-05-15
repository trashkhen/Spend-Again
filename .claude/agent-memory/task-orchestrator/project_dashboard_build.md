---
name: Dashboard custom build system
description: The dashboard uses build.cjs (not vite CLI) because the project path contains '?' which pathToFileURL URL-encodes. New npm packages must be added to the alias map in build.cjs.
type: project
---

The `apps/dashboard` build uses `node build.cjs` (programmatic Vite CJS API) instead of `vite build` CLI because the project directory path `/Users/khen/Desktop/Spend Again?` contains a `?` character that Vite's CLI URL-encodes to `%3F`, breaking package resolution.

**Why:** The `?` in the project directory name causes Rollup's internal `pathToFileURL` to encode it, which then fails when Rollup tries to resolve modules via encoded paths.

**How to apply:** When adding a new npm package to the dashboard that needs to be bundled, you MUST add it to the `alias` map in `apps/dashboard/build.cjs`. Pattern:
```js
const packageDir = pkgDir('package-name');
if (packageDir) {
  alias['package-name'] = path.join(packageDir, 'dist', 'index.mjs'); // use ESM build
}
```
Packages already aliased: `react`, `react-dom`, `react-router-dom`, `recharts`, `scheduler`.
