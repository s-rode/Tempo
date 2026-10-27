import { useDashboardVisibility } from '../hooks/useDashboardVisibility'
import {
  ListChecks,
  SlidersHorizontal,
  RefreshCw,
  ExternalLink,
  Plus,
  X,
  Pencil,
  Timer,
  MoreHorizontal,
  Clock3,
  AlertCircle,
  Play
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement, type KeyboardEvent } from 'react'
import type { inferRouterOutputs } from '@trpc/server'
import type { ReminderFilter, ReminderFilterRule, ReminderTask } from 'shared/reminders'
import { DEFAULT_REMINDER_FILTER } from 'shared/reminders'
import { useAuth } from '../contexts/AuthContext'
import { useRefreshReminderViews, useRemindersAvailable } from '../hooks/useReminders'
import { toast } from '../hooks/use-toast'
import { trpc, type AppRouter } from '../utils/trpc'
import { displayMinutes } from '../lib/taskEstimate'
import {
  reminderDatePresentation,
  reminderGroups,
  reminderFilterSummary
} from '../lib/reminderPresentation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { PlanTaskStartPopover } from './PlanTaskStartPopover'
import type { FocusRuntimeSnapshot } from './FocusRuntimeControls'

type Status = inferRouterOutputs<AppRouter>['reminders']['getStatus']
const showError = (error: { message: string }) =>
  toast({ title: 'Reminders', description: error.message, variant: 'destructive' })
