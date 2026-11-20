<div align="center">

<img src="electron-app/assets/tempo-icon.png" alt="Tempo" width="88" />

# Tempo

A macOS focus tracker that checks your activity against the task you chose, using a local language model.

[![Source checks](https://github.com/s-rode/Tempo/actions/workflows/ci.yml/badge.svg)](https://github.com/s-rode/Tempo/actions/workflows/ci.yml)
[![macOS 14+](https://img.shields.io/badge/macOS-14%2B-1f2430?logo=apple&logoColor=white)](docs/BUILDING.md)
[![Apple Silicon](https://img.shields.io/badge/Apple_Silicon-arm64-1f2430)](docs/BUILDING.md)
[![Local AI via Ollama](https://img.shields.io/badge/AI-on--device-1f2430)](docs/LOCAL_AI.md)
[![MIT License](https://img.shields.io/badge/license-MIT-1f2430)](LICENSE)

<img src="docs/images/tempo-notch-hero.svg" alt="Tempo's focused and distracted timers on either side of the MacBook notch" width="720" />

[Features](#features) · [How it works](#how-it-works) · [Setup](#setup) · [Docs](#documentation)

</div>

Tempo is a focus tracker for macOS. You pick the task you want to work on, and a small language model running locally on your Mac checks whether what is on screen matches it. Nothing leaves the machine.

It shows the day as a timeline, keeps a focused and a distracted timer next to the MacBook notch, and can nudge you when you drift. It also has a simple planner for goals and tasks, or it can read your tasks from Apple Reminders.

![Tempo's Today view with the plan, Calendar, time per task and the timeline](docs/images/tempo-today.png)

## Features

- **Task-aware tracking.** Activity is judged against the task you chose, not a fixed list of "productive" apps. The same site can be work for one task and a distraction for another.
- **Timers in the notch.** A small native helper shows focused and distracted time beside the notch, even with the main window closed. Hover it to see the current activity, fix its category, pause, or add time to a finished session.
- **Planner.** Long-term goals, a week plan and a queue for today. Tasks can link to a goal and carry an estimate. Sessions can count down the estimate, count up, or run as Pomodoro blocks.
- **Apple Reminders and Calendar.** Use Reminders lists instead of the planner if you prefer. Calendar events show up on the timeline. Both are read-only.
- **Timeline.** Today as blocks, hour by hour, or as a week, with the time spent on each task against its estimate.
- **Analysis.** A week or month view of when you focus best, how long focus lasts, what pulls you away, how sessions went against their estimates, and how much time each goal got against its weekly target.
- **Corrections.** Fix a wrong classification in the timeline or the notch and Tempo remembers it. Per-app rules cover the cases that never change.
- **Private.** No account, no cloud AI, no telemetry. Classification and storage run on your Mac.

### Notch

<p align="center">
  <img src="docs/images/tempo-notch.svg" alt="Tempo's expanded notch panel with the current activity, its category and session controls" width="760" />
</p>

### Planner

![Tempo's week plan with tasks per day and their goals](docs/images/tempo-plan.png)

Turn the planner on under **Settings → Planning**. Quick entry understands goals and estimates, so `Draft chapter 3 #thesis 45m` adds a 45-minute task linked to the thesis goal. Unfinished tasks move to today. See the [planner guide](docs/planner.md) for shortcuts.

### Focus sessions

<p align="center">
  <img src="docs/images/tempo-focus.png" alt="A running focus session with its goal, timer, and controls" width="340" />
</p>

### Analysis

![Tempo's Analysis tab for one week, with suggestions and focus by day](docs/images/tempo-analysis.png)

Analysis is computed locally from the same events as the timeline and ends with up to three suggestions. The screenshots use sample data.

## How it works

1. A native observer reports the frontmost app and window title. In Firefox, a companion extension adds some of the visible page text.
2. Your per-app rules and earlier corrections are checked first.
3. If they don't decide it, the activity and your task go to a local model through [Ollama](https://ollama.com) (`qwen3:4b-instruct`). A "focused" answer is only accepted if it points to evidence that is actually in the window title or page text.
4. Timeouts and unclear answers are recorded as uncertain. Uncertain time never counts as focused and never triggers an alert.

Page text is only held in memory for the request. App names, window titles and summaries are stored in a local MongoDB database. More in [architecture](docs/ARCHITECTURE.md), [classification](docs/CLASSIFICATION.md) and [privacy](docs/NETWORK_NOTES.md).

The app is Electron with React and TypeScript. The local API runs on Bun with tRPC. The notch helper is Swift and SwiftUI, and window tracking is an Objective-C++ addon.

```text
electron-app/   desktop app, native addon, notch helper, Firefox companion
server/         local API and classification
shared/         types shared between app and server
docs/           longer documentation
```

## Setup

You need an **Apple Silicon Mac running macOS 14 or later**. Tempo is built from source and needs these installed:

| Install        | Requirements                                                               |
| -------------- | -------------------------------------------------------------------------- |
| Build tools    | Xcode Command Line Tools, Node **22.23.2**, Bun **1.4.0**, Python **3.11** |
| Local services | MongoDB Community **8.0**, Ollama with **`qwen3:4b-instruct`**             |

Start MongoDB and Ollama, then run:

```sh
git clone https://github.com/s-rode/Tempo.git
cd Tempo
bun run setup
bun run dev
```

The development app uses its own profile and a test database. To check the source and build an app bundle:

```sh
bun run typecheck
bun run test
bun run build
```

The [build guide](docs/BUILDING.md) covers Python setup, installation, backups, and native checks. Builds are signed locally and are not notarized.

<details>
<summary><strong>Setting up Firefox</strong></summary>

The build creates an unsigned ZIP of the [Firefox companion](electron-app/firefox-extension). Load it through Firefox's `about:debugging` page. You have to reload it after restarting Firefox, because a permanent install in standard Firefox needs a Mozilla-signed XPI.

Chrome and Safari work without an extension through macOS browser automation.

</details>

<details>
<summary><strong>Permissions</strong></summary>

Apple Reminders and Calendar access are optional and read-only. Accessibility improves window-change detection. Screen Recording is only needed for the Firefox OCR fallback.

</details>

<details>
<summary><strong>Trying it with sample data</strong></summary>

The [demo guide](docs/DEMONSTRATION.md) shows how to seed a separate database and profile, so your real activity stays untouched.

</details>

## Documentation

| Guide                                                          | What's inside                                             |
| -------------------------------------------------------------- | --------------------------------------------------------- |
| [Architecture](docs/ARCHITECTURE.md)                           | Processes, boundaries and how activity flows between them |
| [Classification and learning](docs/CLASSIFICATION.md)          | The decision pipeline and the rules for corrections       |
| [Local AI and browser support](docs/LOCAL_AI.md)               | The model, its limits, and what each browser provides     |
| [Privacy and stored data](docs/NETWORK_NOTES.md)               | What is kept, what is not, and what touches the network   |
| [Performance](docs/PERFORMANCE.md)                             | Measurements, methods and caveats                         |
| [Classification evaluation](docs/CLASSIFICATION_VALIDATION.md) | What each level of testing does and does not prove        |
| [Build and install](docs/BUILDING.md)                          | Toolchain, checks, installation and rollback              |
| [Planner](docs/planner.md)                                     | Goals, the week plan, the queue and its shortcuts         |
| [Apple Reminders](docs/apple-reminders.md)                     | Read-only planning from Reminders lists                   |
| [Apple Calendar](docs/apple-calendar.md)                       | Read-only appointments on the timeline                    |

## Credits & license

Tempo is developed by **s-rode** and builds on [Cronus](docs/PROVENANCE.md) by Moritz Wallawitsch and Arne Strickmann. It adds local AI, correction learning, task-based focus sessions, a built-in planner, notch controls, Firefox support, Apple Reminders and Calendar, and reworked timelines and analysis.

Both Tempo and the Cronus foundation are licensed under [MIT](LICENSE). Original copyright notices are preserved in [NOTICE](NOTICE); dependencies and assets are covered in the [third-party notices](docs/THIRD_PARTY_NOTICES.md).
