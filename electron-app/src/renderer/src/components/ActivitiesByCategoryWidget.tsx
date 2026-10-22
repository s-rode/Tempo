import { memo, useMemo, useState } from 'react'
import type { Category } from 'shared'
import { useAuth } from '../contexts/AuthContext'
import { toast } from '../hooks/use-toast'
import { formatDuration } from '../lib/activityByCategoryWidgetHelpers'
import { processActivityEvents, type ActivityItem } from '../lib/activityProcessing'
import { SYSTEM_EVENT_NAMES } from '../lib/constants'
import { trpc } from '../utils/trpc'
import { ActivityList } from './ActivityList'
import type { ProcessedEventBlock } from './DashboardView'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import { Skeleton } from './ui/skeleton'

interface Props {
  processedEvents: ProcessedEventBlock[] | null
  isLoadingEvents: boolean
  refetchEvents: () => void
  selectedHour: number | null
  onHourSelect: (hour: number | null) => void
  selectedDay: Date | null
  onDaySelect: (day: Date | null) => void
}

function ActivitiesByCategoryWidget(props: Props) {
  const { token } = useAuth()
  const query = trpc.category.getCategories.useQuery(
    { token: token || '' },
    { enabled: Boolean(token) }
  )
  const categories = query.data as Category[] | undefined
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [hovered, setHovered] = useState<string | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const groups = useMemo(() => {
    const map = new Map((categories || []).map((category) => [category._id, category]))
    return processActivityEvents(
      (props.processedEvents || []).filter((event) => !SYSTEM_EVENT_NAMES.includes(event.name)),
      map
    ).sort((a, b) =>
      a.isProductive !== b.isProductive
        ? a.isProductive
          ? -1
          : 1
        : b.totalDurationMs - a.totalDurationMs
    )
  }, [categories, props.processedEvents])
  const move = trpc.activeWindowEvents.recategorizeBlock.useMutation({
    onSuccess: (_result, variables) => {
      props.refetchEvents()
      toast({
        title: 'Activity Moved',
        description: `Selected activity block moved to ${categories?.find((category) => category._id === variables.newCategoryId)?.name || 'another category'}.`
      })
    },
    onError: () =>
      toast({
        title: 'Could not move activity',
        description: 'Try again when the local service is available.',
        variant: 'destructive'
      })
  })
  const moveActivity = (activity: ActivityItem, categoryId: string) => {
    if (token && activity.eventIds.length)
      move.mutate({
        token,
        eventIds: activity.eventIds,
        newCategoryId: categoryId,
        correctionActionId: crypto.randomUUID(),
        rememberExactMatch: true
      })
  }
  return (
    <Card>
      <CardContent className="space-y-4 px-2 pt-2 pb-3">
        {props.selectedHour !== null && (
          <div className="flex items-center justify-between gap-2 rounded-sm bg-muted px-3 py-2">
            <span className="text-xs text-muted-foreground">
              Displaying activities for {String(props.selectedHour).padStart(2, '0')}:00–
              {String(props.selectedHour + 1).padStart(2, '0')}:00
            </span>
            <Button variant="outline" size="xs" onClick={() => props.onHourSelect(null)}>
              Show Full Day
            </Button>
          </div>
        )}
        {props.selectedDay && (
          <div className="flex items-center justify-between gap-2 rounded-sm bg-muted px-3 py-2">
            <span className="text-xs text-muted-foreground">
              Displaying activities for{' '}
              {props.selectedDay.toLocaleDateString(undefined, {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}
            </span>
            <Button variant="outline" size="xs" onClick={() => props.onDaySelect(null)}>
              Show Full Week
            </Button>
          </div>
        )}
        {query.isLoading || props.isLoadingEvents ? (
          Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-14 w-full" />)
        ) : groups.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">
            No activity data for the selected period, or no categories defined.
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.id}>
              <div className="sticky top-0 z-10 mb-1 flex items-center justify-between border-b border-border bg-card py-2 ml-2">
                <h3 className="flex min-w-0 items-center text-md font-semibold text-primary">
                  <span
                    className="mr-2 size-4 shrink-0 rounded-full"
                    style={{ backgroundColor: group.color }}
                  />
                  {group.name}
                </h3>
                <span className="text-md font-semibold">
                  {formatDuration(group.totalDurationMs)}
                </span>
              </div>
              <ActivityList
                activities={group.activities}
                currentCategory={group}
                allUserCategories={categories}
                handleMoveActivity={moveActivity}
                isMovingActivity={move.isLoading}
                isShowMore={Boolean(expanded[group.id])}
                onToggleShowMore={() =>
                  setExpanded((values) => ({ ...values, [group.id]: !values[group.id] }))
                }
                hoveredActivityKey={hovered}
                setHoveredActivityKey={setHovered}
                openDropdownActivityKey={menu}
                setOpenDropdownActivityKey={setMenu}
              />
            </section>
          ))
        )}
      </CardContent>
    </Card>
  )
}
export default memo(ActivitiesByCategoryWidget)
