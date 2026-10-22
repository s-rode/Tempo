#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEST_DIRECTORY="$(mktemp -d "${TMPDIR:-/tmp}/tempo-notch-interaction-tests.XXXXXX")"
MODULE_CACHE="${ROOT_DIR}/.build/ModuleCache.noindex"
SDK="$(xcrun --sdk macosx --show-sdk-path)"
trap 'rm -rf "$TEST_DIRECTORY"' EXIT
mkdir -p "$MODULE_CACHE"

CLANG_MODULE_CACHE_PATH="$MODULE_CACHE" SWIFTPM_MODULECACHE_OVERRIDE="$MODULE_CACHE" \
  swiftc -O -target arm64-apple-macosx14.0 -sdk "$SDK" \
  -o "$TEST_DIRECTORY/NotchInteractionLayoutTests" \
  "$ROOT_DIR/native-notch-helper/NotchInteractionLayout.swift" \
  "$ROOT_DIR/native-notch-helper/NotchInteractionLayoutTests.swift"
"$TEST_DIRECTORY/NotchInteractionLayoutTests"
