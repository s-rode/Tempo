import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import type { Theme } from '../../contexts/ThemeContext'
import { useTheme } from '../../contexts/ThemeContext'
import { trpc } from '../../utils/trpc'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme()
  const { token } = useAuth()
  const [previousTheme, setPreviousTheme] = useState<Theme>(theme)

  // Fetch electron app settings
  const { data: _electronAppSettings, isLoading: isLoadingSettings } =
    trpc.user.getElectronAppSettings.useQuery(
      { token: token || '' },
      {
        enabled: !!token,
        onSuccess: (data) => {
          if (data && 'theme' in data && data.theme) {
            const backendTheme = data.theme as 'light' | 'dark' | 'system'
            setTheme(backendTheme)
            setPreviousTheme(backendTheme)
          }
        },
        onError: (error) => {
          console.error('Failed to fetch theme settings:', error)
          // Optionally, set a default theme or rely on localStorage/context default
          // For now, just logging the error. The context will use its default or localStorage.
        }
      }
    )

  // Update electron app settings mutation
  const updateSettingsMutation = trpc.user.updateElectronAppSettings.useMutation({
    onError: (error) => {
      console.error('Failed to update theme:', error)
      // Revert to the previous theme on error
      setTheme(previousTheme)
      // alert('Failed to save theme preference. Please try again.'); // Optional: notify user
    }
    // We can also refetch settings on success/settled if needed, but not strictly necessary here
  })

  // This effect synchronizes the local previousTheme state if the theme is changed by other means
  // (e.g. initial load from context/localStorage before backend sync)
  useEffect(() => {
    setPreviousTheme(theme)
  }, [theme])

  const handleSetTheme = (newTheme: 'light' | 'dark' | 'system') => {
    setPreviousTheme(theme) // Store current theme as previous before attempting change
    setTheme(newTheme) // Optimistically update UI

    if (token) {
      updateSettingsMutation.mutate({
        token,
        theme: newTheme
      })
    } else {
      // If no token, revert or handle locally (e.g. rely on localStorage in ThemeContext)
      // For now, we assume if there's no token, ThemeContext's localStorage is the source of truth
      localStorage.setItem('theme', newTheme)
    }
  }

  if (isLoadingSettings) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Theme</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse">
            <div className="flex space-x-2">
              <div className="h-10 w-20 bg-muted rounded-md"></div>
              <div className="h-10 w-20 bg-muted rounded-md"></div>
              <div className="h-10 w-20 bg-muted rounded-md"></div>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Theme</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex space-x-2">
          <Button
            onClick={() => handleSetTheme('light')}
            variant={theme === 'light' ? 'default' : 'outline'}
            disabled={updateSettingsMutation.isLoading}
          >
            Light
          </Button>
          <Button
            onClick={() => handleSetTheme('dark')}
            variant={theme === 'dark' ? 'default' : 'outline'}
            disabled={updateSettingsMutation.isLoading}
          >
            Dark
          </Button>
          <Button
            onClick={() => handleSetTheme('system')}
            variant={theme === 'system' ? 'default' : 'outline'}
            disabled={updateSettingsMutation.isLoading}
          >
            System
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
