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

  @MainActor
  static func testBatteryLifecycle() {
    func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
      guard condition() else {
        fputs("Notch battery lifecycle test failed: \(message)\n", stderr)
        exit(1)
      }
    }
    let panel = TempoNotchPanel(contentRect: CGRect(x: -5000, y: -5000, width: 520, height: 194),
                                styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.isReleasedWhenClosed = false
    let controller = NotchController(panel: panel, geometry: resolveGeometry())
    panel.orderBack(nil)
    defer { controller.hide() }

    func update(_ changes: [String: Any]) {
      let data = try! JSONEncoder().encode(controller.status)
      var payload = try! JSONSerialization.jsonObject(with: data) as! [String: Any]
      changes.forEach { payload[$0.key] = $0.value }
      controller.apply(status: try! JSONDecoder().decode(StatusPayload.self,
        from: JSONSerialization.data(withJSONObject: payload)))
    }

    controller.refreshBackgroundWork()
    expect(controller.globalPointerMonitor != nil && controller.localPointerMonitor != nil,
           "mouse events work without requesting Accessibility")
    expect(controller.pointerTimer == nil, "ordinary hover has no 60 Hz polling timer")
    expect(controller.displayClockTimer == nil, "static initial state does not redraw each second")
    let originalGlobal = controller.globalPointerMonitor as AnyObject?
    controller.refreshBackgroundWork()
    expect(originalGlobal === (controller.globalPointerMonitor as AnyObject?), "repeated status does not duplicate monitors")

    let time = Date().timeIntervalSince1970 * 1000
    update(["productiveClock": ["accumulatedMs": 1200, "runningSinceMs": time]])
    expect(controller.displayClockTimer != nil, "live pills retain their second clock")
    var ticks = 0
    let subscription = controller.$now.dropFirst().sink { _ in ticks += 1 }
    RunLoop.current.run(until: Date().addingTimeInterval(1.15))
    expect(ticks >= 1 && ticks <= 2, "live clock still advances once per second")
    controller.setPillsSuppressed(true)
    expect(controller.displayClockTimer == nil, "covered pills do not redraw while collapsed")
    ticks = 0
    RunLoop.current.run(until: Date().addingTimeInterval(1.1))
    expect(ticks == 0, "covered idle state publishes no clock ticks")
    controller.setExpanded(true)
    expect(controller.displayClockTimer != nil, "expanded live detail clock resumes immediately")
    controller.setExpanded(false)
    controller.setPillsSuppressed(false)
    expect(controller.displayClockTimer != nil, "restoring pills resumes their clock")

    update(["suspensionReasons": ["manual_pause"], "trackingState": "paused", "suspendedAtMs": time,
            "pausedUntilMs": time + 60000])
    expect(controller.displayClockTimer == nil, "collapsed frozen clocks stay asleep")
    expect(controller.globalPointerMonitor != nil, "paused controls remain interactive")
    controller.setExpanded(true)
    expect(controller.displayClockTimer != nil, "visible pause countdown keeps ticking")
    update(["suspensionReasons": ["screen_locked"]])
    expect(controller.displayClockTimer == nil && controller.globalPointerMonitor == nil &&
           controller.localPointerMonitor == nil && controller.pointerTimer == nil,
           "locking removes all helper interaction and clock wakeups")
    update(["suspensionReasons": [], "trackingState": "active", "suspendedAtMs": NSNull(),
            "runtimeMode": "custom", "phaseRemainingMs": 60000, "phaseRemainingSampledAtMs": time])
    expect(controller.globalPointerMonitor != nil && controller.displayClockTimer != nil,
           "unlock restores interaction and live clocks")
    controller.setExpanded(false)
    controller.setPillsSuppressed(true)
    expect(controller.displayClockTimer != nil, "compact phase progress stays live even with covered pills")
    controller.hide()
    expect(controller.globalPointerMonitor == nil && controller.localPointerMonitor == nil &&
           controller.pointerTimer == nil && controller.displayClockTimer == nil,
           "hide cleans up timers and both event monitors")
    update(["suspensionReasons": ["system_sleep"]])
    controller.show()
    expect(controller.globalPointerMonitor == nil && controller.displayClockTimer == nil,
           "show during sleep does not restart background work")
    withExtendedLifetime(subscription) {}
    print("Notch battery lifecycle tests passed (60 Hz pointer polling eliminated; live clock cadence preserved)")
  }
}

extension NotchOverlapMonitor {
  @MainActor
  static func testBatteryLifecycle() {
    func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
      guard condition() else {
        fputs("Overlap battery lifecycle test failed: \(message)\n", stderr)
        exit(1)
      }
    }
    var processes = Set<Int32>()
    let monitor = NotchOverlapMonitor(onChange: { _ in }, runningProcessIDs: { processes })
    monitor.start()
    expect(monitor.started && monitor.timer == nil && !monitor.observers.isEmpty,
           "absent watched app uses lifecycle events with no polling")
    processes = [Int32.max]
    monitor.refreshProcessIDs()
    expect(monitor.timer != nil, "watched app launch restores original 100 ms sampling")
    processes = []
    monitor.refreshProcessIDs()
    monitor.sample()
    expect(monitor.timer == nil, "watched app termination removes polling")
    _ = monitor.policy.update(overlapping: true, now: ProcessInfo.processInfo.systemUptime)
    monitor.sample()
    expect(monitor.timer != nil && monitor.policy.suppressed, "termination preserves the clear grace period")
    RunLoop.current.run(until: Date().addingTimeInterval(0.5))
    expect(monitor.timer == nil && !monitor.policy.suppressed, "grace completion restores pills and stops polling")
    monitor.stop()
    expect(!monitor.started && monitor.timer == nil && monitor.observers.isEmpty, "stop removes lifecycle observers")
    monitor.start()
    expect(monitor.timer == nil && !monitor.observers.isEmpty, "hidden monitor can restart without polling")
    monitor.stop()
    print("Overlap battery lifecycle tests passed (no 10 Hz polling while watched app is absent)")
  }
}

@main
struct NotchControllerSuppressionTestMain {
  @MainActor
  static func main() {
    NSApplication.shared.setActivationPolicy(.prohibited)
    NotchController.testPillSuppression()
    NotchController.testBatteryLifecycle()
    NotchOverlapMonitor.testBatteryLifecycle()
  }
}
