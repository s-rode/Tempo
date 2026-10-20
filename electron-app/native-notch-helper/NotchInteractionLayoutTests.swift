import CoreGraphics
import Foundation

@main
struct NotchInteractionLayoutTests {
  private static func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else {
      fputs("Notch interaction layout test failed: \(message)\n", stderr)
      exit(1)
    }
  }

  static func main() {
    for flipped in [false, true] {
      for notchWidth: CGFloat in [185, 210] {
        for menuHeight: CGFloat in [24, 38] {
          for height: CGFloat in [152, 166, 170, 192] {
            let layout = NotchInteractionLayout(
              panelWidth: 520, panelHeight: 194, notchWidth: notchWidth,
              menuBarHeight: menuHeight, pillWidth: 78, notchGap: 8, expandedHeight: height
            )
            func point(_ x: CGFloat, _ top: CGFloat) -> CGPoint {
              CGPoint(x: x, y: flipped ? top : 194 - top)
            }
            func contains(_ regions: [CGRect], _ x: CGFloat, _ top: CGFloat) -> Bool {
              regions.contains { $0.contains(point(x, top)) }
            }
            let collapsed = layout.interactionRects(expanded: false, isFlipped: flipped)
            let expanded = layout.interactionRects(expanded: true, isFlipped: flipped)
            let left = (520 - notchWidth) / 2
            expect(contains(collapsed, left - 8 - 39, menuHeight / 2), "left pill activates")
            expect(contains(collapsed, left + notchWidth + 8 + 39, menuHeight / 2), "right pill activates")
            for regions in [collapsed, expanded] {
              for x in [left + 1, 260, left + notchWidth - 1] {
                expect(!contains(regions, x, menuHeight / 2), "entire camera strip passes through")
              }
              expect(!contains(regions, left - 4, menuHeight / 2), "gap passes through")
              expect(!contains(regions, 10, menuHeight / 2), "empty menu-bar area passes through")
              expect(!contains(regions, 260, height + 1), "space below content passes through")
            }
            expect(!contains(collapsed, 260, menuHeight + 1), "collapsed content does not activate")
            expect(contains(expanded, 260, menuHeight + 1), "expanded content under camera is interactive")
            expect(contains(expanded, 1, height - 1), "expanded content covers full width and height")
            expect(!contains(expanded, -1, menuHeight + 1), "outside panel passes through")
          }
        }
      }
    }
    print("Notch interaction layout tests passed")
  }
}
