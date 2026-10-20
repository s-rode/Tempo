import CoreGraphics
import Foundation

@main
struct NotchOverlapPolicyTests {
  private static func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else {
      fputs("Notch overlap policy test failed: \(message)\n", stderr)
      exit(1)
    }
  }

  static func main() {
    // Use point coordinates, including displays left of and above the primary.
    for offset in [CGPoint.zero, CGPoint(x: -1512, y: 0), CGPoint(x: 0, y: -982)] {
      let notch = CGRect(x: 663 + offset.x, y: offset.y, width: 185, height: 33)
      let pills = [
        CGRect(x: 577 + offset.x, y: 6 + offset.y, width: 78, height: 21),
        CGRect(x: 856 + offset.x, y: 6 + offset.y, width: 78, height: 21),
      ]
      func overlaps(_ bounds: CGRect, pid: Int32 = 42, layer: Int = 26, alpha: Double = 1) -> Bool {
        NotchOverlapPolicy.overlaps(
          windows: [NotchOverlapWindow(processID: pid, bounds: bounds, layer: layer, alpha: alpha)],
          processIDs: [42], minimumLayer: 24, notch: notch, pills: pills
        )
      }
      let expanded = CGRect(x: 404 + offset.x, y: offset.y, width: 704, height: 326)
      expect(!overlaps(notch), "collapsed notch leaves pills visible")
      expect(overlaps(expanded), "expanded notch hides pills")
      expect(overlaps(CGRect(x: pills[0].minX, y: notch.minY, width: notch.maxX - pills[0].minX, height: 33)), "left-only overlap hides both")
      expect(overlaps(CGRect(x: notch.minX, y: notch.minY, width: pills[1].maxX - notch.minX, height: 33)), "right-only overlap hides both")
      expect(!overlaps(pills[0]), "unrelated window near pill must also intersect camera")
      expect(!overlaps(expanded, pid: 99), "other processes ignored")
      expect(!overlaps(expanded, layer: 0), "normal settings windows ignored")
      expect(!overlaps(expanded, alpha: 0), "transparent helpers ignored")
      expect(!overlaps(expanded.offsetBy(dx: 3000, dy: 0)), "other display ignored")
      expect(!NotchOverlapPolicy.overlaps(windows: [], processIDs: [], minimumLayer: 24, notch: notch, pills: pills), "quit app is clear")
    }

    let converted = NotchOverlapPolicy.quartzRect(
      fromAppKit: CGRect(x: -800, y: 1100, width: 78, height: 21), primaryDisplayHeight: 982
    )
    expect(converted == CGRect(x: -800, y: -139, width: 78, height: 21), "global AppKit-to-Quartz conversion preserves negative origins and point sizes")

    var policy = NotchOverlapPolicy()
    expect(!policy.update(overlapping: false, now: 1), "starts visible")
    expect(policy.update(overlapping: true, now: 2), "first overlap hides immediately")
    expect(policy.update(overlapping: false, now: 3), "first clear sample starts grace period")
    expect(policy.update(overlapping: false, now: 3.299), "clear period has not elapsed")
    expect(!policy.update(overlapping: false, now: 3.301), "restores after 300 ms")
    expect(policy.update(overlapping: true, now: 4), "new notification hides")
    expect(policy.update(overlapping: false, now: 5), "closing starts grace")
    expect(policy.update(overlapping: true, now: 5.2), "repeated notification resets grace")
    expect(policy.update(overlapping: false, now: 5.3), "clear starts again")
    expect(policy.update(overlapping: false, now: 5.5), "old clear deadline does not restore")
    expect(!policy.update(overlapping: false, now: 5.601), "new clear deadline restores")
    expect(policy.update(overlapping: true, now: 6), "overlap hides again")
    expect(!policy.update(overlapping: nil, now: 6.1), "unavailable metadata fails open immediately")

    var activation = NotchPillActivation()
    expect(activation.canActivate, "ordinary numbers retain hover activation")
    activation.setSuppressed(true)
    activation.observePointer(overPill: true)
    expect(!activation.canActivate, "hidden numbers cannot schedule or complete hover opening")
    activation.observePointer(overPill: false)
    expect(!activation.canActivate, "leaving while hidden does not rearm")
    activation.setSuppressed(false)
    activation.observePointer(overPill: true)
    expect(!activation.canActivate, "restoration under stationary pointer stays disarmed")
    activation.observePointer(overPill: false)
    activation.observePointer(overPill: true)
    expect(activation.canActivate, "fresh exit and entry rearms")
    activation.setSuppressed(true)
    activation.setSuppressed(false)
    activation.observePointer(overPill: false)
    expect(activation.canActivate, "restoring outside a pill permits its next entry")

    let layout = NotchInteractionLayout(panelWidth: 520, panelHeight: 194, notchWidth: 185,
                                      menuBarHeight: 33, pillWidth: 78, notchGap: 8, expandedHeight: 192)
    for flipped in [false, true] {
      expect(layout.interactionRects(expanded: false, isFlipped: flipped, pillsSuppressed: true).isEmpty,
             "hidden collapsed pills have no hit regions")
      let regions = layout.interactionRects(expanded: true, isFlipped: flipped, pillsSuppressed: true)
      expect(regions.count == 1, "open popup retains its content hit region")
      expect(regions[0].height == 159, "suppression does not resize open popup")
      for pill in layout.pillRects(isFlipped: flipped) {
        expect(!regions.contains { $0.contains(CGPoint(x: pill.midX, y: pill.midY)) }, "hidden pills excluded from expanded hit regions")
      }
    }
    print("Notch overlap policy tests passed")
  }
}
