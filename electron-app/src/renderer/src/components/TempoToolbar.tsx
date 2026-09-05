import { PanelLeft, Settings, Sparkles } from 'lucide-react'
import { FocusRuntimeControls, type FocusRuntimeSnapshot } from './FocusRuntimeControls'
import type { TempoPage } from './TempoSidebar'
import { Button } from './ui/button'

const labels: Record<TempoPage, { title: string; subtitle: string }> = {
  dashboard: { title: 'Today', subtitle: 'Your activity, at a glance' },
  analysis: { title: 'Analysis', subtitle: 'Local activity patterns' },
  settings: { title: 'Settings', subtitle: 'Tempo preferences' }
}

export function TempoToolbar({ page, sidebarCollapsed, onToggleSidebar, onShowSettings, runtime, focusOpenRequest, focusQuickActionRequest }: {
  page: TempoPage
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  onShowSettings: () => void
  runtime: FocusRuntimeSnapshot | undefined
  focusOpenRequest: number
  focusQuickActionRequest: number
}) {
  const current = labels[page]
  return <header className={`tempo-toolbar tempo-toolbar-drag-region flex shrink-0 items-center gap-3 px-4${sidebarCollapsed ? ' tempo-toolbar--sidebar-collapsed' : ''}`}>
    <Button variant="ghost" size="xs" className="tempo-toolbar-icon" onClick={onToggleSidebar} aria-label="Toggle sidebar"><PanelLeft size={17} /></Button>
    <div className="min-w-0 flex-1"><div className="flex items-baseline gap-2"><h1 className="text-[15px] font-semibold tracking-tight">{current.title}</h1><span className="hidden text-xs text-muted-foreground sm:inline">{current.subtitle}</span></div></div>
    {page !== 'settings' && <div className="hidden items-center gap-1.5 text-xs text-muted-foreground lg:flex"><Sparkles size={14} className="text-emerald-600 dark:text-emerald-400" /><span>Local and private</span></div>}
    <FocusRuntimeControls runtime={runtime} openRequest={focusOpenRequest} quickActionRequest={focusQuickActionRequest} />
    {page !== 'settings' && <Button variant="ghost" size="xs" className="tempo-toolbar-icon" onClick={onShowSettings} aria-label="Open Settings"><Settings size={17} /></Button>}
  </header>
}
