import { useAuth } from '../../contexts/AuthContext'
import type { DarkStyle, LightStyle, Theme } from '../../contexts/ThemeContext'
import { isDarkStyle, isLightStyle, renamedStyle, useTheme } from '../../contexts/ThemeContext'
import { trpc } from '../../utils/trpc'
import { SettingsRow, SettingsSegmented } from './SettingsLayout'

const THEMES: ReadonlyArray<{ value: Theme; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Auto' }
]

const DARK_STYLE_OPTIONS: ReadonlyArray<{ value: DarkStyle; label: string }> = [
  { value: 'solid', label: 'Solid' },
  { value: 'gruvbox', label: 'Gruvbox' },
  { value: 'sage', label: 'Sage' },
  { value: 'sage-solid', label: 'Sage Solid' }
]

const LIGHT_STYLE_OPTIONS: ReadonlyArray<{ value: LightStyle; label: string }> = [
  { value: 'solid', label: 'Solid' },
  { value: 'gruvbox', label: 'Gruvbox' },
  { value: 'sage', label: 'Sage' },
  { value: 'glass', label: 'Glass' },
  { value: 'sage-glass', label: 'Sage Glass' }
]

const isTheme = (value: unknown): value is Theme => THEMES.some((option) => option.value === value)

export function ThemeSwitcher() {
  const { theme, setTheme, darkStyle, setDarkStyle, lightStyle, setLightStyle } = useTheme()
  const { token } = useAuth()

  // The saved theme wins over the locally cached one once it loads.
  trpc.user.getElectronAppSettings.useQuery(
    { token: token || '' },
    {
      enabled: !!token,
      onSuccess: (data) => {
        if (data && 'theme' in data && isTheme(data.theme)) setTheme(data.theme)
        const darkStyle = data && 'darkStyle' in data ? renamedStyle(data.darkStyle) : null
        const lightStyle = data && 'lightStyle' in data ? renamedStyle(data.lightStyle) : null
        if (isDarkStyle(darkStyle)) setDarkStyle(darkStyle)
        if (isLightStyle(lightStyle)) setLightStyle(lightStyle)
      }
    }
  )
  const update = trpc.user.updateElectronAppSettings.useMutation()

  const choose = (next: Theme) => {
    const previous = theme
    setTheme(next)
    if (token) update.mutate({ token, theme: next }, { onError: () => setTheme(previous) })
  }

  const chooseDarkStyle = (next: DarkStyle) => {
    const previous = darkStyle
    setDarkStyle(next)
    if (token) update.mutate({ token, darkStyle: next }, { onError: () => setDarkStyle(previous) })
  }

  const chooseLightStyle = (next: LightStyle) => {
    const previous = lightStyle
    setLightStyle(next)
    if (token) update.mutate({ token, lightStyle: next }, { onError: () => setLightStyle(previous) })
  }

  return (
    <>
      <SettingsRow
        title="Appearance"
        description="Auto follows the appearance of macOS."
        control={
          <SettingsSegmented
            aria-label="Appearance"
            value={theme}
            options={THEMES}
            disabled={update.isLoading}
            onChange={choose}
          />
        }
      />
      <SettingsRow
        title="Light style"
        description="Solid uses white cards on ivory. Gruvbox uses warm paper colours. Sage uses the app icon's paper, sage green and coral. Glass is the original look; Sage Glass adds the Sage colours to it."
        inactive={theme === 'dark'}
        control={
          <SettingsSegmented
            aria-label="Light style"
            value={lightStyle}
            options={LIGHT_STYLE_OPTIONS}
            disabled={update.isLoading}
            onChange={chooseLightStyle}
          />
        }
      />
      <SettingsRow
        title="Dark style"
        description="Solid uses quiet grey cards. Gruvbox adds warmer text and small uppercase headings. Sage uses a green-black ink with sage green and coral. Sage Solid uses the Sage colours on a deep black window with a grey sidebar."
        inactive={theme === 'light'}
        control={
          <SettingsSegmented
            aria-label="Dark style"
            value={darkStyle}
            options={DARK_STYLE_OPTIONS}
            disabled={update.isLoading}
            onChange={chooseDarkStyle}
          />
        }
      />
    </>
  )
}
