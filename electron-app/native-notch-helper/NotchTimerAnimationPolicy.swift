import Foundation

/** The unit currently visible in a compact notch timer pill. */
enum NotchTimerPrecision: Equatable {
  case seconds
  case minutes
}

/**
 The smallest state needed to decide whether a text update represents one
 continuous clock step rather than a reset, recovery, or presentation change.
 */
struct NotchTimerAnimationSnapshot: Equatable {
  let value: Int
  let precision: NotchTimerPrecision
  let isFrozen: Bool
}

/**
 A native numeric-text transition should only be used for adjacent displayed
 values. This keeps lock/wake recovery, session resets, and format changes from
 rolling through misleading intermediate digits.
 */
func shouldAnimateNotchTimerTransition(
  from previous: NotchTimerAnimationSnapshot?,
  to next: NotchTimerAnimationSnapshot,
  reduceMotion: Bool,
  animationsEnabled: Bool = true
) -> Bool {
  guard animationsEnabled,
        !reduceMotion,
        let previous,
        !previous.isFrozen,
        !next.isFrozen,
        previous.precision == next.precision else {
    return false
  }

  return abs(next.value - previous.value) == 1
}
