import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { readThemeColors, type ThemeColors } from './colors'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

// Must match the inline script in index.html that applies the theme before first paint.
export const THEME_STORAGE_KEY = 'lightsync.theme'

interface ThemeContextValue {
  preference: ThemePreference
  theme: ResolvedTheme
  setPreference: (p: ThemePreference) => void
  toggle: () => void
  colors: ThemeColors
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function systemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function readPreference(): ThemePreference {
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference)
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => setSystem(mq.matches ? 'light' : 'dark')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const theme: ResolvedTheme = preference === 'system' ? system : preference

  const [colors, setColors] = useState<ThemeColors>(readThemeColors)

  useLayoutEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    root.classList.toggle('light', theme === 'light')
    root.style.colorScheme = theme
    // Charts and the 3D scene need literal colors, re-read once the class lands.
    setColors(readThemeColors())
  }, [theme])

  const setPreference = useCallback((p: ThemePreference) => {
    if (p === 'system') localStorage.removeItem(THEME_STORAGE_KEY)
    else localStorage.setItem(THEME_STORAGE_KEY, p)
    setPreferenceState(p)
  }, [])

  const toggle = useCallback(() => setPreference(theme === 'dark' ? 'light' : 'dark'), [theme, setPreference])

  const value = useMemo(
    () => ({ preference, theme, setPreference, toggle, colors }),
    [preference, theme, setPreference, toggle, colors],
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}

export function useThemeColors(): ThemeColors {
  return useTheme().colors
}
