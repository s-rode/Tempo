import { useId, type ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'

/**
 * Building blocks for the Settings page, modelled on macOS preference panes:
 * a titled section holds one glass group of rows, each row has its label and
 * description on the left and one control on the right.
 */

interface SettingsSectionProps {
  title: string
  description?: ReactNode
  /** Small controls aligned with the section title, such as an Add button. */
  actions?: ReactNode
  /** Muted note below the group. */
  footer?: ReactNode
  children: ReactNode
}

export function SettingsSection({
  title,
  description,
  actions,
  footer,
  children
}: SettingsSectionProps) {
  const id = useId()
  return (
    <section className="tempo-pref-section" aria-labelledby={id}>
      <div className="tempo-pref-section-header">
        <div className="min-w-0">
          <h2 id={id}>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="tempo-pref-control">{actions}</div>}
      </div>
      <div className="tempo-pref-group">{children}</div>
      {footer && <div className="tempo-pref-footnote">{footer}</div>}
    </section>
  )
}

interface SettingsRowProps {
  title: ReactNode
  description?: ReactNode
  /** Id of the control, so clicking the title focuses or toggles it. */
  htmlFor?: string
  control?: ReactNode
  /** Full-width content below the label, such as a list or an editor. */
  children?: ReactNode
  /** Dims the row when it depends on a setting that is off. */
  inactive?: boolean
  className?: string
}

export function SettingsRow({
  title,
  description,
  htmlFor,
  control,
  children,
  inactive = false,
  className
}: SettingsRowProps) {
  return (
    <div className={cn('tempo-pref-row', className)} data-inactive={inactive || undefined}>
      <div className="tempo-pref-row-main">
        <div className="tempo-pref-row-text">
          {htmlFor ? (
            <label htmlFor={htmlFor} className="tempo-pref-title">
              {title}
            </label>
          ) : (
            <div className="tempo-pref-title">{title}</div>
          )}
          {description && <div className="tempo-pref-description">{description}</div>}
        </div>
        {control && <div className="tempo-pref-control">{control}</div>}
      </div>
      {children && <div className="tempo-pref-row-body">{children}</div>}
    </div>
  )
}

/** A short muted message filling a group, for loading and empty states. */
export function SettingsPlaceholder({ children }: { children: ReactNode }) {
  return <div className="tempo-pref-placeholder">{children}</div>
}

interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
}

interface SettingsSegmentedProps<T extends string> {
  value: T
  options: ReadonlyArray<SegmentedOption<T>>
  onChange: (value: T) => void
  disabled?: boolean
  'aria-label': string
  className?: string
}

/** The glass segmented control used across Tempo, sized for a settings row. */
export function SettingsSegmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  className,
  'aria-label': ariaLabel
}: SettingsSegmentedProps<T>) {
  return (
    <ToggleGroup
      type="single"
      size="sm"
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn('tempo-glass-segmented tempo-pref-segmented', className)}
      onValueChange={(next) => next && next !== value && onChange(next as T)}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
