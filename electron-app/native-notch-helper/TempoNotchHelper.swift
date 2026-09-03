import AppKit
import Combine
import CoreGraphics
import Foundation
import SwiftUI

private let protocolVersion = 3
private let panelWidth: CGFloat = 520
private let panelHeight: CGFloat = 180
private let expandedPanelHeight: CGFloat = 170
private let pillWidth: CGFloat = 96
private let pillHeight: CGFloat = 26
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

struct StatusPayload: Codable {
  let latestStatus: String?
  let dailyProductiveMs: Double
  let dailyUnproductiveMs: Double
  let productiveClock: StreakClockPayload?
  let distractedClock: StreakClockPayload?
  let provisionalDistractionStartedAtMs: Double?
  let productiveStreakMs: Double?
  let distractedStreakMs: Double?
  let statusStartedAtMs: Double?
  let categoryDetails: HelperCategory?
  let availableCategories: [HelperCategory]?
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
  let phaseRemainingMs: Double?
  let phaseDurationMs: Double?
  let phaseGoal: String?
  let phaseKind: String?
  let phaseIndex: Int?
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
}

final class KronusNotchPanel: NSPanel {
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
  }

  required init(rootView: AnyView) {
    super.init(rootView: rootView)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

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
    productiveClock: StreakClockPayload(accumulatedMs: 0, runningSinceMs: nil),
    distractedClock: StreakClockPayload(accumulatedMs: 0, runningSinceMs: nil),
    provisionalDistractionStartedAtMs: nil,
    productiveStreakMs: 0, distractedStreakMs: 0, statusStartedAtMs: nil,
    categoryDetails: nil, availableCategories: [], activityName: nil,
    activitySummary: nil, activityUrl: nil, categoryReasoning: nil,
    classificationStatus: nil, nudgeTitle: nil, nudgeBody: nil, eventIds: [],
    runtimeMode: "normal", trackingState: "normal", suspensionReasons: [],
    phaseRemainingMs: nil, phaseDurationMs: nil, phaseGoal: nil, phaseKind: nil, phaseIndex: nil
  )
  @Published var expanded = false
  @Published var now = Date()
  @Published var chooserOpen = false
  @Published var recategorizeMessage: String?
  @Published var geometry: NotchGeometry

  private let panel: KronusNotchPanel
  private var hoverOpenWork: DispatchWorkItem?
  private var hoverCloseWork: DispatchWorkItem?
  private var previousStatus: String?
  private weak var host: PassthroughHostingView?

  init(panel: KronusNotchPanel, geometry: NotchGeometry) {
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

  func interactionRects(isFlipped: Bool) -> [NSRect] {
    let bounds = NSRect(x: 0, y: 0, width: panelWidth, height: panelHeight)
    if expanded {
      // SwiftUI lays out from the top, while an NSHostingView can use flipped
      // coordinates. Keep the tracking rectangle in the host's own system.
      let y = isFlipped ? 0 : bounds.maxY - expandedPanelHeight
      return [NSRect(x: 0, y: y, width: bounds.width, height: expandedPanelHeight)]
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
    if previous == "productive" && next.latestStatus == "unproductive" {
      setExpanded(true)
      DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
        guard let self, !self.chooserOpen else { return }
        self.setExpanded(false)
      }
    }
  }

  func setExpanded(_ value: Bool) {
    hoverOpenWork?.cancel()
    hoverCloseWork?.cancel()
    withAnimation(.spring(response: 0.36, dampingFraction: 0.82)) { expanded = value }
    panel.acceptsKeyboardControls = value && chooserOpen
    host?.refreshInteractionRegions()
  }

  func hoverChanged(_ hovering: Bool) {
    hoverOpenWork?.cancel()
    hoverCloseWork?.cancel()
    if hovering {
      let work = DispatchWorkItem { [weak self] in self?.setExpanded(true) }
      hoverOpenWork = work
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: work)
    } else if !chooserOpen {
      let work = DispatchWorkItem { [weak self] in self?.setExpanded(false) }
      hoverCloseWork = work
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.35, execute: work)
    }
  }

  func toggleCategoryChooser() {
    chooserOpen.toggle()
    panel.acceptsKeyboardControls = chooserOpen
    host?.refreshInteractionRegions()
  }

  func show() {
    panel.orderFrontRegardless()
    emit(type: "visibilityChanged", extra: ["visible": true])
  }

  func hide() {
    panel.orderOut(nil)
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

  var animatableData: CGFloat {
    get { progress }
    set { progress = newValue }
  }

  func path(in rect: CGRect) -> Path {
    let p = min(1, max(0, progress))
    let width = notchWidth + (panelWidth - notchWidth) * p
    let height = menuBarHeight + (expandedPanelHeight - menuBarHeight) * p
    let x = rect.midX - width / 2
    let y = rect.minY
    let radius = 7 + (24 - 7) * p
    return Path(roundedRect: CGRect(x: x, y: y, width: width, height: height), cornerRadius: radius)
  }
}

struct TimerPill: View {
  let label: String
  let value: String
  let active: Bool
  let color: Color

