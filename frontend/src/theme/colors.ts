/** Resolved token colors for libraries that need literal values (SVG charts, three.js). */
export interface ThemeColors {
  fg: string
  muted: string
  dim: string
  card: string
  inset: string
  line: string
  grid: string
  accent: string
  teal: string
  green: string
  blue: string
  amber: string
  red: string
  violet: string
}

const VARS: Record<keyof ThemeColors, string> = {
  fg: '--fg', muted: '--fg-muted', dim: '--fg-dim', card: '--card', inset: '--card-inset',
  line: '--line', grid: '--grid', accent: '--accent', teal: '--teal', green: '--green',
  blue: '--blue', amber: '--amber', red: '--red', violet: '--violet',
}

export function readThemeColors(): ThemeColors {
  const style = getComputedStyle(document.documentElement)
  const out = {} as ThemeColors
  for (const [key, cssVar] of Object.entries(VARS) as [keyof ThemeColors, string][]) {
    out[key] = style.getPropertyValue(cssVar).trim() || '#888888'
  }
  return out
}
