import Color from 'color'

// Helper function to convert hex to rgba
export const hexToRgba = (hex: string, alpha: number): string => {
  if (!hex || !/^#[0-9A-F]{6}$/i.test(hex)) {
    // Basic hex validation
    return `rgba(128, 128, 128, ${alpha})` // Default gray if hex is invalid
  }
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export const processColor = (
  hex: string,
  options: { isDarkMode: boolean; saturation?: number; lightness?: number; opacity?: number }
): string => {
  const { isDarkMode, saturation = 1, lightness = 1, opacity = 1 } = options
  try {
    let color = Color(hex)

    if (saturation !== 1) {
      color = color.saturate(saturation - 1)
    }

    if (isDarkMode && lightness !== 1) {
      color = color.lighten(lightness - 1)
    } else if (!isDarkMode && lightness !== 1) {
      // Potentially darken in light mode if needed, for now we just lighten in dark mode
    }

    return color.alpha(opacity).string()
  } catch (e) {
    // Fallback for invalid color
    return `rgba(128, 128, 128, ${opacity})`
  }
}

export const getDarkerColor = (hex: string, amount = 0.5): string => {
  try {
    return Color(hex).darken(amount).string()
  } catch (e) {
    return '#000000' // fallback to black
  }
}

// Gruvbox's neutral accents, which read on light and dark surfaces alike.
const GRUVBOX = [
  { hue: 2, hex: '#cc241d' },
  { hue: 24, hex: '#d65d0e' },
  { hue: 40, hex: '#d79921' },
  { hue: 60, hex: '#98971a' },
  { hue: 122, hex: '#689d6a' },
  { hue: 183, hex: '#458588' },
  { hue: 330, hex: '#b16286' }
]

/**
 * The Today page draws category colours from the gruvbox palette, so they sit
 * with the focused, distracted and uncertain accents.  Each category keeps its
 * own hue family: the stored colour maps to the nearest gruvbox accent.
 */
export const gruvboxCategoryColor = (hex?: string | null): string => {
  if (!hex) return 'var(--day-uncertain)'
  try {
    const [hue, saturation] = Color(hex).hsl().array()
    if (saturation < 15) return '#928374'
    const distance = (value: number) => Math.min(Math.abs(value - hue), 360 - Math.abs(value - hue))
    return [...GRUVBOX].sort((left, right) => distance(left.hue) - distance(right.hue))[0].hex
  } catch {
    return 'var(--day-uncertain)'
  }
}
