import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { trpc } from '../utils/trpc'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'

export function OnboardingModal({ onComplete }: { onComplete: () => void }) {
  const { token } = useAuth()
  const [step, setStep] = useState(0)
  const [browser, setBrowser] = useState<'chrome' | 'safari' | 'firefox'>('chrome')
  const [accessibility, setAccessibility] = useState<number | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const complete = trpc.auth.markOnboardingComplete.useMutation()
  const headings = [
    'Welcome to Tempo',
    'Plan your day',
    'Optional permissions',
    'Browser context',
    'Ready to begin'
  ]
  useEffect(() => {
    if (step !== 2) return
    const refresh = () => {
      if (!document.hidden)
        void window.api
          .getPermissionStatus(0)
          .then(setAccessibility)
          .catch(() => {})
    }
    refresh()
    const interval = window.setInterval(refresh, 2000)
    return () => window.clearInterval(interval)
  }, [step])
  const finish = async () => {
    if (complete.isLoading) return
    try {
      if (token) await complete.mutateAsync({ token })
      onComplete()
    } catch {
      setError(
        'Tempo could not save setup progress. Try again when the local service is available.'
      )
    }
  }
  const request = async (kind: number) => {
    setRequesting(true)
    try {
      await window.api.requestPermission(kind)
      setAccessibility(await window.api.getPermissionStatus(0))
    } catch {
      setError('Open System Settings to review Tempo permissions.')
    } finally {
      setRequesting(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void finish()
      }}
    >
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{headings[step]}</DialogTitle>
          <DialogDescription>
            Step {step + 1} of {headings.length}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-52 space-y-4 py-4 text-sm leading-relaxed">
          {step === 0 && (
            <>
              <p>
                Tempo compares your current activity with your plan using local AI and shows focused
                and distracted time beside the notch.
              </p>
              <p className="text-muted-foreground">
                Your activity history and settings stay on this Mac.
              </p>
            </>
          )}
          {step === 1 && (
            <>
              <p>
                Add a short, ordered plan in Today. Unfinished tasks guide classification; a running
                focus session supplies its own goal.
              </p>
              <p className="text-muted-foreground">
                Weekly focus and longer-term direction are available in Settings. You can connect
                Apple Reminders there when you are ready.
              </p>
            </>
          )}
          {step === 2 && (
            <>
              <p>
                Tempo can track app names and available window titles without Accessibility. You can
                enable this optional fallback if you want it.
              </p>
              <p className="text-muted-foreground">
                Accessibility: {accessibility === 1 ? 'granted' : 'optional, not granted'}. Screen
                Recording is used only for Firefox OCR fallback.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={requesting} onClick={() => void request(0)}>
                  Request Accessibility
                </Button>
                <Button variant="outline" disabled={requesting} onClick={() => void request(2)}>
                  Request Firefox OCR access
                </Button>
              </div>
              <p className="text-muted-foreground">
                Review permissions under System Settings → Privacy & Security. Restart Tempo after
                granting Screen Recording if macOS requests it. Reminders access is requested only
                after Connect.
              </p>
            </>
          )}
          {step === 3 && (
            <>
              <div className="flex gap-2">
                {(['chrome', 'safari', 'firefox'] as const).map((name) => (
                  <Button
                    key={name}
                    size="sm"
                    variant={browser === name ? 'default' : 'outline'}
                    onClick={() => setBrowser(name)}
                  >
                    {name === 'chrome' ? 'Chrome' : name === 'safari' ? 'Safari' : 'Firefox'}
                  </Button>
                ))}
              </div>
              {browser === 'firefox' ? (
                <>
                  <p>
                    The Tempo companion supplies bounded visible page context. If that is
                    unavailable, optional in-memory OCR can supply context. Raw page evidence is not
                    retained.
                  </p>
                  <p>
                    For development, reveal the companion package, extract it, and load its manifest
                    using Firefox extension debugging. Temporary loading must be repeated after
                    browser restarts.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.api.revealFirefoxCompanionPackage()}
                    >
                      Reveal companion
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        window.api.copyFirefoxRuntimeDebuggingAddress()
                        void window.api.openFirefoxRuntimeDebugging()
                      }}
                    >
                      Open Firefox and copy address
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p>
                    {browser === 'chrome'
                      ? 'In Chrome, choose View → Developer → Allow JavaScript from Apple Events.'
                      : 'In Safari, enable the Develop menu in Settings → Advanced, then choose Develop → Allow JavaScript from Apple Events.'}
                  </p>
                  <p className="text-muted-foreground">
                    macOS may ask for Apple Events access when supported browser context is first
                    read.
                  </p>
                </>
              )}
            </>
          )}
          {step === 4 && (
            <>
              <p>
                Open Today to add tasks or start a focus session. Closing the main window keeps
                monitoring and the notch running; Quit stops Tempo and its helpers.
              </p>
              <p className="text-muted-foreground">
                Plans, appearance, permissions, sounds, and session behavior can be changed in
                Settings.
              </p>
            </>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-between gap-2 border-t pt-4">
          <Button variant="ghost" disabled={complete.isLoading} onClick={() => void finish()}>
            Skip setup
          </Button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button
                variant="outline"
                disabled={complete.isLoading}
                onClick={() => setStep(step - 1)}
              >
                Back
              </Button>
            )}
            <Button
              disabled={complete.isLoading}
              onClick={() => (step === headings.length - 1 ? void finish() : setStep(step + 1))}
            >
              {complete.isLoading
                ? 'Saving…'
                : step === headings.length - 1
                  ? 'Start Tempo'
                  : 'Continue'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
