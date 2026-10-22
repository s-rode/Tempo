#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
POLICY_SOURCE="${ROOT_DIR}/native-notch-helper/NotchTimerAnimationPolicy.swift"
TEST_SOURCE="${ROOT_DIR}/native-notch-helper/NotchTimerAnimationPolicyTests.swift"
TEST_DIRECTORY="$(mktemp -d "${TMPDIR:-/tmp}/tempo-notch-animation-tests.XXXXXX")"
TEST_EXECUTABLE="${TEST_DIRECTORY}/NotchTimerAnimationPolicyTests"
MODULE_CACHE="${ROOT_DIR}/.build/ModuleCache.noindex"
SDK="$(xcrun --sdk macosx --show-sdk-path)"

trap 'rm -rf "${TEST_DIRECTORY}"' EXIT
mkdir -p "$MODULE_CACHE"

CLANG_MODULE_CACHE_PATH="$MODULE_CACHE" SWIFTPM_MODULECACHE_OVERRIDE="$MODULE_CACHE" \
  swiftc -O -target arm64-apple-macosx14.0 -sdk "$SDK" -o "$TEST_EXECUTABLE" "$POLICY_SOURCE" "$TEST_SOURCE"
"$TEST_EXECUTABLE"
