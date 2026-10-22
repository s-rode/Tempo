import { ChevronDownIcon } from '@radix-ui/react-icons'
import { AnimatePresence, motion } from 'framer-motion'
import type { Category } from 'shared'
import type { ActivityItem, ProcessedCategory } from '../lib/activityProcessing'
import { formatDuration } from '../lib/activityByCategoryWidgetHelpers'
import { ActivityIcon } from './ui/ActivityIcon'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'

interface ActivityListProps {
  activities: ActivityItem[]
  currentCategory: ProcessedCategory
  allUserCategories: Category[] | undefined
  handleMoveActivity: (activity: ActivityItem, targetCategoryId: string) => void
  isMovingActivity: boolean
  isShowMore: boolean
  onToggleShowMore: () => void
  hoveredActivityKey: string | null
  setHoveredActivityKey: (key: string | null) => void
  openDropdownActivityKey: string | null
  setOpenDropdownActivityKey: (key: string | null) => void
}

export function ActivityList(props: ActivityListProps) {
  const main = props.activities.filter((activity) => activity.durationMs >= 60000)
  const brief = main.length
    ? props.activities.filter((activity) => activity.durationMs < 60000)
    : []
  const targets = (props.allUserCategories || []).filter(
    (category) => category._id !== props.currentCategory.id
  )
  const rows = (activities: ActivityItem[]) =>
    activities.map((activity) => {
      const key = `${activity.identifier}:${activity.eventIds.join(':')}`
      const expanded = props.hoveredActivityKey === key || props.openDropdownActivityKey === key
      return (
        <div
          key={key}
          className="group flex w-full items-center justify-between gap-2 rounded-md px-2 py-0.5 hover:bg-muted"
          onMouseEnter={() => props.setHoveredActivityKey(key)}
          onMouseLeave={() => props.setHoveredActivityKey(null)}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <ActivityIcon
              appName={activity.ownerName || activity.identifier}
              size={16}
              itemType={activity.itemType}
              color={props.currentCategory.color}
            />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="truncate text-sm text-muted-foreground" tabIndex={0}>
                    {activity.name}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-sm break-words">
                  <p>{activity.name}</p>
                  <p>Identifier: {activity.identifier}</p>
                  {activity.originalUrl && <p>URL: {activity.originalUrl}</p>}
                  <p>
                    Type: {activity.itemType} · Duration: {formatDuration(activity.durationMs)}
                  </p>
                  {activity.summary && <p>{activity.summary}</p>}
                  {activity.reasoning && <p>Why this category: {activity.reasoning}</p>}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!expanded && (
              <span className="text-sm text-muted-foreground">
                {formatDuration(activity.durationMs)}
              </span>
            )}
            {targets.length === 1 ? (
              <Button
                variant="outline"
                size="xs"
                disabled={props.isMovingActivity}
                className={expanded ? '' : 'sr-only focus:not-sr-only'}
                onClick={() => props.handleMoveActivity(activity, targets[0]._id)}
              >
                {props.isMovingActivity ? 'Moving…' : `Move: ${targets[0].name}`}
              </Button>
            ) : (
              targets.length > 1 && (
                <DropdownMenu
                  open={props.openDropdownActivityKey === key}
                  onOpenChange={(open) => props.setOpenDropdownActivityKey(open ? key : null)}
                >
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="xs"
                      className={expanded ? '' : 'sr-only focus:not-sr-only'}
                      aria-label={`Move ${activity.name} to another category`}
                    >
                      Move to…
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {targets.map((target) => (
                      <DropdownMenuItem
                        key={target._id}
                        disabled={props.isMovingActivity}
                        onSelect={() => props.handleMoveActivity(activity, target._id)}
                      >
                        {target.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )
            )}
          </div>
        </div>
      )
    })
  return (
    <>
      {rows(main.length ? main : props.activities)}
      {brief.length > 0 && (
        <Button
          variant="link"
          size="sm"
          className="justify-start text-xs"
          onClick={props.onToggleShowMore}
          aria-expanded={props.isShowMore}
        >
          {props.isShowMore ? 'Show less' : `Show ${brief.length} more`}
          <ChevronDownIcon className={`ml-1 size-4 ${props.isShowMore ? 'rotate-180' : ''}`} />
        </Button>
      )}
      <AnimatePresence>
        {props.isShowMore && brief.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            {rows(brief)}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
