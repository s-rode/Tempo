import AppKit
import Combine
import CoreGraphics
import Foundation
import SwiftUI

private let protocolVersion = 5
private let panelWidth: CGFloat = 520
// The native panel stays large enough to animate in place, but the visible
// shape and hit region use the exact current content height below.
private let panelHeight: CGFloat = 194
private let maximumExpandedPanelHeight: CGFloat = 192
// The normal details view has a compact final command row. Reserve one
// additional macOS spacing unit beneath it so its native 22-point controls
// are never clipped by the shape or hit-testing region.
private let normalExpandedPanelHeight: CGFloat = 152
// A personal distraction reminder includes two readable lines of local copy
// plus compact actions. It remains below the fixed host maximum, while the
// visible notch shape and hit region match this exact content height.
private let distractionNoticeExpandedPanelHeight: CGFloat = 170
private let normalChooserExpandedPanelHeight: CGFloat = 166
private let sessionExpandedPanelHeight: CGFloat = 192
// Keep the compact companion visually quieter than ordinary menu-bar items.
// These deliberately follow Tempo's light, compact dashboard controls rather
// than looking like two miniature floating windows.
private let pillWidth: CGFloat = 78
private let pillHeight: CGFloat = 21
private let notchGap: CGFloat = 8

struct HelperCategory: Codable, Identifiable {
  let id: String
  let name: String
  let color: String?
  let isProductive: Bool

  enum CodingKeys: String, CodingKey { case id = "_id", name, color, isProductive }
}

struct StreakClockPayload: Codable {
  let accumulatedMs: Double
  let runningSinceMs: Double?
}

struct FocusTransitionNotice: Codable, Equatable {
  let id: String
  let kind: String
  let runId: String
  let phaseId: String
  let phaseIndex: Int
  let occurredAtMs: Double
  let goal: String?
  let breakDurationMs: Double?
}

/**
 A live-only reminder mirrored from the same event as Notification Center.
 The helper never persists this message or any browser/activity content.
 */
struct DistractionAttentionNotice: Codable, Equatable {
  let id: String
  let eventId: String
  let title: String
  let body: String
  let occurredAtMs: Double
}

struct StatusPayload: Codable {
  let latestStatus: String?
  let dailyProductiveMs: Double
  let dailyUnproductiveMs: Double
  let dailyProductiveClock: StreakClockPayload?
  let dailyUnproductiveClock: StreakClockPayload?
  let productiveClock: StreakClockPayload?
  let distractedClock: StreakClockPayload?
  let provisionalDistractionStartedAtMs: Double?
  let productiveStreakMs: Double?
  let distractedStreakMs: Double?
  let statusStartedAtMs: Double?
  let animateTimerDigits: Bool?
  let categoryDetails: HelperCategory?
  let availableCategories: [HelperCategory]?
  let activitySource: String?
  let activityName: String?
  let activitySummary: String?
  let activityUrl: String?
  let categoryReasoning: String?
  let classificationStatus: String?
  let nudgeTitle: String?
  let nudgeBody: String?
  let eventIds: [String]?
  let runtimeMode: String?
  let trackingState: String?
  let suspensionReasons: [String]?
  let suspendedAtMs: Double?
  let pausedUntilMs: Double?
  let phaseRemainingMs: Double?
  let phaseRemainingSampledAtMs: Double?
  let phaseDurationMs: Double?
  let phaseGoal: String?
  let phaseKind: String?
  let phaseIndex: Int?
  let sessionTransitionAlertsEnabled: Bool?
  let playSessionTransitionChime: Bool?
  let showDistractionNotchAlerts: Bool?
  let transitionNotice: FocusTransitionNotice?
}

struct CommandEnvelope: Codable {
  let version: Int
  let type: String
  let payload: StatusPayload?
  let requestId: String?
  let ok: Bool?
  let message: String?
  let action: String?
  let durationMinutes: Int?
  let distractionNotice: DistractionAttentionNotice?
}

final class TempoNotchPanel: NSPanel {
  var acceptsKeyboardControls = false
  override var canBecomeKey: Bool { acceptsKeyboardControls }
  override var canBecomeMain: Bool { false }
}

final class PassthroughHostingView: NSHostingView<AnyView> {
  weak var controller: NotchController?
  private var hoverAreas: [NSTrackingArea] = []

  init(rootView: AnyView, controller: NotchController) {
    self.controller = controller
    super.init(rootView: rootView)
    wantsLayer = true
    layer?.backgroundColor = NSColor.clear.cgColor
  }

  required init(rootView: AnyView) {
    super.init(rootView: rootView)
    wantsLayer = true
    layer?.backgroundColor = NSColor.clear.cgColor
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override var isOpaque: Bool { false }

  override func hitTest(_ point: NSPoint) -> NSView? {
    guard let controller else { return nil }
    return controller.interactionRects(isFlipped: isFlipped).contains(where: { $0.contains(point) })
      ? super.hitTest(point)
      : nil
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    hoverAreas.forEach(removeTrackingArea)
    hoverAreas.removeAll()
    guard let controller else { return }
    for rect in controller.interactionRects(isFlipped: isFlipped) {
      let area = NSTrackingArea(
        rect: rect,
        options: [.mouseEnteredAndExited, .activeAlways],
        owner: self,
        userInfo: nil
      )
      addTrackingArea(area)
      hoverAreas.append(area)
    }
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    DispatchQueue.main.async { [weak self] in self?.refreshInteractionRegions() }
  }

  override func layout() {
    super.layout()
    // AppKit can assign hosting-view bounds after the panel is first framed.
    // Refreshing here prevents an initial zero-sized tracking region.
    DispatchQueue.main.async { [weak self] in self?.refreshInteractionRegions() }
  }

  override func mouseEntered(with event: NSEvent) { controller?.hoverChanged(true) }
  override func mouseExited(with event: NSEvent) { controller?.hoverChanged(false) }

  func refreshInteractionRegions() {
    updateTrackingAreas()
  }
}

struct NotchGeometry {
  let screen: NSScreen
  let notchWidth: CGFloat
  let menuBarHeight: CGFloat
}

@MainActor
final class NotchController: NSObject, ObservableObject {
  @Published var status = StatusPayload(
    latestStatus: "maybe", dailyProductiveMs: 0, dailyUnproductiveMs: 0,
    dailyProductiveClock: StreakClockPayload(accumulatedMs: 0, runningSinceMs: nil),
    dailyUnproductiveClock: StreakClockPayload(accumulatedMs: 0, runningSinceMs: nil),
    productiveClock: StreakClockPayload(accumulatedMs: 0, runningSinceMs: nil),
    distractedClock: StreakClockPayload(accumulatedMs: 0, runningSinceMs: nil),
    provisionalDistractionStartedAtMs: nil,
    productiveStreakMs: 0, distractedStreakMs: 0, statusStartedAtMs: nil, animateTimerDigits: true,
    categoryDetails: nil, availableCategories: [], activitySource: nil, activityName: nil,
    activitySummary: nil, activityUrl: nil, categoryReasoning: nil,
    classificationStatus: nil, nudgeTitle: nil, nudgeBody: nil, eventIds: [],
    runtimeMode: "normal", trackingState: "normal", suspensionReasons: [], suspendedAtMs: nil, pausedUntilMs: nil,
    phaseRemainingMs: nil, phaseRemainingSampledAtMs: nil,
    phaseDurationMs: nil, phaseGoal: nil, phaseKind: nil, phaseIndex: nil,
    sessionTransitionAlertsEnabled: true, playSessionTransitionChime: true,
    showDistractionNotchAlerts: true, transitionNotice: nil
  )
  @Published var expanded = false
  @Published var now = Date()
  @Published var chooserOpen = false
  @Published var pausePickerOpen = false
  @Published var recategorizeMessage: String?
  @Published var presentedTransitionNotice: FocusTransitionNotice?
  @Published var presentedDistractionNotice: DistractionAttentionNotice?
  @Published var geometry: NotchGeometry

