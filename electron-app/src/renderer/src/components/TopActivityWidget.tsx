import { AnimatePresence, motion } from 'framer-motion'
import React, { useEffect, useState } from 'react'
import { Card } from '../components/ui/card'
import type { ProcessedEventBlock } from './DashboardView'
import AppIcon from './AppIcon'
import { Skeleton } from './ui/skeleton'

interface WebsiteUsage {
  key: string
  title: string
  summary?: string
  durationMs: number
}

interface AppUsage {
  name: string
  durationMs: number
  percentage?: number
  websites?: WebsiteUsage[]
  isExpanded?: boolean
}

interface TopActivityWidgetProps {
  processedEvents: ProcessedEventBlock[] | null
  isLoadingEvents: boolean
}

const formatDuration = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  return hours > 0 ? `${hours}h ${minutes}m` : minutes > 0 ? `${minutes}m` : `${totalSeconds}s`
}

const TopActivityWidget: React.FC<TopActivityWidgetProps> = ({ processedEvents, isLoadingEvents }) => {
  const [topApps, setTopApps] = useState<AppUsage[]>([])
  const [totalTrackedTimeMs, setTotalTrackedTimeMs] = useState(0)

  useEffect(() => {
    if (!processedEvents?.length) {
      setTopApps([])
      setTotalTrackedTimeMs(0)
      return
    }

    const apps = new Map<string, { durationMs: number; websites: Map<string, WebsiteUsage> }>()
    let total = 0
    for (const block of processedEvents) {
      total += block.durationMs
      const appName = block.ownerName
      const entry = apps.get(appName) || { durationMs: 0, websites: new Map<string, WebsiteUsage>() }
      entry.durationMs += block.durationMs
      if (block.originalEvent.type === 'browser' || block.originalEvent.browser === 'firefox') {
        const previous = entry.websites.get(block.activityKey)
        entry.websites.set(block.activityKey, {
          key: block.activityKey,
          title: block.activityLabel,
          summary: block.activitySummary,
          durationMs: (previous?.durationMs || 0) + block.durationMs
        })
      }
      apps.set(appName, entry)
    }

    const ordered = [...apps.entries()]
      .map(([name, entry]) => ({
        name,
        durationMs: entry.durationMs,
        websites: entry.websites.size ? [...entry.websites.values()].sort((a, b) => b.durationMs - a.durationMs) : undefined,
        isExpanded: false
      }))
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, 5)
    const max = ordered[0]?.durationMs || 0
    setTopApps(ordered.map((app) => ({ ...app, percentage: max ? Math.round((app.durationMs / max) * 100) : 0 })))
    setTotalTrackedTimeMs(total)
  }, [processedEvents])

  const toggleExpansion = (appName: string) =>
    setTopApps((apps) => apps.map((app) => (app.name === appName ? { ...app, isExpanded: !app.isExpanded } : app)))

  if (isLoadingEvents && !topApps.length) {
    return <Card className="p-4"><Skeleton className="h-20 w-full" /></Card>
  }
  if (!topApps.length) {
    return <Card className="p-4 text-sm text-muted-foreground">No significant activity tracked yet today.</Card>
  }

  return (
    <Card className="p-4">
      <ul className="space-y-3">
        {topApps.map((app, index) => (
          <motion.li key={app.name} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
            <div className={`${app.websites ? 'cursor-pointer hover:bg-accent' : ''} rounded-lg p-2`} onClick={() => app.websites && toggleExpansion(app.name)}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center space-x-3 min-w-0">
                  <AppIcon appName={app.name} size={20} className="flex-shrink-0" />
                  <span className="text-sm font-medium truncate">{app.name}</span>
                  {app.websites && <span className="text-xs text-muted-foreground">{app.isExpanded ? '▼' : '▶'}</span>}
                </div>
                <span className="text-sm text-secondary-foreground">{formatDuration(app.durationMs)}</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-blue-500 to-purple-500" style={{ width: `${app.percentage}%` }} /></div>
            </div>
            <AnimatePresence>
              {app.isExpanded && app.websites && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="ml-6 mt-2 space-y-2 border-l-2 border-primary/30 pl-3">
                  {app.websites.map((site) => (
                    <div key={site.key} className="flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{site.title}</p>
                        {site.summary && <p className="text-muted-foreground truncate">{site.summary}</p>}
                      </div>
                      <span className="text-muted-foreground flex-shrink-0">{formatDuration(site.durationMs)}</span>
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground border-t pt-4 mt-4">Total actively tracked time today: {formatDuration(totalTrackedTimeMs)}</p>
    </Card>
  )
}

export default TopActivityWidget
