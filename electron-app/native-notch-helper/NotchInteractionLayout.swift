import CoreGraphics
import Foundation

/// All coordinates originate at the top of the panel, then convert to the
/// hosting view's coordinate system. The camera strip never belongs to Tempo.
struct NotchInteractionLayout {
  let panelWidth: CGFloat
  let panelHeight: CGFloat
  let notchWidth: CGFloat
  let menuBarHeight: CGFloat
  let pillWidth: CGFloat
  let notchGap: CGFloat
  let expandedHeight: CGFloat

  private func rect(x: CGFloat, top: CGFloat, width: CGFloat, height: CGFloat, isFlipped: Bool) -> CGRect {
    CGRect(x: x, y: isFlipped ? top : panelHeight - top - height, width: width, height: height)
  }

  func pillRects(isFlipped: Bool) -> [CGRect] {
    let notchLeft = (panelWidth - notchWidth) / 2
    return [
      rect(x: notchLeft - notchGap - pillWidth, top: 0, width: pillWidth, height: menuBarHeight, isFlipped: isFlipped),
      rect(x: notchLeft + notchWidth + notchGap, top: 0, width: pillWidth, height: menuBarHeight, isFlipped: isFlipped),
    ]
  }

  func interactionRects(expanded: Bool, isFlipped: Bool, pillsSuppressed: Bool = false) -> [CGRect] {
    var regions = pillsSuppressed ? [] : pillRects(isFlipped: isFlipped)
    if expanded && expandedHeight > menuBarHeight {
      regions.append(rect(
        x: 0, top: menuBarHeight, width: panelWidth,
        height: expandedHeight - menuBarHeight, isFlipped: isFlipped
      ))
    }
    return regions
  }
}