  private let panel: TempoNotchPanel
  private var hoverOpenWork: DispatchWorkItem?
  private var hoverCloseWork: DispatchWorkItem?
  private var previousStatus: String?
  private var displayClockTimer: DispatchSourceTimer?
  private var transitionAlertWork: DispatchWorkItem?
  private var distractionAlertWork: DispatchWorkItem?
  private var queuedDistractionNotice: DistractionAttentionNotice?
  private var isHovering = false
  private weak var host: PassthroughHostingView?

  init(panel: TempoNotchPanel, geometry: NotchGeometry) {
    self.panel = panel
    self.geometry = geometry
  }

  func install() {
    let host = PassthroughHostingView(rootView: AnyView(NotchRootView(controller: self)), controller: self)
    self.host = host
    panel.contentView = host
    positionPanel()
    panel.orderFrontRegardless()
    host.refreshInteractionRegions()
    startDisplayClock()
    emit(type: "ready")
    emit(type: "visibilityChanged", extra: ["visible": true])
  }

  func positionPanel() {
    geometry = resolveGeometry()
    let frame = geometry.screen.frame
    panel.setFrame(
      NSRect(x: frame.midX - panelWidth / 2, y: frame.maxY - panelHeight, width: panelWidth, height: panelHeight),
      display: true
    )
    host?.refreshInteractionRegions()
  }

  var expandedContentHeight: CGFloat {
    if presentedTransitionNotice != nil {
      return normalExpandedPanelHeight
    }
    if presentedDistractionNotice != nil {
      return distractionNoticeExpandedPanelHeight
    }
    let presentsSession = status.runtimeMode != "normal" || status.trackingState == "paused"
    if chooserOpen || pausePickerOpen {
      return presentsSession ? sessionExpandedPanelHeight : normalChooserExpandedPanelHeight
    }
    return presentsSession ? sessionExpandedPanelHeight : normalExpandedPanelHeight
  }

  func interactionRects(isFlipped: Bool) -> [NSRect] {
    let bounds = NSRect(x: 0, y: 0, width: panelWidth, height: panelHeight)
    if expanded {
      // SwiftUI lays out from the top, while an NSHostingView can use flipped
      // coordinates. Keep the tracking rectangle in the host's own system.
      let visibleHeight = expandedContentHeight
      let y = isFlipped ? 0 : bounds.maxY - visibleHeight
      return [NSRect(x: 0, y: y, width: bounds.width, height: visibleHeight)]
    }
    let notchLeft = bounds.midX - geometry.notchWidth / 2
    let y = isFlipped ? 0 : bounds.maxY - geometry.menuBarHeight
    return [
      NSRect(x: notchLeft - notchGap - pillWidth, y: y, width: pillWidth, height: geometry.menuBarHeight),
      NSRect(x: notchLeft, y: y, width: geometry.notchWidth, height: geometry.menuBarHeight),
      NSRect(x: notchLeft + geometry.notchWidth + notchGap, y: y, width: pillWidth, height: geometry.menuBarHeight),
    ]
  }

  func apply(status next: StatusPayload) {
    let previous = previousStatus
    previousStatus = next.latestStatus
    status = next
    // Status changes must render at the instant they arrive, rather than
    // waiting for the next one-second display tick.
    now = Date()
    if !panel.isVisible || (next.suspensionReasons ?? []).contains("system_sleep") {
      stopDisplayClock()
    } else {
      startDisplayClock()
    }
    if next.trackingState == "paused" { pausePickerOpen = false }
    if next.showDistractionNotchAlerts == false {
      clearDistractionNotice()
      queuedDistractionNotice = nil
    } else {
      if let notice = presentedDistractionNotice, !isCurrentDistractionNotice(notice) {
        clearDistractionNotice()
      }
      if let notice = queuedDistractionNotice, !isCurrentDistractionNotice(notice) {
        queuedDistractionNotice = nil
      }
    }
    if next.sessionTransitionAlertsEnabled == false {
      transitionAlertWork?.cancel()
      presentedTransitionNotice = nil
    } else if let notice = next.transitionNotice,
              notice.id != presentedTransitionNotice?.id {
      presentTransitionNotice(notice, playChime: next.playSessionTransitionChime != false)
    }
    host?.refreshInteractionRegions()
    if presentedTransitionNotice != nil || presentedDistractionNotice != nil { return }
    if previous == "productive" && next.latestStatus == "unproductive" {
      setExpanded(true)
      DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
        guard let self, !self.chooserOpen, !self.pausePickerOpen else { return }
        self.setExpanded(false)
      }
    }
  }

