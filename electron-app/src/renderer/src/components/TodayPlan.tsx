import {
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  Copy,
  Focus,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Timer,
  Trash2
} from 'lucide-react'
import { FormEvent, KeyboardEvent, ReactElement, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { toast } from '../hooks/use-toast'
import { cn } from '../lib/utils'
import { trpc } from '../utils/trpc'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import { Input } from './ui/input'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { ToastAction } from './ui/toast'
import type { FocusRuntimeSnapshot } from './FocusRuntimeControls'

type PlanTask = { id: string; text: string; position: number; completedAtMs: number | null }

interface TodayPlanProps {
  selectedDate: Date
  openRequest?: number
}

const isSameLocalDay = (left: Date, right = new Date()): boolean =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate()

/** Native list-style plan for the selected calendar day. */
export function TodayPlan({ selectedDate, openRequest = 0 }: TodayPlanProps): ReactElement {
  const { token } = useAuth()
  const utils = trpc.useContext()
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState('')
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null)
  const [contextTaskId, setContextTaskId] = useState<string | null>(null)
  const [startingTaskId, setStartingTaskId] = useState<string | null>(null)
  const [undo, setUndo] = useState<(() => void) | null>(null)
  const isToday = isSameLocalDay(selectedDate)
  const dateMs = selectedDate.getTime()
  const { data: plan, isLoading } = trpc.goals.getDailyPlan.useQuery(
    { token: token || '', dateMs },
    { enabled: !!token }
  )
  const { data: planning } = trpc.goals.getPlanning.useQuery(
    { token: token || '' },
    { enabled: !!token }
  )
  const { data: focusRuntime } = trpc.focusRuntime.getState.useQuery(
    { token: token || '' },
    { enabled: !!token && isToday }
  )
  const invalidate = () => {
    void utils.goals.getDailyPlan.invalidate()
    void utils.goals.getPlanning.invalidate()
    void utils.goals.getActiveContext.invalidate()
    void utils.activeWindowEvents.getLatestEvent.invalidate()
    void utils.activeWindowEvents.getEventsForDateRange.invalidate()
  }
  const refreshIfChanged = (result: { effectiveContextChanged: boolean }) => {
    invalidate()
    if (result.effectiveContextChanged) void window.api?.refreshCurrentActivity()
  }
  const add = trpc.goals.addDailyTask.useMutation({ onSuccess: refreshIfChanged })
  const update = trpc.goals.updateDailyTask.useMutation({ onSuccess: refreshIfChanged })
  const complete = trpc.goals.setDailyTaskCompleted.useMutation({ onSuccess: refreshIfChanged })
  const reorder = trpc.goals.reorderDailyTasks.useMutation({ onSuccess: refreshIfChanged })
  const remove = trpc.goals.deleteDailyTask.useMutation({ onSuccess: refreshIfChanged })
  const restore = trpc.goals.restoreDailyTask.useMutation({ onSuccess: refreshIfChanged })
  const copy = trpc.goals.copyUnfinishedToToday.useMutation({
    onSuccess: (result) => {
      refreshIfChanged(result)
      toast({
        title: result.copied
          ? `Copied ${result.copied} task${result.copied === 1 ? '' : 's'} to Today`
          : 'No unfinished tasks to copy'
      })
    }
  })
  const busy =
    add.isLoading ||
    update.isLoading ||
    complete.isLoading ||
    reorder.isLoading ||
    remove.isLoading ||
    restore.isLoading ||
    copy.isLoading

  useEffect(() => {
    if (!openRequest || !isToday) return
    inputRef.current?.focus()
  }, [isToday, openRequest])

  useEffect(() => {
    const undoLast = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && undo) {
        event.preventDefault()
        undo()
        setUndo(null)
      }
    }
    window.addEventListener('keydown', undoLast)
    return () => window.removeEventListener('keydown', undoLast)
  }, [undo])

  const tasks = (plan?.tasks || []) as PlanTask[]
  const activeTasks = useMemo(() => tasks.filter((task) => task.completedAtMs === null), [tasks])
  const completedTasks = useMemo(() => tasks.filter((task) => task.completedAtMs !== null), [tasks])
  const typedFocusRuntime = focusRuntime as FocusRuntimeSnapshot | undefined
  const phase = typedFocusRuntime?.currentPhase
  const waitingForPomodoroGoal = Boolean(typedFocusRuntime?.run && phase?.state === 'awaiting_goal')
  const canStartPlanTask = !typedFocusRuntime?.run || waitingForPomodoroGoal
  const activePlanTaskId =
    phase?.kind === 'work' && phase?.state === 'running' ? phase.todayPlanTask?.taskId : null

  const announceUndo = (title: string, action: () => void) => {
    setUndo(() => action)
    toast({
      title,
      action: (
        <ToastAction
          altText="Undo plan change"
          onClick={() => {
            action()
            setUndo(null)
          }}
        >
          Undo
        </ToastAction>
      )
    })
  }
  const addTask = (event?: FormEvent) => {
    event?.preventDefault()
    const text = draft.trim()
    if (!text || busy) return
    setDraft('')
    add.mutate(
      { token: token || '', text },
      {
        onSuccess: (result) => {
          refreshIfChanged(result)
          announceUndo('Task added', () =>
            remove.mutate({ token: token || '', taskId: result.task.id })
          )
        }
      }
    )
  }
  const saveEdit = (task: PlanTask) => {
    const text = editingText.trim()
    if (!text || text === task.text || busy) {
      setEditingTaskId(null)
      return
    }
    const previous = task.text
    update.mutate(
      { token: token || '', taskId: task.id, text },
      {
        onSuccess: (result) => {
          refreshIfChanged(result)
          announceUndo('Task renamed', () =>
            update.mutate({ token: token || '', taskId: task.id, text: previous })
          )
        }
      }
    )
    setEditingTaskId(null)
  }
  const setCompleted = (task: PlanTask, completed: boolean) => {
    complete.mutate(
      { token: token || '', taskId: task.id, completed },
      {
        onSuccess: (result) => {
          refreshIfChanged(result)
          announceUndo(completed ? 'Task completed' : 'Task restored', () =>
            complete.mutate({ token: token || '', taskId: task.id, completed: !completed })
          )
        }
      }
    )
  }
  const deleteTask = (task: PlanTask) => {
    remove.mutate(
      { token: token || '', taskId: task.id },
      {
        onSuccess: (result) => {
          refreshIfChanged(result)
          announceUndo('Task deleted', () =>
            restore.mutate({ token: token || '', task: result.deletedTask })
          )
        }
      }
    )
  }
  const reorderTasks = (orderedIds: string[]) => {
    if (orderedIds.join('|') === activeTasks.map((task) => task.id).join('|')) return
    const previous = activeTasks.map((task) => task.id)
    reorder.mutate(
      { token: token || '', taskIds: orderedIds },
      {
        onSuccess: (result) => {
          refreshIfChanged(result)
          announceUndo('Task order changed', () =>
            reorder.mutate({ token: token || '', taskIds: previous })
          )
        }
      }
    )
  }
  const move = (task: PlanTask, direction: -1 | 1) => {
    const index = activeTasks.findIndex((candidate) => candidate.id === task.id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= activeTasks.length) return
    const next = activeTasks.map((candidate) => candidate.id)
    ;[next[index], next[target]] = [next[target], next[index]]
    reorderTasks(next)
  }
  const rowKeyDown = (event: KeyboardEvent<HTMLDivElement>, task: PlanTask) => {
    if (event.altKey && event.key === 'ArrowUp') {
      event.preventDefault()
      move(task, -1)
    }
    if (event.altKey && event.key === 'ArrowDown') {
      event.preventDefault()
      move(task, 1)
    }
    if (
      event.metaKey &&
      event.key === 'Enter' &&
      isToday &&
      task.completedAtMs === null &&
      canStartPlanTask
    ) {
      event.preventDefault()
      setStartingTaskId(task.id)
    }
  }

  const taskRow = (task: PlanTask, index: number, isCompleted: boolean) => (
    <div
      key={task.id}
      className={cn(
        'tempo-plan-task',
        isCompleted && 'is-completed',
        draggingTaskId === task.id && 'is-dragging',
        activePlanTaskId === task.id && 'is-in-focus'
      )}
      draggable={!isCompleted && isToday && !busy}
      onDragStart={() => setDraggingTaskId(task.id)}
      onDragEnd={() => setDraggingTaskId(null)}
      onDragOver={(event) => {
        if (!isCompleted && isToday) event.preventDefault()
      }}
      onDrop={() => {
        if (!draggingTaskId || isCompleted || draggingTaskId === task.id) return
        const ids = activeTasks.map((candidate) => candidate.id)
        const from = ids.indexOf(draggingTaskId)
        const to = ids.indexOf(task.id)
        ids.splice(from, 1)
        ids.splice(to, 0, draggingTaskId)
        reorderTasks(ids)
      }}
      onKeyDown={(event) => rowKeyDown(event, task)}
      onContextMenu={(event) => {
        if (!isToday) return
        event.preventDefault()
        setContextTaskId(task.id)
      }}
      tabIndex={isToday ? 0 : -1}
    >
      {!isCompleted && isToday ? (
        <GripVertical className="tempo-plan-grip" size={15} aria-hidden="true" />
      ) : (
        <span className="w-[15px] shrink-0" />
      )}
      {isToday ? (
        <button
          type="button"
          className="tempo-plan-check"
          disabled={busy}
          onClick={() => setCompleted(task, !isCompleted)}
          aria-label={`Mark ${task.text} ${isCompleted ? 'incomplete' : 'complete'}`}
        >
          {isCompleted ? <Check size={14} /> : <Circle size={15} />}
        </button>
      ) : (
        <span className="tempo-plan-check is-readonly" aria-hidden="true">
          {isCompleted ? <Check size={14} /> : <Circle size={15} />}
        </span>
      )}
      {editingTaskId === task.id ? (
        <Input
          autoFocus
          value={editingText}
          className="h-7 min-w-0 border-0 px-1 text-sm shadow-none"
          onChange={(event) => setEditingText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') saveEdit(task)
            if (event.key === 'Escape') setEditingTaskId(null)
          }}
          onBlur={() => saveEdit(task)}
        />
      ) : (
        <span className="tempo-plan-task-text min-w-0 flex-1 truncate text-sm">{task.text}</span>
      )}
      {activePlanTaskId === task.id && (
        <span className="tempo-plan-active" aria-label="Currently in a focus session">
          <Timer size={12} aria-hidden="true" />
          In Focus
        </span>
      )}
      {isToday && !isCompleted && (
        <PlanTaskStartPopover
          task={task}
          runtime={typedFocusRuntime}
          open={startingTaskId === task.id}
          disabled={!canStartPlanTask || busy}
          onOpenChange={(open) => setStartingTaskId(open ? task.id : null)}
          onStarted={() => {
            setStartingTaskId(null)
            void utils.focusRuntime.getState.invalidate()
          }}
        />
      )}
      {isToday && (
        <DropdownMenu
          open={contextTaskId === task.id}
          onOpenChange={(open) => setContextTaskId(open ? task.id : null)}
        >
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              className="tempo-plan-more"
              aria-label={`Actions for ${task.text}`}
            >
              <MoreHorizontal size={15} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!isCompleted && (
              <>
                <DropdownMenuItem
                  disabled={!canStartPlanTask || busy}
                  onSelect={() => setStartingTaskId(task.id)}
                >
                  <Play size={14} />
                  Start Session…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem
              onSelect={() => {
                setEditingTaskId(task.id)
                setEditingText(task.text)
              }}
            >
              <Pencil size={14} />
              Edit
            </DropdownMenuItem>
            {!isCompleted && (
              <>
                <DropdownMenuItem disabled={index === 0} onSelect={() => move(task, -1)}>
                  <ChevronUp size={14} />
                  Move Up
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={index === activeTasks.length - 1}
                  onSelect={() => move(task, 1)}
                >
                  <ChevronDown size={14} />
                  Move Down
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem onSelect={() => setCompleted(task, !isCompleted)}>
              {isCompleted ? <Circle size={14} /> : <Check size={14} />}
              {isCompleted ? 'Mark Incomplete' : 'Mark Complete'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => deleteTask(task)}
            >
              <Trash2 size={14} />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )

  return (
    <section className="tempo-today-plan" aria-labelledby="today-plan-heading">
      <div className="tempo-today-plan-heading">
        <div>
          <p id="today-plan-heading">Today’s Plan</p>
          <span>{isToday ? `${activeTasks.length} remaining` : 'Plan for this day'}</span>
        </div>
        {isToday && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => inputRef.current?.focus()}
            aria-label="Add a task to Today’s Plan"
          >
            <Plus size={16} />
          </Button>
        )}
      </div>
      {isLoading ? (
        <div className="h-14 animate-pulse rounded bg-muted" />
      ) : (
        <>
          {activeTasks.length > 0 && (
            <div className="tempo-plan-task-list" role="list">
              {activeTasks.map((task, index) => taskRow(task, index, false))}
            </div>
          )}
          {isToday && (
            <form className="tempo-plan-add" onSubmit={addTask}>
              <Plus size={15} aria-hidden="true" />
              <Input
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Add a task"
                aria-label="Add a task to Today’s Plan"
                disabled={busy}
              />
              <button type="submit" className="sr-only">
                Add task
              </button>
            </form>
          )}
          {!activeTasks.length && (
            <p className="tempo-plan-empty">
              {planning?.weeklyFocus
                ? 'No remaining tasks. Tempo will use this week’s focus.'
                : 'No remaining tasks. Add a clear task to guide classification.'}
            </p>
          )}
          {completedTasks.length > 0 && (
            <div className="tempo-plan-completed">
              <div className="tempo-plan-divider">
                <span>Completed</span>
              </div>
              <div className="tempo-plan-task-list" role="list">
                {completedTasks.map((task, index) => taskRow(task, index, true))}
              </div>
            </div>
          )}
          {!isToday && activeTasks.length > 0 && selectedDate < new Date() && (
            <Button
              variant="ghost"
              size="xs"
              className="mt-2"
              disabled={copy.isLoading}
              onClick={() => copy.mutate({ token: token || '', sourceDateMs: dateMs })}
            >
              <Copy size={14} />
              Copy unfinished tasks to Today
            </Button>
          )}
        </>
      )}
    </section>
  )
}

function PlanTaskStartPopover({
  task,
  runtime,
  open,
  disabled,
  onOpenChange,
  onStarted
}: {
  task: PlanTask
  runtime: FocusRuntimeSnapshot | undefined
  open: boolean
  disabled: boolean
  onOpenChange: (open: boolean) => void
  onStarted: () => void
}): ReactElement {
  const { token } = useAuth()
  const [duration, setDuration] = useState<15 | 30 | 45 | 60 | 90 | 120>(30)
  const isWaitingForGoal = Boolean(runtime?.run && runtime.currentPhase?.state === 'awaiting_goal')
  const startCustom = trpc.focusRuntime.startCustom.useMutation({
    onSuccess: onStarted,
    onError: (error) =>
      toast({ title: 'Could not start focus', description: error.message, variant: 'destructive' })
  })
  const startPomodoro = trpc.focusRuntime.startPomodoro.useMutation({
    onSuccess: onStarted,
    onError: (error) =>
      toast({ title: 'Could not start Pomodoro', description: error.message, variant: 'destructive' })
  })
  const confirmGoal = trpc.focusRuntime.confirmWorkGoal.useMutation({
    onSuccess: onStarted,
    onError: (error) =>
      toast({ title: 'Could not begin the next block', description: error.message, variant: 'destructive' })
  })
  const busy = startCustom.isLoading || startPomodoro.isLoading || confirmGoal.isLoading
  const source = { kind: 'today_plan_task' as const, taskId: task.id }

  const start = (kind: 'custom' | 'pomodoro' | 'next') => {
    if (!token) return
    if (kind === 'custom') startCustom.mutate({ token, goalSource: source, durationMinutes: duration })
    if (kind === 'pomodoro') startPomodoro.mutate({ token, firstGoalSource: source })
    if (kind === 'next') confirmGoal.mutate({ token, goalSource: source })
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="tempo-plan-start"
          disabled={disabled}
          aria-label={`Start a focus session for ${task.text}`}
        >
          <Play size={14} aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        className="tempo-focus-popover tempo-plan-session-popover w-[290px] p-3"
        aria-label={`Start a session for ${task.text}`}
      >
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold">
              {isWaitingForGoal ? 'Next Pomodoro block' : 'Start a session'}
            </p>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{task.text}</p>
          </div>
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
                {[15, 30, 45, 60, 90, 120].map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} minutes
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {isWaitingForGoal ? (
              <Button size="sm" disabled={busy || !token} onClick={() => start('next')}>
                <Play size={15} />
                Begin block
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" disabled={busy || !token} onClick={() => start('pomodoro')}>
                  <Focus size={15} />
                  Pomodoro
                </Button>
                <Button size="sm" disabled={busy || !token} onClick={() => start('custom')}>
                  <Play size={15} />
                  Start Focus
                </Button>
              </>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
