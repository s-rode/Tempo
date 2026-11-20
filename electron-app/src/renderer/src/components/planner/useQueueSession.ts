import { useCallback, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from '../../hooks/use-toast'
import { scheduleGoalProfileRefresh } from '../../lib/goalProfileRefresh'
import type { PlannerTask } from '../../lib/plannerModel'
import { trpc } from '../../utils/trpc'
import type { FocusRuntimeSnapshot } from '../FocusRuntimeControls'

const SESSION_KEY = 'tempoPlannerSessionMinutes'
const AUTO_NEXT_KEY = 'tempoPlannerAutoNext'
const TIMER_KEY = 'tempoPlannerTimer'

/**
 * How a task session is timed: counting down the task's estimate, counting up
 * until the task is done, or in Pomodoro blocks until the task is done.
 */
export type QueueTimer = 'estimate' | 'open' | 'pomodoro'
export const QUEUE_TIMERS: { value: QueueTimer; label: string; detail: string }[] = [
  { value: 'estimate', label: 'Estimate', detail: 'Counts down the task’s estimate' },
  { value: 'open', label: 'Count Up', detail: 'Runs until you mark the task done' },
  { value: 'pomodoro', label: 'Pomodoro', detail: '30-minute blocks with breaks until done' }
]

const storedTimer = (): QueueTimer => {
  try {
    const value = localStorage.getItem(TIMER_KEY)
    return value === 'open' || value === 'pomodoro' ? value : 'estimate'
  } catch {
    return 'estimate'
  }
}

const storedMinutes = (): number => {
  const value = Number(localStorage.getItem(SESSION_KEY))
  return Number.isInteger(value) && value >= 5 && value <= 240 ? value : 30
}

/**
 * Working through today's queue is an ordinary Tempo focus session on one
 * planned task after another, so the timer, the notch, distraction alerts and
 * the day timeline all behave exactly as they do for any other session.
 */
export function useQueueSession(runtime: FocusRuntimeSnapshot | undefined, queue: PlannerTask[]) {
  const { token } = useAuth()
  const auth = { token: token || '' }
  const utils = trpc.useContext()
  const [defaultMinutes, setDefaultMinutesState] = useState(storedMinutes)
  const [autoNext, setAutoNextState] = useState(
    () => localStorage.getItem(AUTO_NEXT_KEY) !== 'false'
  )
  const [working, setWorking] = useState(false)
  const [timer, setTimerState] = useState<QueueTimer>(storedTimer)

  const progress = runtime?.run ? runtime.taskProgress : null
  const activeTaskId = progress?.taskId && progress.source !== 'reminder' ? progress.taskId : null
  const activeTask = queue.find((task) => task.id === activeTaskId) || null
  const upcoming = queue.filter((task) => task.id !== activeTaskId)
  /** Another session (a custom goal, a reminder) is running; the queue waits for it. */
  const blocked = Boolean(runtime?.run) && !activeTask

  const synced = useCallback(() => {
    void utils.focusRuntime.getState.invalidate()
    void utils.focusRuntime.getTimelineRuns.invalidate()
    void utils.planner.getWeek.invalidate()
    void utils.planner.getGoals.invalidate()
    void utils.goals.getDailyPlan.invalidate()
    void utils.goals.getActiveContext.fetch(auth).then((context) => {
      void window.api?.refreshCurrentActivity()
      scheduleGoalProfileRefresh(context, () => utils.goals.getActiveContext.fetch(auth))
    })
  }, [utils, token])

  const startCustom = trpc.focusRuntime.startCustom.useMutation()
  const startPomodoro = trpc.focusRuntime.startPomodoro.useMutation()
  const finishTask = trpc.focusRuntime.finishTaskSession.useMutation()
  const endRun = trpc.focusRuntime.endRun.useMutation()
  const extend = trpc.focusRuntime.extendTaskSession.useMutation()
  const pauseRun = trpc.focusRuntime.pause.useMutation()
  const resumeRun = trpc.focusRuntime.resume.useMutation()
  const moveTask = trpc.planner.moveTask.useMutation()

  const guarded = useCallback(
    async (title: string, work: () => Promise<void>) => {
      if (!token || working) return
      setWorking(true)
      try {
        await work()
      } catch (error) {
        toast({
          title,
          description: error instanceof Error ? error.message : undefined,
          variant: 'destructive'
        })
      } finally {
        setWorking(false)
        synced()
      }
    },
    [token, working, synced]
  )

  const begin = (task: PlannerTask) => {
    const goalSource = { kind: 'today_plan_task' as const, taskId: task.id }
    if (timer === 'pomodoro')
      return startPomodoro.mutateAsync({ ...auth, firstGoalSource: goalSource, openEnded: true })
    return startCustom.mutateAsync({
      ...auth,
      goalSource,
      durationMinutes: task.estimatedMinutes || defaultMinutes,
      openEnded: timer === 'open'
    })
  }

  const start = (task?: PlannerTask) => {
    const first = task || queue[0]
    if (!first || runtime?.run) return
    void guarded('Could not start working', async () => {
      await begin(first)
    })
  }

  /** Completes the task in focus; with `thenNext` the next one starts at once. */
  const finish = (thenNext = autoNext) => {
    if (!runtime?.run || !activeTask) return
    const runId = runtime.run.id
    void guarded('Could not complete the task', async () => {
      await finishTask.mutateAsync({ ...auth, runId })
      if (thenNext && upcoming[0]) await begin(upcoming[0])
    })
  }

  /** Sends the task in focus to the back of the queue and moves on. */
  const later = (dateKey: string) => {
    if (!runtime?.run || !activeTask || !upcoming.length) return
    void guarded('Could not skip the task', async () => {
      await endRun.mutateAsync(auth)
      await moveTask.mutateAsync({
        ...auth,
        taskId: activeTask.id,
        fromDateKey: dateKey,
        toDateKey: dateKey,
        toIndex: queue.length
      })
      await begin(upcoming[0])
    })
  }

  const stop = () => {
    if (!runtime?.run || !activeTask) return
    void guarded('Could not stop the session', async () => {
      await endRun.mutateAsync(auth)
    })
  }

  const reasons = runtime?.suspension.reasons || []
  /** Paused by hand (here, in the toolbar or the notch), so Resume can lift it. */
  const paused = Boolean(activeTask) && reasons.includes('manual_pause')
  /** Only a running work stretch can be paused; a break or a lock already holds the clock. */
  const canPause =
    Boolean(activeTask) &&
    runtime?.currentPhase?.kind === 'work' &&
    runtime?.currentPhase?.state === 'running' &&
    !reasons.length

  /** Stops the clock until Resume. Paused time is not task, goal or focus time. */
  const pause = () => {
    if (!canPause) return
    void guarded('Could not pause the task', async () => {
      await pauseRun.mutateAsync(auth)
    })
  }

  const resume = () => {
    if (!paused) return
    void guarded('Could not resume the task', async () => {
      await resumeRun.mutateAsync(auth)
    })
  }

  const togglePause = () => (paused ? resume() : pause())

  const addTime = (minutes: number) => {
    if (!runtime?.run) return
    const runId = runtime.run.id
    void guarded('Could not add time', async () => {
      await extend.mutateAsync({ ...auth, runId, minutes })
    })
  }

  return {
    activeTask,
    activeTaskId,
    upcoming,
    blocked,
    working,
    canStart: !runtime?.run && !working,
    timer,
    setTimer: (value: QueueTimer) => {
      try {
        localStorage.setItem(TIMER_KEY, value)
      } catch {
        /* the choice then lasts for this window only */
      }
      setTimerState(value)
    },
    defaultMinutes,
    setDefaultMinutes: (minutes: number) => {
      localStorage.setItem(SESSION_KEY, String(minutes))
      setDefaultMinutesState(minutes)
    },
    autoNext,
    setAutoNext: (value: boolean) => {
      localStorage.setItem(AUTO_NEXT_KEY, String(value))
      setAutoNextState(value)
    },
    start,
    finish,
    later,
    stop,
    paused,
    canPause,
    pause,
    resume,
    togglePause,
    addTime
  }
}

export type QueueSession = ReturnType<typeof useQueueSession>