  private func presentTransitionNotice(_ notice: FocusTransitionNotice, playChime: Bool) {
    transitionAlertWork?.cancel()
    // Session boundaries are the higher-priority attention state. A stale
    // distraction reminder must never cover a scheduled break or completion.
    clearDistractionNotice()
    queuedDistractionNotice = nil
    presentedTransitionNotice = notice
    chooserOpen = false
    pausePickerOpen = false
    if playChime {
      NSSound(named: NSSound.Name("Glass"))?.play()
    }
    setExpanded(true)
    let work = DispatchWorkItem { [weak self] in
      guard let self else { return }
      self.presentedTransitionNotice = nil
      self.panel.acceptsKeyboardControls = self.chooserOpen || self.pausePickerOpen || self.presentedDistractionNotice != nil
      self.host?.refreshInteractionRegions()
      if let queued = self.queuedDistractionNotice, self.isCurrentDistractionNotice(queued) {
        self.queuedDistractionNotice = nil
        self.showDistractionNotice(queued)
      } else if !self.isHovering { self.setExpanded(false) }
    }
    transitionAlertWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 10, execute: work)
  }

  /** Shows a reminder only for the still-current distracting event. */
  func presentDistractionNotice(_ notice: DistractionAttentionNotice) {
    guard status.showDistractionNotchAlerts != false, isCurrentDistractionNotice(notice) else { return }
    if presentedTransitionNotice != nil {
      // At most one lower-priority reminder may wait behind a session alert.
      queuedDistractionNotice = notice
      return
    }
    showDistractionNotice(notice)
  }

  private func showDistractionNotice(_ notice: DistractionAttentionNotice) {
    distractionAlertWork?.cancel()
    presentedDistractionNotice = notice
    chooserOpen = false
    pausePickerOpen = false
    setExpanded(true)
    let work = DispatchWorkItem { [weak self] in
      guard let self else { return }
      self.presentedDistractionNotice = nil
      self.panel.acceptsKeyboardControls = self.chooserOpen || self.pausePickerOpen || self.presentedTransitionNotice != nil
      self.host?.refreshInteractionRegions()
      if !self.isHovering && self.presentedTransitionNotice == nil { self.setExpanded(false) }
    }
    distractionAlertWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 10, execute: work)
  }

  private func clearDistractionNotice() {
    distractionAlertWork?.cancel()
    distractionAlertWork = nil
    presentedDistractionNotice = nil
  }

  func dismissDistractionNotice() {
    clearDistractionNotice()
    queuedDistractionNotice = nil
    panel.acceptsKeyboardControls = chooserOpen || pausePickerOpen || presentedTransitionNotice != nil
    host?.refreshInteractionRegions()
    if !isHovering && presentedTransitionNotice == nil { setExpanded(false) }
  }

  func openCategoryChooserFromDistractionNotice() {
    guard presentedDistractionNotice != nil, !(status.eventIds ?? []).isEmpty else { return }
    clearDistractionNotice()
    queuedDistractionNotice = nil
    chooserOpen = true
    pausePickerOpen = false
    setExpanded(true)
    panel.acceptsKeyboardControls = true
    host?.refreshInteractionRegions()
  }

  private func isCurrentDistractionNotice(_ notice: DistractionAttentionNotice) -> Bool {
    guard status.latestStatus == "unproductive",
          status.trackingState == "normal" || status.trackingState == "active",
          (status.suspensionReasons ?? []).isEmpty else { return false }
    return status.eventIds?.contains(notice.eventId) == true
  }

  /**
   * This replaces SwiftUI's run-loop timer with one main-queue source aligned
   * to second boundaries. It is still exactly one redraw per second: no new
   * IPC, database query, activity capture, OCR, or model work is introduced.
   */
  private func startDisplayClock() {
    guard displayClockTimer == nil else { return }
    let timer = DispatchSource.makeTimerSource(queue: .main)
    let milliseconds = Int(Date().timeIntervalSince1970 * 1_000)
    let delay = max(1, 1_000 - (milliseconds % 1_000))
    timer.schedule(
      deadline: .now() + .milliseconds(delay),
      repeating: .seconds(1),
      leeway: .milliseconds(20)
    )
    timer.setEventHandler { [weak self] in self?.now = Date() }
    displayClockTimer = timer
    timer.resume()
  }

  private func stopDisplayClock() {
    displayClockTimer?.setEventHandler {}
    displayClockTimer?.cancel()
    displayClockTimer = nil
  }

  deinit {
    displayClockTimer?.setEventHandler {}
    displayClockTimer?.cancel()
  }

  func setExpanded(_ value: Bool) {
    hoverOpenWork?.cancel()
    hoverCloseWork?.cancel()
    let animation: Animation = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
      ? .easeOut(duration: 0.12)
      : .spring(response: 0.32, dampingFraction: 0.88)
    withAnimation(animation) { expanded = value }
    panel.acceptsKeyboardControls = value && (chooserOpen || pausePickerOpen || presentedTransitionNotice != nil || presentedDistractionNotice != nil)
    host?.refreshInteractionRegions()
  }

  func hoverChanged(_ hovering: Bool) {
    isHovering = hovering
    hoverOpenWork?.cancel()
    hoverCloseWork?.cancel()
    if hovering {
      let work = DispatchWorkItem { [weak self] in self?.setExpanded(true) }
      hoverOpenWork = work
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: work)
    } else if !chooserOpen && !pausePickerOpen && presentedTransitionNotice == nil && presentedDistractionNotice == nil {
      let work = DispatchWorkItem { [weak self] in self?.setExpanded(false) }
      hoverCloseWork = work
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.35, execute: work)
    }
  }

  func toggleCategoryChooser() {
    chooserOpen.toggle()
    if chooserOpen { pausePickerOpen = false }
    panel.acceptsKeyboardControls = chooserOpen || pausePickerOpen
    host?.refreshInteractionRegions()
  }

  func togglePausePicker() {
    pausePickerOpen.toggle()
    if pausePickerOpen {
      chooserOpen = false
      setExpanded(true)
    }
    panel.acceptsKeyboardControls = chooserOpen || pausePickerOpen
    host?.refreshInteractionRegions()
  }

  func show() {
    panel.orderFrontRegardless()
    now = Date()
    startDisplayClock()
    emit(type: "visibilityChanged", extra: ["visible": true])
  }

  func hide() {
    panel.orderOut(nil)
    stopDisplayClock()
    emit(type: "visibilityChanged", extra: ["visible": false])
  }

  func requestRecategorization(_ category: HelperCategory) {
    let ids = status.eventIds ?? []
    guard !ids.isEmpty else { return }
    let requestId = UUID().uuidString
    recategorizeMessage = "Recategorizing…"
    emit(type: "recategorize", extra: ["requestId": requestId, "categoryId": category.id, "eventIds": ids])
  }

  func requestFocusAction(_ action: String, durationMinutes: Int? = nil) {
    var payload: [String: Any] = ["action": action]
    if let durationMinutes { payload["durationMinutes"] = durationMinutes }
    emit(type: "focusCommand", extra: payload)
  }

  func requestPause(minutes: Int) {
    pausePickerOpen = false
    panel.acceptsKeyboardControls = chooserOpen
    host?.refreshInteractionRegions()
    requestFocusAction("pause", durationMinutes: minutes)
  }

  func dismissTransientControls() {
    chooserOpen = false
    pausePickerOpen = false
    transitionAlertWork?.cancel()
    clearDistractionNotice()
    queuedDistractionNotice = nil
    presentedTransitionNotice = nil
    panel.acceptsKeyboardControls = false
    host?.refreshInteractionRegions()
  }

  func receiveRecategorizationResult(_ command: CommandEnvelope) {
    recategorizeMessage = command.ok == true ? "Recategorized" : (command.message ?? "Could not recategorize")
    if command.ok == true {
      chooserOpen = false
      panel.acceptsKeyboardControls = false
      host?.refreshInteractionRegions()
      DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
        guard let self, !self.pointerIsOverInteractionRegion else { return }
        self.setExpanded(false)
      }
    }
  }

  private var pointerIsOverInteractionRegion: Bool {
    guard let host else { return false }
    let pointInWindow = panel.convertPoint(fromScreen: NSEvent.mouseLocation)
    let pointer = host.convert(pointInWindow, from: nil)
    return interactionRects(isFlipped: host.isFlipped).contains(where: { $0.contains(pointer) })
  }

  func emit(type: String, extra: [String: Any] = [:]) {
    var message: [String: Any] = ["version": protocolVersion, "type": type]
    extra.forEach { message[$0.key] = $0.value }
    guard JSONSerialization.isValidJSONObject(message),
          let data = try? JSONSerialization.data(withJSONObject: message),
          let line = String(data: data, encoding: .utf8) else { return }
    FileHandle.standardOutput.write(Data((line + "\n").utf8))
  }
}

