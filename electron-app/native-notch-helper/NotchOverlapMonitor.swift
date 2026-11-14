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
  private var sampling = NotchOverlapSampling()
  private var timerIntervalMs = 0
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
    source.setEventHandler { [weak self] in self?.sample() }
    timer = source
    timerIntervalMs = 0
    applyCadence(sampleNow: true)
    source.resume()
  }

  private func stopTimer() {
    timer?.setEventHandler {}
    timer?.cancel()
    timer = nil
    timerIntervalMs = 0
  }

  /// Slow when idle; the original 100 ms while the pointer is near the notch
  /// or while the pills are hidden and waiting out their clear grace period.
  private func applyCadence(sampleNow: Bool = false) {
    guard let timer else { return }
    let interval = sampling.intervalMs(
      suppressed: policy.suppressed, now: ProcessInfo.processInfo.systemUptime)
    guard interval != timerIntervalMs else { return }
    timerIntervalMs = interval
    timer.schedule(
      deadline: sampleNow ? .now() : .now() + .milliseconds(interval),
      repeating: .milliseconds(interval),
      leeway: .milliseconds(interval >= NotchOverlapSampling.idleIntervalMs ? 100 : 5)
    )
  }

  /// The pointer reached the top of the screen, where another notch app may
  /// open. Sample at full rate for a few seconds, starting immediately.
  func boost() {
    guard started else { return }
    let now = ProcessInfo.processInfo.systemUptime
    let wasActive = sampling.isActive(suppressed: policy.suppressed, now: now)
    sampling.boost(now: now)
    guard !wasActive, timer != nil else { return }
    applyCadence(sampleNow: true)
    sample()
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
    sampling = NotchOverlapSampling()
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
    applyCadence()
  }

  deinit {
    timer?.setEventHandler {}
    timer?.cancel()
    let center = NSWorkspace.shared.notificationCenter
    observers.forEach(center.removeObserver)
  }
}