  var body: some View {
    HStack(spacing: 6) {
      Circle().fill(active ? color : Color.white.opacity(0.25)).frame(width: 9, height: 9)
      Text(value).font(.system(size: 17, weight: .semibold, design: .monospaced))
    }
    .foregroundStyle(active ? color : Color.white.opacity(0.65))
    .frame(width: pillWidth, height: pillHeight)
    .background(Color.black.opacity(active ? 0.8 : 0.58))
    .overlay(RoundedRectangle(cornerRadius: 6).stroke(active ? color.opacity(0.9) : Color.white.opacity(0.12), lineWidth: active ? 1.5 : 1))
    .clipShape(RoundedRectangle(cornerRadius: 6))
    .accessibilityLabel("\(label) \(value)")
  }
}

private struct NotchActionStyle: ButtonStyle {
  let tint: Color

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: 12, weight: .semibold))
      .foregroundStyle(.white)
      .padding(.horizontal, 10)
      .padding(.vertical, 6)
      .background(tint.opacity(configuration.isPressed ? 0.62 : 0.32))
      .overlay(RoundedRectangle(cornerRadius: 7).stroke(tint.opacity(0.9), lineWidth: 1))
      .clipShape(RoundedRectangle(cornerRadius: 7))
  }
}

struct NotchRootView: View {
  @ObservedObject var controller: NotchController
  private let clock = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

  private func elapsed(_ clock: StreakClockPayload?, fallback: Double?) -> Double {
    guard let clock else { return fallback ?? 0 }
    let running = clock.runningSinceMs.map { max(0, controller.now.timeIntervalSince1970 * 1000 - $0) } ?? 0
    return max(0, clock.accumulatedMs + running)
  }
  private var productiveTime: Double {
    elapsed(controller.status.productiveClock, fallback: controller.status.productiveStreakMs)
  }
  private var distractedTime: Double {
    elapsed(controller.status.distractedClock, fallback: controller.status.distractedStreakMs)
  }
  private var phaseProgress: CGFloat {
    guard let total = controller.status.phaseDurationMs,
          let remaining = controller.status.phaseRemainingMs,
          total > 0 else { return 0 }
    return min(1, max(0, CGFloat((total - remaining) / total)))
  }

  var body: some View {
    GeometryReader { proxy in
      let notchLeft = proxy.size.width / 2 - controller.geometry.notchWidth / 2
      ZStack(alignment: .topLeading) {
        NotchMorphShape(
          progress: controller.expanded ? 1 : 0,
          notchWidth: controller.geometry.notchWidth,
          menuBarHeight: controller.geometry.menuBarHeight
        )
        .fill(Color.black.opacity(controller.expanded ? 0.96 : 0.82))
        .frame(width: panelWidth, height: expandedPanelHeight, alignment: .top)
        .accessibilityHidden(true)
        if controller.expanded {
          details
            .offset(y: controller.geometry.menuBarHeight + 5)
            .transition(.opacity.combined(with: .move(edge: .top)))
        }
        TimerPill(label: "Focused", value: format(productiveTime), active: controller.status.latestStatus == "productive", color: .green)
          .position(x: notchLeft - notchGap - pillWidth / 2, y: controller.geometry.menuBarHeight / 2)
        TimerPill(label: controller.status.latestStatus == "maybe" ? "Uncertain" : "Distracted", value: format(distractedTime), active: controller.status.latestStatus == "unproductive", color: statusColor(controller.status.latestStatus))
          .position(x: notchLeft + controller.geometry.notchWidth + notchGap + pillWidth / 2, y: controller.geometry.menuBarHeight / 2)
        if controller.status.runtimeMode != "normal" {
          Capsule()
            .fill(statusColor(controller.status.latestStatus))
            .frame(width: max(2, (controller.geometry.notchWidth - 14) * phaseProgress), height: 2)
            .position(x: proxy.size.width / 2 - (controller.geometry.notchWidth - 14) * (1 - phaseProgress) / 2, y: controller.geometry.menuBarHeight - 3)
            .accessibilityLabel("Focus phase progress")
        }
      }
      .onReceive(clock) { controller.now = $0 }
      .onExitCommand { controller.setExpanded(false) }
    }
    .frame(width: panelWidth, height: panelHeight, alignment: .top)
  }

