import AppKit
import CoreGraphics

/// Reads only process IDs and window geometry. No titles, pixels or event taps.
@MainActor
final class NotchOverlapMonitor {
  private var timer: DispatchSourceTimer?
  private var started = false
  private var observers: [NSObjectProtocol] = []
  private var processIDs = Set<Int32>()
  private var policy = NotchOverlapPolicy()
  private var notch = CGRect.zero
  private var pills: [CGRect] = []
  private let onChange: (Bool) -> Void
  private let runningProcessIDs: () -> Set<Int32>

  init(
    onChange: @escaping (Bool) -> Void,
    runningProcessIDs: @escaping () -> Set<Int32> = {
      Set(NSWorkspace.shared.runningApplications
        .filter { $0.bundleIdentifier == "com.vorssaint.utils" }
        .map { $0.processIdentifier })
    }
  ) {
    self.onChange = onChange
    self.runningProcessIDs = runningProcessIDs
  }

  func updateGeometry(notch: CGRect, pills: [CGRect]) {
    self.notch = notch
    self.pills = pills
    if started { sample() }
  }

  func start() {
    guard !started else { return }
    started = true
    let center = NSWorkspace.shared.notificationCenter
    for name in [NSWorkspace.didLaunchApplicationNotification, NSWorkspace.didTerminateApplicationNotification] {
      observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
        Task { @MainActor in
          guard let self, self.started else { return }
          self.refreshProcessIDs()
          self.sample()
        }
      })
    }
    refreshProcessIDs()
    sample()
  }

  private func startTimer() {
    guard timer == nil else { return }
    let source = DispatchSource.makeTimerSource(queue: .main)
    source.schedule(deadline: .now(), repeating: .milliseconds(100), leeway: .milliseconds(5))
    source.setEventHandler { [weak self] in self?.sample() }
    timer = source
    source.resume()
  }

  private func stopTimer() {
    timer?.setEventHandler {}
    timer?.cancel()
    timer = nil
  }

  func stop() {
    started = false
    stopTimer()
    let center = NSWorkspace.shared.notificationCenter
    observers.forEach(center.removeObserver)
    observers.removeAll()
    processIDs.removeAll()
    let wasSuppressed = policy.suppressed
    policy = NotchOverlapPolicy()
    if wasSuppressed { onChange(false) }
  }

  private func refreshProcessIDs() {
    processIDs = runningProcessIDs()
    // Workspace launch/termination events restart sampling immediately. There
    // is nothing to inspect while the only app we watch is absent.
    if processIDs.isEmpty { stopTimer() }
    else { startTimer() }
  }

  private func sample() {
    let overlap: Bool?
    if processIDs.isEmpty {
      overlap = false
    } else if let metadata = CGWindowListCopyWindowInfo(
      [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID
    ) as? [[String: Any]] {
      let windows: [NotchOverlapWindow] = metadata.compactMap { item in
        guard let pid = item[kCGWindowOwnerPID as String] as? Int32, processIDs.contains(pid),
              let dictionary = item[kCGWindowBounds as String] as? NSDictionary,
              let bounds = CGRect(dictionaryRepresentation: dictionary),
              let layer = item[kCGWindowLayer as String] as? Int,
              let alpha = item[kCGWindowAlpha as String] as? Double else { return nil }
        return NotchOverlapWindow(processID: pid, bounds: bounds, layer: layer, alpha: alpha)
      }
      overlap = NotchOverlapPolicy.overlaps(
        windows: windows, processIDs: processIDs,
        minimumLayer: Int(CGWindowLevelForKey(.mainMenuWindow)), notch: notch, pills: pills
      )
    } else {
      overlap = nil
    }
    let previous = policy.suppressed
    let suppressed = policy.update(overlapping: overlap, now: ProcessInfo.processInfo.systemUptime)
    if previous != suppressed { onChange(suppressed) }
    // Finish the existing 300 ms clear grace period after the watched app
    // exits, then stop waking. No window-list query is needed during grace.
    if processIDs.isEmpty {
      if suppressed { startTimer() }
      else { stopTimer() }
    }
  }

  deinit {
    timer?.setEventHandler {}
    timer?.cancel()
    let center = NSWorkspace.shared.notificationCenter
    observers.forEach(center.removeObserver)
  }
}
