import { CheckCircle2, CircleDashed, Copy, ExternalLink, FolderOpen, Info, Sparkles } from 'lucide-react'
import { useState } from 'react'
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
  const [addressCopied, setAddressCopied] = useState(false)

  const copyDebuggingAddress = () => {
    window.api?.copyFirefoxRuntimeDebuggingAddress?.()
    setAddressCopied(true)
    window.setTimeout(() => setAddressCopied(false), 2_000)
  }
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
              <div className="mt-3 space-y-2 border-t border-border pt-3 text-xs">
                <p className="font-medium text-foreground">Install the companion in Firefox</p>
                <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
                  <li>Open Firefox, then paste the copied address in its address bar.</li>
                  <li>
                    Select <span className="font-medium text-foreground">This Firefox</span> →{' '}
                    <span className="font-medium text-foreground">Load Temporary Add-on…</span>.
                  </li>
                  <li>Reveal and unzip the Tempo package, then select its <code>manifest.json</code>.</li>
                </ol>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <button
                    type="button"
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => void window.api?.openFirefoxRuntimeDebugging?.()}
                    aria-label="Open Firefox"
                  >
                    Open Firefox
                    <ExternalLink size={12} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={copyDebuggingAddress}
                    aria-label="Copy Firefox extension debugging address"
                  >
                    <Copy size={12} aria-hidden="true" />
                    {addressCopied ? 'Copied' : 'Copy address'}
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => window.api?.revealFirefoxCompanionPackage?.()}
                    aria-label="Reveal Tempo Firefox companion package in Finder"
                  >
                    <FolderOpen size={12} aria-hidden="true" />
                    Reveal package
                  </button>
                </div>
              </div>
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
