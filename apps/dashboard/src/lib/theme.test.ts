import { describe, expect, test } from 'vitest'
import {
  THEME_STORAGE_KEY,
  applyTheme,
  getInitialTheme,
  getNextTheme,
  persistTheme,
} from './theme'

function createStorage(initialValue: string | null = null) {
  const values = new Map<string, string>()
  if (initialValue !== null) values.set(THEME_STORAGE_KEY, initialValue)

  return {
    getItem(key: string) {
      return values.get(key) ?? null
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
  }
}

describe('theme helpers', () => {
  test('defaults to light mode without a stored preference', () => {
    expect(getInitialTheme(createStorage())).toBe('light')
  })

  test('uses a stored dark preference', () => {
    expect(getInitialTheme(createStorage('dark'))).toBe('dark')
  })

  test('ignores unknown stored values', () => {
    expect(getInitialTheme(createStorage('sepia'))).toBe('light')
  })

  test('toggles between light and dark themes', () => {
    expect(getNextTheme('light')).toBe('dark')
    expect(getNextTheme('dark')).toBe('light')
  })

  test('persists the selected theme', () => {
    const storage = createStorage()

    persistTheme('dark', storage)

    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })

  test('applies the selected theme to the document root dataset', () => {
    const root = { dataset: { theme: 'light' } }

    applyTheme('dark', root)

    expect(root.dataset.theme).toBe('dark')
  })
})
