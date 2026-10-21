import { Focus, Play } from 'lucide-react'
import { ReactElement, useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { toast } from '../hooks/use-toast'
import { trpc } from '../utils/trpc'
import { scheduleGoalProfileRefresh } from '../lib/goalProfileRefresh'
import { pomodoroSummary } from '../lib/taskEstimate'
import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import type { FocusRuntimeSnapshot } from './FocusRuntimeControls'
type PlanTask = { id: string; source?: 'reminder'; text: string; estimatedMinutes?: number | null }

export function PlanTaskStartPopover({
  task,
  runtime,
  open,
  disabled,
  triggerClassName,
  onOpenChange,
  onStarted
}: {
  task: PlanTask
  runtime: FocusRuntimeSnapshot | undefined
  open: boolean
  disabled: boolean
  triggerClassName?: string
  onOpenChange: (open: boolean) => void
  onStarted: () => void
}): ReactElement {
  const { token } = useAuth()
  const utils = trpc.useContext()
  const [duration, setDuration] = useState(task.estimatedMinutes ?? 30)
  useEffect(() => {
    if (open) setDuration(task.estimatedMinutes ?? 30)
  }, [open, task.estimatedMinutes])
  const isWaitingForGoal = Boolean(runtime?.run && runtime.currentPhase?.state === 'awaiting_goal')
  const afterStarted = () => {
    onStarted()
    void utils.goals.getActiveContext.fetch({ token: token || '' }).then((context) => {
      void window.api?.refreshCurrentActivity()
      scheduleGoalProfileRefresh(context, () =>
        utils.goals.getActiveContext.fetch({ token: token || '' })
      )
    })
  }
  const startCustom = trpc.focusRuntime.startCustom.useMutation({
    onSuccess: afterStarted,
    onError: (error) =>
      toast({ title: 'Could not start focus', description: error.message, variant: 'destructive' })
  })
  const startPomodoro = trpc.focusRuntime.startPomodoro.useMutation({
    onSuccess: afterStarted,
    onError: (error) =>
      toast({
        title: 'Could not start Pomodoro',
        description: error.message,
        variant: 'destructive'
      })
  })
  const confirmGoal = trpc.focusRuntime.confirmWorkGoal.useMutation({
    onSuccess: afterStarted,
    onError: (error) =>
      toast({
        title: 'Could not begin the next block',
        description: error.message,
        variant: 'destructive'
      })
  })
  const busy = startCustom.isLoading || startPomodoro.isLoading || confirmGoal.isLoading
  const source = {
    kind: task.source === 'reminder' ? ('reminder' as const) : ('today_plan_task' as const),
    taskId: task.id
  }

  const start = (kind: 'custom' | 'pomodoro' | 'next') => {
    if (!token) return
    if (kind === 'custom')
      startCustom.mutate({ token, goalSource: source, durationMinutes: duration })
    if (kind === 'pomodoro')
      startPomodoro.mutate({ token, firstGoalSource: source, workTargetMinutes: duration })
    if (kind === 'next') confirmGoal.mutate({ token, goalSource: source })
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className={['tempo-plan-start', triggerClassName].filter(Boolean).join(' ')}
          disabled={disabled}
          title={`Start a focus session${task.source === 'reminder' ? ' (⌘↵)' : ''}`}
          aria-keyshortcuts={task.source === 'reminder' ? 'Meta+Enter' : undefined}
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
              <span className="text-xs font-medium text-muted-foreground">Work time · minutes</span>
              <input
                type="number"
                min={1}
                max={720}
                step={1}
                className="tempo-field w-full"
                value={duration}
                onChange={(event) => setDuration(Number(event.target.value))}
                aria-label="Task work time in minutes"
              />
            </label>
          )}
          {!isWaitingForGoal && duration >= 1 && duration <= 720 && (
            <p className="text-xs text-muted-foreground">
              Pomodoro: {pomodoroSummary(duration)}. Breaks do not count toward work time.
            </p>
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
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || !token || duration < 1 || duration > 720}
                  onClick={() => start('pomodoro')}
                >
                  <Focus size={15} />
                  Pomodoro
                </Button>
                <Button
                  size="sm"
                  disabled={busy || !token || duration < 1 || duration > 720}
                  onClick={() => start('custom')}
                >
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
