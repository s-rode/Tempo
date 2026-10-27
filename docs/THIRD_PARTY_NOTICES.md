# Third-party notices

Cronus source retains its original copyright and MIT permission notice in the root LICENSE. Tempo additions do not replace third-party terms.

The vendored shadcn-style UI primitives derive from the MIT-licensed shadcn/ui project. Its notice is retained in `licenses/shadcn-MIT.txt`. Radix, React, Framer Motion, Lucide, and other package dependencies retain their own notices and licenses in installed packages.

[`licenses/dependency-inventory.json`](../licenses/dependency-inventory.json) and [`licenses/dependency-notices.md`](../licenses/dependency-notices.md) record inspected installed metadata and notice files. Only exact locked versions are included. Registry metadata for the 43 platform-specific locked versions absent on this Mac was checked against each exact package version and lockfile integrity. This metadata review does not substitute for retaining the notice files when those packages are installed on another platform.

Electron distributions include Chromium and other third-party notices. Those generated distribution notices must remain in local builds. MongoDB, Ollama, model weights, and macOS frameworks are separate prerequisites rather than vendored source. Installing those components does not change their terms.

The hourglass app icon was supplied by s-rode for Tempo. Other application icons are looked up from installed macOS applications at runtime. Distraction alert sounds are read from the user’s macOS installation at runtime. Apple’s sound recordings are not bundled or redistributed in this repository or app.
