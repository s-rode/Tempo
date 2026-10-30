<div align="center">

<img src="electron-app/assets/tempo-icon.png" alt="Tempo" width="96" />

# Tempo

**Your tasks, your timeline, and a timer in the notch.**

[![macOS](https://img.shields.io/badge/macOS-14%2B-111827?logo=apple&logoColor=white)](docs/BUILDING.md)
[![Apple Silicon](https://img.shields.io/badge/Apple_Silicon-arm64-555555)](docs/BUILDING.md)
[![Ollama](https://img.shields.io/badge/AI-Ollama-16a34a)](docs/LOCAL_AI.md)
[![MIT License](https://img.shields.io/badge/License-MIT-2563eb)](LICENSE)

[Get started](#setup) · [Documentation](#documentation)

</div>

Reading a paper, following its references, and getting sidetracked can all happen in the same browser. Tempo tracks your activity and uses local AI to compare it with what you meant to work on.

Choose a task, start a session, and get on with it. Come back to a timeline that shows where the time went.

![Tempo's Today view with tasks, Calendar, and tracked activity](docs/images/tempo-today.png)

## Start with something you want to finish

Write a task in Tempo or bring in your Apple Reminders. Add a time estimate, then start a Focus or Pomodoro session.

That task gives Tempo context for classifying your activity. Choose Flexible, Balanced, or Strict, and correct mistakes directly in the timeline. Tempo uses those corrections to improve future classifications.

Apple Reminders is read-only: your lists stay managed in Reminders, while estimates and focus context live in Tempo.

<p align="center">
  <img src="docs/images/tempo-focus.png" alt="Starting a focus session from a task" width="340" />
</p>

## Keep the timer upstairs

The notch shows your timer and session controls while you work.

Finished the timer but still in the middle of something? Add another **5, 10, 15, or 30 minutes** from the notch and keep working on the same goal.

Distraction notifications can connect what pulled you away with the task you chose. Pick an alert sound, preview it, and adjust how often alerts appear.

## Put your schedule next to your day

Connect Apple Calendar to see appointments and tracked activity on the same time scale.

Tempo can ask whether you want to pause tracking for an event. Accept, and both activity capture and the focus timer pause for its duration. Tracking resumes afterward when you return to activity.

Calendar access is read-only. Appointments provide context; they don't count toward tracked time.

## A day you can read back

The daily timeline groups activity around goals, changes in activity, and gaps. Expand a block to see the apps and activities inside it, including focused, distracted, and uncertain time.

For a longer view, weekly and monthly analytics show how your time adds up across apps and categories.

![Tempo's weekly analytics](docs/images/tempo-analysis.png)

## Local, including the AI

Classification runs through Ollama on your Mac. Activity history lives in a local MongoDB database. No account, cloud AI service, or telemetry.

Browser text and Firefox OCR images are used for classification and discarded afterward. Saved history includes app names, window titles, summaries, goals, and corrections. The [privacy notes](docs/NETWORK_NOTES.md) explain the details, including older records.

Firefox has a companion extension and an optional OCR fallback. Chrome and Safari use macOS browser automation.

Apple Reminders and Calendar access are optional. Accessibility can improve activity capture, and Screen Recording is only needed for the Firefox OCR fallback.

## Setup

You'll need an **Apple Silicon Mac running macOS 14 or later**. Tempo builds from source and needs the following installed:

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

The development app uses a separate profile and test database. To check the source and build an app bundle:

```sh
bun run typecheck
bun run test
bun run build
```

The [build guide](docs/BUILDING.md) covers Python setup, installation, backups, and native checks. Builds are signed locally; they aren't notarized.

<details>
<summary><strong>Setting up Firefox</strong></summary>

The build creates an unsigned ZIP of the [Firefox companion](electron-app/firefox-extension). Load it through Firefox's `about:debugging` page for development. You'll need to reload it after restarting Firefox. Permanent installation in standard Firefox requires a Mozilla-signed XPI.

</details>

## Built with

Electron, React, and TypeScript for the app; Swift/AppKit and Objective-C++ for the macOS integrations. A local Bun/tRPC server connects MongoDB storage with Ollama classification.

See the [architecture](docs/ARCHITECTURE.md) and [classification docs](docs/CLASSIFICATION.md) for more detail.

## Documentation

- [Build and install](docs/BUILDING.md)
- [Local AI and browser support](docs/LOCAL_AI.md)
- [Apple Reminders](docs/apple-reminders.md)
- [Apple Calendar](docs/apple-calendar.md)
- [Privacy and stored data](docs/NETWORK_NOTES.md)
- [Classification evaluation](docs/CLASSIFICATION_VALIDATION.md)
- [Demo setup](docs/DEMONSTRATION.md)

## Credits & license

Tempo is developed by **s-rode** and builds on [Cronus](docs/PROVENANCE.md) by Moritz Wallawitsch and Arne Strickmann. It adds local AI, correction learning, task-based focus sessions, notch controls, Firefox support, Apple Reminders and Calendar, and updated timelines and analytics.

Both Tempo and the Cronus foundation are licensed under [MIT](LICENSE). Original copyright notices are preserved in [NOTICE](NOTICE); dependencies and assets are covered in the [third-party notices](docs/THIRD_PARTY_NOTICES.md).
