import { useAuth } from '../../contexts/AuthContext'
import type { DarkStyle, LightStyle, Theme } from '../../contexts/ThemeContext'
import { isDarkStyle, isLightStyle, useTheme } from '../../contexts/ThemeContext'
import { trpc } from '../../utils/trpc'
import { SettingsRow, SettingsSegmented } from './SettingsLayout'

const THEMES: ReadonlyArray<{ value: Theme; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Auto' }
]

const DARK_STYLE_OPTIONS: ReadonlyArray<{ value: DarkStyle; label: string }> = [
  { value: 'solid', label: 'Solid' },
  { value: 'gruvbox', label: 'Gruvbox' }
]

const LIGHT_STYLE_OPTIONS: ReadonlyArray<{ value: LightStyle; label: string }> = [
  { value: 'solid', label: 'Solid' },
  { value: 'gruvbox', label: 'Gruvbox' },
  { value: 'glass', label: 'Glass' }
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
        if (data && 'darkStyle' in data && isDarkStyle(data.darkStyle)) setDarkStyle(data.darkStyle)
        if (data && 'lightStyle' in data && isLightStyle(data.lightStyle)) setLightStyle(data.lightStyle)
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
        description="Solid uses white cards on ivory. Gruvbox uses warm paper colours. Glass is the original look."
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
        description="Solid uses quiet grey cards. Gruvbox adds warmer text and small uppercase headings."
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
