#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
OUTPUT_DIR="${ROOT_DIR}/build-resources/firefox-host"
MODULE_CACHE="${ROOT_DIR}/.build/ModuleCache.noindex"
SDK="$(xcrun --sdk macosx --show-sdk-path)"

mkdir -p "$OUTPUT_DIR" "$MODULE_CACHE"
CLANG_MODULE_CACHE_PATH="$MODULE_CACHE" SWIFTPM_MODULECACHE_OVERRIDE="$MODULE_CACHE" \
  swiftc -O -target arm64-apple-macosx14.0 -sdk "$SDK" -o "$OUTPUT_DIR/tempo-firefox-native-host" \
  "$ROOT_DIR/native-firefox-host/TempoFirefoxNativeHost.swift"
