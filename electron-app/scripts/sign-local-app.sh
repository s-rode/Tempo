#!/bin/bash
set -euo pipefail

APP_PATH="${1:?Expected the packaged Tempo.app path}"

if [[ ! -d "$APP_PATH" ]]; then
  echo "Tempo app bundle does not exist: $APP_PATH" >&2
  exit 1
fi

# Bun's linker-generated ad-hoc signature is rejected as an invalid page by
# macOS 27 when the local server first executes. The local server is an extra
# resource rather than a conventional nested bundle, so `--deep` alone does
# not reach it: sign it before sealing the outer app bundle.
LOCAL_SERVER="$APP_PATH/Contents/Resources/local-server/tempo-local-server"
if [[ ! -f "$LOCAL_SERVER" ]]; then
  echo "Tempo local server is missing: $LOCAL_SERVER" >&2
  exit 1
fi

# macOS records Accessibility (shown as “Device Control” on newer releases)
# against an app's designated requirement. A plain ad-hoc signature derives
# that requirement from the changing code hash, so every local Tempo rebuild
# looked like a new app and lost the user's existing grant. Keep local signing
# ad-hoc, but make Tempo's designated requirement stable across rebuilt code.
TEMPO_DESIGNATED_REQUIREMENT='designated => identifier "com.tempo.local"'

codesign --force --sign - --timestamp=none "$LOCAL_SERVER"
codesign --force --deep --sign - --timestamp=none "$APP_PATH"
# Sign the outer application once more without --deep: nested components have
# already been sealed above, and this writes the stable requirement only on
# the bundle macOS presents in Privacy & Security.
codesign --force --sign - --timestamp=none -r="$TEMPO_DESIGNATED_REQUIREMENT" "$APP_PATH"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
codesign --verify --strict --verbose=2 "$LOCAL_SERVER"
