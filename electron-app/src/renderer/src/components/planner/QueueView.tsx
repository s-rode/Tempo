import {
  CalendarRange,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheckBig,
  Pause,
  Play,
  SkipForward,
  Square
} from 'lucide-react'
import { DragEvent, ReactElement, ReactNode, RefObject, useEffect, useState } from 'react'
import {
  dateFromKey,
  dropIndex,
  formatClock,
  plannedMinutes,
  type PlannerDay,
  type PlannerGoal,
  type PlannerTask
} from '../../lib/plannerModel'
import { displayMinutes } from '../../lib/taskEstimate'
import { useDashboardVisibility } from '../../hooks/useDashboardVisibility'
import { cn } from '../../lib/utils'
import type { FocusRuntimeSnapshot } from '../FocusRuntimeControls'
import { Button } from '../ui/button'
import { Switch } from '../ui/switch'
import { AddTask } from './AddTask'
import { GoalChip } from './GoalBits'
import { TaskCard } from './TaskCard'
import type { Planner } from './usePlanner'
import { QUEUE_TIMERS, type QueueSession, type QueueTimer } from './useQueueSession'

const SESSION_LENGTHS = [15, 25, 30, 45, 60, 90]

/** Today's tasks in working order, reorderable by dragging. */
function QueueList({
  day,
  tasks,
  numberFrom,
  goals,
  planner,
  session
}: {
  day: PlannerDay
  tasks: PlannerTask[]
  numberFrom: number
  goals: PlannerGoal[]
  planner: Planner
  session: QueueSession
}): ReactElement {
  const [dragged, setDragged] = useState<PlannerTask | null>(null)
  const [beforeId, setBeforeId] = useState<string | null | undefined>(undefined)
  const over = (event: DragEvent<HTMLDivElement>) => {
    if (!dragged) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-task-id]')]
    const before = rows.find((row) => {
      const box = row.getBoundingClientRect()
      return event.clientY < box.top + box.height / 2
    })
    const next = before?.dataset.taskId || null
    if (next !== beforeId) setBeforeId(next)
  }
  const end = () => {
    setDragged(null)
    setBeforeId(undefined)
  }
  return (
    <div
      className="planner-queue-list"
      role="list"
      aria-label="Today’s queue"
      onDragOver={over}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setBeforeId(undefined)
      }}
      onDrop={(event) => {
        event.preventDefault()
        if (dragged && beforeId !== undefined) {
          const toIndex = dropIndex(day, dragged.id, beforeId)
          if (toIndex !== dragged.position)
            planner.moveTask(dragged, day.dateKey, day.dateKey, toIndex, {
              fromIndex: dragged.position
            })
        }
        end()
      }}
    >
      {tasks.map((task, index) => (
        <div key={task.id} className="planner-slot">
          {dragged && beforeId === task.id && dragged.id !== task.id && (
            <div className="planner-drop-line" aria-hidden="true" />
          )}
          <TaskCard
            variant="row"
            task={task}
            dateKey={day.dateKey}
            todayKey={day.dateKey}
            goals={goals}
            planner={planner}
            index={task.position}
            openCount={day.open.length}
            lead={<span className="planner-queue-number">{numberFrom + index}</span>}
            canStart={session.canStart}
            onStart={() => session.start(task)}
            dragging={dragged?.id === task.id}
            onDragStart={() => setDragged(task)}
            onDragEnd={end}
          />
        </div>
      ))}
      {dragged && beforeId === null && <div className="planner-drop-line" aria-hidden="true" />}
    </div>
  )
}

/**
 * Live clocks for the task in focus: its work time, and what is left of the
 * current Pomodoro block or break. One timer ticks only while a clock moves.
 */
