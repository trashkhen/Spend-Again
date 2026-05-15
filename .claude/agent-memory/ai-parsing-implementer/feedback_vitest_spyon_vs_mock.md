---
name: Vitest spyOn vs vi.mock for intra-package module interception
description: When testing a module that statically imports sibling modules, vi.mock on the sibling does not intercept the binding seen by the module under test in vmForks pool — use vi.spyOn instead
type: feedback
---

In the `vmForks` Vitest pool, `vi.mock('../src/some-module.js')` does NOT reliably intercept the imported binding inside a module that also statically imports `some-module.js`. The module under test captures the real import reference at load time and the mock replacement does not propagate to it.

**Why:** ES module live bindings and the vmForks isolation model interact in a way that makes sibling-module mocking unreliable when the module under test is in the same package. The mock replaces the registry entry but the closure in the compiled output already holds a reference to the real function.

**How to apply:** When testing `index.ts` (or any orchestrator module) that statically imports `regex.js`, `learned.js`, `gemini.js` etc., use `vi.spyOn` on the namespace import after importing all modules:

```typescript
import * as RegexModule from '../src/regex.js'
import * as LearnedModule from '../src/learned.js'
import * as GeminiModule from '../src/gemini.js'
import { parse } from '../src/index.js'

beforeEach(() => {
  spyRegex = vi.spyOn(RegexModule, 'parseWithRegex')
  spyLookup = vi.spyOn(LearnedModule, 'lookupItem')
  spyGemini = vi.spyOn(GeminiModule, 'parseWithGemini')
})
```

Still mock external packages (`@spend-again/db`, `@google/generative-ai`) via `vi.mock` at the top to prevent side-effects at module load time (e.g. DATABASE_URL validation, API key checks).
