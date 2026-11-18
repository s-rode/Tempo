import { useCallback, useEffect, useRef } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from '../../hooks/use-toast'
import { scheduleGoalProfileRefresh } from '../../lib/goalProfileRefresh'
import {
  moveTaskInWeek,
  type PlannerGoal,
  type PlannerTask,
  type PlannerWeek
} from '../../lib/plannerModel'
import { trpc } from '../../utils/trpc'
import { ToastAction } from '../ui/toast'

type ContextResult = {
  effectiveContextChanged: boolean
  classificationContextFingerprint: string
  profilePending: boolean
}

/**
 * Every planner change on one place: the mutations, cache refreshes, the
 * classifier refresh a changed plan needs, and a single-level Undo (toast
 * button or Command-Z) for the last change.
 */
export function usePlanner(weekStartKey?: string) {
  const { token } = useAuth()
  const auth = { token: token || '' }
  const utils = trpc.useContext()
  const undoRef = useRef<(() => void) | null>(null)

  const refresh = useCallback(() => {
    void utils.planner.getWeek.invalidate()
    void utils.planner.getGoals.invalidate()
    void utils.goals.getDailyPlan.invalidate()
    void utils.goals.getActiveContext.invalidate()
  }, [utils])

  const settled = useCallback(
    (result: ContextResult) => {
      refresh()
      if (result.effectiveContextChanged) void window.api?.refreshCurrentActivity()
      scheduleGoalProfileRefresh(result, () => utils.goals.getActiveContext.fetch(auth))
    },
    [refresh, utils, token]
  )
  const failed = (title: string) => (error: { message: string }) => {
    refresh()
    toast({ title, description: error.message, variant: 'destructive' })
  }

  const add = trpc.planner.addTask.useMutation({
    onSuccess: settled,
    onError: failed('Could not add the task')
  })
  const update = trpc.planner.updateTask.useMutation({
    onSuccess: settled,
    onError: failed('Could not change the task')
  })
  const complete = trpc.planner.setTaskCompleted.useMutation({
    onSuccess: settled,
    onError: failed('Could not update the task')
  })
  const remove = trpc.planner.deleteTask.useMutation({
    onSuccess: settled,
    onError: failed('Could not delete the task')
  })
  const restore = trpc.planner.restoreTask.useMutation({
    onSuccess: settled,
    onError: failed('Could not restore the task')
  })
  const move = trpc.planner.moveTask.useMutation({
    onSuccess: settled,
    onError: failed('Could not move the task')
  })

  const offerUndo = useCallback((title: string, action: () => void) => {
    undoRef.current = action
    toast({
      title,
      action: (
        <ToastAction
          altText="Undo the last plan change"
          onClick={() => {
            if (undoRef.current === action) undoRef.current = null
            action()
          }}
        >
          Undo
        </ToastAction>
      )
    })
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.key.toLowerCase() !== 'z')
        return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      if (!undoRef.current) return
      event.preventDefault()
      const action = undoRef.current
      undoRef.current = null
      action()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const moveTask = useCallback(
    (
      task: PlannerTask,
      fromDateKey: string,
      toDateKey: string,
      toIndex: number,
      options: { undoable?: boolean; fromIndex?: number } = {}
    ) => {
      // Show the drop at once; the server answer replaces it a moment later.
      if (weekStartKey)
        utils.planner.getWeek.setData({ ...auth, weekStartKey }, (current) =>
          current
            ? (moveTaskInWeek(
                current as PlannerWeek,
                task.id,
                fromDateKey,
                toDateKey,
                toIndex
              ) as typeof current)
            : current
        )
      move.mutate(
        { ...auth, taskId: task.id, fromDateKey, toDateKey, toIndex },
        {
          onSuccess: () => {
            if (options.undoable === false) return
            offerUndo(fromDateKey === toDateKey ? 'Queue order changed' : 'Task moved', () =>
              move.mutate({
                ...auth,
                taskId: task.id,
                fromDateKey: toDateKey,
                toDateKey: fromDateKey,
                toIndex: options.fromIndex ?? task.position
              })
            )
          }
        }
      )
    },
    [auth.token, weekStartKey, move, offerUndo, utils]
  )

  const setCompleted = (task: PlannerTask, dateKey: string, completed: boolean) =>
    complete.mutate(
      { ...auth, dateKey, taskId: task.id, completed },
      {
        onSuccess: () =>
          offerUndo(completed ? 'Task completed' : 'Task reopened', () =>
            complete.mutate({ ...auth, dateKey, taskId: task.id, completed: !completed })
          )
      }
    )

  const deleteTask = (task: PlannerTask, dateKey: string) =>
    remove.mutate(
      { ...auth, dateKey, taskId: task.id },
      {
        onSuccess: () => offerUndo('Task deleted', () => restore.mutate({ ...auth, dateKey, task }))
      }
    )

  const addTask = (
    dateKey: string,
    task: { text: string; goalId: string | null; estimatedMinutes: number | null }
  ) => add.mutateAsync({ ...auth, dateKey, ...task })

  const updateTask = (
    task: PlannerTask,
    dateKey: string,
    changes: { text?: string; goalId?: string | null; estimatedMinutes?: number | null }
  ) => update.mutate({ ...auth, dateKey, taskId: task.id, ...changes })

  return {
    auth,
    refresh,
    addTask,
    updateTask,
    moveTask,
    setCompleted,
    deleteTask,
    busy: add.isLoading || move.isLoading
  }
}

export type Planner = ReturnType<typeof usePlanner>
export type { PlannerGoal, PlannerTask, PlannerWeek }
