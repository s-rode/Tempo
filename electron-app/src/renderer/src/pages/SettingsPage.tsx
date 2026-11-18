import { useEffect, useState } from 'react'
import { AppRulesSettings } from '../components/settings/AppRulesSettings'
import { AppleCalendarSettings } from '../components/settings/AppleCalendarSettings'
import { BrowserTrackingSettings } from '../components/settings/BrowserTrackingSettings'
import { CategoryManagement } from '../components/settings/CategoryManagement'
import { ClassificationHealthSettings } from '../components/settings/ClassificationHealthSettings'
import { ClassificationLearningSettings } from '../components/settings/ClassificationLearningSettings'
import { ClassifierStrictnessSettings } from '../components/settings/ClassifierStrictnessSettings'
import DistractionSoundSettings from '../components/settings/DistractionSoundSettings'
import { FocusComparisonSettings } from '../components/settings/FocusComparisonSettings'
import { PermissionsStatus } from '../components/settings/PermissionsStatus'
import { PlanningSettings } from '../components/settings/PlanningSettings'
import { RememberedCorrectionsSettings } from '../components/settings/RememberedCorrectionsSettings'
import { SessionTransitionAlertSettings } from '../components/settings/SessionTransitionAlertSettings'
import {
  SettingsRow,
  SettingsSection,
  SettingsSegmented
} from '../components/settings/SettingsLayout'
import { ThemeSwitcher } from '../components/settings/ThemeSwitcher'
import { TimerDisplaySettings } from '../components/settings/TimerDisplaySettings'
import { RemindersSettings } from '../components/RemindersPanel'
import { Button } from '../components/ui/button'

type Pane = 'general' | 'planning' | 'alerts' | 'classification' | 'privacy'

const PANES: ReadonlyArray<{ value: Pane; label: string }> = [
  { value: 'general', label: 'General' },
  { value: 'planning', label: 'Planning' },
  { value: 'alerts', label: 'Alerts' },
  { value: 'classification', label: 'Classification' },
  { value: 'privacy', label: 'Privacy' }
]

// Kept across visits to Settings, like the selected pane of a macOS settings window.
let lastPane: Pane = 'general'
let handledPlanningRequest = 0

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
  const pendingPlanningRequest =
    planningOpenRequest > handledPlanningRequest ? planningOpenRequest : 0
  const [pane, setPane] = useState<Pane>(() => (pendingPlanningRequest ? 'planning' : lastPane))

  useEffect(() => {
    if (pendingPlanningRequest) setPane('planning')
  }, [pendingPlanningRequest])
  useEffect(() => {
    lastPane = pane
  }, [pane])

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="tempo-prefs">
        <header className="tempo-prefs-header">
          <div>
            <h1>Settings</h1>
            <p>Preferences are stored locally on this Mac.</p>
          </div>
          <SettingsSegmented
            aria-label="Settings section"
            className="tempo-prefs-tabs"
            value={pane}
            options={PANES}
            onChange={setPane}
          />
        </header>

        {pane === 'general' && (
          <>
            <SettingsSection title="General">
              <ThemeSwitcher />
              <FocusComparisonSettings />
            </SettingsSection>
            <TimerDisplaySettings />
            <SettingsSection
              title="Troubleshooting"
              footer="Your history, focus session and timer settings are kept."
            >
              <SettingsRow
                title="Restart monitoring"
                description="Use this if Tempo keeps showing an older activity after you switch apps."
                control={
                  <Button variant="glass" size="compact" onClick={onRestartMonitoring}>
                    Restart
                  </Button>
                }
              />
              <SettingsRow
                title="Onboarding"
                description="Run the setup again to review your plan and permissions."
                control={
                  <Button variant="glass" size="compact" onClick={onResetOnboarding}>
                    Run Setup…
                  </Button>
                }
              />
            </SettingsSection>
          </>
        )}

        {pane === 'planning' && (
          <>
            <PlanningSettings
              openRequest={pendingPlanningRequest}
              onOpenRequestHandled={(request) => {
                handledPlanningRequest = request
              }}
            />
            <AppleCalendarSettings />
            <RemindersSettings />
          </>
        )}

        {pane === 'alerts' && (
          <>
            <DistractionSoundSettings />
            <SessionTransitionAlertSettings />
          </>
        )}

        {pane === 'classification' && (
          <>
            <SettingsSection title="Classifier">
              <ClassifierStrictnessSettings />
            </SettingsSection>
            <CategoryManagement />
            <AppRulesSettings />
            <ClassificationLearningSettings />
            <RememberedCorrectionsSettings />
            <ClassificationHealthSettings />
          </>
        )}

        {pane === 'privacy' && (
          <>
            <PermissionsStatus />
            <SettingsSection title="Browsers">
              <BrowserTrackingSettings />
            </SettingsSection>
          </>
        )}
      </div>
    </main>
  )
}