private func resolveGeometry() -> NotchGeometry {
  let screens = NSScreen.screens
  let builtInNotched = screens.first { screen in
    guard let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else { return false }
    return CGDisplayIsBuiltin(number.uint32Value) != 0 && screen.safeAreaInsets.top > 0
  }
  let screen = builtInNotched ?? NSScreen.main ?? screens[0]
  let left = screen.auxiliaryTopLeftArea ?? .zero
  let right = screen.auxiliaryTopRightArea ?? .zero
  let measuredWidth = max(0, NSMinX(right) - NSMaxX(left))
  let notchWidth = measuredWidth > 0 ? measuredWidth : 185
  let menuHeight = max(28, screen.frame.maxY - screen.visibleFrame.maxY)
  return NotchGeometry(screen: screen, notchWidth: notchWidth, menuBarHeight: menuHeight)
}

private func format(_ milliseconds: Double) -> String {
  let seconds = max(0, Int(milliseconds / 1000))
  let hours = seconds / 3600
  let minutes = (seconds % 3600) / 60
  let remainder = seconds % 60
  return hours > 0 ? "\(hours):\(String(format: "%02d", minutes)):\(String(format: "%02d", remainder))" : "\(minutes):\(String(format: "%02d", remainder))"
}

// Compact pills use one precision mode as a pair. Once either side reaches an
// hour, explicit minute units keep the shorter counter from looking like it is
// showing seconds next to an h:mm value.
private func formatPill(_ milliseconds: Double, precision: NotchTimerPrecision) -> String {
  guard precision == .minutes else { return format(milliseconds) }
  let totalMinutes = max(0, Int(milliseconds / 60_000))
  let hours = totalMinutes / 60
  let minutes = totalMinutes % 60
  return hours > 0 ? "\(hours)h \(minutes)m" : "\(minutes)m"
}

private func statusColor(_ value: String?) -> Color {
  switch value {
  case "productive": return .green
  case "unproductive": return .red
  default: return .orange
  }
}

private func formatRemaining(_ milliseconds: Double?) -> String {
  guard let milliseconds else { return "" }
  return format(milliseconds)
}

private struct NotchMorphShape: Shape {
  var progress: CGFloat
  var notchWidth: CGFloat
  var menuBarHeight: CGFloat
  var expandedHeight: CGFloat

  var animatableData: CGFloat {
    get { progress }
    set { progress = newValue }
  }

  func path(in rect: CGRect) -> Path {
    let p = min(1, max(0, progress))
    let width = notchWidth + (panelWidth - notchWidth) * p
    let height = menuBarHeight + (expandedHeight - menuBarHeight) * p
    let x = rect.midX - width / 2
    let y = rect.minY
    let radius = 8 + (18 - 8) * p
    return Path(roundedRect: CGRect(x: x, y: y, width: width, height: height), cornerRadius: radius)
  }
}

/**
 A deterministic, shape-clipped menu-bar surface for both macOS appearances.
 The helper deliberately avoids `Material`: an opaque dark surface is more
 legible over light applications and cannot leak a full-hosting-view rectangle.
 */
private struct NotchSurface<S: Shape>: View {
  let shape: S
  let expanded: Bool

  var body: some View {
    let reduceTransparency = NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency
    let increaseContrast = NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast
    ZStack {
      shape.fill(Color.black.opacity((expanded || reduceTransparency) ? 1 : 0.90))
      if !expanded && !reduceTransparency {
        shape.fill(Color.white.opacity(0.025))
      }
      shape.stroke(Color.white.opacity(increaseContrast ? 0.28 : 0.14), lineWidth: increaseContrast ? 1 : 0.75)
    }
    .clipShape(shape)
    .shadow(color: Color.black.opacity(expanded ? 0.32 : 0.12), radius: expanded ? 8 : 2, y: expanded ? 3 : 1)
  }
}

private struct NativeClockTimerText: View {
  let identity: String
  let text: String
  let value: Int
  let precision: NotchTimerPrecision
  let isFrozen: Bool
  let animationsEnabled: Bool

  private final class AnimationMemory {
    static let shared = AnimationMemory()
    var snapshots: [String: NotchTimerAnimationSnapshot] = [:]
  }

  private var snapshot: NotchTimerAnimationSnapshot {
    NotchTimerAnimationSnapshot(value: value, precision: precision, isFrozen: isFrozen)
  }

  private var shouldAnimate: Bool {
    shouldAnimateNotchTimerTransition(
      from: AnimationMemory.shared.snapshots[identity],
      to: snapshot,
      reduceMotion: NSWorkspace.shared.accessibilityDisplayShouldReduceMotion,
      animationsEnabled: animationsEnabled
    )
  }

  @ViewBuilder
  var body: some View {
    if #available(macOS 14.0, *) {
      timerText
        .contentTransition(shouldAnimate ? .numericText(value: Double(value)) : .identity)
        // The system numeric transition only animates inside an animation
        // transaction. This is deliberately shorter than the one-second clock
        // tick, so no transition stacks up or creates continuous work.
        .transaction { transaction in
          transaction.animation = shouldAnimate ? .easeInOut(duration: 0.24) : nil
        }
        .onAppear { AnimationMemory.shared.snapshots[identity] = snapshot }
        .onChange(of: snapshot) { nextSnapshot in
          AnimationMemory.shared.snapshots[identity] = nextSnapshot
        }
    } else {
      // Tempo supports macOS 13 as well. Keep the existing static number there
      // rather than substituting a custom, less-native animation.
      timerText
        .onAppear { AnimationMemory.shared.snapshots[identity] = snapshot }
        .onChange(of: snapshot) { nextSnapshot in
          AnimationMemory.shared.snapshots[identity] = nextSnapshot
        }
    }
  }

  private var timerText: some View {
    Text(text)
      .font(.system(size: 12, weight: .semibold).monospacedDigit())
  }
}

struct TimerPill: View {
  let label: String
  let elapsedMilliseconds: Double
  let precision: NotchTimerPrecision
  let active: Bool
  let paused: Bool
  let isFrozen: Bool
  let animateDigits: Bool
  let color: Color

  private var displayValue: Int {
    let divisor = precision == .minutes ? 60_000 : 1_000
    return max(0, Int(elapsedMilliseconds / Double(divisor)))
  }

  private var text: String {
    formatPill(elapsedMilliseconds, precision: precision)
  }

  var body: some View {
    HStack(spacing: 4) {
      Circle()
        .fill(paused ? Color.white.opacity(0.28) : active ? color : Color.white.opacity(0.30))
        .frame(width: 6, height: 6)
      NativeClockTimerText(identity: label, text: text, value: displayValue, precision: precision, isFrozen: isFrozen, animationsEnabled: animateDigits)
    }
    .foregroundStyle(paused ? Color.white.opacity(0.50) : active ? .white : Color.white.opacity(0.70))
    .frame(width: pillWidth, height: pillHeight)
    .background {
      let shape = Capsule(style: .continuous)
      ZStack {
        shape.fill(Color.black.opacity(paused ? 0.76 : 0.94))
        shape.stroke(Color.white.opacity(paused ? 0.10 : 0.14), lineWidth: 0.7)
        if !paused && active {
          shape.stroke(color.opacity(0.52), lineWidth: 0.8)
        }
      }
    }
    .shadow(color: Color.black.opacity(0.22), radius: 2, y: 1)
    .accessibilityLabel("\(label), \(text)\(paused ? ", paused" : active ? ", active" : "")")
  }
}

