import { ChevronLeft, ChevronRight, ListChecks, Plus } from 'lucide-react'
import { ReactElement, ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import type { FocusRuntimeSnapshot } from '../components/FocusRuntimeControls'
import { GoalEditor, GoalMark, type GoalDraft } from '../components/planner/GoalBits'
import { GoalsView } from '../components/planner/GoalsView'
import { QueueView } from '../components/planner/QueueView'
import { usePlanner } from '../components/planner/usePlanner'
import { useQueueSession } from '../components/planner/useQueueSession'
import { WeekBoard } from '../components/planner/WeekBoard'
import { Button } from '../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../components/ui/dialog'
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group'
import { useAuth } from '../contexts/AuthContext'
import { toast } from '../hooks/use-toast'
import {
  GOAL_COLORS,
  addDays,
  goalColorVar,
  keyFromDate,
  weekRangeLabel,
  weekStartOf,
  type PlannerDay,
  type PlannerGoal,
  type PlannerWeek
} from '../lib/plannerModel'
import { cn } from '../lib/utils'
import { trpc } from '../utils/trpc'
import '../styles/planner.css'

type PlanTab = 'queue' | 'week' | 'goals'
const TAB_KEY = 'tempoPlanTab'

const isTyping = (target: EventTarget | null): boolean =>
  Boolean(
    (target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')
  )

export function PlanPage({
  runtime,
  nowActivity,
  onOpenSettings
}: {
  runtime: FocusRuntimeSnapshot | undefined
  nowActivity?: ReactNode
  onOpenSettings: () => void
}): ReactElement {
  const { token } = useAuth()
  const auth = { token: token || '' }
  const utils = trpc.useContext()
  const [tab, setTabState] = useState<PlanTab>(() => {
    const stored = localStorage.getItem(TAB_KEY)
    return stored === 'queue' || stored === 'goals' ? stored : 'week'
  })
  const setTab = (next: PlanTab) => {
    localStorage.setItem(TAB_KEY, next)
    setTabState(next)
  }
  const [todayKey, setTodayKey] = useState(() => keyFromDate(new Date()))
  const [weekStartKey, setWeekStartKey] = useState(() => weekStartOf(keyFromDate(new Date())))
  const [goalFilter, setGoalFilter] = useState<Set<string>>(new Set())
  const [editor, setEditor] = useState<{ open: boolean; goal: PlannerGoal | null }>({
    open: false,
    goal: null
  })
  const [deleting, setDeleting] = useState<PlannerGoal | null>(null)
  const todayInputRef = useRef<HTMLInputElement>(null)
  const queueInputRef = useRef<HTMLInputElement>(null)
  const currentWeekKey = weekStartOf(todayKey)

  // A window left open overnight moves on to the new day by itself.
  useEffect(() => {
    const check = () => {
      const next = keyFromDate(new Date())
      setTodayKey((current) => {
        if (current === next) return current
        setWeekStartKey((shown) => (shown === weekStartOf(current) ? weekStartOf(next) : shown))
        void utils.planner.getWeek.invalidate()
        return next
      })
    }
    const interval = window.setInterval(check, 60_000)
    window.addEventListener('focus', check)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', check)
    }
  }, [utils])

  const { data: source } = trpc.planner.getSource.useQuery(auth, { enabled: !!token })
  const enabled = !!token && source?.source === 'planner'
  const { data: goalData } = trpc.planner.getGoals.useQuery(auth, { enabled })
  const { data: shownWeek } = trpc.planner.getWeek.useQuery(
    { ...auth, weekStartKey },
    { enabled, keepPreviousData: true }
  )
  const { data: thisWeek } = trpc.planner.getWeek.useQuery(
    { ...auth, weekStartKey: currentWeekKey },
    { enabled }
  )
  const goals = useMemo(() => (goalData || []) as PlannerGoal[], [goalData])
  const week = shownWeek as PlannerWeek | undefined
  const today: PlannerDay = useMemo(
    () =>
      (thisWeek as PlannerWeek | undefined)?.days.find((day) => day.dateKey === todayKey) || {
        dateKey: todayKey,
        open: [],
        done: []
      },
    [thisWeek, todayKey]
  )
  const planner = usePlanner(weekStartKey)
  const session = useQueueSession(runtime, today.open)

  const invalidateGoals = () => {
    void utils.planner.getGoals.invalidate()
    void utils.planner.getWeek.invalidate()
  }
  const goalFailed = (error: { message: string }) =>
    toast({ title: 'Could not save the goal', description: error.message, variant: 'destructive' })
  const createGoal = trpc.planner.createGoal.useMutation({
    onSuccess: invalidateGoals,
    onError: goalFailed
  })
  const updateGoal = trpc.planner.updateGoal.useMutation({
    onSuccess: invalidateGoals,
    onError: goalFailed
  })
  const reorderGoals = trpc.planner.reorderGoals.useMutation({
    onSuccess: invalidateGoals,
    onError: goalFailed
  })
  const deleteGoal = trpc.planner.deleteGoal.useMutation({
    onSuccess: invalidateGoals,
    onError: goalFailed
  })
  const setSource = trpc.planner.setSource.useMutation({
    onSuccess: () => {
      void utils.planner.invalidate()
      void utils.goals.invalidate()
      void window.api?.refreshCurrentActivity()
    }
  })

  const activeGoals = goals.filter((goal) => goal.completedAtMs === null)
  const suggestedColor =
    GOAL_COLORS.find((color) => !goals.some((goal) => goal.color === color.id))?.id ||
    GOAL_COLORS[goals.length % GOAL_COLORS.length].id
  const saveGoal = (draft: GoalDraft) => {
    const done = () => setEditor({ open: false, goal: null })
    if (editor.goal)
      updateGoal.mutate({ ...auth, goalId: editor.goal.id, ...draft }, { onSuccess: done })
    else createGoal.mutate({ ...auth, ...draft }, { onSuccess: done })
  }
  const toggleFilter = (id: string, additive: boolean) =>
    setGoalFilter((current) => {
      if (!additive) return current.size === 1 && current.has(id) ? new Set() : new Set([id])
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Page-level keys. Cards and fields handle their own first.
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTyping(event.target)) return
      if (document.querySelector('[role="dialog"], [role="menu"]')) return
      if (event.key === 'Enter' && event.metaKey) {
        event.preventDefault()
        if (session.activeTask) session.finish()
        else if (today.open.length && session.canStart) {
          setTab('queue')
          session.start()
        }
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'n') {
        event.preventDefault()
        if (tab === 'goals') return setEditor({ open: true, goal: null })
        const field = tab === 'queue' ? queueInputRef : todayInputRef
        if (tab === 'week' && weekStartKey !== currentWeekKey) {
          // Today's column is not on screen yet; focus it once it is.
          setWeekStartKey(currentWeekKey)
          window.setTimeout(() => field.current?.focus(), 50)
        } else field.current?.focus()
      }
      if (key === 'g') {
        event.preventDefault()
        setEditor({ open: true, goal: null })
      }
      if (tab !== 'week') return
      if (key === 't') setWeekStartKey(currentWeekKey)
      if (event.key === '[') setWeekStartKey((shown) => addDays(shown, -7))
      if (event.key === ']') setWeekStartKey((shown) => addDays(shown, 7))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, tab, session, today.open.length, currentWeekKey, weekStartKey])

  if (source && source.source !== 'planner')
    return (
      <main className="planner-page">
        <div className="planner-empty">
          <span className="planner-empty-icon">
            <ListChecks size={22} strokeWidth={1.8} />
          </span>
          <h2>Plan with Tempo</h2>
          <p>
            Tasks currently come from Apple Reminders. Tempo’s own planner adds long-term goals, a
            plan for each day of the week, and a queue that shows one task at a time.
            {source.remindersConnected
              ? ' Reminders stays connected and can be switched back on at any time.'
              : ''}
          </p>
          <Button
            size="sm"
            disabled={setSource.isLoading}
            onClick={() => setSource.mutate({ ...auth, source: 'planner' })}
          >
            Use Tempo’s Planner
          </Button>
          <Button variant="ghost" size="sm" onClick={onOpenSettings}>
            Open Settings
          </Button>
        </div>
      </main>
    )

  return (
    <main className="planner-page">
      <div className="planner-bar">
        <ToggleGroup
          type="single"
          size="sm"
          className="tempo-glass-segmented"
          value={tab}
          onValueChange={(value) => value && setTab(value as PlanTab)}
          aria-label="Plan view"
        >
          <ToggleGroupItem value="queue" className="px-3 text-xs">
            Queue
            {today.open.length > 0 && (
              <span className="planner-tab-count">{today.open.length}</span>
            )}
          </ToggleGroupItem>
          <ToggleGroupItem value="week" className="px-3 text-xs">
            Week
          </ToggleGroupItem>
          <ToggleGroupItem value="goals" className="px-3 text-xs">
            Goals
          </ToggleGroupItem>
        </ToggleGroup>
        {tab === 'week' && (
          <div className="planner-week-nav">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setWeekStartKey(addDays(weekStartKey, -7))}
              aria-label="Previous week"
              title="Previous week ([)"
            >
              <ChevronLeft size={17} />
            </Button>
            <span className="planner-week-range">{weekRangeLabel(weekStartKey)}</span>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setWeekStartKey(addDays(weekStartKey, 7))}
              aria-label="Next week"
              title="Next week (])"
            >
              <ChevronRight size={17} />
            </Button>
            <Button
              variant="ghost"
              size="xs"
              className="planner-this-week"
              disabled={weekStartKey === currentWeekKey}
              onClick={() => setWeekStartKey(currentWeekKey)}
              title="Show this week (T)"
            >
              This Week
            </Button>
          </div>
        )}
        <div className="flex-1" />
        {tab === 'goals' ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setEditor({ open: true, goal: null })}
            title="New goal (G)"
          >
            <Plus size={15} />
            New Goal
          </Button>
        ) : (
          session.activeTask &&
          tab !== 'queue' && (
            <button type="button" className="planner-working-pill" onClick={() => setTab('queue')}>
              <i aria-hidden="true" />
              <span>{session.activeTask.text}</span>
            </button>
          )
        )}
      </div>

      {tab === 'week' && (
        <div className="planner-filter" role="toolbar" aria-label="Show tasks by goal">
          <button
            type="button"
            className="planner-filter-chip"
            aria-pressed={goalFilter.size === 0}
            onClick={() => setGoalFilter(new Set())}
          >
            All Tasks
          </button>
          {activeGoals.map((goal) => (
            <button
              key={goal.id}
              type="button"
              className="planner-filter-chip"
              style={{ ['--goal' as string]: goalColorVar(goal.color) }}
              aria-pressed={goalFilter.has(goal.id)}
              title={`${goal.title}. Shift-click to combine goals.`}
              onClick={(event) => toggleFilter(goal.id, event.shiftKey || event.metaKey)}
              onDoubleClick={() => setEditor({ open: true, goal })}
            >
              <GoalMark goal={goal} size={8} />
              <span>{goal.title}</span>
              {goal.openTasks > 0 && <em>{goal.openTasks}</em>}
            </button>
          ))}
          {activeGoals.length > 0 && (
            <button
              type="button"
              className="planner-filter-chip"
              aria-pressed={goalFilter.has('none')}
              onClick={(event) => toggleFilter('none', event.shiftKey || event.metaKey)}
            >
              No Goal
            </button>
          )}
          <button
            type="button"
            className={cn('planner-filter-chip is-add')}
            onClick={() => setEditor({ open: true, goal: null })}
            title="New goal (G)"
          >
            <Plus size={12} />
            Goal
          </button>
        </div>
      )}

      {tab === 'week' &&
        (week ? (
          <WeekBoard
            week={week}
            goals={goals}
            planner={planner}
            goalFilter={goalFilter}
            activeTaskId={session.activeTaskId}
            canStart={session.canStart}
            onStart={(task) => {
              setTab('queue')
              session.start(task)
            }}
            todayInputRef={todayInputRef}
          />
        ) : (
          <div className="planner-board is-loading" aria-busy="true" />
        ))}
      {tab === 'queue' && (
        <div className="planner-scroll">
          <QueueView
            day={today}
            goals={goals}
            planner={planner}
            runtime={runtime}
            session={session}
            nowActivity={nowActivity}
            addInputRef={queueInputRef}
            onShowWeek={() => setTab('week')}
          />
        </div>
      )}
      {tab === 'goals' && (
        <div className="planner-scroll">
          <GoalsView
            goals={goals}
            actions={{
              onNew: () => setEditor({ open: true, goal: null }),
              onEdit: (goal) => setEditor({ open: true, goal }),
              onSetAchieved: (goal, achieved) =>
                updateGoal.mutate({ ...auth, goalId: goal.id, completed: achieved }),
              onMove: (goal, direction) => {
                const ids = activeGoals.map((entry) => entry.id)
                const from = ids.indexOf(goal.id)
                const to = from + direction
                if (from < 0 || to < 0 || to >= ids.length) return
                ;[ids[from], ids[to]] = [ids[to], ids[from]]
                reorderGoals.mutate({ ...auth, goalIds: ids })
              },
              onDelete: setDeleting,
              onShowTasks: (goal) => {
                setGoalFilter(new Set([goal.id]))
                setTab('week')
              }
            }}
          />
        </div>
      )}

      <GoalEditor
        open={editor.open}
        goal={editor.goal}
        suggestedColor={suggestedColor}
        saving={createGoal.isLoading || updateGoal.isLoading}
        onOpenChange={(open) => setEditor((current) => ({ ...current, open }))}
        onSave={saveGoal}
      />
      <Dialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Delete “{deleting?.title}”?</DialogTitle>
            <DialogDescription>
              {deleting && deleting.openTasks + deleting.doneTasks > 0
                ? `Its ${deleting.openTasks + deleting.doneTasks} task${deleting.openTasks + deleting.doneTasks === 1 ? '' : 's'} stay in your plan without a goal.`
                : 'No tasks are linked to this goal.'}{' '}
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteGoal.isLoading}
              onClick={() => {
                if (!deleting) return
                const id = deleting.id
                deleteGoal.mutate(
                  { ...auth, goalId: id },
                  {
                    onSuccess: () => {
                      setDeleting(null)
                      setGoalFilter((current) => {
                        const next = new Set(current)
                        next.delete(id)
                        return next
                      })
                    }
                  }
                )
              }}
            >
              Delete Goal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
