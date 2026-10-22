import { HashRouter, Route, Routes } from 'react-router-dom'
import { MainAppContent } from './App'
import './assets/custom-title-bar.css'
import { PageContainer } from './components/layout/PageContainer'
import Spinner from './components/ui/Spinner'
import { useAuth } from './contexts/AuthContext'

export default function App(): React.JSX.Element {
  const { isAuthenticated, isLoading, loginLocal } = useAuth()
  return (
    <HashRouter>
      <PageContainer>
        {isAuthenticated ? (
          <Routes>
            <Route path="/" element={<MainAppContent />} />
          </Routes>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            {isLoading ? (
              <>
                <Spinner />
                <p>Starting local Tempo…</p>
              </>
            ) : (
              <>
                <p>Tempo could not connect to its local service.</p>
                <button type="button" className="tempo-button" onClick={() => void loginLocal()}>
                  Try again
                </button>
              </>
            )}
          </div>
        )}
      </PageContainer>
    </HashRouter>
  )
}
