#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_DIR="${ROOT_DIR}/build-resources/Tempo Notch Helper.app"
EXECUTABLE_DIR="${APP_DIR}/Contents/MacOS"
SOURCE="${ROOT_DIR}/native-notch-helper/TempoNotchHelper.swift"
ANIMATION_POLICY_SOURCE="${ROOT_DIR}/native-notch-helper/NotchTimerAnimationPolicy.swift"
INTERACTION_LAYOUT_SOURCE="${ROOT_DIR}/native-notch-helper/NotchInteractionLayout.swift"
OVERLAP_POLICY_SOURCE="${ROOT_DIR}/native-notch-helper/NotchOverlapPolicy.swift"
OVERLAP_MONITOR_SOURCE="${ROOT_DIR}/native-notch-helper/NotchOverlapMonitor.swift"
MODULE_CACHE="${ROOT_DIR}/.build/ModuleCache.noindex"
SDK="$(xcrun --sdk macosx --show-sdk-path)"

rm -rf "$APP_DIR"
mkdir -p "$EXECUTABLE_DIR"
mkdir -p "$MODULE_CACHE"
plutil -create xml1 "$APP_DIR/Contents/Info.plist"

CLANG_MODULE_CACHE_PATH="$MODULE_CACHE" SWIFTPM_MODULECACHE_OVERRIDE="$MODULE_CACHE" \
  swiftc -O -target arm64-apple-macosx14.0 -sdk "$SDK" -framework AppKit -framework SwiftUI -framework Combine -o "$EXECUTABLE_DIR/Tempo Notch Helper" "$ANIMATION_POLICY_SOURCE" "$INTERACTION_LAYOUT_SOURCE" "$OVERLAP_POLICY_SOURCE" "$OVERLAP_MONITOR_SOURCE" "$SOURCE"

/usr/libexec/PlistBuddy -c 'Add :CFBundleExecutable string Tempo Notch Helper' "$APP_DIR/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleIdentifier string com.tempo.local.notch-helper' "$APP_DIR/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleName string Tempo Notch Helper' "$APP_DIR/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundlePackageType string APPL' "$APP_DIR/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleShortVersionString string 1.0.0' "$APP_DIR/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleVersion string 1' "$APP_DIR/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :LSUIElement bool true' "$APP_DIR/Contents/Info.plist"
