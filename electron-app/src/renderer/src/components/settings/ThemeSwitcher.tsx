import { useAuth } from '../../contexts/AuthContext'
import type { Theme } from '../../contexts/ThemeContext'
import { useTheme } from '../../contexts/ThemeContext'
import { trpc } from '../../utils/trpc'
import { SettingsRow, SettingsSegmented } from './SettingsLayout'

const THEMES: ReadonlyArray<{ value: Theme; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Auto' }
]

const isTheme = (value: unknown): value is Theme => THEMES.some((option) => option.value === value)

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme()
  const { token } = useAuth()

  // The saved theme wins over the locally cached one once it loads.
  trpc.user.getElectronAppSettings.useQuery(
    { token: token || '' },
    {
      enabled: !!token,
      onSuccess: (data) => {
        if (data && 'theme' in data && isTheme(data.theme)) setTheme(data.theme)
      }
    }
  )
  const update = trpc.user.updateElectronAppSettings.useMutation()

  const choose = (next: Theme) => {
    const previous = theme
    setTheme(next)
    if (token) update.mutate({ token, theme: next }, { onError: () => setTheme(previous) })
  }

  return (
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
  )
}
