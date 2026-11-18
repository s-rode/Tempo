import { displayMinutes } from '../../lib/taskEstimate'

interface DurationSliderProps {
  value: number
  onChange: (minutes: number) => void
  label: string
  /** Upper end of the slider. A longer value already chosen (e.g. a task estimate) stays reachable. */
  max?: number
  disabled?: boolean
}

/** A minutes slider with a live read-out, shared by every place a focus length is picked. */
export function DurationSlider({
  value,
  onChange,
  label,
  max = 120,
  disabled
}: DurationSliderProps) {
  const upper = Math.max(max, value)
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        className="tempo-strictness-slider min-w-0 flex-1 accent-primary"
        min={1}
        max={upper}
        step={1}
        value={value}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={displayMinutes(value)}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="w-14 shrink-0 text-right text-sm font-medium tabular-nums">
        {displayMinutes(value)}
      </span>
    </div>
  )
}
