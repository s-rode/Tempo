import { BarChart3, CalendarDays, ChevronLeft, CircleDot, MonitorCog, Settings } from 'lucide-react'
import type { FirefoxCompanionState } from './FirefoxCompanionStatus'
import { FirefoxCompanionStatus } from './FirefoxCompanionStatus'

export type TempoPage = 'dashboard' | 'analysis' | 'settings'

const entries: Array<{ page: TempoPage; label: string; Icon: typeof CalendarDays }> = [
  { page: 'dashboard', label: 'Today', Icon: CalendarDays },
  { page: 'analysis', label: 'Analysis', Icon: BarChart3 },
  { page: 'settings', label: 'Settings', Icon: Settings }
]

export function TempoSidebar({ activePage, onNavigate, collapsed, onCollapse, firefoxState }: {
  activePage: TempoPage
  onNavigate: (page: TempoPage) => void
  collapsed: boolean
  onCollapse: () => void
  firefoxState: FirefoxCompanionState
}) {
  if (collapsed) return null
  return (
    <aside className="tempo-sidebar flex min-h-0 flex-col px-2 pb-3 pt-10" aria-label="Tempo navigation">
      <div className="mb-2 flex items-center justify-end px-2"><button type="button" onClick={onCollapse} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Hide sidebar"><ChevronLeft size={15} /></button></div>
      <nav className="space-y-0.5" aria-label="Primary navigation">
        {entries.map(({ page, label, Icon }) => <button key={page} type="button" className="tempo-sidebar-item" data-active={activePage === page} onClick={() => onNavigate(page)} aria-current={activePage === page ? 'page' : undefined}><Icon size={16} strokeWidth={1.8} /><span>{label}</span></button>)}
      </nav>
      <div className="mt-auto space-y-2 border-t pt-3">
        <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground"><MonitorCog size={14} /><span>Monitoring active</span></div>
        <FirefoxCompanionStatus state={firefoxState} />
        <div className="flex items-center gap-2 px-2 text-[11px] text-muted-foreground"><CircleDot size={12} /><span>Local-only activity data</span></div>
      </div>
    </aside>
  )
}
