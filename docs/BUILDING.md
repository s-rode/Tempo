# Building and verifying Tempo

Use Apple Silicon and macOS 14 or later. Local execution has been tested on macOS 27.0.1; compatibility with every intervening release is not implied. Install Xcode Command Line Tools, Python 3.11, Node 22.23.2, and Bun 1.4.0. Put Node 22 on PATH, or set `TEMPO_NODE22` to its executable for native rebuilding.

`bun run setup` performs a frozen dependency install with lifecycle scripts disabled, explicitly bootstraps the pinned Electron development runtime, rebuilds the native addon, and builds shared declarations. Electron's runtime download is an intentional setup step, not a general re-enabling of dependency lifecycle scripts. `bun run build` builds and locally signs the complete ARM64 app. Generated icons, sounds, native modules and helpers are build output, not versioned binaries.

The regular app requires MongoDB Community 8.0 on port 27017 and Ollama on port 11434 with `qwen3:4b-instruct`. Start those services using your installation's service manager. Installing a model may download its separately licensed weights. There is no remote AI fallback.

## Native-build Python

The retained native toolchain uses `node-gyp` 9.4.1, which imports Python's `distutils`. Python 3.12 removed that module. CI explicitly selects Python 3.11 and passes its executable through `PYTHON` during setup and packaging. Python 3.10 also worked in the original local validation.

If your default Python is newer, select an installed Python 3.11 for both commands:

```sh
PYTHON=python3.11 bun run setup
PYTHON=python3.11 bun run build
```

This keeps the existing dependency resolutions; no global Python package or dependency upgrade is required.

## Checks

Backend tests use Bun's `--isolate` mode so module mocks cannot leak between files. Keep it enabled when running the suite or selecting multiple backend test files.

- `bun run typecheck`: shared declarations, server and Electron TypeScript.
- `bun run test`: deterministic backend, renderer and main-process tests.
- `bun run test:integration`: requires existing local MongoDB; uses uniquely named disposable databases, never `tempo_local` or Apple Reminders.
- `bun run test:native`: native animation/layout/overlap policies.
- `bun run --cwd electron-app test:notch-controller`: requires a desktop AppKit session.
- `bun run source:check`: checks the current source and reachable history for excluded files, credential patterns, and private paths.

Real Ollama evaluation and interactive app checks are separate from deterministic tests. See [classification validation](CLASSIFICATION_VALIDATION.md). Test actual browser capture, notch controls, permissions, and existing data before replacing a daily-use installation.

## Isolated profile

`bun run dev` uses `.tempo-dev`, port 3301, and a database prefixed `tempo_test_`. Packaged tests may set `TEMPO_TEST_PROFILE_DIR` to an absolute private directory, `TEMPO_TEST_SERVER_PORT` to a separate port, and `TEMPO_TEST_DATABASE` to a `tempo_test_` name. Normal Firefox host registration is disabled in test profiles. Do not point them at real activity data.

## Install and rollback

The existing Electron profile is `~/Library/Application Support/tempo-electron-app`, including `local-runtime/jwt-secret`, local storage and window preferences. The separate `~/Library/Application Support/Tempo` folder holds the Firefox navigation identity key. Preserve both folders: the display name alone does not identify the Electron profile path.

Before installing, quit Tempo after any active session has ended. Save the installed app bundle, the actual Tempo application-support/user-data directories, Firefox native-host manifest, and a consistent `mongodump` of `tempo_local`. Keep backups outside the repository with restricted permissions; verify database restoration into a disposable database before replacement.

`bun run install:local` checks that Tempo and its server have quit, verifies the staged bundle, saves a verified private copy of the installed app, and replaces it at `/Applications/Tempo.app`. Set `TEMPO_APP_BACKUP_DIR` to choose that bundle-backup parent directory. The database/support-directory checkpoint above is still required. A failed staged or installed signature check leaves or restores the previous app. Verify deep/strict signatures and designated requirement `identifier "com.tempo.local"`; then confirm installed helper/server hashes, existing data, actual browser capture, notch interactions, Reminders, and close/reopen behavior.

On failure, quit the candidate and restore the old bundle and host manifest. Restore the database only when necessary, after archiving newer records.

## Explicit legacy import

Automatic legacy import/deletion has been removed. Before the first launch into an empty destination, quit Tempo and run:

```sh
bun run import:legacy --confirm-copy --copy-runtime-secrets
```

This copies `cronus_local` to `tempo_local`, preserves IDs, copies absent legacy runtime secrets, and leaves the legacy database, files, and app intact. A nonempty destination is rejected. An interrupted import can be retried while Tempo remains closed; conflicts are rejected rather than overwritten. A completed import is not repeated. Never import on top of an existing daily-use Tempo database.