  private var details: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack {
        Text(statusHeading)
          .font(.caption.weight(.bold)).foregroundStyle(statusColor(controller.status.latestStatus))
        Spacer()
        Text("Today  \(format(controller.status.dailyProductiveMs)) focused · \(format(controller.status.dailyUnproductiveMs)) distracted")
          .font(.caption2).foregroundStyle(.white.opacity(0.62))
      }
      if controller.status.runtimeMode != "normal" || controller.status.trackingState == "paused" {
        HStack(spacing: 6) {
          Text(sessionHeading).font(.caption.weight(.semibold)).foregroundStyle(.white.opacity(0.9))
          if let goal = controller.status.phaseGoal, !goal.isEmpty {
            Text(goal).font(.caption).foregroundStyle(.white.opacity(0.7)).lineLimit(1)
          }
          Spacer()
          if let phaseRemaining = controller.status.phaseRemainingMs { Text("\(formatRemaining(phaseRemaining)) left").font(.caption.monospacedDigit()).foregroundStyle(.white.opacity(0.75)) }
        }
      }
      HStack(spacing: 7) {
        Text(controller.status.activityName ?? "Waiting for activity")
          .font(.system(size: 14, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
        if let category = controller.status.categoryDetails {
          Text(category.name).font(.caption.weight(.semibold)).foregroundStyle(statusColor(controller.status.latestStatus)).lineLimit(1)
        }
      }
      if let summary = controller.status.activitySummary {
        Text(summary).font(.caption).foregroundStyle(.white.opacity(0.78)).lineLimit(1)
      }
      if controller.status.latestStatus == "unproductive", let nudge = controller.status.nudgeBody {
        Text(nudge).font(.caption2).foregroundStyle(.red.opacity(0.95)).lineLimit(1)
      } else if let reasoning = controller.status.categoryReasoning {
        Text("Why: \(reasoning)").font(.caption2).foregroundStyle(.white.opacity(0.6)).lineLimit(1)
      }
      HStack(spacing: 7) {
        Button(controller.chooserOpen ? "Cancel" : "Reclassify") {
          controller.toggleCategoryChooser()
        }
        .accessibilityIdentifier("kronus-reclassify")
        .accessibilityLabel("Reclassify current activity")
        .disabled((controller.status.eventIds ?? []).isEmpty)
        .opacity((controller.status.eventIds ?? []).isEmpty ? 0.45 : 1)
        .buttonStyle(NotchActionStyle(tint: statusColor(controller.status.latestStatus)))
        Button("Open Kronus") { controller.emit(type: "openMain") }
          .buttonStyle(NotchActionStyle(tint: .white.opacity(0.45)))
        Button("Hide") { controller.hide() }
          .buttonStyle(NotchActionStyle(tint: .white.opacity(0.45)))
        if controller.status.trackingState == "paused", (controller.status.suspensionReasons ?? []).contains("manual_pause") {
          Button("Resume") { controller.requestFocusAction("resume") }
            .buttonStyle(NotchActionStyle(tint: .green))
        } else if controller.status.trackingState == "active" || controller.status.trackingState == "normal" {
          Menu("Pause") {
            ForEach([1, 5, 20, 30, 60, 120], id: \.self) { minutes in
              Button(minutes < 60 ? "\(minutes) min" : "\(minutes / 60) hour\(minutes == 60 ? "" : "s")") {
                controller.requestFocusAction("pause", durationMinutes: minutes)
              }
            }
          }
          .menuStyle(.borderlessButton)
          .frame(width: 54)
        }
        if controller.status.trackingState == "break" {
          Button("Skip break") { controller.requestFocusAction("skipBreak") }
            .buttonStyle(NotchActionStyle(tint: .white.opacity(0.45)))
        }
        if controller.status.runtimeMode != "normal" {
          Button("End") { controller.requestFocusAction("endRun") }
            .buttonStyle(NotchActionStyle(tint: .red))
        }
        Spacer()
        if let message = controller.recategorizeMessage { Text(message).font(.caption2).foregroundStyle(.white.opacity(0.75)) }
      }
      if controller.chooserOpen {
        Text("Apply only to this current activity")
          .font(.caption2).foregroundStyle(.white.opacity(0.55))
        ScrollView(.vertical, showsIndicators: true) {
          FlowLayout(spacing: 6) {
            ForEach(controller.status.availableCategories ?? []) { category in
              Button(category.name) { controller.requestRecategorization(category) }
                .buttonStyle(NotchActionStyle(tint: category.isProductive ? .green : .red))
                .accessibilityLabel("Set category to \(category.name), \(category.isProductive ? "productive" : "distracting")")
            }
          }
        }
        .frame(height: 45)
      }
    }
    .padding(.horizontal, 18)
    .padding(.top, 2)
    .frame(width: panelWidth, alignment: .leading)
  }

  private var statusHeading: String {
    if controller.status.trackingState == "paused" { return "PAUSED" }
    if controller.status.trackingState == "break" { return "BREAK" }
    return controller.status.latestStatus == "productive" ? "FOCUSED" : controller.status.latestStatus == "unproductive" ? "DISTRACTED" : "UNCERTAIN"
  }

  private var sessionHeading: String {
    if controller.status.trackingState == "break" { return controller.status.phaseKind == "long_break" ? "Long break" : "Short break" }
    if controller.status.trackingState == "paused" { return "Kronus paused" }
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
    let panel = KronusNotchPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel, .utilityWindow, .hudWindow], backing: .buffered, defer: false)
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
    case "show": controller.show()
    case "hide": controller.hide()
    case "refreshGeometry": controller.positionPanel()
    case "recategorizeResult": controller.receiveRecategorizationResult(command)
    case "shutdown": NSApplication.shared.terminate(nil)
    default: controller.emit(type: "error", extra: ["code": "unsupported_command"])
    }
  }
}

let application = NSApplication.shared
application.setActivationPolicy(.accessory)
let delegate = MainActor.assumeIsolated { AppDelegate() }
application.delegate = delegate
application.run()
