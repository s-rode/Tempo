import Foundation

@main
struct NotchTimerAnimationPolicyTests {
  private static func snapshot(
    _ value: Int,
    precision: NotchTimerPrecision = .seconds,
    frozen: Bool = false
  ) -> NotchTimerAnimationSnapshot {
    NotchTimerAnimationSnapshot(value: value, precision: precision, isFrozen: frozen)
  }

  private static func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else {
      fputs("Notch timer animation policy test failed: \(message)\n", stderr)
      exit(1)
    }
  }

  static func main() {
    expect(!shouldAnimateNotchTimerTransition(from: nil, to: snapshot(0), reduceMotion: false), "initial render stays static")
    expect(shouldAnimateNotchTimerTransition(from: snapshot(18), to: snapshot(19), reduceMotion: false), "continuous seconds count up")
    expect(shouldAnimateNotchTimerTransition(from: snapshot(19), to: snapshot(18), reduceMotion: false), "continuous seconds count down")
    expect(shouldAnimateNotchTimerTransition(from: snapshot(42, precision: .minutes), to: snapshot(43, precision: .minutes), reduceMotion: false), "continuous minutes count up")
    expect(!shouldAnimateNotchTimerTransition(from: snapshot(18), to: snapshot(22), reduceMotion: false), "recovery jump stays static")
    expect(!shouldAnimateNotchTimerTransition(from: snapshot(3_599), to: snapshot(60, precision: .minutes), reduceMotion: false), "precision change stays static")
    expect(!shouldAnimateNotchTimerTransition(from: snapshot(18, frozen: true), to: snapshot(19), reduceMotion: false), "resume stays static")
    expect(!shouldAnimateNotchTimerTransition(from: snapshot(18), to: snapshot(18, frozen: true), reduceMotion: false), "pause stays static")
    expect(!shouldAnimateNotchTimerTransition(from: snapshot(18), to: snapshot(19), reduceMotion: true), "Reduce Motion stays static")
    expect(!shouldAnimateNotchTimerTransition(from: snapshot(18), to: snapshot(19), reduceMotion: false, animationsEnabled: false), "preference disables animation")
    let cadence = NotchDisplayClockCadence.self
    expect(cadence.nextDelayMs(nowMs: 10_250, secondsLive: false, minutePillElapsedMs: [], phaseProgressLive: false) == nil, "nothing live means no timer")
    expect(cadence.nextDelayMs(nowMs: 10_250, secondsLive: true, minutePillElapsedMs: [], phaseProgressLive: false) == 770, "seconds align to the next second boundary")
    expect(cadence.nextDelayMs(nowMs: 10_000, secondsLive: true, minutePillElapsedMs: [], phaseProgressLive: false) == 1_020, "a tick exactly on a boundary waits a full second")
    expect(cadence.nextDelayMs(nowMs: 0, secondsLive: false, minutePillElapsedMs: [95_500], phaseProgressLive: false) == 24_520, "minute pills wait for their own minute boundary")
    expect(cadence.nextDelayMs(nowMs: 0, secondsLive: false, minutePillElapsedMs: [95_500, 119_900], phaseProgressLive: false) == 120, "the soonest of two running minute pills wins")
    expect(cadence.nextDelayMs(nowMs: 0, secondsLive: false, minutePillElapsedMs: [], phaseProgressLive: true) == 15_020, "phase progress alone redraws every 15 seconds")
    expect(cadence.nextDelayMs(nowMs: 10_250, secondsLive: true, minutePillElapsedMs: [30_000], phaseProgressLive: true) == 770, "a seconds clock dominates slower ones")
    expect(cadence.nextDelayMs(nowMs: 0, secondsLive: false, minutePillElapsedMs: [59_999], phaseProgressLive: false) == 21, "never schedules an instant busy tick")
    expect(cadence.nextDelayMs(nowMs: 0, secondsLive: false, minutePillElapsedMs: [-5], phaseProgressLive: false) == 60_020, "negative elapsed is clamped")
    print("Notch timer animation policy tests passed")
  }
}
