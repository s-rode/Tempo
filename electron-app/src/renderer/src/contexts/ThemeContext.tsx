import React, { createContext, useContext, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark' | 'system'
/** How cards and panels look in dark mode.  Light mode is the same for both. */
export type DarkStyle = 'solid' | 'gruvbox' | 'sage'

export const DARK_STYLES: ReadonlyArray<DarkStyle> = ['solid', 'gruvbox', 'sage']
export const isDarkStyle = (value: unknown): value is DarkStyle =>
  DARK_STYLES.includes(value as DarkStyle)
/** Sage was briefly called Quest; read that name as Sage. */
export const renamedStyle = (value: unknown): unknown => (value === 'quest' ? 'sage' : value)
/** How cards and panels look in light mode.  Glass is the original look. */
export type LightStyle = 'glass' | 'solid' | 'gruvbox' | 'sage'

export const LIGHT_STYLES: ReadonlyArray<LightStyle> = ['glass', 'solid', 'gruvbox', 'sage']
export const isLightStyle = (value: unknown): value is LightStyle =>
  LIGHT_STYLES.includes(value as LightStyle)

interface ThemeContextType {
  theme: Theme
  setTheme: (theme: Theme) => void
  darkStyle: DarkStyle
  setDarkStyle: (style: DarkStyle) => void
  lightStyle: LightStyle
  setLightStyle: (style: LightStyle) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>(() => {
    const storedTheme = localStorage.getItem('theme') as Theme | null
    if (storedTheme) {
      return storedTheme
    }
    return 'system'
  })
  const [darkStyle, setDarkStyle] = useState<DarkStyle>(() => {
    const stored = renamedStyle(localStorage.getItem('darkStyle'))
    return isDarkStyle(stored) ? stored : 'solid'
  })

  // The style class sits next to `.dark` on the root; it only has an effect
  // while `.dark` is present.
  useEffect(() => {
    const root = window.document.documentElement
    for (const style of DARK_STYLES) root.classList.toggle(`tempo-dark-${style}`, style === darkStyle)
    localStorage.setItem('darkStyle', darkStyle)
  }, [darkStyle])

  const [lightStyle, setLightStyle] = useState<LightStyle>(() => {
    const stored = renamedStyle(localStorage.getItem('lightStyle'))
    return isLightStyle(stored) ? stored : 'solid'
  })

  // Like the dark style, this class only has an effect while `.dark` is absent.
  useEffect(() => {
    const root = window.document.documentElement
    for (const style of LIGHT_STYLES) root.classList.toggle(`tempo-light-${style}`, style === lightStyle)
    localStorage.setItem('lightStyle', lightStyle)
  }, [lightStyle])

  useEffect(() => {
    const root = window.document.documentElement
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    const handleChange = () => {
      if (theme === 'system') {
        if (mediaQuery.matches) {
          root.classList.add('dark')
        } else {
          root.classList.remove('dark')
        }
      }
    }

    if (theme === 'system') {
      if (mediaQuery.matches) {
        root.classList.add('dark')
      } else {
        root.classList.remove('dark')
      }
      mediaQuery.addEventListener('change', handleChange)
    } else if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }

    localStorage.setItem('theme', theme) // Store theme preference
    window.api?.setNativeTheme?.(theme)

    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [theme])

  useEffect(() => {
    window.api?.getSystemAccentColor?.().then((accent) => {
      if (accent) window.document.documentElement.style.setProperty('--tempo-system-accent', accent)
    }).catch(() => {})
  }, [])

  return <ThemeContext.Provider value={{ theme, setTheme, darkStyle, setDarkStyle, lightStyle, setLightStyle }}>{children}</ThemeContext.Provider>
}

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
