import { useEffect, useState } from 'react'

/**
 * Custom hook that returns the current time, updated at a specified interval.
 * @param updateInterval The interval in milliseconds at which to update the time. Defaults to 60000ms (1 minute).
 * @returns The current Date object.
 */
export function useCurrentTime(updateInterval = 60000): Date {
  const [currentTime, setCurrentTime] = useState(new Date())

  useEffect(() => {
    const intervalId = setInterval(() => {
      setCurrentTime(new Date())
    }, updateInterval)

    return () => clearInterval(intervalId)
  }, [updateInterval])

  return currentTime
}
