import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

// vite-node unconditionally requests /@vite/env. When the project directory
// contains '?' the URL-encoded path (%3F) breaks /@fs/ resolution. This plugin
// intercepts the virtual module and returns an empty stub so tests can run.
const viteEnvStub: Plugin = {
  name: 'vite-env-stub',
  resolveId(id: string) {
    if (id === '/@vite/env') return '\0vite-env-stub'
  },
  load(id: string) {
    if (id === '\0vite-env-stub') return 'export default {}'
  },
}

export default defineConfig({
  plugins: [viteEnvStub],
  test: {
    environment: 'node',
    pool: 'vmForks',
  },
})
