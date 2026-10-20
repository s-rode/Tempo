// Appended to the helper definitions by test-notch-controller.sh so this
// extension can inspect pending work without adding a production testing API.
extension NotchController {
  @MainActor
  static func testPillSuppression() {
    func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
      guard condition() else {
        fputs("Notch controller suppression test failed: \(message)\n", stderr)
        exit(1)
      }
    }
    let panel = TempoNotchPanel(contentRect: CGRect(x: -5000, y: -5000, width: 520, height: 194),
                                styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.isReleasedWhenClosed = false
    let controller = NotchController(panel: panel, geometry: resolveGeometry())
    let host = PassthroughHostingView(rootView: AnyView(EmptyView()), controller: controller)
    controller.host = host
    panel.contentView = host
    panel.orderBack(nil)
    defer { panel.orderOut(nil) }

    controller.hoverChanged(true)
    let pendingOpen = controller.hoverOpenWork
    expect(pendingOpen != nil, "hover starts an opening delay")
    controller.setPillsSuppressed(true)
    expect(pendingOpen?.isCancelled == true, "overlap cancels pending hover opening")
    expect(controller.pillsSuppressed && controller.hoveredPill == nil, "hidden pills have no highlight")
    expect(panel.ignoresMouseEvents, "hidden pills cannot intercept input")
    expect(controller.interactionRects(isFlipped: host.isFlipped).isEmpty, "hidden collapsed overlay has no targets")

    controller.setPillsSuppressed(false)
    controller.setExpanded(true)
    controller.isHovering = true // Simulate entry from a number before overlap.
    controller.setPillsSuppressed(true)
    expect(controller.hoverCloseWork == nil || controller.hoverCloseWork?.isCancelled == true,
           "losing a covered pill does not schedule popup closure")
    RunLoop.current.run(until: Date().addingTimeInterval(0.45))
    expect(controller.expanded, "open popup survives the normal closing deadline")

    controller.chooserOpen = true
    controller.pausePickerOpen = true
    controller.presentedTransitionNotice = FocusTransitionNotice(
      id: "test", kind: "break_started", runId: "run", phaseId: "phase", phaseIndex: 1,
      occurredAtMs: 0, goal: "Test", breakDurationMs: 60_000
    )
    controller.presentedDistractionNotice = DistractionAttentionNotice(
      id: "notice", eventId: "event", title: "Test", body: "Test", occurredAtMs: 0
    )
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    let statusBefore = try! encoder.encode(controller.status)
    controller.setPillsSuppressed(false)
    controller.setPillsSuppressed(true)
    expect(controller.expanded && controller.chooserOpen && controller.pausePickerOpen,
           "suppression preserves open controls")
    expect(controller.presentedTransitionNotice != nil && controller.presentedDistractionNotice != nil,
           "suppression preserves automatic notices")
    expect(try! encoder.encode(controller.status) == statusBefore, "tracking and timer state are unchanged")
    print("Notch controller suppression tests passed")
  }
}

@main
struct NotchControllerSuppressionTestMain {
  @MainActor
  static func main() {
    NSApplication.shared.setActivationPolicy(.prohibited)
    NotchController.testPillSuppression()
  }
}
