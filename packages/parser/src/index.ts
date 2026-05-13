// Parser package entry point
// Task 2.1: regex tier exported here; full parse() orchestration added in Task 2.4
export { parseWithRegex } from './regex.js'
export type { ParseResult } from './regex.js'

// Task 2.2: Gemini LLM tier (Tier 3)
export { parseWithGemini, GeminiRateLimitError, buildPrompt } from './gemini.js'
