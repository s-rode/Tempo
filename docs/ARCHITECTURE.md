# Tempo architecture

Tempo preserves the recovered v1.0.8 continuous goals workflow while replacing
cloud classification with local Ollama and adding a native notch companion.

```text
macOS active-window observer / Firefox companion
  → Electron monitoring coordinator (750 ms stability)
  → localhost tRPC server
  → local MongoDB history or local Ollama decision
  → dashboard, timeline, native Tempo notch helper, nudges
```

The Electron main process owns monitoring and the bundled `tempo-local-server`.
Its health handshake includes a packaged API revision and the owning Electron
process ID. On launch, Tempo replaces an outdated or orphaned loopback server
before monitoring begins, so an app update cannot silently keep using an older
classifier binary.
The renderer authenticates one local user and sends only the current event and
category choices through authenticated tRPC. The native Swift `Tempo Notch
Helper.app` receives derived status over local stdin/stdout JSON and never gets
authentication tokens or raw OCR/page text. Its display contract includes activity, category and session text; optional legacy URL metadata remains in the interface. The helper does not make network requests.

## Classification and privacy

Tempo's foreground classifier makes one goal-aware local request over the
current activity evidence. The model may reason semantically about abbreviations
and paraphrases, but a Focused result must identify an active target and cite
evidence aliases from the current request. Server policy validates those aliases
and confidence rather than applying literal word-overlap rules. Generic method
claims and low-confidence focus guesses fail closed to Distracted; technical
failures alone are Uncertain. The foreground decision controls timers, sound,
and notifications. Optional enrichment after 12 stable seconds cannot change
it. Firefox DOM/OCR context remains in memory only; persisted events retain app names and window titles as well as derived labels, category, decision metadata, and opaque fingerprints.

Users choose a local evidence policy of Flexible, Balanced, or Strict. It only
changes how much visible evidence is required before Tempo calls an activity
focused; it never makes generic app names productive, changes manual
corrections, or turns technical failures into distractions. Automatic cache
fingerprints include strictness, policy, goal-profile, and learning revisions.

## Monitoring and focus runtime

The coordinator ignores visits shorter than 750 ms, buffers delivery through a
hidden dashboard, rejects stale classifications by sequence number, and has a
one-second foreground-PID watchdog. Window-identity checks run every five seconds without a healthy Accessibility observer and every thirty seconds when that observer is healthy.
Each capture is acknowledged only after the local server saves it; opaque capture
IDs make bounded redelivery safe after a renderer or loopback failure. Lock, sleep, manual pause, and Pomodoro breaks
authoritatively suspend capture, timers, OCR, inference, sounds, and nudges.

Normal mode has a 60-second productive-session grace period. Custom Focus and
Pomodoro work phases instead expose cumulative focused and distracted time for
the current block, and their confirmed goal becomes the authoritative classifier
context.

Completed and cancelled focus runs are copied to local focus-run history before
their active phase is cleared. The notch can show either the existing implicit
streaks or workday totals since local 06:00; a manual counter reset changes only
the displayed workday range, never activity history.

The calendar remains midnight-to-midnight. Its day view groups retained activity
sessions into 30-minute chronological chapters, splitting at five-minute gaps and
runtime boundaries while retaining exact child event IDs for recategorization.

## Firefox companion

The Tempo Firefox WebExtension supplies navigation identity and bounded visible
page context over native messaging to a mode-`0600` Unix socket. Editable,
hidden, private, and privileged content is excluded. An active-tab-only mutation
observer coalesces dynamic-page changes and forwards a new revision only after
content settles and its bounded content signature changes. The readable URL,
hostname, and DOM text stay in process memory; only HMAC fingerprints and
derived decision metadata persist. Switching back to the same document and goal
reuses the prior grounded decision.

Chrome and Safari can also supply browser title, URL and page body text through Apple Events when browser scripting is enabled; transport bounds page text before local inference. They do not use OCR. Other native applications remain app-and-title only: Tempo does not inspect their Accessibility body text or capture screenshots.

## Main window lifecycle

Closing the main window keeps monitoring and the notch helper running and hides
Tempo's Dock icon on macOS. The expanded notch's **Open window** button restores
the main window and its Dock icon. Opening Tempo again, following a deep link,
or opening the window from a notification also restores its Dock presence.
Minimizing keeps the Dock icon; Quit still shuts down Tempo and its helpers.
