export type ThemeMode = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'spend-again-theme'

type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>
type ThemeRoot = {
  dataset: {
    theme?: string | undefined
  }
}

function getBrowserStorage(): ThemeStorage | undefined {
  if (typeof window === 'undefined') return undefined

  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

function getDocumentRoot(): ThemeRoot | undefined {
  if (typeof document === 'undefined') return undefined
  return document.documentElement
}

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'light' || value === 'dark'
}

export function getInitialTheme(storage: ThemeStorage | undefined = getBrowserStorage()): ThemeMode {
  try {
    const storedTheme = storage?.getItem(THEME_STORAGE_KEY) ?? null
    return isThemeMode(storedTheme) ? storedTheme : 'light'
  } catch {
    return 'light'
  }
}

export function getNextTheme(theme: ThemeMode): ThemeMode {
  return theme === 'dark' ? 'light' : 'dark'
}

export function persistTheme(
  theme: ThemeMode,
  storage: ThemeStorage | undefined = getBrowserStorage(),
) {
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Theme persistence is a convenience; blocked storage should not break the app shell.
  }
}

export function applyTheme(theme: ThemeMode, root: ThemeRoot | undefined = getDocumentRoot()) {
  if (!root) return
  root.dataset.theme = theme
}
