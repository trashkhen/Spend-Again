---
name: TypeScript strict mode quirks in dashboard
description: exactOptionalPropertyTypes causes T vs T|undefined mismatches; Recharts formatter types use ValueType (number|string|undefined) not number.
type: project
---

The `tsconfig.base.json` enables `exactOptionalPropertyTypes: true`. This means:

1. **Optional object properties**: A type `{ foo?: string }` means `foo` is either absent OR `string`. You cannot assign `{ foo: string | undefined }` to it. Fix: define types as `{ foo?: string | undefined }`.

2. **Recharts formatter callbacks**: `Tooltip formatter` receives `ValueType` (which is `number | string | undefined`), not `number`. Always guard: `const num = typeof value === 'number' ? value : parseFloat(String(value))`.

3. **Recharts PieLabelRenderProps**: All fields (cx, cy, midAngle, etc.) are optional. Guard each with `typeof x !== 'number'` before using.

**Why:** The base tsconfig is intentionally strict to catch subtle bugs. These patterns are load-bearing for correctness.

**How to apply:** When writing any dashboard component that uses optional object types or Recharts components, apply these patterns immediately rather than after a TS error.
