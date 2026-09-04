import { Coffee, Focus, Pause, Play, Timer, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { trpc } from '../utils/trpc'
import { Button } from './ui/button'

const customDurations = [15, 30, 45, 60, 90, 120] as const
const pauseDurations = [1, 5, 20, 30, 60, 120] as const

const clock = (milliseconds: number | null | undefined) => {
  if (milliseconds === null || milliseconds === undefined) return ''
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

interface FocusRuntimeSnapshot {
  mode?: 'normal' | 'custom' | 'pomodoro'
  trackingState: string
  run?: { kind: 'custom' | 'pomodoro'; currentPhaseIndex: number } | null
  currentPhase?: { kind: 'work' | 'short_break' | 'long_break'; state: 'awaiting_goal' | 'running' | 'suspended'; goal?: string | null } | null
  phaseRemainingMs: number | null
  suspension: { reasons: string[]; pausedUntilMs?: number | null }
}

const inputStyle = 'h-10 rounded-lg border border-border bg-background px-3 text-sm shadow-inner shadow-black/[.02] outline-none transition placeholder:text-muted-foreground focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 dark:shadow-black/20'
const selectStyle = 'h-10 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15'

/** A presentation-only shell around the server-authoritative focus runtime. */
export function FocusRuntimeControls({ runtime }: { runtime: FocusRuntimeSnapshot | undefined }) {
  const { token } = useAuth()
  const [goal, setGoal] = useState('')
  const [duration, setDuration] = useState<(typeof customDurations)[number]>(30)
  const utils = trpc.useContext()
  const invalidate = () => utils.focusRuntime.getState.invalidate()
  const startCustom = trpc.focusRuntime.startCustom.useMutation({ onSuccess: invalidate })
  const startPomodoro = trpc.focusRuntime.startPomodoro.useMutation({ onSuccess: invalidate })
  const confirmGoal = trpc.focusRuntime.confirmWorkGoal.useMutation({ onSuccess: invalidate })
  const pause = trpc.focusRuntime.pause.useMutation({ onSuccess: invalidate })
  const resume = trpc.focusRuntime.resume.useMutation({ onSuccess: invalidate })
  const skipBreak = trpc.focusRuntime.skipBreak.useMutation({ onSuccess: invalidate })
  const endRun = trpc.focusRuntime.endRun.useMutation({ onSuccess: invalidate })
  const busy = startCustom.isLoading || startPomodoro.isLoading || confirmGoal.isLoading || pause.isLoading || resume.isLoading || skipBreak.isLoading || endRun.isLoading

  if (!token || !runtime) return null
  const phase = runtime.currentPhase
  const activeRun = runtime.run
  const isWaitingForGoal = phase?.state === 'awaiting_goal'
  const isBreak = runtime.trackingState === 'break'
  const isPaused = runtime.trackingState === 'paused'
  const submitGoal = (action: 'custom' | 'pomodoro' | 'next') => {
    const trimmed = goal.trim()
    if (!trimmed) return
    if (action === 'custom') startCustom.mutate({ token, goal: trimmed, durationMinutes: duration })
    if (action === 'pomodoro') startPomodoro.mutate({ token, firstGoal: trimmed })
    if (action === 'next') confirmGoal.mutate({ token, goal: trimmed })
    setGoal('')
  }

  return (
    <section className="mx-4 mb-3 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {!activeRun ? (
        <div className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center">
          <div className="flex min-w-[150px] items-center gap-2 px-1">
            <StatusMark tone="emerald"><Focus size={18} /></StatusMark>
            <div><p className="text-sm font-semibold">Start a focus block</p><p className="text-xs text-muted-foreground">Set one clear intention.</p></div>
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <input className={`${inputStyle} min-w-[220px] flex-1`} value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="What will you focus on?" onKeyDown={(event) => event.key === 'Enter' && submitGoal('custom')} />
            <select className={selectStyle} value={duration} onChange={(event) => setDuration(Number(event.target.value) as typeof duration)} aria-label="Custom focus duration">
              {customDurations.map((minutes) => <option key={minutes} value={minutes}>{minutes} min</option>)}
            </select>
            <Button className="h-10 bg-emerald-600 px-4 text-white hover:bg-emerald-700" disabled={!goal.trim() || busy} onClick={() => submitGoal('custom')}><Timer size={16} />Start focus</Button>
            <Button variant="outline" className="h-10 border-violet-300 bg-violet-500/[.06] text-violet-700 hover:bg-violet-500/[.12] dark:border-violet-500/40 dark:text-violet-300" disabled={!goal.trim() || busy} onClick={() => submitGoal('pomodoro')}><Focus size={16} />Pomodoro</Button>
          </div>
          <div className="border-t pt-3 lg:border-l lg:border-t-0 lg:pl-3 lg:pt-0"><PauseMenu disabled={busy} onPause={(minutes) => pause.mutate({ token, durationMinutes: minutes })} /></div>
        </div>
      ) : isWaitingForGoal ? (
        <div className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center">
          <StatusMark tone="amber"><Timer size={18} /></StatusMark>
          <div className="min-w-[190px]"><p className="text-sm font-semibold">Ready for the next Pomodoro block</p><p className="text-xs text-muted-foreground">Choose one goal for the next 30 minutes.</p></div>
          <input className={`${inputStyle} min-w-[240px] flex-1`} value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="Goal for this 30-minute block" onKeyDown={(event) => event.key === 'Enter' && submitGoal('next')} />
          <Button className="h-10 bg-emerald-600 text-white hover:bg-emerald-700" disabled={!goal.trim() || busy} onClick={() => submitGoal('next')}><Play size={16} />Begin block</Button>
          <EndButton disabled={busy} onEnd={() => endRun.mutate({ token })} />
        </div>
      ) : (
        <div className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center">
          <StatusMark tone={isBreak ? 'sky' : isPaused ? 'amber' : 'emerald'}>{isBreak ? <Coffee size={18} /> : isPaused ? <Pause size={18} /> : <Focus size={18} />}</StatusMark>
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><p className="text-sm font-semibold">{isBreak ? 'Break' : activeRun.kind === 'pomodoro' ? `Pomodoro ${Math.ceil((activeRun.currentPhaseIndex + 1) / 2)} of 4` : 'Focus session'}</p>{runtime.phaseRemainingMs !== null && <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs font-semibold text-muted-foreground">{clock(runtime.phaseRemainingMs)} left</span>}</div><p className="truncate text-xs text-muted-foreground">{isPaused ? 'Paused — monitoring and counters are frozen.' : phase?.goal || (isBreak ? 'Monitoring is suspended during your break.' : 'Focus in progress')}</p></div>
          {isPaused && runtime.suspension.reasons.includes('manual_pause') ? <Button disabled={busy} className="h-10 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => resume.mutate({ token })}><Play size={16} />Resume now</Button> : null}
          {!isBreak && !isPaused ? <PauseMenu disabled={busy} onPause={(minutes) => pause.mutate({ token, durationMinutes: minutes })} /> : null}
          {isBreak ? <Button variant="outline" disabled={busy} className="h-10" onClick={() => skipBreak.mutate({ token })}>Skip break</Button> : null}
          <EndButton disabled={busy} onEnd={() => endRun.mutate({ token })} />
        </div>
      )}
    </section>
  )
}

function StatusMark({ tone, children }: { tone: 'emerald' | 'amber' | 'sky'; children: ReactNode }) {
  const tones = { emerald: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400', amber: 'bg-amber-500/12 text-amber-600 dark:text-amber-400', sky: 'bg-sky-500/12 text-sky-600 dark:text-sky-400' }
  return <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}>{children}</div>
}

function PauseMenu({ onPause, disabled }: { onPause: (minutes: (typeof pauseDurations)[number]) => void; disabled?: boolean }) {
  return <select disabled={disabled} className={selectStyle} aria-label="Pause Tempo" defaultValue="" onChange={(event) => { const value = Number(event.target.value) as (typeof pauseDurations)[number]; if (value) onPause(value); event.currentTarget.value = '' }}><option value="" disabled>Pause…</option>{pauseDurations.map((minutes) => <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes} min` : `${minutes / 60} hour${minutes === 60 ? '' : 's'}`}</option>)}</select>
}

function EndButton({ onEnd, disabled }: { onEnd: () => void; disabled?: boolean }) {
  return <Button variant="outline" disabled={disabled} className="h-10 border-rose-300 text-rose-700 hover:bg-rose-500/[.08] dark:border-rose-500/50 dark:text-rose-300" onClick={() => { if (window.confirm('End this session? Tempo will return to normal monitoring.')) onEnd() }}><X size={16} />End</Button>
}