/** A compact, always-visible acknowledgement that Tempo is running a deliberate session. */
private struct FocusSessionBadge: View {
  let title: String
  let progress: CGFloat
  let tint: Color

  var body: some View {
    VStack(spacing: 3) {
      HStack(spacing: 5) {
        Image(systemName: "target")
          .font(.system(size: 9, weight: .semibold))
        Text(title)
          .font(.system(size: 10, weight: .semibold))
      }
      .foregroundStyle(tint.opacity(0.96))
      Rectangle()
        .fill(.white.opacity(0.16))
        .frame(width: 60, height: 1)
        .overlay(alignment: .leading) {
          Rectangle().fill(tint).frame(width: max(2, 60 * progress), height: 1)
        }
    }
    .frame(width: 78, height: 20)
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(title) session in progress")
  }
}

/** A compact session-status row that keeps the current goal prominent. */
private struct FocusSessionCard: View {
  let title: String
  let goal: String?
  let remaining: String?
  let progress: CGFloat
  let tint: Color

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      HStack(spacing: 7) {
        Image(systemName: "target")
          .font(.system(size: 11, weight: .semibold))
          .foregroundStyle(tint)
        Text(title)
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(tint)
        Spacer(minLength: 8)
        if let remaining {
          Text(remaining)
            .font(.system(size: 12, weight: .semibold).monospacedDigit())
            .foregroundStyle(.white.opacity(0.92))
        }
      }
      if let goal, !goal.isEmpty {
        Text(goal)
          .font(.system(size: 11, weight: .regular))
          .foregroundStyle(.white.opacity(0.80))
          .lineLimit(1)
      }
      // Keep this explicitly height-bound. A max-width overlay without a
      // concrete height can receive an unbounded SwiftUI proposal and push the
      // footer out of the fixed-height notch panel.
      GeometryReader { proxy in
        ZStack(alignment: .leading) {
          Rectangle().fill(.white.opacity(0.12))
          Rectangle().fill(tint)
            .frame(width: max(2, proxy.size.width * progress), height: 3)
        }
      }
      .frame(height: 3)
    }
    .padding(.horizontal, 2)
    .padding(.vertical, 3)
    .frame(height: 36)
  }
}

/** A short, action-oriented card shown only for a newly completed phase. */
private struct FocusTransitionCard: View {
  let symbol: String
  let title: String
  let message: String
  let tint: Color

  var body: some View {
    HStack(alignment: .top, spacing: 9) {
      Image(systemName: symbol)
        .font(.system(size: 13, weight: .semibold))
        .foregroundStyle(tint)
        .frame(width: 18, height: 18)
        .background(Circle().fill(tint.opacity(0.13)))
      VStack(alignment: .leading, spacing: 2) {
        Text(title)
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(.white.opacity(0.96))
        Text(message)
          .font(.system(size: 10, weight: .regular))
          .foregroundStyle(.white.opacity(0.67))
          .lineLimit(1)
      }
      Spacer(minLength: 0)
    }
    .frame(height: 34, alignment: .leading)
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(title). \(message)")
  }
}

/**
 A compact native attention card for a reminder that has already been approved
 for Notification Center. The only semantic accent is the warning glyph; the
 message itself remains the hierarchy, not a loud colored panel.
 */
private struct DistractionAttentionCard: View {
  let title: String
  let message: String
  let context: String

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        Image(systemName: "exclamationmark.circle.fill")
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(.red.opacity(0.88))
          .accessibilityHidden(true)
        Text("Focus check")
          .font(.system(size: 11, weight: .semibold))
          .foregroundStyle(.white.opacity(0.82))
        Spacer(minLength: 6)
        Text(context)
          .font(.system(size: 10, weight: .regular))
          .foregroundStyle(.white.opacity(0.58))
          .lineLimit(1)
      }
      Text(title)
        .font(.system(size: 13, weight: .semibold))
        .foregroundStyle(.white.opacity(0.96))
        .lineLimit(1)
      Text(message)
        .font(.system(size: 10, weight: .regular))
        .foregroundStyle(.white.opacity(0.72))
        .lineLimit(2)
        .fixedSize(horizontal: false, vertical: true)
    }
    .frame(height: 76, alignment: .topLeading)
    .accessibilityElement(children: .combine)
    .accessibilityLabel("Focus check. \(title). \(message). \(context).")
  }
}

private enum NotchActionTone: Equatable {
  case neutral
  case productive
  case destructive

  var accent: Color {
    switch self {
    case .neutral: return .white
    case .productive: return .green
    case .destructive: return .red
    }
  }

  var isNeutral: Bool { self == .neutral }
}

private struct NotchActionStyle: ButtonStyle {
  let tone: NotchActionTone

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: 11, weight: .semibold))
      .foregroundStyle(Color.white.opacity(configuration.isPressed ? 0.78 : 0.94))
      .padding(.horizontal, 7)
      .frame(minHeight: 22)
      .background {
        let shape = RoundedRectangle(cornerRadius: 5, style: .continuous)
        ZStack {
          shape.fill(tone.isNeutral ? Color.white.opacity(configuration.isPressed ? 0.16 : 0.09) : tone.accent.opacity(configuration.isPressed ? 0.46 : 0.28))
          shape.stroke(tone.isNeutral ? Color.white.opacity(0.16) : tone.accent.opacity(0.62), lineWidth: 0.75)
        }
      }
      .contentShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
  }
}

/**
 A category is a small status control, not a prominent action button. Keeping
 it beside the activity title makes its scope obvious and avoids a detached,
 web-style blue “Reclassify” button at the edge of the notch.
 */
private struct NotchCategoryControl: View {
  let name: String
  let status: String?
  let isEnabled: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 4) {
        Circle()
          .fill(statusColor(status))
          .frame(width: 5, height: 5)
        Text(name)
        if isEnabled {
          Image(systemName: "chevron.down")
            .font(.system(size: 7, weight: .semibold))
            .foregroundStyle(.white.opacity(0.54))
        }
      }
      .font(.system(size: 10, weight: .medium))
      .foregroundStyle(.white.opacity(isEnabled ? 0.78 : 0.64))
      .padding(.horizontal, 6)
      .frame(minHeight: 20)
      .background {
        RoundedRectangle(cornerRadius: 5, style: .continuous)
          .fill(Color.white.opacity(isEnabled ? 0.075 : 0.035))
          .overlay {
            RoundedRectangle(cornerRadius: 5, style: .continuous)
              .stroke(Color.white.opacity(isEnabled ? 0.14 : 0.08), lineWidth: 0.7)
          }
      }
    }
    .buttonStyle(.plain)
    .disabled(!isEnabled)
    .accessibilityLabel(isEnabled ? "Change category, currently \(name)" : "Category: \(name)")
  }
}

struct NotchRootView: View {
  @ObservedObject var controller: NotchController