export function RemindersSettings() {
  const { token } = useAuth()
  const available = useRemindersAvailable()
  const refresh = useRefreshReminderViews()
  const { data: status } = trpc.reminders.getStatus.useQuery(
    { token: token || '' },
    { enabled: available && !!token }
  )
  const [busy, setBusy] = useState(false)
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
      refresh()
    } catch (error) {
      showError(error as Error)
      refresh()
    } finally {
      setBusy(false)
    }
  }
  if (!available) return null
  return (
    <section className="tempo-planning-row" aria-labelledby="reminders-settings-heading">
      <div className="tempo-planning-row-icon">
        <ListChecks size={16} />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <h3 id="reminders-settings-heading">Apple Reminders</h3>
          <p>
            Use reminders as your tasks. Estimates, focus context, and session history stay in
            Tempo.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          macOS requests full Reminders access. Tempo only reads; edit and complete your tasks in
          Reminders.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {status?.enabled ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void run(window.api.refreshReminders)}
              >
                <RefreshCw size={14} />
                Refresh
              </Button>
              {status.permission !== 'granted' && (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => void run(window.api.connectReminders)}
                >
                  Reconnect
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void run(window.api.disconnectReminders)}
              >
                Disconnect
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              disabled={busy || !status}
              onClick={() => void run(window.api.connectReminders)}
            >
              {busy ? 'Connecting…' : 'Connect Apple Reminders'}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void window.api.openReminders().catch(showError)}
          >
            <ExternalLink size={14} />
            Open Reminders
          </Button>
        </div>
        {status && <ReminderSyncStatus status={status} />}
        {status?.enabled && (
          <>
            <RemindersFilters status={status} />
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Focus context by list</h4>
              <p className="text-xs text-muted-foreground">
                Describe what these short task names mean once. You can override this for individual
                reminders. Native tag filtering is not available in this version.
              </p>
              {status.lists.map((list) => (
                <ListContextEditor
                  key={list.id}
                  list={list}
                  value={status.listContexts[list.id] || ''}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function useReminderClock(): number {
  const [now, setNow] = useState(Date.now)
  const visible = useDashboardVisibility()
  useEffect(() => {
    if (!visible) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [visible])
  return now
}

function ReminderSyncStatus({ status, compact = false }: { status: Status; compact?: boolean }) {
  const now = useReminderClock()
  const denied = status.enabled && status.permission !== 'granted'
  const stale = Boolean(
    status.error ||
      (status.enabled && status.lastSuccessAtMs && now - status.lastSuccessAtMs > 120_000)
  )
  const problem = denied || stale
  const age = status.lastSuccessAtMs
    ? Math.max(0, Math.floor((now - status.lastSuccessAtMs) / 60_000))
    : null
  const syncLabel =
    age === null ? 'Waiting to sync' : age < 1 ? 'Synced just now' : 'Synced ' + age + ' min ago'
  const lastSync = status.lastSuccessAtMs
    ? 'Last synced ' + new Date(status.lastSuccessAtMs).toLocaleString()
    : 'No successful sync yet'
  const message = denied
    ? 'Reminders access unavailable. Reconnect in Settings.'
    : stale
      ? 'Using the last sync. Try refreshing.'
      : status.enabled
        ? syncLabel
        : 'Disconnected · manual Tempo tasks are available.'
  return (
    <div
      className={
        compact
          ? 'tempo-reminder-sync' + (problem ? ' has-error' : '')
          : 'text-xs text-muted-foreground'
      }
      role={problem ? 'status' : undefined}
      title={lastSync}
    >
      {compact &&
        (problem ? (
          <AlertCircle size={12} aria-hidden="true" />
        ) : (
          <span className="tempo-reminder-sync-dot" aria-hidden="true" />
        ))}
      <span>{message}</span>
      {!compact && status.enabled && <span> · Read-only. {lastSync}.</span>}
    </div>
  )
}

function ListContextEditor({
  list,
  value
}: {
  list: { id: string; name: string; accountName: string }
  value: string
}) {
  const { token } = useAuth()
  const refresh = useRefreshReminderViews()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const mutation = trpc.reminders.setListContext.useMutation({
    onSuccess: () => {
      setEditing(false)
      refresh()
    },
    onError: showError
  })
  return (
    <div className="rounded-md border p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {list.name}
          <span className="ml-2 text-xs font-normal text-muted-foreground">{list.accountName}</span>
        </span>
        <Button
          variant="ghost"
          size="xs"
          aria-label={`Edit focus context for ${list.name}`}
          onClick={() => {
            setDraft(value)
            setEditing(!editing)
          }}
        >
          <Pencil size={13} />
        </Button>
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <Textarea
            aria-label={`Focus context for ${list.name}`}
            rows={3}
            maxLength={1000}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="For example: Watch Machine Learning lectures, review the material, and create related flashcards."
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="xs" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              size="xs"
              disabled={mutation.isLoading}
              onClick={() =>
                mutation.mutate({ token: token || '', listId: list.id, focusContext: draft })
              }
            >
              Save
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
          {value || 'No default context. Tempo uses the reminder title and list name.'}
        </p>
      )}
    </div>
  )
}

const ruleLabels: Record<ReminderFilterRule['kind'], string> = {
  due_today: 'Due today',
  overdue: 'Overdue',
  due_later: 'Due later',
  no_due_date: 'No due date',
  list: 'In selected lists'
}

export function RemindersFilters({
  status,
  compact = false,
  open: controlledOpen,
  onOpenChange
}: {
  status: Status
  compact?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const { token } = useAuth()
  const refresh = useRefreshReminderViews()
  const [localOpen, setLocalOpen] = useState(false)
  const open = controlledOpen ?? localOpen
  const setOpen = onOpenChange ?? setLocalOpen
  const [draft, setDraft] = useState<ReminderFilter>(status.filter)
  useEffect(() => {
    if (open) setDraft(status.filter)
  }, [open])
  const mutation = trpc.reminders.setFilter.useMutation({
    onSuccess: () => {
      setOpen(false)
      refresh()
    },
    onError: showError
  })
  const update = (index: number, rule: ReminderFilterRule) =>
    setDraft((previous) => ({
      ...previous,
      rules: previous.rules.map((entry, i) => (i === index ? rule : entry))
    }))
  const apply = () => mutation.mutate({ token: token || '', filter: draft })
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className={compact ? 'tempo-reminder-icon-button' : 'tempo-reminder-filter-button'}
          aria-label="Filter reminders"
          title={'Filter reminders · ' + reminderFilterSummary(status.filter, status.lists)}
        >
          <SlidersHorizontal size={14} aria-hidden="true" />
          {!compact && 'Filters'}
          {compact && status.filter.rules.length > 0 && (
            <span className="tempo-reminder-filter-dot" aria-hidden="true" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="tempo-reminder-popover tempo-reminder-filter-popover"
        aria-label="Filter reminders"
        onKeyDown={(event) => {
          if (event.metaKey && event.key === 'Enter' && !mutation.isLoading) {
            event.preventDefault()
            apply()
          }
        }}
      >
        <div className="tempo-reminder-popover-heading">
          <h4>Filter reminders</h4>
          <p>Show unfinished reminders that match</p>
        </div>
        <fieldset className="tempo-reminder-match">
          <legend className="sr-only">How to combine conditions</legend>
          {(['any', 'all'] as const).map((value) => (
            <label key={value}>
              <input
                type="radio"
                name="reminder-match"
                value={value}
                checked={draft.match === value}
                onChange={() => setDraft({ ...draft, match: value })}
              />
              <span>{value === 'any' ? 'Any condition' : 'All conditions'}</span>
            </label>
          ))}
        </fieldset>
        <div className="tempo-reminder-rules">
          {!draft.rules.length && (
            <p className="tempo-reminder-filter-help">
              No conditions: show all unfinished reminders.
            </p>
          )}
          {draft.rules.map((rule, index) => (
            <div key={index} className="tempo-reminder-rule">
              <div className="tempo-reminder-rule-line">
                <select
                  className="tempo-field"
                  aria-label={'Condition ' + (index + 1)}
                  value={rule.kind}
                  onChange={(event) =>
                    update(
                      index,
                      event.target.value === 'list'
                        ? { kind: 'list', listIds: [] }
                        : {
                            kind: event.target.value as Exclude<ReminderFilterRule['kind'], 'list'>
                          }
                    )
                  }
                >
                  {Object.entries(ruleLabels).map(([kind, label]) => (
                    <option value={kind} key={kind}>
                      {label}
                    </option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  size="xs"
                  className="tempo-reminder-icon-button"
                  aria-label={'Remove condition ' + (index + 1)}
                  title="Remove condition"
                  onClick={() =>
                    setDraft({ ...draft, rules: draft.rules.filter((_, i) => i !== index) })
                  }
                >
                  <X size={13} aria-hidden="true" />
                </Button>
              </div>
              {rule.kind === 'list' && (
                <fieldset className="tempo-reminder-filter-lists">
                  <legend className="sr-only">Lists for condition {index + 1}</legend>
                  {[
                    ...status.lists,
                    ...rule.listIds
                      .filter((id) => !status.lists.some((list) => list.id === id))
                      .map((id) => ({ id, name: 'Unavailable list', accountName: id }))
                  ].map((list) => (
                    <label key={list.id}>
                      <input
                        type="checkbox"
                        checked={rule.listIds.includes(list.id)}
                        onChange={(event) =>
                          update(index, {
                            kind: 'list',
                            listIds: event.target.checked
                              ? [...rule.listIds, list.id]
                              : rule.listIds.filter((id) => id !== list.id)
                          })
                        }
                      />
                      <span>{list.name}</span>
                      <small>{list.accountName}</small>
                    </label>
                  ))}
                  {!rule.listIds.length && (
                    <p className="tempo-reminder-filter-help">
                      Choose a list. An empty selection matches nothing.
                    </p>
                  )}
                </fieldset>
              )}
            </div>
          ))}
        </div>
        <Button
          variant="ghost"
          size="xs"
          className="tempo-reminder-add-condition"
          disabled={draft.rules.length >= 30}
          onClick={() => setDraft({ ...draft, rules: [...draft.rules, { kind: 'due_today' }] })}
        >
          <Plus size={13} />
          Add condition
        </Button>
        <div className="tempo-reminder-popover-footer">
          <Button
            variant="ghost"
            size="xs"
            className="mr-auto"
            onClick={() => setDraft(DEFAULT_REMINDER_FILTER)}
          >
            Reset
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size="xs"
            disabled={mutation.isLoading}
            aria-keyshortcuts="Meta+Enter"
            onClick={apply}
          >
            {mutation.isLoading ? 'Applying…' : 'Apply'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function RemindersPlan({
  tasks,
  canStart,
  openRequest = 0
}: {
  tasks: ReminderTask[]
  canStart: boolean
  openRequest?: number
}) {
  const { token } = useAuth()
  const { data: status } = trpc.reminders.getStatus.useQuery(
    { token: token || '' },
    { enabled: !!token }
  )
  const { data: runtime } = trpc.focusRuntime.getState.useQuery(
    { token: token || '' },
    { enabled: !!token }
  )
  const refreshViews = useRefreshReminderViews()
  const now = useReminderClock()
  const listRef = useRef<HTMLDivElement>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const state = runtime as FocusRuntimeSnapshot | undefined
  const mayStart = canStart && (!state?.run || state.currentPhase?.state === 'awaiting_goal')
  const groups = reminderGroups
    .map((group) => ({
      ...group,
      tasks: tasks.filter(
        (task) => reminderDatePresentation(task.due, new Date(now)).group === group.id
      )
    }))
    .filter((group) => group.tasks.length)
  const sharedList =
    tasks.length && tasks.every((task) => task.listId === tasks[0].listId)
      ? tasks[0].listName
      : null
  const summary = status
    ? reminderFilterSummary(status.filter, status.lists)
    : 'Unfinished reminders'
  const scope = sharedList && summary !== sharedList ? sharedList + ' · ' + summary : summary
  useEffect(() => {
    if (openRequest)
      listRef.current?.querySelector<HTMLButtonElement>('[data-reminder-body]')?.focus()
  }, [openRequest])
  const refreshNow = async () => {
    setRefreshing(true)
    try {
      await window.api.refreshReminders()
      refreshViews()
    } catch (error) {
      showError(error as Error)
    } finally {
      setRefreshing(false)
    }
  }
  return (
    <section className="tempo-reminders" aria-labelledby="reminders-plan-heading">
      <header className="tempo-reminder-header">
        <div className="tempo-reminder-title">
          <h3 id="reminders-plan-heading">Reminders</h3>
          <span className="tempo-reminder-count" aria-label={tasks.length + ' matching reminders'}>
            {tasks.length}
          </span>
        </div>
        <div className="tempo-reminder-toolbar" role="group" aria-label="Reminder list actions">
          {status && (
            <RemindersFilters
              status={status}
              compact
              open={filtersOpen}
              onOpenChange={setFiltersOpen}
            />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="xs"
                className="tempo-reminder-icon-button"
                aria-label="Reminder list options"
                title="Reminder list options"
              >
                <MoreHorizontal size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="tempo-reminder-menu">
              <DropdownMenuItem disabled={refreshing} onSelect={() => void refreshNow()}>
                <RefreshCw size={14} />
                {refreshing ? 'Refreshing…' : 'Refresh reminders'}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void window.api.openReminders().catch(showError)}>
                <ExternalLink size={14} />
                Open Reminders
              </DropdownMenuItem>
              {status?.permission !== 'granted' && (
                <DropdownMenuItem
                  onSelect={() => void window.api.connectReminders().catch(showError)}
                >
                  Reconnect Reminders…
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <p className="tempo-reminder-scope" title={scope}>
        {scope}
      </p>
      <div
        ref={listRef}
        className="tempo-reminder-list"
        role="list"
        aria-label="Unfinished reminders"
        aria-busy={refreshing}
      >
        {groups.map((group) => (
          <div className="tempo-reminder-group" role="presentation" key={group.id}>
            {groups.length > 1 && (
              <div
                className={
                  'tempo-reminder-group-heading' + (group.id === 'overdue' ? ' is-overdue' : '')
                }
                role="presentation"
              >
                <span>{group.label}</span>
                <span>{group.tasks.length}</span>
              </div>
            )}
            {group.tasks.map((task) => (
              <ReminderRow
                key={task.id}
                task={task}
                now={now}
                runtime={state}
                mayStart={Boolean(mayStart)}
                showListName={!sharedList}
                onStarted={refreshViews}
              />
            ))}
          </div>
        ))}
      </div>
      {!tasks.length && (
        <div className="tempo-reminder-empty">
          <ListChecks size={23} aria-hidden="true" />
          <h4>No matching reminders</h4>
          <p>Try another list or adjust the due-date conditions.</p>
          {status && (
            <Button size="xs" variant="outline" onClick={() => setFiltersOpen(true)}>
              Edit filters
            </Button>
          )}
        </div>
      )}
      <footer className="tempo-reminder-footer">
        <button
          type="button"
          className="tempo-reminder-source"
          onClick={() => void window.api.openReminders().catch(showError)}
          title="Tempo only reads reminders. Complete tasks in the Reminders app."
        >
          Complete in Reminders
          <ExternalLink size={11} aria-hidden="true" />
        </button>
        {refreshing ? (
          <span className="tempo-reminder-sync" role="status">
            <RefreshCw size={11} className="animate-spin" />
            Refreshing…
          </span>
        ) : (
          status && <ReminderSyncStatus status={status} compact />
        )}
      </footer>
    </section>
  )
}

function ReminderRow({
  task,
  now,
  runtime,
  mayStart,
  showListName,
  onStarted
}: {
  task: ReminderTask
  now: number
  runtime: FocusRuntimeSnapshot | undefined
  mayStart: boolean
  showListName: boolean
  onStarted: () => void
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [startOpen, setStartOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const date = reminderDatePresentation(task.due, new Date(now))
  const active = runtime?.taskProgress?.taskId === task.id
  const hasMeta = Boolean(showListName || date.label || task.estimatedMinutes || active)
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.target as Node)) return
    if (event.metaKey && event.key === 'Enter' && mayStart && !active) {
      event.preventDefault()
      setStartOpen(true)
      return
    }
    if ((event.target as HTMLElement).closest('[data-reminder-menu]')) return
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    const buttons = [
      ...(event.currentTarget
        .closest('[role="list"]')
        ?.querySelectorAll<HTMLButtonElement>('[data-reminder-body]') || [])
    ]
    const index = buttons.findIndex(
      (button) => button.closest('[data-reminder-row]') === event.currentTarget
    )
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
    event.preventDefault()
    buttons[next]?.focus()
  }
  return (
    <div
      role="listitem"
      data-reminder-row={task.id}
      className={'tempo-reminder-row' + (active ? ' is-in-focus' : '')}
      onKeyDown={navigate}
      onContextMenu={(event) => {
        if (!event.currentTarget.contains(event.target as Node)) return
        event.preventDefault()
        setDetailsOpen(false)
        setMenuOpen(true)
      }}
    >
      <ReminderMetadataEditor task={task} open={detailsOpen} onOpenChange={setDetailsOpen}>
        <button
          type="button"
          className="tempo-reminder-body"
          data-reminder-body
          aria-label={'Task details for ' + task.text}
          aria-describedby={hasMeta ? 'reminder-meta-' + task.id : undefined}
          title={task.text + '\nEdit time estimate and focus context'}
        >
          <span className="tempo-reminder-name">{task.text || 'Untitled reminder'}</span>
          {hasMeta && (
            <span className="tempo-reminder-meta" id={'reminder-meta-' + task.id}>
              {active && <span className="tempo-reminder-focus-label">In focus</span>}
              {showListName && (
                <span className="tempo-reminder-list-name" title={task.listName}>
                  {task.listName}
                </span>
              )}
              {date.label && (
                <span
                  className={'tempo-reminder-due' + (date.group === 'overdue' ? ' is-overdue' : '')}
                  title={date.fullLabel}
                >
                  {date.label}
                </span>
              )}
              {task.estimatedMinutes && (
                <span className="tempo-reminder-duration">
                  <Clock3 size={10} aria-hidden="true" />
                  {displayMinutes(task.estimatedMinutes)}
                </span>
              )}
            </span>
          )}
        </button>
      </ReminderMetadataEditor>
      <div className="tempo-reminder-row-actions">
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              data-reminder-menu
              className="tempo-reminder-icon-button tempo-reminder-row-more"
              aria-label={'Options for ' + task.text}
              title="Task options"
            >
              <MoreHorizontal size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="tempo-reminder-menu"
            onCloseAutoFocus={(event) => {
              if (detailsOpen || startOpen) event.preventDefault()
            }}
          >
            <DropdownMenuItem onSelect={() => setDetailsOpen(true)}>
              <Pencil size={14} />
              Edit Tempo details…
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!mayStart || active} onSelect={() => setStartOpen(true)}>
              <Play size={14} />
              Start focus…<span className="tempo-reminder-shortcut">⌘↵</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void window.api.openReminders().catch(showError)}>
              <ExternalLink size={14} />
              Open Reminders
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {active ? (
          <span
            className="tempo-reminder-active-icon"
            title="Currently in focus"
            aria-label="Currently in focus"
          >
            <Timer size={14} />
          </span>
        ) : (
          <PlanTaskStartPopover
            task={task}
            runtime={runtime}
            open={startOpen}
            disabled={!mayStart}
            triggerClassName="tempo-reminder-start"
            onOpenChange={setStartOpen}
            onStarted={() => {
              setStartOpen(false)
              onStarted()
            }}
          />
        )}
      </div>
    </div>
  )
}

function ReminderMetadataEditor({
  task,
  open,
  onOpenChange,
  children
}: {
  task: ReminderTask
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactElement
}) {
  const { token } = useAuth()
  const refresh = useRefreshReminderViews()
  const [minutes, setMinutes] = useState('')
  const [context, setContext] = useState('')
  useEffect(() => {
    if (open) {
      setMinutes(task.estimatedMinutes?.toString() || '')
      setContext(task.customFocusContext)
    }
  }, [open])
  const mutation = trpc.reminders.setTaskMetadata.useMutation({
    onSuccess: () => {
      onOpenChange(false)
      refresh()
    },
    onError: showError
  })
  const valid =
    !minutes ||
    (Number.isInteger(Number(minutes)) && Number(minutes) >= 1 && Number(minutes) <= 720)
  const save = () => {
    if (valid && !mutation.isLoading)
      mutation.mutate({
        token: token || '',
        taskId: task.id,
        estimatedMinutes: minutes ? Number(minutes) : null,
        focusContext: context
      })
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="tempo-reminder-popover tempo-reminder-details-popover"
        aria-label={'Tempo details for ' + task.text}
        onKeyDown={(event) => {
          if (event.metaKey && event.key === 'Enter') {
            event.preventDefault()
            save()
          }
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
        >
          <div className="tempo-reminder-popover-heading">
            <h4>Time &amp; focus context</h4>
            <p className="tempo-reminder-detail-title" title={task.text}>
              {task.text}
            </p>
          </div>
          <div className="tempo-reminder-form">
            <label className="tempo-reminder-field">
              <span>Work estimate</span>
              <div className="tempo-reminder-minutes">
                <Input
                  type="number"
                  min={1}
                  max={720}
                  step={1}
                  value={minutes}
                  onChange={(event) => setMinutes(event.target.value)}
                  placeholder="No estimate"
                  aria-invalid={!valid}
                />
                <span aria-hidden="true">min</span>
              </div>
            </label>
            {!valid && (
              <p className="tempo-reminder-field-error" role="status">
                Enter a whole number from 1 to 720 minutes.
              </p>
            )}
            <label className="tempo-reminder-field">
              <span>
                Focus context <small>Optional</small>
              </span>
              <Textarea
                rows={3}
                maxLength={1000}
                value={context}
                onChange={(event) => setContext(event.target.value)}
                placeholder="Leave blank to use this list’s context."
              />
            </label>
            <p className="tempo-reminder-field-help">
              {context.trim()
                ? 'Replaces the list context for this reminder.'
                : 'Uses the context from ' + task.listName + '.'}
            </p>
            {task.listFocusContext && (
              <details className="tempo-reminder-inherited">
                <summary>List context · {task.listName}</summary>
                <p>{task.listFocusContext}</p>
              </details>
            )}
          </div>
          <div className="tempo-reminder-popover-footer">
            <span className="tempo-reminder-local-note">Saved only in Tempo</span>
            <Button type="button" variant="ghost" size="xs" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="xs"
              disabled={!valid || mutation.isLoading}
              aria-keyshortcuts="Meta+Enter"
            >
              {mutation.isLoading ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
