import { CheckCircle2, CircleDashed, ExternalLink, Info, Sparkles } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

export type FirefoxCompanionState = 'not_detected' | 'connected' | 'cache_hit' | 'cache_miss'

const copy: Record<
  FirefoxCompanionState,
  { label: string; detail: string; tone: string; Icon: typeof CheckCircle2 }
> = {
  cache_hit: {
    label: 'Firefox companion · reused',
    detail:
      'Tempo recognized the same page and goal and reused its local decision. No OCR or Ollama request was needed.',
    tone: 'text-emerald-700 dark:text-emerald-300',
    Icon: Sparkles
  },
  cache_miss: {
    label: 'Firefox companion · new page',
    detail:
      'Firefox supplied bounded visible page context for local interpretation. Tempo falls back to one in-memory OCR capture when page text is unavailable.',
    tone: 'text-sky-700 dark:text-sky-300',
    Icon: CheckCircle2
  },
  connected: {
    label: 'Firefox companion connected',
    detail:
      'Tempo is receiving Firefox navigation events and ephemeral visible context. It can reuse local decisions when you return to the same page and goal.',
    tone: 'text-sky-700 dark:text-sky-300',
    Icon: CheckCircle2
  },
  not_detected: {
    label: 'Firefox companion unavailable',
    detail:
      'Tempo has not received a navigation event yet. Enable the Tempo Firefox companion, then activate a non-private Firefox tab. Tempo safely falls back to title-change capture when it is unavailable.',
    tone: 'text-muted-foreground',
    Icon: CircleDashed
  }
}

export function FirefoxCompanionStatus({ state }: { state: FirefoxCompanionState }) {
  const current = copy[state]
  const Icon = current.Icon
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="firefox-companion-status"
          className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${current.tone}`}
          aria-label={`${current.label}. Open Firefox companion details.`}
        >
          <Icon size={14} />
          <span className="hidden sm:inline">{current.label}</span>
          <Info size={13} className="opacity-65" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <div className="flex gap-2">
          <div className={`mt-0.5 ${current.tone}`}>
            <Icon size={16} />
          </div>
          <div>
            <p className="text-sm font-semibold">{current.label}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{current.detail}</p>
            {state === 'not_detected' && (
              <button
                type="button"
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                onClick={() => window.api?.openFirefoxRuntimeDebugging?.()}
                aria-label="Open Firefox extension debugging"
              >
                Open Firefox extension debugging
                <ExternalLink size={12} aria-hidden="true" />
              </button>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">
              Visible page text is processed on this Mac and discarded after classification. URLs
              and page text are never stored.
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
