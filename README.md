<div align="center">

<img src="electron-app/assets/tempo-icon.png" alt="Tempo" width="88" />

# Tempo

A focus tracker for macOS.

[![Source checks](https://github.com/s-rode/Tempo/actions/workflows/ci.yml/badge.svg)](https://github.com/s-rode/Tempo/actions/workflows/ci.yml)
[![macOS 14+](https://img.shields.io/badge/macOS-14%2B-1f2430?logo=apple&logoColor=white)](docs/BUILDING.md)
[![MIT License](https://img.shields.io/badge/license-MIT-1f2430)](LICENSE)

<img src="docs/images/tempo-notch-hero.svg" alt="Tempo's focused and distracted timers on either side of the MacBook notch" width="720" />

[Features](#features) · [How it works](#how-it-works) · [Technical notes](#technical-notes) · [Setup](#setup) · [Docs](#documentation)

</div>

You pick the task you want to work on, and a small language model running on your Mac checks whether what is on screen matches it. Nothing leaves the machine.

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

```mermaid
flowchart LR
  subgraph capture["Capture · native"]
    AX["Active-window observer<br/>Objective-C++ addon"]
    FF["Firefox companion<br/>WebExtension + native host"]
  end
  subgraph app["Tempo · Electron"]
    MAIN["Main process<br/>monitoring coordinator"]
    UI["Dashboard<br/>React"]
  end
  subgraph local["Local services"]
    API["Local API<br/>Bun + tRPC"]
    DB[("MongoDB")]
    LLM["Ollama<br/>qwen3:4b"]
  end
  NOTCH["Notch helper<br/>Swift + SwiftUI"]

  AX --> MAIN
  FF --> MAIN
  MAIN <--> UI
  UI <--> API
  API <--> DB
  API <--> LLM
  MAIN <-->|"JSON over stdio"| NOTCH
```

Everything runs on your Mac. The parts talk over loopback, a private Unix socket or stdio.

1. A native observer reports the frontmost app and window title. In Firefox, a companion extension adds some of the visible page text.
2. Your per-app rules and earlier corrections are checked first.
3. If they don't decide it, the activity and your task go to a local model through [Ollama](https://ollama.com) (`qwen3:4b-instruct`). A "focused" answer is only accepted if it points to evidence that is actually in the window title or page text.
4. Timeouts and unclear answers are recorded as uncertain. Uncertain time never counts as focused and never triggers an alert.

## Technical notes

**Keeping a small model honest.** A 4B model is fast enough for a laptop but will make up reasons if you let it. Tempo asks for structured JSON and has the model cite evidence by short aliases, which the server checks. The model has to name the subject it sees before it gives a verdict, and a "focused" answer only counts if that subject really appears in the window title or page text. A malformed reply gets one retry, and the whole decision has a ten-second deadline.

**Learning from corrections.** A correction applies to the task it was made in. Broader preferences need several confirmations across sessions, expire without new feedback, and are suspended by one contradicting observation. Tempo never learns from passive use. Details are in the [classification notes](docs/CLASSIFICATION.md).

**Privacy.** Page text and OCR frames are kept in memory for one request and then dropped. Prompts and model replies are not stored. App names, window titles and summaries are kept in the local database. The notch helper never sees page text and makes no network requests. See [privacy and stored data](docs/NETWORK_NOTES.md).

**Testing.** About 290 deterministic tests cover the server and renderer, and Swift suites cover the notch's layout, timing and lifecycle. The classifier is also checked against a live local model with 466 written scenarios, including paraphrases, look-alike keywords, prompt injection and empty windows. Part of that set is held out and never used for tuning. CI runs the tests on Linux and builds and verifies the signed app on Apple Silicon. See [classification evaluation](docs/CLASSIFICATION_VALIDATION.md).

**Performance.** The weekly analytics now sort their events once and find each date range with a binary search instead of rescanning. On a 70-day fixture of 33,600 events, computing a week and its comparisons went from 427 ms to 39 ms, with identical results. The notch helper polls the window list adaptively instead of at a fixed 10 Hz, which cut its idle CPU from about 0.7 % to 0.1 %. Methods are in the [performance notes](docs/PERFORMANCE.md).

## Built with

| Layer        | Technology                                                           |
| ------------ | -------------------------------------------------------------------- |
| Desktop app  | Electron, React 19, TypeScript, Tailwind CSS, tRPC + React Query     |
| Local API    | Bun, tRPC, Mongoose, Zod                                             |
| Storage      | MongoDB (local)                                                      |
| AI           | Ollama with `qwen3:4b-instruct`, structured JSON output              |
| macOS native | Swift, SwiftUI and AppKit (notch helper); Objective-C++ N-API addon  |
| Browser      | Firefox WebExtension with a Swift native-messaging host; Vision OCR  |
| Tooling, CI  | Bun test, electron-vite, electron-builder, GitHub Actions            |

```text
electron-app/   desktop app, native addon, notch helper, Firefox companion
server/         local API, classification pipeline, evaluation fixtures
shared/         types shared between app and server
docs/           architecture, classification, privacy, performance, build
```

## Setup

Tempo needs an Apple Silicon Mac with macOS 14 or later and is built from source. Install:

- Xcode Command Line Tools, Node 22.23.2, Bun 1.4.0 and Python 3.11
- MongoDB Community 8.0
- Ollama with `qwen3:4b-instruct`

Start MongoDB and Ollama, then:

```sh
git clone https://github.com/s-rode/Tempo.git
cd Tempo
bun run setup
bun run dev
```

The dev app uses its own profile and a test database. `bun run typecheck`, `bun run test` and `bun run build` check the code and build the app. Builds are signed locally and not notarized. The [build guide](docs/BUILDING.md) covers installing, backups and rollback, and the [demo guide](docs/DEMONSTRATION.md) explains how to try Tempo with sample data.

**Firefox:** the build makes an unsigned ZIP of the [companion extension](electron-app/firefox-extension). Load it from `about:debugging`; it has to be reloaded after Firefox restarts. Chrome and Safari work without an extension.

**Permissions:** Reminders and Calendar access are optional and read-only. Accessibility improves window tracking. Screen Recording is only used for the Firefox OCR fallback.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Classification and learning](docs/CLASSIFICATION.md) and [how it is evaluated](docs/CLASSIFICATION_VALIDATION.md)
- [Local AI and browser support](docs/LOCAL_AI.md)
- [Privacy and stored data](docs/NETWORK_NOTES.md)
- [Performance](docs/PERFORMANCE.md)
- [Build and install](docs/BUILDING.md)
- [Planner](docs/planner.md), [Apple Reminders](docs/apple-reminders.md), [Apple Calendar](docs/apple-calendar.md)

## Credits and license

Tempo is built by s-rode on top of [Cronus](docs/PROVENANCE.md) by Moritz Wallawitsch and Arne Strickmann. Both are [MIT](LICENSE) licensed. Original notices are in [NOTICE](NOTICE), and dependencies are listed in the [third-party notices](docs/THIRD_PARTY_NOTICES.md).
