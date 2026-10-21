import {
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  Copy,
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
import { scheduleGoalProfileRefresh } from '../lib/goalProfileRefresh'
import { displayMinutes, parseTaskEstimate } from '../lib/taskEstimate'
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
import { RemindersPlan } from './RemindersPanel'
import { PlanTaskStartPopover } from './PlanTaskStartPopover'
import type { ReminderTask } from 'shared/reminders'

type PlanTask = {
  id: string
  source?: 'reminder'
  text: string
  estimatedMinutes?: number | null
  position: number
  completedAtMs: number | null
}

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
  const { data: plan } = trpc.goals.getDailyPlan.useQuery(
    { token: token || '', dateMs: selectedDate.getTime() },
    { enabled: !!token, refetchInterval: 60_000 }
  )
  if (plan?.source === 'reminder')
    return (
      <RemindersPlan
        tasks={plan.tasks as ReminderTask[]}
        canStart={Boolean(plan.canStart)}
        openRequest={openRequest}
      />
    )
  return <ManualTodayPlan selectedDate={selectedDate} openRequest={openRequest} />
}

function ManualTodayPlan({ selectedDate, openRequest = 0 }: TodayPlanProps): ReactElement {
  const { token } = useAuth()
  const utils = trpc.useContext()
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState('')
  const [draftTitle, setDraftTitle] = useState('')
  const [draftMinutes, setDraftMinutes] = useState('')
  const [editingEstimateId, setEditingEstimateId] = useState<string | null>(null)
  const [editingEstimate, setEditingEstimate] = useState('')
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null)
  const [contextTaskId, setContextTaskId] = useState<string | null>(null)
  const [startingTaskId, setStartingTaskId] = useState<string | null>(null)
  const [decisionTaskId, setDecisionTaskId] = useState<string | null>(null)
  const [extensionMinutes, setExtensionMinutes] = useState(15)
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
  const refreshIfChanged = (result: {
    effectiveContextChanged: boolean
    classificationContextFingerprint: string
    profilePending: boolean
  }) => {
    invalidate()
    if (result.effectiveContextChanged) void window.api?.refreshCurrentActivity()
    scheduleGoalProfileRefresh(result, () =>
      utils.goals.getActiveContext.fetch({ token: token || '' })
    )
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
  const finishTaskSession = trpc.focusRuntime.finishTaskSession.useMutation({
    onSuccess: () => {
      setDecisionTaskId(null)
      void utils.focusRuntime.getState.invalidate()
      invalidate()
      void window.api?.refreshCurrentActivity()
    }
  })
  const extendTaskSession = trpc.focusRuntime.extendTaskSession.useMutation({
    onSuccess: () => {
      setDecisionTaskId(null)
      void utils.focusRuntime.getState.invalidate()
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
  const decisionTaskIdFromRuntime = typedFocusRuntime?.taskProgress?.checkpointAtMs
    ? typedFocusRuntime.taskProgress.taskId
    : null
  const activeRunId = typedFocusRuntime?.run?.id
  const parsedDraft = parseTaskEstimate(draft)

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
    const text = parsedDraft.recognized ? draftTitle.trim() : draft.trim()
    const estimatedMinutes = parsedDraft.recognized ? Number(draftMinutes) : null
    if (
      parsedDraft.recognized &&
      (estimatedMinutes === null ||
        !Number.isInteger(estimatedMinutes) ||
        estimatedMinutes < 1 ||
        estimatedMinutes > 720)
    )
      return
    if (!text || busy) return
    setDraft('')
    setDraftTitle('')
    setDraftMinutes('')
    add.mutate(
      { token: token || '', text, estimatedMinutes },
      {
        onSuccess: (result) => {
          refreshIfChanged(result)
          announceUndo('Task added', () =>
            remove.mutate({ token: token || '', taskId: result.task.id })
          )
        },
        onError: (error) => {
          setDraft(parsedDraft.recognized ? `${text} ${estimatedMinutes} min` : text)
          setDraftTitle(text)
          setDraftMinutes(estimatedMinutes?.toString() || '')
          toast({ title: 'Could not add task', description: error.message, variant: 'destructive' })
        }
      }
    )
  }
  const saveEstimate = (task: PlanTask) => {
    const value = editingEstimate.trim() ? Number(editingEstimate) : null
    if ((value !== null && (!Number.isInteger(value) || value < 1 || value > 720)) || busy) return
    setEditingEstimateId(null)
    if (value === (task.estimatedMinutes ?? null)) return
    const previous = task.estimatedMinutes ?? null
    update.mutate(
      { token: token || '', taskId: task.id, text: task.text, estimatedMinutes: value },
      {
        onSuccess: (result) => {
          refreshIfChanged(result)
          announceUndo('Time estimate updated', () =>
            update.mutate({
              token: token || '',
              taskId: task.id,
              text: task.text,
              estimatedMinutes: previous
            })
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
      {editingEstimateId === task.id ? (
        <Input
          autoFocus
          type="number"
          min={1}
          max={720}
          step={1}
          className="h-7 w-16 px-1 text-xs"
          value={editingEstimate}
          aria-label={`Estimated work minutes for ${task.text}`}
          onChange={(event) => setEditingEstimate(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') saveEstimate(task)
            if (event.key === 'Escape') setEditingEstimateId(null)
          }}
          onBlur={() => saveEstimate(task)}
        />
      ) : isToday ? (
        <button
          type="button"
          className={cn('tempo-plan-estimate', !task.estimatedMinutes && 'is-empty')}
          disabled={busy}
          aria-label={`${task.estimatedMinutes ? `Estimated ${displayMinutes(task.estimatedMinutes)}` : 'Add time estimate'} for ${task.text}`}
          onClick={() => {
            setEditingEstimateId(task.id)
            setEditingEstimate(task.estimatedMinutes?.toString() || '')
          }}
        >
          {task.estimatedMinutes ? displayMinutes(task.estimatedMinutes) : 'Add time'}
        </button>
      ) : task.estimatedMinutes ? (
        <span className="tempo-plan-estimate is-readonly">
          {displayMinutes(task.estimatedMinutes)}
        </span>
      ) : null}
      {activePlanTaskId === task.id && (
        <span className="tempo-plan-active" aria-label="Currently in a focus session">
          <Timer size={12} aria-hidden="true" />
          In Focus
        </span>
      )}
      {decisionTaskIdFromRuntime === task.id && activeRunId && (
        <Popover
          open={decisionTaskId === task.id}
          onOpenChange={(open) => setDecisionTaskId(open ? task.id : null)}
        >
          <PopoverTrigger asChild>
            <Button variant="outline" size="xs" aria-label={`Finish or extend ${task.text}`}>
              Finish or extend
            </Button>
          </PopoverTrigger>
          <PopoverContent side="right" align="start" className="tempo-focus-popover w-[275px] p-3">
            <p className="text-sm font-semibold">Planned time reached</p>
            <p className="mt-1 text-xs text-muted-foreground">{task.text}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={finishTaskSession.isLoading}
                onClick={() => finishTaskSession.mutate({ token: token || '', runId: activeRunId })}
              >
                I’m finished
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={extendTaskSession.isLoading}
                onClick={() =>
                  extendTaskSession.mutate({ token: token || '', runId: activeRunId, minutes: 10 })
                }
              >
                +10 min
              </Button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={720}
                value={extensionMinutes}
                className="h-7 w-20"
                aria-label="Custom extension minutes"
                onChange={(event) => setExtensionMinutes(Number(event.target.value))}
              />
              <Button
                variant="outline"
                size="xs"
                disabled={
                  extendTaskSession.isLoading || extensionMinutes < 1 || extensionMinutes > 720
                }
                onClick={() =>
                  extendTaskSession.mutate({
                    token: token || '',
                    runId: activeRunId,
                    minutes: extensionMinutes
                  })
                }
              >
                Add minutes
              </Button>
            </div>
          </PopoverContent>
        </Popover>
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
            <DropdownMenuItem
              onSelect={() => {
                setEditingEstimateId(task.id)
                setEditingEstimate(task.estimatedMinutes?.toString() || '')
              }}
            >
              <Timer size={14} />
              Edit time estimate…
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
                onChange={(event) => {
                  const value = event.target.value
                  const parsed = parseTaskEstimate(value)
                  setDraft(value)
                  setDraftTitle(parsed.title)
                  setDraftMinutes(parsed.estimatedMinutes?.toString() || '')
                }}
                placeholder="Add a task"
                aria-label="Add a task to Today’s Plan"
                disabled={busy}
              />
              <button type="submit" className="sr-only">
                Add task
              </button>
            </form>
          )}
          {isToday && parsedDraft.recognized && (
            <div
              className="tempo-plan-estimate-preview"
              aria-label="Recognized task and time estimate"
            >
              <label>
                <span>Task</span>
                <Input
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') addTask()
                    if (event.key === 'Escape') setDraftTitle(parsedDraft.title)
                  }}
                  aria-label="Task title before saving"
                />
              </label>
              <label>
                <span>Work minutes</span>
                <Input
                  type="number"
                  min={1}
                  max={720}
                  value={draftMinutes}
                  onChange={(event) => setDraftMinutes(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') addTask()
                    if (event.key === 'Escape')
                      setDraftMinutes(parsedDraft.estimatedMinutes?.toString() || '')
                  }}
                  aria-label="Estimated work minutes before saving"
                />
              </label>
              <Button
                type="button"
                size="xs"
                disabled={!draftTitle.trim() || !Number(draftMinutes) || busy}
                onClick={() => addTask()}
              >
                Add
              </Button>
            </div>
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
          {!isToday &&
            activeTasks.length > 0 &&
            selectedDate < new Date() &&
            plan?.canCopyToToday !== false && (
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
