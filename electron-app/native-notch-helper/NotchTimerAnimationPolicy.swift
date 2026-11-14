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

/**
 Decides when the collapsed or expanded notch next needs to redraw a live clock,
 so a display that only shows minutes (or a thin progress line) is not redrawn
 every second. Pure so the cadence can be tested without a window.
 */
enum NotchDisplayClockCadence {
  static let phaseProgressIntervalMs = 15_000
  private static let minimumDelayMs = 20
  /// Small positive slack so the tick lands just after a boundary, never before it.
  private static let boundarySlackMs = 20

  /// Milliseconds until the next visible change, or nil when nothing is live.
  /// - Parameters:
  ///   - secondsLive: a seconds-resolution clock is visible (expanded view, or
  ///     compact pills showing seconds).
  ///   - minutePillElapsedMs: elapsed time of each running compact pill that
  ///     displays whole minutes; each changes only when it crosses a minute.
  ///   - phaseProgressLive: only the thin session progress line is live.
  static func nextDelayMs(
    nowMs: Double,
    secondsLive: Bool,
    minutePillElapsedMs: [Double],
    phaseProgressLive: Bool
  ) -> Int? {
    var candidates: [Int] = []
    if secondsLive {
      candidates.append(1_000 - Int(nowMs.truncatingRemainder(dividingBy: 1_000)))
    }
    for elapsed in minutePillElapsedMs {
      let remainder = Int(max(0, elapsed).truncatingRemainder(dividingBy: 60_000))
      candidates.append(60_000 - remainder)
    }
    if phaseProgressLive { candidates.append(phaseProgressIntervalMs) }
    guard let soonest = candidates.min() else { return nil }
    return max(minimumDelayMs, soonest + boundarySlackMs)
  }
}