  private func elapsed(_ clock: StreakClockPayload?, fallback: Double?) -> Double {
    guard let clock else { return fallback ?? 0 }
    // The parent sends the exact lock/sleep boundary. Do not advance from wall
    // time while macOS is suspended, even though this display timer still redraws.
    let clockNow = controller.status.suspendedAtMs ?? controller.now.timeIntervalSince1970 * 1000
    let running = clock.runningSinceMs.map { max(0, clockNow - $0) } ?? 0
    return max(0, clock.accumulatedMs + running)
  }
  private var productiveTime: Double {
    elapsed(controller.status.productiveClock, fallback: controller.status.productiveStreakMs)
  }
  private var distractedTime: Double {
    elapsed(controller.status.distractedClock, fallback: controller.status.distractedStreakMs)
  }
  private var dailyProductiveTime: Double {
    elapsed(controller.status.dailyProductiveClock, fallback: controller.status.dailyProductiveMs)
  }
  private var dailyUnproductiveTime: Double {
    elapsed(controller.status.dailyUnproductiveClock, fallback: controller.status.dailyUnproductiveMs)
  }
  private var useMinutePrecision: Bool {
    productiveTime >= 3_600_000 || distractedTime >= 3_600_000
  }
  private var timerPillPrecision: NotchTimerPrecision {
    useMinutePrecision ? .minutes : .seconds
  }
  private var areTimerPillsFrozen: Bool {
    let reasons = controller.status.suspensionReasons ?? []
    return !reasons.isEmpty || controller.status.trackingState == "paused" || controller.status.trackingState == "break"
  }
  private var shouldAnimateTimerPills: Bool {
    controller.status.animateTimerDigits ?? true
  }
  private var phaseProgress: CGFloat {
    guard let total = controller.status.phaseDurationMs,
          let remaining = livePhaseRemainingMs,
          total > 0 else { return 0 }
    return min(1, max(0, CGFloat((total - remaining) / total)))
  }
  private var livePhaseRemainingMs: Double? {
    guard let remaining = controller.status.phaseRemainingMs else { return nil }
    guard controller.status.trackingState == "active",
          (controller.status.suspensionReasons ?? []).isEmpty,
          let sampledAt = controller.status.phaseRemainingSampledAtMs else {
      return max(0, remaining)
    }
    let elapsed = max(0, controller.now.timeIntervalSince1970 * 1_000 - sampledAt)
    return max(0, remaining - elapsed)
  }
  private var isManualPause: Bool {
    (controller.status.suspensionReasons ?? []).contains("manual_pause")
  }
  private var pauseRemaining: String? {
    guard isManualPause, let until = controller.status.pausedUntilMs else { return nil }
    return format(max(0, until - controller.now.timeIntervalSince1970 * 1000))
  }
  private var sessionTint: Color {
    if controller.status.trackingState == "paused" { return .white.opacity(0.6) }
    if controller.status.trackingState == "break" { return .orange }
    return .green
  }
  private var compactSessionTitle: String {
    if controller.status.trackingState == "paused" { return "PAUSED" }
    if controller.status.trackingState == "break" { return "BREAK" }
    if controller.status.runtimeMode == "pomodoro" {
      return "POMO \((controller.status.phaseIndex ?? 0) / 2 + 1)/4"
    }
    return "FOCUS"
  }
  private var sessionRemaining: String? {
    if let pauseRemaining { return "\(pauseRemaining) paused" }
    guard let phaseRemaining = livePhaseRemainingMs else { return nil }
    return "\(formatRemaining(phaseRemaining)) left"
  }
  private var hasActiveSessionPresentation: Bool {
    controller.status.runtimeMode != "normal" || controller.status.trackingState == "paused"
  }
  private var transitionNotice: FocusTransitionNotice? {
    controller.presentedTransitionNotice
  }
  private var distractionNotice: DistractionAttentionNotice? {
    controller.presentedDistractionNotice
  }
  private var transitionTitle: String {
    switch transitionNotice?.kind {
    case "focus_complete": return "Focus session complete"
    case "break_started": return "Work block complete"
    case "break_complete": return "Break complete"
    case "pomodoro_complete": return "Pomodoro complete"
    default: return "Session update"
    }
  }
  private var transitionMessage: String {
    guard let notice = transitionNotice else { return "" }
    switch notice.kind {
    case "focus_complete": return notice.goal.map { "Completed: \($0)" } ?? "Your focus session is complete."
    case "break_started":
      let duration = max(1, Int((notice.breakDurationMs ?? 0) / 60_000))
      return "Take your \(duration)-minute break before the next block."
    case "break_complete": return "Choose one clear goal for your next work block."
    case "pomodoro_complete": return "All four work blocks and the long break are complete."
    default: return ""
    }
  }
  private var transitionSymbol: String {
    switch transitionNotice?.kind {
    case "break_started": return "cup.and.saucer.fill"
    case "break_complete": return "target"
    default: return "checkmark.circle.fill"
    }
  }
  private var transitionTint: Color {
    transitionNotice?.kind == "break_started" ? .orange : .green
  }
  private var distractionContext: String {
    let source = activitySource ?? "Current activity"
    return "\(source) · \(format(distractedTime)) distracted"
  }
  private var expandedContentHeight: CGFloat { controller.expandedContentHeight }
  private var activitySource: String? {
    let source = controller.status.activitySource?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return source.isEmpty ? nil : source
  }
  private var activityLabel: String? {
    let label = controller.status.activityName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return label.isEmpty ? nil : label
  }
  private var activityPrimaryText: String {
    // A distraction presentation label already contains its source, e.g.
    // “Distracted by ChatGPT”. It is the whole primary identity—not a second
    // subtitle next to the exact same phrase.
    if controller.status.latestStatus == "unproductive" {
      return activityLabel ?? activitySource ?? "Waiting for activity"
    }
    return activitySource ?? activityLabel ?? "Waiting for activity"
  }
  private var activitySecondaryText: String? {
    guard controller.status.latestStatus != "unproductive",
          let source = activitySource,
          let label = activityLabel,
          label.caseInsensitiveCompare(source) != .orderedSame else { return nil }
    return label
  }

