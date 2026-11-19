#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
NATIVE_DIR="${ROOT_DIR}/src/native-modules/native-windows"
TEST_DIRECTORY="$(mktemp -d "${TMPDIR:-/tmp}/tempo-firefox-window-selection-tests.XXXXXX")"
SDK="$(xcrun --sdk macosx --show-sdk-path)"
trap 'rm -rf "$TEST_DIRECTORY"' EXIT

# Matches the addon: Objective-C++ with manual reference counting.
clang++ -std=c++17 -fno-objc-arc -target arm64-apple-macosx14.0 -isysroot "$SDK" \
  -framework Foundation -framework CoreGraphics \
  -o "$TEST_DIRECTORY/FirefoxWindowSelectionTests" \
  "$NATIVE_DIR/macos/firefoxWindowSelection.mm" \
  "$NATIVE_DIR/tests/FirefoxWindowSelectionTests.mm"
"$TEST_DIRECTORY/FirefoxWindowSelectionTests"
