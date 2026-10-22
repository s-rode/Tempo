import './assets/custom-title-bar.css'
import './styles/index.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './AppWrapper'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { createTrpcClient, trpc } from './utils/trpc'
import { configureServerConnection } from './lib/serverConnection'

function Main() {
  const [queryClient] = useState(() => new QueryClient())
  const [client] = useState(() => createTrpcClient())
  return (
    <React.StrictMode>
      <trpc.Provider client={client} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ThemeProvider>
              <App />
            </ThemeProvider>
          </AuthProvider>
        </QueryClientProvider>
      </trpc.Provider>
    </React.StrictMode>
  )
}

void window.api.getEnvVariables().then((configuration) => {
  configureServerConnection(configuration.SERVER_URL)
  localStorage.setItem('tempoLocalMode', 'true')
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<Main />)
})
