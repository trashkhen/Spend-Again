---
name: Gemini RPM queue must not be inside parseWithGemini
description: Rate limiting queue inside parseWithGemini causes test timeouts; keep it as a separate exported utility.
type: feedback
---

Do NOT embed the Gemini 15 RPM sliding-window queue inside `parseWithGemini()` itself.

**Why:** The gemini.test.ts file runs 22+ calls to `parseWithGemini` in rapid succession with `vi.resetAllMocks()` per test (which does NOT reset module-level state). If a timestamp queue accumulates inside the module, after 15 test calls it sleeps for ~60 seconds waiting for the window to expire — causing test timeouts.

**How to apply:** Keep the RPM queue as an exported utility function (`waitForGeminiRpmBudget`) that callers invoke before calling `parseWithGemini`. The `parseWithGemini` function itself should only throw `GeminiRateLimitError` immediately on a 429 response — no retry loops, no internal sleeping.
