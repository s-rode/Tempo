import { useState } from 'react'
import { Pause, Play, Timer, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { trpc } from '../utils/trpc'

const customDurations = [15, 30, 45, 60, 90, 120] as const
const pauseDurations = [1, 5, 20, 30, 60, 120] as const

const clock = (milliseconds: number | null | undefined) => {
  if (milliseconds === null || milliseconds === undefined) return ''
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** Compact local-session controls; the runtime remains authoritative in MongoDB. */
interface FocusRuntimeSnapshot {
  mode?: 'normal' | 'custom' | 'pomodoro'
  trackingState: string
  run?: { kind: 'custom' | 'pomodoro'; currentPhaseIndex: number } | null
  currentPhase?: { kind: 'work' | 'short_break' | 'long_break'; state: 'awaiting_goal' | 'running' | 'suspended'; goal?: string | null } | null
  phaseRemainingMs: number | null
  suspension: { reasons: string[]; pausedUntilMs?: number | null }
}

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
    <section className="mx-4 mb-3 rounded-lg border border-slate-700 bg-slate-900/70 p-3 text-sm text-slate-100">
      {!activeRun ? (
        <div className="flex flex-wrap items-center gap-2">
          <Timer size={16} className="text-emerald-400" />
          <input
            className="min-w-[220px] flex-1 rounded border border-slate-600 bg-slate-950 px-2 py-1.5 outline-none focus:border-emerald-400"
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="What will you focus on?"
            onKeyDown={(event) => event.key === 'Enter' && submitGoal('custom')}
          />
          <select
            className="rounded border border-slate-600 bg-slate-950 px-2 py-1.5"
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value) as typeof duration)}
            aria-label="Custom focus duration"
          >
            {customDurations.map((minutes) => <option key={minutes} value={minutes}>{minutes} min</option>)}
          </select>
          <button className="rounded bg-emerald-600 px-3 py-1.5 font-medium disabled:opacity-50" disabled={!goal.trim() || busy} onClick={() => submitGoal('custom')}>Start focus</button>
          <button className="rounded border border-violet-400 px-3 py-1.5 text-violet-200 disabled:opacity-50" disabled={!goal.trim() || busy} onClick={() => submitGoal('pomodoro')}>Pomodoro</button>
          <PauseMenu disabled={busy} onPause={(minutes) => pause.mutate({ token, durationMinutes: minutes })} />
        </div>
      ) : isWaitingForGoal ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-amber-300">Next Pomodoro block is ready.</span>
          <input className="min-w-[240px] flex-1 rounded border border-slate-600 bg-slate-950 px-2 py-1.5" value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="Goal for this 30-minute block" onKeyDown={(event) => event.key === 'Enter' && submitGoal('next')} />
          <button className="rounded bg-emerald-600 px-3 py-1.5 font-medium disabled:opacity-50" disabled={!goal.trim() || busy} onClick={() => submitGoal('next')}>Begin block</button>
          <EndButton disabled={busy} onEnd={() => endRun.mutate({ token })} />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[210px] flex-1">
            <div className="font-medium">{isBreak ? 'Break' : activeRun.kind === 'pomodoro' ? `Pomodoro ${Math.ceil((activeRun.currentPhaseIndex + 1) / 2)} of 4` : 'Focus session'}</div>
            <div className="text-xs text-slate-300">{isPaused ? 'Paused' : phase?.goal || (isBreak ? 'Monitoring is suspended' : 'Focus in progress')} {runtime.phaseRemainingMs !== null ? `· ${clock(runtime.phaseRemainingMs)} remaining` : ''}</div>
          </div>
          {isPaused && runtime.suspension.reasons.includes('manual_pause') ? <button disabled={busy} className="rounded bg-emerald-600 px-3 py-1.5" onClick={() => resume.mutate({ token })}><Play size={14} className="mr-1 inline" />Resume now</button> : null}
          {!isBreak && !isPaused ? <PauseMenu disabled={busy} onPause={(minutes) => pause.mutate({ token, durationMinutes: minutes })} /> : null}
          {isBreak ? <button disabled={busy} className="rounded border border-slate-500 px-3 py-1.5" onClick={() => skipBreak.mutate({ token })}>Skip break</button> : null}
          <EndButton disabled={busy} onEnd={() => endRun.mutate({ token })} />
        </div>
      )}
    </section>
  )
}

function PauseMenu({ onPause, disabled }: { onPause: (minutes: (typeof pauseDurations)[number]) => void; disabled?: boolean }) {
  return (
    <select disabled={disabled} className="rounded border border-slate-600 bg-slate-950 px-2 py-1.5" aria-label="Pause Tempo" defaultValue="" onChange={(event) => {
      const value = Number(event.target.value) as (typeof pauseDurations)[number]
      if (value) onPause(value)
      event.currentTarget.value = ''
    }}>
      <option value="" disabled>Pause…</option>
      {pauseDurations.map((minutes) => <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes} min` : `${minutes / 60} hour${minutes === 60 ? '' : 's'}`}</option>)}
    </select>
  )
}

function EndButton({ onEnd, disabled }: { onEnd: () => void; disabled?: boolean }) {
  return <button disabled={disabled} className="rounded border border-rose-500/70 px-2.5 py-1.5 text-rose-200 disabled:opacity-50" onClick={() => { if (window.confirm('End this session? Tempo will return to normal monitoring.')) onEnd() }}><X size={14} className="mr-1 inline" />End</button>
}