  var body: some View {
    GeometryReader { proxy in
      let notchLeft = proxy.size.width / 2 - controller.geometry.notchWidth / 2
      ZStack(alignment: .topLeading) {
        NotchSurface(
          shape: NotchMorphShape(
            progress: controller.expanded ? 1 : 0,
            notchWidth: controller.geometry.notchWidth,
            menuBarHeight: controller.geometry.menuBarHeight,
            expandedHeight: expandedContentHeight
          ),
          expanded: controller.expanded
        )
        // The hosting panel remains fixed so the morph has a stable anchor;
        // only this clipped shape is visible and interactive at its content
        // height. This prevents an empty black rectangle below short states.
        .frame(width: panelWidth, height: maximumExpandedPanelHeight, alignment: .top)
        .accessibilityHidden(true)
        if controller.expanded {
          details
            .offset(y: controller.geometry.menuBarHeight + 5)
            .transition(.opacity.combined(with: .move(edge: .top)))
        }
        TimerPill(label: "Focused", elapsedMilliseconds: productiveTime, precision: timerPillPrecision, active: controller.status.latestStatus == "productive", paused: isManualPause, isFrozen: areTimerPillsFrozen, animateDigits: shouldAnimateTimerPills, color: .green)
          .position(x: notchLeft - notchGap - pillWidth / 2, y: controller.geometry.menuBarHeight / 2)
        TimerPill(label: controller.status.latestStatus == "maybe" ? "Uncertain" : "Distracted", elapsedMilliseconds: distractedTime, precision: timerPillPrecision, active: controller.status.latestStatus == "unproductive", paused: isManualPause, isFrozen: areTimerPillsFrozen, animateDigits: shouldAnimateTimerPills, color: statusColor(controller.status.latestStatus))
          .position(x: notchLeft + controller.geometry.notchWidth + notchGap + pillWidth / 2, y: controller.geometry.menuBarHeight / 2)
        if controller.status.runtimeMode != "normal" {
          FocusSessionBadge(title: compactSessionTitle, progress: phaseProgress, tint: sessionTint)
            .position(x: proxy.size.width / 2, y: controller.geometry.menuBarHeight / 2)
        }
      }
      .onExitCommand {
        controller.dismissTransientControls()
        controller.setExpanded(false)
      }
    }
    .frame(width: panelWidth, height: panelHeight, alignment: .top)
  }

  private var details: some View {
    VStack(alignment: .leading, spacing: 6) {
      if transitionNotice != nil {
        FocusTransitionCard(
          symbol: transitionSymbol,
          title: transitionTitle,
          message: transitionMessage,
          tint: transitionTint
        )
        Rectangle().fill(.white.opacity(0.10)).frame(height: 1 / (NSScreen.main?.backingScaleFactor ?? 2))
        HStack(spacing: 7) {
          if transitionNotice?.kind == "break_complete" {
            Button("Set next goal") { controller.emit(type: "openFocusGoal") }
              .buttonStyle(NotchActionStyle(tone: .productive))
              .accessibilityLabel("Open Tempo to set the next Pomodoro goal")
          } else {
            Button("Open Tempo") { controller.emit(type: "openMain") }
              .buttonStyle(NotchActionStyle(tone: .neutral))
          }
          if transitionNotice?.kind == "break_started" {
            Button("Skip break") { controller.requestFocusAction("skipBreak") }
              .buttonStyle(NotchActionStyle(tone: .neutral))
              .accessibilityLabel("Skip the scheduled Pomodoro break")
          }
          Spacer(minLength: 0)
          Button("Hide") { controller.hide() }
            .buttonStyle(NotchActionStyle(tone: .neutral))
        }
      } else if let notice = distractionNotice {
        DistractionAttentionCard(
          title: notice.title,
          message: notice.body,
          context: distractionContext
        )
        Rectangle().fill(.white.opacity(0.10)).frame(height: 1 / (NSScreen.main?.backingScaleFactor ?? 2))
        HStack(spacing: 7) {
          Button("Open Tempo") { controller.emit(type: "openMain") }
            .buttonStyle(NotchActionStyle(tone: .neutral))
            .accessibilityLabel("Open Tempo")
          Button("Change category…") { controller.openCategoryChooserFromDistractionNotice() }
            .buttonStyle(NotchActionStyle(tone: .neutral))
            .disabled((controller.status.eventIds ?? []).isEmpty)
            .accessibilityLabel("Change the category for this activity")
          Spacer(minLength: 0)
          Button("Dismiss") { controller.dismissDistractionNotice() }
            .buttonStyle(NotchActionStyle(tone: .neutral))
            .accessibilityLabel("Dismiss this distraction reminder")
        }
      } else {
      if !hasActiveSessionPresentation {
        HStack(spacing: 6) {
          Circle().fill(statusColor(controller.status.latestStatus)).frame(width: 6, height: 6)
          Text(statusHeading)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(.white.opacity(0.92))
          Spacer()
          Text("Today  \(format(dailyProductiveTime)) focused · \(format(dailyUnproductiveTime)) distracted")
            .font(.system(size: 10, weight: .regular)).foregroundStyle(.white.opacity(0.62))
        }
        Rectangle().fill(.white.opacity(0.10)).frame(height: 1 / (NSScreen.main?.backingScaleFactor ?? 2))
      }
      if hasActiveSessionPresentation {
        FocusSessionCard(
          title: sessionHeading,
          goal: controller.status.phaseGoal,
          remaining: sessionRemaining,
          progress: phaseProgress,
          tint: sessionTint
        )
      }
      if hasActiveSessionPresentation && controller.status.trackingState != "active" {
        Text(suspensionDescription)
          .font(.system(size: 11, weight: .regular))
          .foregroundStyle(.white.opacity(0.66))
          .lineLimit(1)
      } else {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          Text(activityPrimaryText)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(.white)
            .lineLimit(1)
            .layoutPriority(-1)
          if let secondary = activitySecondaryText {
            Text(secondary)
              .font(.system(size: 11, weight: .regular))
              .foregroundStyle(.white.opacity(0.62))
              .lineLimit(1)
              .layoutPriority(-1)
          }
          Spacer(minLength: 4)
          if let category = controller.status.categoryDetails {
            NotchCategoryControl(
              name: category.name,
              status: controller.status.latestStatus,
              isEnabled: !controller.chooserOpen && !(controller.status.eventIds ?? []).isEmpty,
              action: { controller.toggleCategoryChooser() }
            )
            .accessibilityIdentifier("tempo-reclassify")
            .layoutPriority(1)
          }
        }
        if let summary = controller.status.activitySummary {
          Text(summary)
            .font(.system(size: 11, weight: .regular))
            .foregroundStyle(.white.opacity(0.66))
            .lineLimit(1)
        } else if controller.status.latestStatus == "unproductive", let nudge = controller.status.nudgeBody {
          Text(nudge)
            .font(.system(size: 10, weight: .regular))
            .foregroundStyle(.red.opacity(0.88))
            .lineLimit(1)
        } else if !hasActiveSessionPresentation, let reasoning = controller.status.categoryReasoning {
          Text(reasoning)
            .font(.system(size: 10, weight: .regular))
            .foregroundStyle(.white.opacity(0.56))
            .lineLimit(1)
        }
      }
      Rectangle().fill(.white.opacity(0.10)).frame(height: 1 / (NSScreen.main?.backingScaleFactor ?? 2))
      if controller.chooserOpen {
        HStack(spacing: 7) {
          Button("Cancel") { controller.toggleCategoryChooser() }
            .buttonStyle(NotchActionStyle(tone: .neutral))
          Text("Change category")
            .font(.system(size: 10, weight: .medium))
            .foregroundStyle(.white.opacity(0.62))
          ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
              ForEach(controller.status.availableCategories ?? []) { category in
                Button(category.name) { controller.requestRecategorization(category) }
                  .buttonStyle(NotchActionStyle(tone: category.isProductive ? .productive : .destructive))
                  .accessibilityLabel("Set category to \(category.name), \(category.isProductive ? "productive" : "distracting")")
              }
            }
          }
          .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .frame(height: 32)
      } else if controller.pausePickerOpen {
        HStack(spacing: 6) {
          Button("Cancel") { controller.togglePausePicker() }
            .buttonStyle(NotchActionStyle(tone: .neutral))
          Text("Pause for")
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(.white.opacity(0.72))
          ForEach([1, 5, 20, 30, 60, 120], id: \.self) { minutes in
            Button(minutes < 60 ? "\(minutes)m" : "\(minutes / 60)h") {
              controller.requestPause(minutes: minutes)
            }
            .buttonStyle(NotchActionStyle(tone: .neutral))
            .accessibilityLabel("Pause monitoring for \(minutes) minutes")
          }
        }
        .frame(height: 32, alignment: .leading)
      } else {
        HStack(spacing: 7) {
          Button("Open Tempo") { controller.emit(type: "openMain") }
            .buttonStyle(NotchActionStyle(tone: .neutral))
          if controller.status.trackingState == "paused", (controller.status.suspensionReasons ?? []).contains("manual_pause") {
            Button("Resume") { controller.requestFocusAction("resume") }
              .buttonStyle(NotchActionStyle(tone: .neutral))
          } else if controller.status.trackingState == "active" || controller.status.trackingState == "normal" {
            Button("Pause…") { controller.togglePausePicker() }
              .buttonStyle(NotchActionStyle(tone: .neutral))
              .accessibilityIdentifier("tempo-pause")
              .accessibilityLabel("Pause monitoring for a selected duration")
          }
          if controller.status.trackingState == "break" {
            Button("Skip break") { controller.requestFocusAction("skipBreak") }
              .buttonStyle(NotchActionStyle(tone: .neutral))
          }
          if controller.status.runtimeMode != "normal" {
            Button("End") { controller.requestFocusAction("endRun") }
              .buttonStyle(NotchActionStyle(tone: .destructive))
          }
          Spacer(minLength: 0)
          if let message = controller.recategorizeMessage {
            Text(message)
              .font(.system(size: 10, weight: .regular))
              .foregroundStyle(.white.opacity(0.60))
              .lineLimit(1)
          }
          Button("Hide") { controller.hide() }
            .buttonStyle(NotchActionStyle(tone: .neutral))
        }
      }
      }
    }
    .padding(.horizontal, 16)
    .padding(.top, hasActiveSessionPresentation ? 4 : 5)
    .frame(width: panelWidth, alignment: .leading)
  }

  private var suspensionDescription: String {
    let reasons = controller.status.suspensionReasons ?? []
    if reasons.contains("screen_locked") { return "Tempo is frozen until the screen is unlocked." }
    if reasons.contains("system_sleep") { return "Tempo is frozen while your Mac is asleep." }
    if reasons.contains("awaiting_system_resume") { return "Tempo is rechecking the frontmost app." }
    if let pauseRemaining { return "Monitoring is paused · \(pauseRemaining) remaining." }
    if controller.status.trackingState == "break" { return "Monitoring is paused for your scheduled break." }
    return "Monitoring is paused."
  }

  private var statusHeading: String {
    let reasons = controller.status.suspensionReasons ?? []
    if reasons.contains("screen_locked") { return "LOCKED" }
    if reasons.contains("system_sleep") { return "SLEEPING" }
    if reasons.contains("awaiting_system_resume") { return "RESUMING" }
    if controller.status.trackingState == "paused" { return "PAUSED" }
    if controller.status.trackingState == "break" { return "BREAK" }
    return controller.status.latestStatus == "productive" ? "FOCUSED" : controller.status.latestStatus == "unproductive" ? "DISTRACTED" : "UNCERTAIN"
  }

  private var sessionHeading: String {
    let reasons = controller.status.suspensionReasons ?? []
    if reasons.contains("screen_locked") { return "Screen locked — Tempo is frozen" }
    if reasons.contains("system_sleep") { return "Mac sleeping — Tempo is frozen" }
    if reasons.contains("awaiting_system_resume") { return "Resuming — rechecking the frontmost app" }
    if controller.status.trackingState == "break" { return controller.status.phaseKind == "long_break" ? "Long break" : "Short break" }
    if controller.status.trackingState == "paused" { return "Tempo paused" }
    if controller.status.runtimeMode == "pomodoro" { return "Pomodoro \((controller.status.phaseIndex ?? 0) / 2 + 1)" }
    return controller.status.runtimeMode == "custom" ? "Focus session" : ""
  }
}