function useLiveClocks(runtime: FocusRuntimeSnapshot | undefined): {
  elapsedMs: number
  phaseLeftMs: number | null
} {
  const progress = runtime?.taskProgress
  const phase = runtime?.currentPhase
  const running = Boolean(runtime?.run) && phase?.state === 'running'
  const counting = running && phase?.kind === 'work' && !runtime?.suspension.reasons.length
  // A hidden window does not need a second hand; it catches up when shown.
  const visible = useDashboardVisibility()
  const ticking = visible && (counting || (running && phase?.kind !== 'work'))
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    setNow(Date.now())
    if (!ticking) return
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [ticking, progress?.sampledAtMs])
  const sinceSample = progress?.sampledAtMs ? Math.max(0, now - progress.sampledAtMs) : 0
  const base = progress?.workElapsedMs || 0
  const left = runtime?.phaseRemainingMs
  const moving = running && phase?.kind !== 'work'
  return {
    elapsedMs: counting ? base + sinceSample : base,
    phaseLeftMs:
      left === null || left === undefined
        ? null
        : Math.max(0, left - (counting || moving ? sinceSample : 0))
  }
}

const shortClock = (ms: number) => {
  const seconds = Math.ceil(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** Chooses how the next task session is timed. */
function TimerPicker({
  value,
  onChange
}: {
  value: QueueTimer
  onChange: (value: QueueTimer) => void
}): ReactElement {
  const current = QUEUE_TIMERS.find((timer) => timer.value === value) || QUEUE_TIMERS[0]
  return (
    <label className="planner-session-length" title={current.detail}>
      <span>Timer</span>
      <select
        value={value}
        aria-label="How task sessions are timed"
        onChange={(event) => onChange(event.target.value as QueueTimer)}
      >
        {QUEUE_TIMERS.map((timer) => (
          <option key={timer.value} value={timer.value}>
            {timer.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function QueueView({
  day,
  goals,
  planner,
  runtime,
  session,
  nowActivity,
  addInputRef,
  onShowWeek
}: {
  day: PlannerDay
  goals: PlannerGoal[]
  planner: Planner
  runtime: FocusRuntimeSnapshot | undefined
  session: QueueSession
  nowActivity?: ReactNode
  addInputRef: RefObject<HTMLInputElement | null>
  onShowWeek: () => void
}): ReactElement {
  const [showRest, setShowRest] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const { elapsedMs, phaseLeftMs } = useLiveClocks(runtime)
  const { activeTask, upcoming } = session
  const date = dateFromKey(day.dateKey)
  const dateLabel = date.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  })
  const minutes = plannedMinutes(day.open)
  const total = day.open.length + day.done.length
  const goalOf = (task: PlannerTask) => goals.find((goal) => goal.id === task.goalId) || null

  const doneSection = day.done.length > 0 && (
    <div className="planner-queue-done">
      <button
        type="button"
        className="planner-disclosure"
        aria-expanded={showDone}
        onClick={() => setShowDone(!showDone)}
      >
        {showDone ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        Done today · {day.done.length}
      </button>
      {showDone && (
        <div role="list">
          {day.done.map((task, index) => (
            <TaskCard
              key={task.id}
              variant="row"
              task={task}
              dateKey={day.dateKey}
              todayKey={day.dateKey}
              goals={goals}
              planner={planner}
              index={index}
              openCount={0}
            />
          ))}
        </div>
      )}
    </div>
  )

  if (activeTask) {
    const progress = runtime?.taskProgress
    const targetMs = progress?.workTargetMs || 0
    const reached = Boolean(progress?.checkpointAtMs)
    const onBreak = runtime?.currentPhase?.kind !== 'work'
    const paused = !onBreak && Boolean(runtime?.suspension.reasons.length)
    const pomodoro = runtime?.run?.kind === 'pomodoro'
    const openEnded = Boolean(progress?.openEnded) && !reached
    const blockMs = runtime?.currentPhase?.plannedDurationMs || 0
    // A Pomodoro shows its current block or break; an estimate shows the target.
    const share =
      pomodoro && openEnded
        ? blockMs && phaseLeftMs !== null
          ? Math.min(100, ((blockMs - phaseLeftMs) / blockMs) * 100)
          : 0
        : targetMs && !openEnded
          ? Math.min(100, (elapsedMs / targetMs) * 100)
          : 0
    const pausedAtMs = runtime?.suspension.manualPausedAtMs
    const status = session.paused
      ? pausedAtMs
        ? `Paused at ${new Date(pausedAtMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
        : 'Paused'
      : paused
        ? 'Paused'
        : onBreak
          ? phaseLeftMs !== null
            ? `Break · ${shortClock(phaseLeftMs)} left`
            : 'On a break'
          : reached
            ? `Planned ${displayMinutes(Math.round(targetMs / 60000))} reached`
            : pomodoro && openEnded
              ? phaseLeftMs !== null
                ? `Pomodoro · ${shortClock(phaseLeftMs)} left in this block`
                : 'Pomodoro'
              : openEnded
                ? 'Counting up'
                : `of ${displayMinutes(Math.round(targetMs / 60000))}`
    const showBar = !(openEnded && !pomodoro)
    const goal = goalOf(activeTask)
    const place = day.done.length + 1
    return (
      <div className="planner-queue is-working">
        <p className="planner-queue-kicker">
          Task {place} of {total} · {dateLabel}
        </p>
        <section
          className={cn('planner-now', reached && 'is-over', paused && 'is-paused')}
          aria-label={`Working on ${activeTask.text}`}
        >
          {goal && <GoalChip goal={goal} className="is-large" />}
          <h2>{activeTask.text}</h2>
          <div className="planner-now-clock" role="timer" aria-live="off">
            <span className="planner-now-time">{formatClock(elapsedMs)}</span>
            <span className="planner-now-target">{status}</span>
          </div>
          {showBar ? (
            <div
              className="planner-now-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(share)}
              aria-label={
                pomodoro && openEnded
                  ? onBreak
                    ? 'Share of the break used'
                    : 'Share of this Pomodoro block used'
                  : 'Share of the planned time used'
              }
            >
              <span style={{ width: `${share}%` }} />
            </div>
          ) : (
            <div className="planner-now-bar is-empty" aria-hidden="true" />
          )}
          <div className="planner-now-actions">
            <Button
              size="sm"
              className="planner-primary"
              disabled={session.working}
              onClick={() => session.finish()}
              title="Complete this task (⌘↵)"
            >
              <Check size={15} strokeWidth={2.6} />
              {upcoming.length && session.autoNext ? 'Done · Next Task' : 'Done'}
              <kbd>⌘↵</kbd>
            </Button>
            {session.paused ? (
              <Button
                variant="outline"
                size="sm"
                disabled={session.working}
                onClick={session.resume}
                title="Start the clock again (⇧⌘P)"
              >
                <Play size={12} fill="currentColor" />
                Resume
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={session.working || !session.canPause}
                onClick={session.pause}
                title="Stop the clock until you resume. Paused time does not count toward the task (⇧⌘P)"
              >
                <Pause size={12} fill="currentColor" />
                Pause
              </Button>
            )}
            {reached && (
              <Button
                variant="outline"
                size="sm"
                disabled={session.working}
                onClick={() => session.addTime(10)}
              >
                +10 min
              </Button>
            )}
            {upcoming.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                disabled={session.working}
                onClick={() => session.later(day.dateKey)}
                title="Send this task to the back of the queue and continue with the next"
              >
                <SkipForward size={14} />
                Later
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={session.working}
              onClick={session.stop}
              title="End the session and keep the task in the queue"
            >
              <Square size={12} fill="currentColor" />
              Stop
            </Button>
          </div>
        </section>
        {nowActivity && <div className="planner-now-activity">{nowActivity}</div>}
        <div className="planner-queue-after">
          {upcoming.length > 0 ? (
            <>
              <button
                type="button"
                className="planner-next"
                aria-expanded={showRest}
                onClick={() => setShowRest(!showRest)}
              >
                {showRest ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span className="planner-next-label">Next</span>
                <span className="planner-next-title">{upcoming[0].text}</span>
                {upcoming.length > 1 && (
                  <span className="planner-next-more">+{upcoming.length - 1} more</span>
                )}
              </button>
              {showRest && (
                <QueueList
                  day={day}
                  tasks={upcoming}
                  numberFrom={2}
                  goals={goals}
                  planner={planner}
                  session={session}
                />
              )}
            </>
          ) : (
            <p className="planner-queue-last">This is the last task in today’s queue.</p>
          )}
          <label className="planner-auto-next">
            <Switch
              checked={session.autoNext}
              onCheckedChange={session.setAutoNext}
              aria-label="Start the next task as soon as one is done"
            />
            <span>Start the next task as soon as one is done</span>
          </label>
        </div>
      </div>
    )
  }

  if (!day.open.length)
    return (
      <div className="planner-queue">
        <div className="planner-empty">
          <span className="planner-empty-icon">
            <CircleCheckBig size={22} strokeWidth={1.8} />
          </span>
          <h2>{day.done.length ? 'Today’s queue is clear' : 'Nothing queued for today'}</h2>
          <p>
            {day.done.length
              ? `${day.done.length} task${day.done.length === 1 ? '' : 's'} done. Add another, or call it a day.`
              : 'Add what you want to get done today, or pull tasks in from the week plan.'}
          </p>
          <div className="planner-empty-add">
            <AddTask
              ref={addInputRef}
              dateKey={day.dateKey}
              goals={goals}
              planner={planner}
              placeholder="New task for today"
              label="New task for today"
            />
          </div>
          <Button variant="ghost" size="sm" onClick={onShowWeek}>
            <CalendarRange size={14} />
            Open the Week Plan
          </Button>
        </div>
        {doneSection}
      </div>
    )

  const first = day.open[0]
  const firstMinutes = first.estimatedMinutes || session.defaultMinutes
  return (
    <div className="planner-queue">
      <header className="planner-queue-header">
        <div className="min-w-0">
          <h2>{dateLabel}</h2>
          <p>
            {day.open.length} task{day.open.length === 1 ? '' : 's'} in the queue
            {minutes ? ` · about ${displayMinutes(minutes)} planned` : ''}
            {day.done.length ? ` · ${day.done.length} done` : ''}
          </p>
        </div>
        <div className="planner-queue-start">
          <TimerPicker value={session.timer} onChange={session.setTimer} />
          {session.timer === 'estimate' && !first.estimatedMinutes && (
            <label className="planner-session-length" title="Used for tasks without an estimate">
              <span>Session</span>
              <select
                value={session.defaultMinutes}
                aria-label="Session length for tasks without an estimate"
                onChange={(event) => session.setDefaultMinutes(Number(event.target.value))}
              >
                {[...new Set([...SESSION_LENGTHS, session.defaultMinutes])]
                  .sort((a, b) => a - b)
                  .map((value) => (
                    <option key={value} value={value}>
                      {displayMinutes(value)}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <Button
            size="sm"
            className="planner-primary"
            disabled={!session.canStart}
            onClick={() => session.start()}
            title={
              session.timer === 'estimate'
                ? `Start a ${displayMinutes(firstMinutes)} session on the first task (⌘↵)`
                : session.timer === 'open'
                  ? 'Start on the first task and count up until it is done (⌘↵)'
                  : 'Start on the first task in Pomodoro blocks until it is done (⌘↵)'
            }
          >
            <Play size={13} fill="currentColor" />
            Start Working
            <kbd>⌘↵</kbd>
          </Button>
        </div>
      </header>
      {session.blocked && (
        <p className="planner-queue-note">
          Another focus session is running. Finish or end it in the toolbar, then start the queue.
        </p>
      )}
      <QueueList
        day={day}
        tasks={day.open}
        numberFrom={1}
        goals={goals}
        planner={planner}
        session={session}
      />
      <div className="planner-queue-add">
        <AddTask
          ref={addInputRef}
          dateKey={day.dateKey}
          goals={goals}
          planner={planner}
          placeholder="New task for today"
          label="New task for today"
        />
      </div>
      <p className="planner-hint">
        Drag to set the order. Tempo shows one task at a time once you start, and moves to the next
        when you mark it done.
      </p>
      {doneSection}
    </div>
  )
}
