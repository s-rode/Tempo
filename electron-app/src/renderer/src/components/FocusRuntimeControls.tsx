import { Coffee, Focus, Pause, Play, Timer, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { toast } from '../hooks/use-toast'
import { trpc } from '../utils/trpc'
import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

const customDurations = [15, 30, 45, 60, 90, 120] as const
const pauseDurations = [1, 5, 20, 30, 60, 120] as const

type PlanTaskOption = { id: string; text: string; completedAtMs: number | null }

const clock = (milliseconds: number | null | undefined) => {
  if (milliseconds === null || milliseconds === undefined) return '—'
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export interface FocusRuntimeSnapshot {
  mode?: 'normal' | 'custom' | 'pomodoro'
  trackingState: string
  run?: { kind: 'custom' | 'pomodoro'; currentPhaseIndex: number } | null
  currentPhase?: {
    kind: 'work' | 'short_break' | 'long_break'
    state: 'awaiting_goal' | 'running' | 'suspended'
    goal?: string | null
    todayPlanTask?: { taskId: string; dateKey: string } | null
  } | null
  phaseRemainingMs: number | null
  suspension: { reasons: string[]; pausedUntilMs?: number | null }
}

interface FocusRuntimeControlsProps {
  runtime: FocusRuntimeSnapshot | undefined
  openRequest?: number
  quickActionRequest?: number
}

/** A compact toolbar command surface backed by the server-owned focus runtime. */
export function FocusRuntimeControls({
  runtime,
  openRequest = 0,
  quickActionRequest = 0
}: FocusRuntimeControlsProps) {
  const { token } = useAuth()
  const [goal, setGoal] = useState('')
  const [selectedTaskId, setSelectedTaskId] = useState('')
  const [duration, setDuration] = useState<(typeof customDurations)[number]>(30)
  const [open, setOpen] = useState(false)
  const utils = trpc.useContext()
  const { data: dailyPlan } = trpc.goals.getDailyPlan.useQuery(
    { token: token || '' },
    { enabled: !!token && open }
  )
  const activePlanTasks = useMemo(
    () => ((dailyPlan?.tasks || []) as PlanTaskOption[]).filter((task) => task.completedAtMs === null),
    [dailyPlan]
  )
  const selectedTask = activePlanTasks.find((task) => task.id === selectedTaskId) || null
  const invalidate = () => void utils.focusRuntime.getState.invalidate()
  const finishStart = () => {
    setGoal('')
    setSelectedTaskId('')
    setOpen(false)
    invalidate()
  }
  const showError = (error: { message: string }) =>
    toast({ title: 'Could not start focus', description: error.message, variant: 'destructive' })
  const startCustom = trpc.focusRuntime.startCustom.useMutation({
    onSuccess: finishStart,
    onError: showError
  })
  const startPomodoro = trpc.focusRuntime.startPomodoro.useMutation({
    onSuccess: finishStart,
    onError: showError
  })
  const confirmGoal = trpc.focusRuntime.confirmWorkGoal.useMutation({
    onSuccess: finishStart,
    onError: showError
  })
  const pause = trpc.focusRuntime.pause.useMutation({ onSuccess: invalidate })
  const resume = trpc.focusRuntime.resume.useMutation({ onSuccess: invalidate })
  const skipBreak = trpc.focusRuntime.skipBreak.useMutation({ onSuccess: invalidate })
  const endRun = trpc.focusRuntime.endRun.useMutation({ onSuccess: invalidate })
  const busy =
    startCustom.isLoading ||
    startPomodoro.isLoading ||
    confirmGoal.isLoading ||
    pause.isLoading ||
    resume.isLoading ||
    skipBreak.isLoading ||
    endRun.isLoading

  useEffect(() => {
    if (openRequest) setOpen(true)
  }, [openRequest])
  useEffect(() => {
    if (!quickActionRequest || !runtime || !token) return
    if (runtime.trackingState === 'paused' && runtime.suspension.reasons.includes('manual_pause'))
      resume.mutate({ token })
    else setOpen(true)
  }, [quickActionRequest])
  useEffect(() => {
    if (selectedTaskId && !selectedTask) setSelectedTaskId('')
  }, [selectedTaskId, selectedTask])

  if (!token || !runtime) return null
  const phase = runtime.currentPhase
  const activeRun = runtime.run
  const isWaitingForGoal = phase?.state === 'awaiting_goal'
  const isBreak = runtime.trackingState === 'break'
  const isPaused = runtime.trackingState === 'paused'
  const hasGoal = Boolean(selectedTask || goal.trim())
  const goalSource = selectedTask
    ? { kind: 'today_plan_task' as const, taskId: selectedTask.id }
    : { kind: 'custom' as const, goal: goal.trim() }
  const submitGoal = (action: 'custom' | 'pomodoro' | 'next') => {
    if (!hasGoal) return
    if (action === 'custom') startCustom.mutate({ token, goalSource, durationMinutes: duration })
    if (action === 'pomodoro') startPomodoro.mutate({ token, firstGoalSource: goalSource })
    if (action === 'next') confirmGoal.mutate({ token, goalSource })
  }
  const label = !activeRun
    ? 'Start Focus'
    : isWaitingForGoal
      ? 'Set next goal'
      : isBreak
        ? `Break · ${clock(runtime.phaseRemainingMs)}`
        : isPaused
          ? 'Paused'
          : `${activeRun.kind === 'pomodoro' ? 'Pomodoro' : 'Focus'} · ${clock(runtime.phaseRemainingMs)}`
  const icon = !activeRun ? (
    <Timer size={16} />
  ) : isBreak ? (
    <Coffee size={16} />
  ) : isPaused ? (
    <Pause size={16} />
  ) : (
    <Focus size={16} />
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={activeRun ? 'secondary' : 'default'}
          size="sm"
          className={activeRun ? 'tempo-session-token' : 'tempo-toolbar-primary'}
          aria-label={activeRun ? 'Open current focus session' : 'Start a focus session'}
        >
          {icon}
          <span>{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="tempo-focus-popover w-[340px] p-4"
        aria-label="Focus session controls"
      >
        {!activeRun || isWaitingForGoal ? (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold">
                {isWaitingForGoal ? 'Next Pomodoro block' : 'Start a focus session'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {isWaitingForGoal
                  ? 'Choose one clear goal for the next 30 minutes.'
                  : 'Tempo will use this goal while classifying activity.'}
              </p>
            </div>
            {activePlanTasks.length > 0 && (
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Today’s Plan</span>
                <select
                  className="tempo-field w-full"
                  value={selectedTaskId}
                  onChange={(event) => setSelectedTaskId(event.target.value)}
                  aria-label="Use a task from Today’s Plan"
                >
                  <option value="">Custom goal…</option>
                  {activePlanTasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.text}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {selectedTask ? (
              <div className="tempo-planned-goal" aria-live="polite">
                <span>Session goal</span>
                <p>{selectedTask.text}</p>
              </div>
            ) : (
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Goal</span>
                <input
                  autoFocus
                  className="tempo-field w-full"
                  value={goal}
                  onChange={(event) => setGoal(event.target.value)}
                  placeholder="What will you focus on?"
                  onKeyDown={(event) =>
                    event.key === 'Enter' && submitGoal(isWaitingForGoal ? 'next' : 'custom')
                  }
                />
              </label>
            )}
            {!isWaitingForGoal && (
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Duration</span>
                <select
                  className="tempo-field w-full"
                  value={duration}
                  onChange={(event) =>
                    setDuration(Number(event.target.value) as typeof duration)
                  }
                  aria-label="Custom focus duration"
                >
                  {customDurations.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} minutes
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              {isWaitingForGoal ? (
                <Button size="sm" disabled={!hasGoal || busy} onClick={() => submitGoal('next')}>
                  <Play size={15} />
                  Begin block
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!hasGoal || busy}
                    onClick={() => submitGoal('pomodoro')}
                  >
                    <Focus size={15} />
                    Pomodoro
                  </Button>
                  <Button size="sm" disabled={!hasGoal || busy} onClick={() => submitGoal('custom')}>
                    <Play size={15} />
                    Start Focus
                  </Button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="tempo-session-icon">{icon}</div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {isBreak
                    ? 'Break in progress'
                    : isPaused
                      ? 'Focus session paused'
                      : activeRun.kind === 'pomodoro'
                        ? `Pomodoro ${Math.ceil((activeRun.currentPhaseIndex + 1) / 2)} of 4`
                        : 'Focus session'}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {phase?.goal ||
                    (isBreak ? 'Monitoring is suspended during your break.' : 'Focus in progress')}
                </p>
              </div>
              <span className="font-mono text-sm font-semibold tabular-nums">
                {clock(runtime.phaseRemainingMs)}
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full w-2/3 rounded-full bg-[hsl(var(--accent-system))]" />
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {isPaused && runtime.suspension.reasons.includes('manual_pause') ? (
                <Button size="sm" disabled={busy} onClick={() => resume.mutate({ token })}>
                  <Play size={15} />
                  Resume
                </Button>
              ) : null}
              {!isBreak && !isPaused ? (
                <PauseSelect
                  disabled={busy}
                  onPause={(minutes) => pause.mutate({ token, durationMinutes: minutes })}
                />
              ) : null}
              {isBreak ? (
                <Button variant="outline" size="sm" disabled={busy} onClick={() => skipBreak.mutate({ token })}>
                  Skip break
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  if (window.confirm('End this session? Tempo will return to normal monitoring.'))
                    endRun.mutate({ token })
                }}
              >
                <X size={15} />
                End
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function PauseSelect({
  onPause,
  disabled
}: {
  onPause: (minutes: (typeof pauseDurations)[number]) => void
  disabled?: boolean
}) {
  return (
    <select
      disabled={disabled}
      className="tempo-compact-select"
      aria-label="Pause Tempo"
      defaultValue=""
      onChange={(event) => {
        const value = Number(event.target.value) as (typeof pauseDurations)[number]
        if (value) onPause(value)
        event.currentTarget.value = ''
      }}
    >
      <option value="" disabled>
        Pause…
      </option>
      {pauseDurations.map((minutes) => (
        <option key={minutes} value={minutes}>
          {minutes < 60 ? `${minutes} min` : `${minutes / 60} hour${minutes === 60 ? '' : 's'}`}
        </option>
      ))}
    </select>
  )
}