struct FlowLayout: Layout {
  var spacing: CGFloat = 6

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? panelWidth - 36
    var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
    for view in subviews {
      let size = view.sizeThatFits(.unspecified)
      if x > 0 && x + size.width > width { x = 0; y += rowHeight + spacing; rowHeight = 0 }
      x += size.width + spacing
      rowHeight = max(rowHeight, size.height)
    }
    return CGSize(width: width, height: y + rowHeight)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
    for view in subviews {
      let size = view.sizeThatFits(.unspecified)
      if x > bounds.minX && x + size.width > bounds.maxX { x = bounds.minX; y += rowHeight + spacing; rowHeight = 0 }
      view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
      x += size.width + spacing
      rowHeight = max(rowHeight, size.height)
    }
  }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  private var controller: NotchController?

  func applicationDidFinishLaunching(_ notification: Notification) {
    // `.hudWindow` adds AppKit's own translucent rectangular HUD treatment,
    // which is visible below a custom-shaped transparent panel. The native
    // panel itself must stay entirely clear; NotchSurface owns every pixel.
    let panel = TempoNotchPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel, .utilityWindow], backing: .buffered, defer: false)
    panel.isFloatingPanel = true
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.level = .mainMenu + 3
    panel.collectionBehavior = [.fullScreenAuxiliary, .stationary, .canJoinAllSpaces, .ignoresCycle]
    panel.isMovable = false
    panel.hasShadow = false
    panel.isReleasedWhenClosed = false
    let controller = NotchController(panel: panel, geometry: resolveGeometry())
    self.controller = controller
    controller.install()

    NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak controller] _ in
      Task { @MainActor in controller?.positionPanel() }
    }
    readCommands()
  }

  private func readCommands() {
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      while let line = readLine() {
        guard let data = line.data(using: .utf8), let command = try? JSONDecoder().decode(CommandEnvelope.self, from: data), command.version == protocolVersion else { continue }
        DispatchQueue.main.async {
          Task { @MainActor in self?.handle(command) }
        }
      }
      DispatchQueue.main.async { NSApplication.shared.terminate(nil) }
    }
  }

  @MainActor private func handle(_ command: CommandEnvelope) {
    guard let controller else { return }
    switch command.type {
    case "status": if let payload = command.payload { controller.apply(status: payload) }
    case "distractionNotice":
      if let notice = command.distractionNotice { controller.presentDistractionNotice(notice) }
    case "show": controller.show()
    case "hide": controller.hide()
    case "refreshGeometry": controller.positionPanel()
    case "recategorizeResult": controller.receiveRecategorizationResult(command)
    case "shutdown": NSApplication.shared.terminate(nil)
    default: controller.emit(type: "error", extra: ["code": "unsupported_command"])
    }
  }
}

@main
struct TempoNotchHelperMain {
  @MainActor
  static func main() {
    let application = NSApplication.shared
    application.setActivationPolicy(.accessory)
    let delegate = AppDelegate()
    application.delegate = delegate
    application.run()
  }
}
