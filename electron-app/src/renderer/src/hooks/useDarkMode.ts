import { useEffect, useState } from 'react'

export function useDarkMode(): boolean {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    // Initialize state with the current value to avoid a flash of incorrect theme
    return document.documentElement.classList.contains('dark')
  })

  useEffect(() => {
    const checkDarkMode = (): void => {
      setIsDarkMode(document.documentElement.classList.contains('dark'))
    }

    // No need to call checkDarkMode() here as the state is initialized correctly
    // and the observer will catch any subsequent changes.

    const observer = new MutationObserver(checkDarkMode)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    })

    return () => observer.disconnect()
  }, [])

  return isDarkMode
}
