import { RefreshCw, RotateCcw } from 'lucide-react'
import { CategoryManagement } from '../components/settings/CategoryManagement' // We'll create this next
import DistractionSoundSettings from '../components/settings/DistractionSoundSettings'
import { PermissionsStatus } from '../components/settings/PermissionsStatus'
import { ThemeSwitcher } from '../components/settings/ThemeSwitcher'
import { TimerDisplaySettings } from '../components/settings/TimerDisplaySettings'
import { FocusComparisonSettings } from '../components/settings/FocusComparisonSettings'
import { SessionTransitionAlertSettings } from '../components/settings/SessionTransitionAlertSettings'
import { RememberedCorrectionsSettings } from '../components/settings/RememberedCorrectionsSettings'
import { PlanningSettings } from '../components/settings/PlanningSettings'
import { ClassificationHealthSettings } from '../components/settings/ClassificationHealthSettings'
import { ClassifierStrictnessSettings } from '../components/settings/ClassifierStrictnessSettings'
import { ClassificationLearningSettings } from '../components/settings/ClassificationLearningSettings'
import { Button } from '../components/ui/button'
import { useAuth } from '../contexts/AuthContext'

interface SettingsPageProps {
  onResetOnboarding: () => void
  onRestartMonitoring: () => void
  planningOpenRequest?: number
}

export function SettingsPage({
  onResetOnboarding,
  onRestartMonitoring,
  planningOpenRequest = 0
}: SettingsPageProps) {
  const { user, logout } = useAuth()

  const LogOutButtonSection = () => {
    return (
      <section className="tempo-settings-row">
        <div>
          <h2>Account</h2>
          <p>Logged in as: {user?.email || 'Unknown'}</p>
        </div>
        <Button onClick={logout} variant="destructive" size="sm">
          Logout
        </Button>
      </section>
    )
  }

  const OnboardingSection = () => {
    return (
      <section className="tempo-settings-row">
        <div>
          <h2>Onboarding</h2>
          <p>Restart the setup process to review your plan and permissions.</p>
        </div>
        <Button onClick={onResetOnboarding} variant="outline" size="sm">
          <RefreshCw className="w-4 h-4 mr-2" />
          Reset Onboarding
        </Button>
      </section>
    )
  }

  const MonitoringSection = () => (
    <section className="tempo-settings-row">
      <div>
        <h2>Monitoring</h2>
        <p>
          If Tempo remains on an older activity after you switch apps, restart its local observer.
          Your history, focus session, and timer settings are preserved.
        </p>
      </div>
      <Button onClick={onRestartMonitoring} variant="outline" size="sm">
        <RotateCcw className="w-4 h-4 mr-2" />
        Restart monitoring
      </Button>
    </section>
  )

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="tempo-settings mx-auto max-w-3xl px-8 py-7">
        <header className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Preferences are stored locally on this Mac.
          </p>
        </header>
        <section className="tempo-settings-group">
          <h2>Planning and focus</h2>
          <PlanningSettings openRequest={planningOpenRequest} />
          <SessionTransitionAlertSettings />
        </section>
        <section className="tempo-settings-group">
          <h2>Appearance and timers</h2>
          <ThemeSwitcher />
          <TimerDisplaySettings />
        </section>
        <section className="tempo-settings-group">
          <h2>Dashboard</h2>
          <FocusComparisonSettings />
        </section>
        <section className="tempo-settings-group">
          <h2>Activity feedback</h2>
          <CategoryManagement />
          <DistractionSoundSettings />
          <ClassifierStrictnessSettings />
          <ClassificationLearningSettings />
          <RememberedCorrectionsSettings />
          <ClassificationHealthSettings />
        </section>
        <section className="tempo-settings-group">
          <h2>Privacy and permissions</h2>
          <PermissionsStatus />
        </section>
        <section className="tempo-settings-group">
          <h2>Support</h2>
          <MonitoringSection />
          <OnboardingSection />
          <LogOutButtonSection />
        </section>
      </div>
    </main>
  )
}
