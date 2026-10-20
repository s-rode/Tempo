import { Coffee, Focus, Pause, Pencil, Play, Timer, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { toast } from '../hooks/use-toast'
import { trpc } from '../utils/trpc'
import { scheduleGoalProfileRefresh } from '../lib/goalProfileRefresh'
import { displayMinutes, pomodoroSummary } from '../lib/taskEstimate'
import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

const customDurations = [15, 30, 45, 60, 90, 120] as const
const pauseDurations = [1, 5, 20, 30, 60, 120] as const

type PlanTaskOption = { id: string; text: string; estimatedMinutes?: number | null; completedAtMs: number | null }

const clock = (milliseconds: number | null | undefined) => {
  if (milliseconds === null || milliseconds === undefined) return '—'
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export interface FocusRuntimeSnapshot {
  mode?: 'normal' | 'custom' | 'pomodoro'
  trackingState: string
  run?: { id: string; kind: 'custom' | 'pomodoro'; currentPhaseIndex: number; phases?: { kind: string }[] } | null
  currentPhase?: {
    kind: 'work' | 'short_break' | 'long_break'
    state: 'awaiting_goal' | 'running' | 'suspended'
    goal?: string | null
    todayPlanTask?: { taskId: string; dateKey: string } | null
  } | null
  phaseRemainingMs: number | null
  taskProgress?: { taskId?: string; dateKey?: string; goal?: string; estimatedMinutes?: number | null; workTargetMs?: number; workElapsedMs?: number; checkpointAtMs?: number | null; sampledAtMs?: number } | null
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
  const [duration, setDuration] = useState(30)
  const [customExtension, setCustomExtension] = useState(15)
  const [clockNow, setClockNow] = useState(Date.now())
  const [open, setOpen] = useState(false)
  const [changingGoal, setChangingGoal] = useState(false)
  const [changingTaskGoal, setChangingTaskGoal] = useState(false)
  const utils = trpc.useContext()
  const { data: dailyPlan } = trpc.goals.getDailyPlan.useQuery(
    { token: token || '' },
    { enabled: !!token && open }
  )
  const activePlanTasks = useMemo(
    () =>
      ((dailyPlan?.tasks || []) as PlanTaskOption[]).filter((task) => task.completedAtMs === null),
    [dailyPlan]
  )
  const selectedTask = activePlanTasks.find((task) => task.id === selectedTaskId) || null
  const invalidate = () => void utils.focusRuntime.getState.invalidate()
  const refreshGoalContext = () => {
    invalidate()
    void utils.goals.getActiveContext.fetch({ token: token || '' }).then((context) => {
      void window.api?.refreshCurrentActivity()
      scheduleGoalProfileRefresh(context, () =>
        utils.goals.getActiveContext.fetch({ token: token || '' })
      )
    })
  }
  const finishStart = () => {
    setGoal('')
    setSelectedTaskId('')
    setChangingGoal(false)
    setOpen(false)
    refreshGoalContext()
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
  const changeCurrentWorkGoal = trpc.focusRuntime.changeCurrentWorkGoal.useMutation({
    onSuccess: () => {
      setGoal('')
      setSelectedTaskId('')
      setChangingGoal(false)
      refreshGoalContext()
      toast({ title: 'Focus goal updated', description: 'The timer keeps running.' })
    },
    onError: (error) =>
      toast({
        title: 'Could not change focus goal',
        description: error.message,
        variant: 'destructive'
      })
  })
  const pause = trpc.focusRuntime.pause.useMutation({ onSuccess: invalidate })
  const resume = trpc.focusRuntime.resume.useMutation({ onSuccess: invalidate })
  const skipBreak = trpc.focusRuntime.skipBreak.useMutation({ onSuccess: invalidate })
  const endRun = trpc.focusRuntime.endRun.useMutation({
    onSuccess: (state) => {
      void utils.focusRuntime.getState.setData({ token: token || '' }, state)
      setOpen(changingTaskGoal)
      setChangingTaskGoal(false)
      invalidate()
    }
  })
  const finishTask = trpc.focusRuntime.finishTaskSession.useMutation({
    onSuccess: (state) => {
      void utils.focusRuntime.getState.setData({ token: token || '' }, state)
      setOpen(changingTaskGoal)
      setChangingTaskGoal(false)
      refreshGoalContext()
      void utils.goals.getDailyPlan.invalidate()
    },
    onError: (error) => toast({ title: 'Could not finish task', description: error.message, variant: 'destructive' })
  })
  const extendTask = trpc.focusRuntime.extendTaskSession.useMutation({
    onSuccess: invalidate,
    onError: (error) => toast({ title: 'Could not extend session', description: error.message, variant: 'destructive' })
  })
  const busy =
    startCustom.isLoading ||
    startPomodoro.isLoading ||
    confirmGoal.isLoading ||
    changeCurrentWorkGoal.isLoading ||
    pause.isLoading ||
    resume.isLoading ||
    skipBreak.isLoading ||
    endRun.isLoading || finishTask.isLoading || extendTask.isLoading

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
  useEffect(() => {
    if (selectedTask) setDuration(selectedTask.estimatedMinutes ?? 30)
    else setDuration(30)
  }, [selectedTaskId])
  useEffect(() => {
    if (!open) { setChangingGoal(false); setChangingTaskGoal(false) }
  }, [open])
  useEffect(() => {
    if (!runtime?.taskProgress || runtime.trackingState !== 'active') return
    const interval = window.setInterval(() => setClockNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [runtime?.taskProgress?.taskId, runtime?.trackingState])

  if (!token || !runtime) return null
  const phase = runtime.currentPhase
  const activeRun = runtime.run
  const isWaitingForGoal = phase?.state === 'awaiting_goal'
  const isBreak = runtime.trackingState === 'break'
  const isPaused = runtime.trackingState === 'paused'
  const canChangeCurrentGoal = phase?.kind === 'work' && phase.state !== 'awaiting_goal'
  const taskProgress = runtime.taskProgress
  const awaitingTaskDecision = Boolean(taskProgress?.checkpointAtMs)
  const liveTaskWorkMs = (taskProgress?.workElapsedMs || 0) +
    (runtime.trackingState === 'active' && taskProgress?.sampledAtMs
      ? Math.max(0, clockNow - taskProgress.sampledAtMs) : 0)
  const hasGoal = Boolean(selectedTask || goal.trim())
  const goalSource = selectedTask
    ? { kind: 'today_plan_task' as const, taskId: selectedTask.id }
    : { kind: 'custom' as const, goal: goal.trim() }
  const submitGoal = (action: 'custom' | 'pomodoro' | 'next' | 'change') => {
    if (!hasGoal) return
    if (action === 'custom') startCustom.mutate({ token, goalSource, durationMinutes: duration })
    if (action === 'pomodoro') startPomodoro.mutate({ token, firstGoalSource: goalSource,
      ...(selectedTask ? { workTargetMinutes: duration } : {}) })
    if (action === 'next') confirmGoal.mutate({ token, goalSource })
    if (action === 'change') changeCurrentWorkGoal.mutate({ token, goalSource })
  }
  const label = !activeRun
    ? 'Start Focus'
    : isWaitingForGoal
      ? 'Set next goal'
      : awaitingTaskDecision
        ? 'Finish or extend'
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
        {changingTaskGoal && activeRun ? (
          <div className="space-y-3">
            <p className="text-sm font-semibold">Move to another goal</p>
            <p className="text-xs text-muted-foreground">This work time belongs to the planned task. Finish it or leave it unchecked before choosing a new goal.</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setChangingTaskGoal(false)}>Cancel</Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => endRun.mutate({ token })}>End task session</Button>
              <Button size="sm" disabled={busy} onClick={() => finishTask.mutate({ token, runId: activeRun.id })}>Finish task</Button>
            </div>
          </div>
        ) : !activeRun || isWaitingForGoal || changingGoal ? (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold">
                {changingGoal
                  ? 'Change current goal'
                  : isWaitingForGoal
                    ? 'Next Pomodoro block'
                    : 'Start a focus session'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {changingGoal
                  ? 'The timer keeps running. New activity will be compared with this goal.'
                  : isWaitingForGoal
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
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && changingGoal) {
                      event.preventDefault()
                      setChangingGoal(false)
                    }
                    if (event.key === 'Enter')
                      submitGoal(changingGoal ? 'change' : isWaitingForGoal ? 'next' : 'custom')
                  }}
                />
              </label>
            )}
            {!isWaitingForGoal && !changingGoal && (
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Work time</span>
                {selectedTask ? <input type="number" min={1} max={720} step={1}
                  className="tempo-field w-full"
                  value={duration}
                  onChange={(event) => setDuration(Number(event.target.value))}
                  aria-label="Task work time in minutes" /> : <select className="tempo-field w-full"
                    value={duration} onChange={(event) => setDuration(Number(event.target.value))}
                    aria-label="Custom focus duration">
                  {customDurations.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} minutes
                    </option>
                  ))}
                </select>}
              </label>
            )}
            {!isWaitingForGoal && !changingGoal && selectedTask && duration >= 1 && duration <= 720 && (
              <p className="text-xs text-muted-foreground">Pomodoro: {pomodoroSummary(duration)}. Breaks are additional.</p>
            )}
            <div className="flex justify-end gap-2">
              {isWaitingForGoal && !changingGoal ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  className="mr-auto text-destructive hover:text-destructive"
                  onClick={() => {
                    if (
                      window.confirm('End this Pomodoro? Tempo will return to normal monitoring.')
                    )
                      endRun.mutate({ token })
                  }}
                >
                  End Pomodoro
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => (changingGoal ? setChangingGoal(false) : setOpen(false))}
              >
                Cancel
              </Button>
              {changingGoal ? (
                <Button size="sm" disabled={!hasGoal || busy} onClick={() => submitGoal('change')}>
                  <Pencil size={15} />
                  Update goal
                </Button>
              ) : isWaitingForGoal ? (
                <Button size="sm" disabled={!hasGoal || busy} onClick={() => submitGoal('next')}>
                  <Play size={15} />
                  Begin block
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!hasGoal || busy || (selectedTask !== null && (duration < 1 || duration > 720))}
                    onClick={() => submitGoal('pomodoro')}
                  >
                    <Focus size={15} />
                    Pomodoro
                  </Button>
                  <Button
                    size="sm"
                    disabled={!hasGoal || busy || (selectedTask !== null && (duration < 1 || duration > 720))}
                    onClick={() => submitGoal('custom')}
                  >
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
                        ? taskProgress ? 'Planned task · Pomodoro' : `Pomodoro ${Math.ceil((activeRun.currentPhaseIndex + 1) / 2)} of 4`
                        : 'Focus session'}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {phase?.goal ||
                    (isBreak ? 'Monitoring is suspended during your break.' : 'Focus in progress')}
                </p>
              </div>
              <span className="font-mono text-sm font-semibold tabular-nums">
                {awaitingTaskDecision ? `+${clock(Math.max(0, liveTaskWorkMs - (taskProgress?.workTargetMs || 0)))}` : clock(runtime.phaseRemainingMs)}
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full w-2/3 rounded-full bg-[hsl(var(--accent-system))]" />
            </div>
            {taskProgress && (
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {awaitingTaskDecision ? 'Your planned work time is complete. Keep working, or choose what to do next.' :
                  `${displayMinutes(Math.floor(liveTaskWorkMs / 60_000))} worked of ${displayMinutes(Math.ceil((taskProgress.workTargetMs || 0) / 60_000))} target`}
                {taskProgress.estimatedMinutes ? ` · original estimate ${displayMinutes(taskProgress.estimatedMinutes)}` : ''}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              {awaitingTaskDecision && activeRun && (
                <>
                  <Button size="sm" disabled={busy} onClick={() => finishTask.mutate({ token, runId: activeRun.id })}>I’m finished</Button>
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => extendTask.mutate({ token, runId: activeRun.id, minutes: 10 })}>Add 10 min</Button>
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span className="sr-only">Custom extension minutes</span>
                    <input type="number" className="tempo-field w-14" min={1} max={720} value={customExtension}
                      onChange={(event) => setCustomExtension(Number(event.target.value))} aria-label="Custom extension minutes" />
                    <Button variant="outline" size="sm" disabled={busy || customExtension < 1 || customExtension > 720}
                      onClick={() => extendTask.mutate({ token, runId: activeRun.id, minutes: customExtension })}>Add</Button>
                  </label>
                </>
              )}
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
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => skipBreak.mutate({ token })}
                >
                  Skip break
                </Button>
              ) : null}
              {canChangeCurrentGoal ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    if (taskProgress) {
                      setChangingTaskGoal(true)
                      return
                    }
                    setGoal(phase?.goal || '')
                    setSelectedTaskId(phase?.todayPlanTask?.taskId || '')
                    setChangingGoal(true)
                  }}
                >
                  <Pencil size={15} />
                  Change goal…
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
