import { createContext, JSX, ReactNode, useContext, useEffect, useRef, useState } from 'react'
import { User } from 'shared/dist/types.js'
import { trpc } from '../utils/trpc'

interface AuthContextType {
  user: User | null
  token: string | null
  isLoading: boolean
  isAuthenticated: boolean
  loginLocal: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider = ({ children }: { children: ReactNode }): JSX.Element => {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('accessToken'))
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const localLoginInFlight = useRef<Promise<void> | null>(null)
  const localLoginMutation = trpc.auth.localLogin.useMutation()

  const {
    data: _fetchedUser,
    error: _userError,
    isLoading: userIsLoading,
    refetch: refetchUser
  } = trpc.auth.getUser.useQuery(
    { token: token! },
    {
      enabled: !!token,
      retry: 1,
      onSuccess: (data) => {
        setUser(data as User)
      },
      onError: (err) => {
        console.error('Failed to fetch user with token during query:')
        // Drop the stale session; the effect below signs in to the local account again.
        clearSession()
      }
    }
  )

  useEffect(() => {
    const storedToken = localStorage.getItem('accessToken')
    if (!storedToken) {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === 'accessToken') {
        const newToken = event.newValue
        setToken(newToken)
        if (!newToken) setUser(null)
      }
    }

    window.addEventListener('storage', handleStorageChange)
    return () => {
      window.removeEventListener('storage', handleStorageChange)
    }
  }, [refetchUser])

  useEffect(() => {
    if (!token) {
      setIsLoading(false)
    } else if (userIsLoading) {
      setIsLoading(true)
    } else {
      setIsLoading(false)
    }
  }, [token, userIsLoading])

  const login = (accessToken: string, newRefreshToken?: string, userData?: User) => {
    localStorage.setItem('accessToken', accessToken)
    setToken(accessToken)
    if (newRefreshToken) {
      localStorage.setItem('refreshToken', newRefreshToken)
    }
    if (userData) {
      setUser(userData)
      setIsLoading(false)
    } else {
      refetchUser()
    }
  }

  const loginLocal = (): Promise<void> => {
    if (localLoginInFlight.current) return localLoginInFlight.current
    setIsLoading(true)
    localLoginInFlight.current = (async () => {
      try {
        const { accessToken, refreshToken, user } = await localLoginMutation.mutateAsync()
        login(accessToken, refreshToken, user as User)
      } catch {
        console.error('Local Tempo login failed.')
      } finally {
        localLoginInFlight.current = null
        setIsLoading(false)
      }
    })()
    return localLoginInFlight.current
  }

  useEffect(() => {
    if (!token) void loginLocal()
  }, [token])

  const clearSession = () => {
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
    setToken(null)
    setUser(null)
    setIsLoading(false)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAuthenticated: !!user && !!token,
        loginLocal
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
