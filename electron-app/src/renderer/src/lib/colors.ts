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
