#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEST_DIRECTORY="$(mktemp -d "${TMPDIR:-/tmp}/tempo-notch-controller-tests.XXXXXX")"
MODULE_CACHE="${ROOT_DIR}/.build/ModuleCache.noindex"
SDK="$(xcrun --sdk macosx --show-sdk-path)"
trap 'rm -rf "$TEST_DIRECTORY"' EXIT
mkdir -p "$MODULE_CACHE"

# Keep the helper definitions verbatim, replacing only the app entrypoint with
# the test entrypoint. No commands are added to Tempo's production IPC protocol.
python3 - "$ROOT_DIR" "$TEST_DIRECTORY/ControllerTests.swift" <<'PY'
from pathlib import Path
import sys
root = Path(sys.argv[1]) / 'native-notch-helper'
source = (root / 'TempoNotchHelper.swift').read_text()
marker = '@main\nstruct TempoNotchHelperMain'
assert source.count(marker) == 1
Path(sys.argv[2]).write_text(
    source.split(marker)[0]
    + (root / 'NotchOverlapMonitor.swift').read_text()
    + (root / 'NotchControllerSuppressionTests.swift').read_text()
)
PY

CLANG_MODULE_CACHE_PATH="$MODULE_CACHE" SWIFTPM_MODULECACHE_OVERRIDE="$MODULE_CACHE" \
  swiftc -O -target arm64-apple-macosx14.0 -sdk "$SDK" \
  -framework AppKit -framework SwiftUI -framework Combine \
  -o "$TEST_DIRECTORY/NotchControllerTests" \
  "$ROOT_DIR/native-notch-helper/NotchTimerAnimationPolicy.swift" \
  "$ROOT_DIR/native-notch-helper/NotchInteractionLayout.swift" \
  "$ROOT_DIR/native-notch-helper/NotchOverlapPolicy.swift" \
  "$TEST_DIRECTORY/ControllerTests.swift"
"$TEST_DIRECTORY/NotchControllerTests"
