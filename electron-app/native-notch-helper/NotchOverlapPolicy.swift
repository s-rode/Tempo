import CoreGraphics
import Foundation

struct NotchOverlapWindow {
  let processID: Int32
  let bounds: CGRect
  let layer: Int
  let alpha: Double
}

struct NotchOverlapPolicy {
  private(set) var suppressed = false
  private var clearSince: TimeInterval?

  static func quartzRect(fromAppKit rect: CGRect, primaryDisplayHeight: CGFloat) -> CGRect {
    CGRect(x: rect.minX, y: primaryDisplayHeight - rect.maxY, width: rect.width, height: rect.height)
  }

  static func overlaps(
    windows: [NotchOverlapWindow], processIDs: Set<Int32>, minimumLayer: Int,
    notch: CGRect, pills: [CGRect]
  ) -> Bool {
    windows.contains { window in
      processIDs.contains(window.processID) && window.layer >= minimumLayer && window.alpha > 0
        && window.bounds.intersects(notch) && pills.contains { window.bounds.intersects($0) }
    }
  }

  /// nil means metadata is unavailable. Fail open immediately in that case.
  mutating func update(overlapping: Bool?, now: TimeInterval) -> Bool {
    guard let overlapping else {
      suppressed = false
      clearSince = nil
      return false
    }
    if overlapping {
      suppressed = true
      clearSince = nil
    } else if suppressed {
      if clearSince == nil { clearSince = now }
      if now - (clearSince ?? now) >= 0.3 {
        suppressed = false
        clearSince = nil
      }
    }
    return suppressed
  }
}

/// A restored timer must not open underneath a stationary pointer.
struct NotchPillActivation {
  private(set) var suppressed = false
  private var requiresFreshEntry = false
  var canActivate: Bool { !suppressed && !requiresFreshEntry }

  mutating func setSuppressed(_ value: Bool) {
    suppressed = value
    requiresFreshEntry = true
  }

  mutating func observePointer(overPill: Bool) {
    if !suppressed && !overPill { requiresFreshEntry = false }
  }
}
