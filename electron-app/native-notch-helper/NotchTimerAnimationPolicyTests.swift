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
    print("Notch timer animation policy tests passed")
  }
}
