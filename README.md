<div align="center">

<img src="electron-app/assets/tempo-icon.png" alt="Tempo hourglass" width="112" />

# Tempo

### Your time. Your goals. Your focus.

A macOS focus companion with local AI, native notch timers, and a clear view of your day.

[![macOS](https://img.shields.io/badge/macOS-14%2B-111827?logo=apple&logoColor=white)](docs/BUILDING.md)
[![Apple Silicon](https://img.shields.io/badge/Apple_Silicon-arm64-555555)](docs/BUILDING.md)
[![Local AI](https://img.shields.io/badge/AI-local_with_Ollama-16a34a)](docs/LOCAL_AI.md)
[![MIT License](https://img.shields.io/badge/License-MIT-2563eb)](LICENSE)

[Explore the features](#a-clearer-picture-of-your-day) · [Under the hood](#under-the-hood) · [Run Tempo](#run-from-source)

</div>

![Tempo's Today dashboard showing planned tasks, weekly focus totals, and a detailed activity timeline](docs/images/tempo-today.png)

<p align="center"><sub>Real app screenshots with authored demo data. Tracking is paused while capturing; no personal activity or Reminders are shown.</sub></p>

Reading documentation and getting lost in a feed can happen in the same browser. The task makes the difference.

Tempo connects your activity to what you're trying to accomplish. A local language model classifies app and browser context against your goals, while focus sessions, task planning, and a native notch UI help you stay on track. Your timeline makes it easy to see where the day went—and correct the app when it gets something wrong.

## A clearer picture of your day

| | What Tempo brings to your workflow |
|---|---|
| **AI that knows the task** | Classify activity against your current focus goal or plan. Choose Flexible, Balanced, or Strict behavior, and teach Tempo through explicit corrections. |
| **Focus at the notch** | Keep session progress and focus counters close at hand with a native Swift helper, live clocks, and compact controls. |
| **Sessions with a purpose** | Start a timed focus session or Pomodoro from a task. Use estimates, take breaks, extend a session, and pick up where you left off after a restart. |
| **Your plan, connected** | Write tasks in Tempo or connect Apple Reminders. Bring task and list context into focus sessions without editing your reminders. |
| **A day you can understand** | Explore activity timelines, inspect time by app and category, and correct individual classifications. Zoom out to weekly and monthly patterns. |
| **Browser context included** | Use the Firefox companion for page context, with optional Firefox OCR fallback. Chrome and Safari capture are also supported. |

## Turn a task into focused time

Pick a task, set a work target, and choose Focus or Pomodoro. Tempo carries the task context into classification and keeps session state across pauses, sleep, and restarts.

<p align="center">
  <img src="docs/images/tempo-focus.png" alt="Tempo focus setup with a planned task, a 30-minute work target, and Focus or Pomodoro actions" width="340" />
</p>

Manual tasks and Apple Reminders share the same focus workflow. Reminders access is optional and read-only; disconnecting restores your manual plan.

## See the shape of your week

Compare focused and distracting time, inspect app switches, and spot when focused work tends to happen. Day and week views keep the individual activities behind those totals within reach.

![Tempo analytics with weekly activity bars, focused-time summaries, app switches, and a focus-rhythm chart, using synthetic demo data](docs/images/tempo-analysis.png)

## Local by design

**Inference runs on your Mac through Ollama. Activity history lives in your local MongoDB.** Tempo's normal monitoring flow uses local services and IPC, with no cloud inference fallback, hosted account, or telemetry integration.

Captured page text and OCR images are transient. Tempo stores activity metadata, including app names, window titles, derived summaries, goals, and corrections, so your local history can still contain sensitive information. See [privacy and stored data](docs/NETWORK_NOTES.md) for the details.

Permissions follow the features you use: Reminders access is requested when you connect it, Accessibility is optional, and Screen Recording enables the optional Firefox OCR fallback.

## Under the hood

Tempo combines a TypeScript desktop application with native macOS components and a local inference pipeline.

| Layer | Technology and responsibility |
|---|---|
| Desktop | **Electron, React, TypeScript, Tailwind** — dashboard, planning, analytics, settings, and app lifecycle |
| macOS integration | **Objective-C++, Swift/AppKit, EventKit** — activity capture, native notch controls, and read-only Reminders access |
| Local API and storage | **Bun, Express, tRPC, MongoDB** — session state, activity history, correction learning, and task metadata |
| Classification | **Ollama** — goal-aware decisions with evidence validation, scoped learning, cancellation, and stale-result protection |

I developed Tempo from the MIT-licensed Cronus foundation, adding local Ollama classification and correction learning, task-linked focus/Pomodoro sessions, the native notch interface, Firefox integration, Apple Reminders planning, and analytics and reliability improvements. Cronus provides the original Electron/macOS monitoring and dashboard foundation.

Explore the [architecture](docs/ARCHITECTURE.md), [classification pipeline](docs/CLASSIFICATION.md), and [project origins](docs/PROVENANCE.md).

## Run from source

Tempo currently targets **Apple Silicon Macs running macOS 14 or later**. You'll need Xcode Command Line Tools, Node **22.23.2**, Bun **1.4.0**, Python **3.11**, local MongoDB Community **8.0**, and Ollama with **`qwen3:4b-instruct`**. Services and model weights are separate prerequisites.

With MongoDB and Ollama running and the model available:

```sh
git clone https://github.com/s-rode/Tempo.git
cd Tempo
bun run setup
bun run dev
```

Development uses an isolated profile and test database. To build a macOS app bundle:

```sh
bun run typecheck
bun run test
bun run build
```

See the [build guide](docs/BUILDING.md) for Python selection, native checks, local installation, data locations, and backup instructions. Source builds use local ad-hoc signing; they are not Developer ID signed or notarized releases.

<details>
<summary><strong>Firefox companion</strong></summary>

The companion source is in [`electron-app/firefox-extension`](electron-app/firefox-extension). The macOS build produces an unsigned development ZIP. Load the extension temporarily through Firefox's `about:debugging` page; temporary loading must be repeated after browser restarts. Permanent installation in standard Firefox requires a Mozilla-signed XPI.

</details>

<details>
<summary><strong>More documentation</strong></summary>

- [Build, install, and develop](docs/BUILDING.md)
- [Local AI and browser context](docs/LOCAL_AI.md)
- [Apple Reminders](docs/apple-reminders.md)
- [Privacy and stored data](docs/NETWORK_NOTES.md)
- [Classification evaluation](docs/CLASSIFICATION_VALIDATION.md)
- [Create an isolated demo](docs/DEMONSTRATION.md)

</details>

## Credits and license

Tempo builds on the verified MIT-licensed Cronus snapshot at `222adf835a3a210ca5375a3876e7ed1fed31bb9e`, by Moritz Wallawitsch and Arne Strickmann. It is an independent derivative project.

Tempo's contributions by Samuel R. are also licensed under **[MIT](LICENSE)**. Original copyright notices are preserved; dependencies retain their own terms. See [NOTICE](NOTICE) and [third-party notices](docs/THIRD_PARTY_NOTICES.md).
