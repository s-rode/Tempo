# Tempo Local preparation verification — 2026-10-22

The separate source repository is prepared for publication review and ongoing development. The integrated application has been installed locally. This is not a notarized public release, an assertion of universal compatibility, or a legal opinion. Outstanding manual checks below remain explicit.

## Source and history

- Foundation: verified MIT Cronus commit `222adf835a3a210ca5375a3876e7ed1fed31bb9e`; recovered archive SHA-256 `acfdb2345131b273650334aaec03b674b5f1d8189c15a10b1ced8780869bc13f`; all 620 upstream blobs checked.
- Every current source file has a hash-bound disposition. Moved/split MIT counterparts, retained schemas/contracts, attributable later Tempo features and independent replacements are distinguished in the source inventory and blob ledger.
- All 128 original commits are mapped: 97 chronological feature steps retained, 29 development commits consolidated into reviewed compatibility work, and two recovery imports represented by the attributed MIT foundation. All 14 commits ahead of the saved remote reference are accounted for: 11 retained individually and three consolidated.
- Samuel's retained feature commits preserve original author dates and use his GitHub noreply identity. Reconstruction has current committer dates. Import messages explicitly attribute upstream source; they do not claim original Tempo implementation authorship.
- All reachable revisions are audited, including original-to-public mapping completeness/reachability, reviewed historical blobs, commit messages, excluded/private/generated paths and credential-shaped strings. This scan supplements source review; it does not establish permission through a similarity threshold.
- Intermediate curated feature steps are not claimed to be independently validated historical builds. The final integrated checkout is the supported development target. No original recovery ancestry, tags, backup refs or remote is imported.

## Component disposition

| Component | Final treatment | Behavior retained / deliberate change |
|---|---|---|
| Native observer, title/browser capture | MIT counterparts plus reviewed Tempo changes and small lifecycle/serialization adapters | Stability filtering, Chrome cadence, pause/recovery, sleep/lock, Firefox navigation and optional OCR. Browser-running guards prevent background relaunch. |
| Local classification and correction learning | Retained attributable Tempo pipeline; inherited schema/query glue reviewed against MIT | Ollama, strictness, grounded evidence, navigation cache, enrichment, manual corrections and scoped learning. No remote OpenAI replacement. |
| Persistence and local authentication | Existing models/collections/contracts retained; local session router independently supplied | Existing IDs/settings/history remain readable. Concurrent first-run seeding is serialized; refresh updates both request inputs and headers. |
| Legacy import | Independently replaced with explicit, resumable, insert-only copying | Empty-target/conflict/identity guards; no automatic import, legacy-app removal, database deletion or post-login finalization. |
| Focus, planning, Reminders | Retained Tempo feature implementation and reviewed interfaces | Task estimates, Focus/Pomodoro phases, pause/extension/recovery, read-only EventKit, list context and synchronization. |
| Native notch and IPC | Retained Swift helper and Tempo transport, with reviewed MIT main/preload plumbing | Live local clocks and controls, overlap policies, notification state and process cleanup. Correction cache invalidation keeps shared totals current without polling. |
| Dashboard/category/settings presentation | MIT successors where applicable; small independent activity/week/category adapters | Sunday weeks, selection/filtering, exact-event corrections, day chapters, analytics, appearance and settings. |
| Runtime/profile/build | Explicit local profile, source builders, one lockfile, stable local signing and rollback installer | Production Electron profile remains `tempo-electron-app`; separate `Tempo` Firefox identity folder preserved. Disposable test profile has its own database/port and skips Firefox registration. |
| Assets | Supplied hourglass PNG retained exactly; generated icon sizes/chime; local app icon lookup | Unknown-source old chime/screenshots and redistributed app-logo collection omitted. Asset and dependency notices retained. |
| Hosted/obsolete paths | Removed after reference checks | Website, hosted payments/login/S3/telemetry/updater, old timeline chain, content extractor, duplicate generated sources and alternate packaging tooling excluded. Local login/settings/onboarding remain. |

## Automated and runtime evidence

| Area | Verified evidence | Limits / outstanding checks |
|---|---|---|
| Clean source build | Fresh clone; Node 22.23.2/Bun 1.4.0; frozen lifecycle-disabled install; explicit Electron bootstrap/native rebuild; shared/server/Electron type checks; complete ARM64 app build and signing | Run on macOS 27.0.1. macOS 14 is the declared API/deployment minimum, not a tested release here. The first GitHub CI run failed; see the follow-up below. |
| Deterministic tests | 125 backend tests; 89 renderer/main/runtime tests; three installer rollback tests | These are source-level checks, not GUI accuracy measurements. |
| Disposable Mongo integration | Local authentication/concurrent bootstrap, correction/classification routers, durable system boundaries, Reminders metadata and explicit legacy import | Uses unique test databases. It does not edit Apple reminders or import over production. |
| Native checks | Addon source rebuild/inactive lifecycle smoke; animation/layout/overlap policies; off-screen AppKit controller suppression and idle-work tests | Off-screen tests do not prove physical hover or coexistence with a real overlapping app. |
| Actual local inference | Original and candidate each passed 120 standard and 15 adversarial fixed cases with the same installed local model/settings | See `model-comparison.json`. Synthetic fixture success is not real-world accuracy. Sequential warm-model timing is not a controlled speed benchmark. |
| Staged app | Synthetic task/activity dashboard, estimates, task-linked Pomodoro start/countdown/pause/resume/end; week range/stacking/day selection; keyboard correction and totals refresh | The first fixture lacked its matching unlock and froze normal streak clocks. The fixture was corrected; no timer-code change was required. Live test activity then made that disposable profile unsuitable for public screenshots. |
| Native live clock | Native helper received state; focused counter observed advancing from 1:34 to 1:57 after the matching synthetic unlock | Every physical hover/control/overlap transition has not been independently exercised. |
| Close/Quit lifecycle | Closing staged dashboard left app/helper/API alive; Quit stopped the staged app/helper and isolated API | Exact Dock animation, rapid close during restore and real notch Open-window interaction still need manual acceptance. |
| Installed bundle | Deep/strict signatures, designated requirement `identifier "com.tempo.local"`, macOS 14 target, tempo protocol and five artifact hashes match | Exact built-source commit and artifact hashes are in `installed-artifacts.json`; later documentation/demo commits need no app rebuild. |
| Installed data/permissions | New API revision, existing database/model readiness, same runtime key, history/settings/corrections, existing Reminders lists/tasks and current synchronization observed; no permission re-grant performed | Screen Recording reported granted. Optional Accessibility was not requested. Full denied/granted permutations were not forced on the daily-use profile. |
| Firefox | User reports the installed app works on two websites | User declined browser automation access. No further browser-control permission was requested. The full companion/revisit/long-title/OCR failure matrix is not independently verified. |
| Chrome/Safari | Reviewed retained capture implementation/build inputs and browser-running guards | Interactive checks not run; the user uses Firefox. Neither browser was controlled. |
| Privacy | Local endpoints/IPC, omitted hosted code paths, transient raw browser evidence and capture-safe logging reviewed; current/reachable source scans pass | No packet-capture audit was performed. Existing app names/titles, derived metadata and historical raw fields in private databases/backups are not anonymous or automatically scrubbed. |
| UI/performance | Actual synthetic dashboard/week/correction interaction and native clock advance; native idle-work policies tested | Dark-mode/context-menu permutations, measured 260px `scrollWidth <= clientWidth`, physical overnight sleep, real midnight rollover, and a hardware energy benchmark remain manual checks. |

The sidebar's existing “Monitoring active” label is static; the main paused-state card is authoritative during a manual pause. This presentation limitation predates the port.

### First GitHub CI follow-up

The owner's [initial CI run](https://github.com/s-rode/Tempo/actions/runs/39805326801) failed in two jobs. The macOS native build selected a Python without `distutils`, required by the retained `node-gyp` 9.4.1. The workflow now selects Python 3.11 explicitly for setup and packaging. The Linux backend suite exposed cross-file module-mock contamination: the categorization service's scheduler mock replaced the scheduler under test. Backend commands now use `--isolate`; the categorization fixture also supplies its previously missing `snapshotGoalContext` export using the real pure helper. The failing file order was reproduced locally and passes with isolation, without increasing the scheduler delay or weakening assertions.

Local follow-up checks passed: the full deterministic suite (125 backend, 89 Electron, three installer tests), type checks, frozen setup/native rebuild with Python 3.11, native policy/lifecycle tests, the complete ARM64 package build, and deep/strict signature verification. The installed application was not replaced. A successful GitHub rerun is still required after pushing this fix. No existing commit dates or application behavior were changed by this follow-up.

## Recovery and handoff

Private checkpoints remain outside the publication repository. Their contents are never included in public refs:

1. Original filesystem checkout plus independent all-ref bundle; restored HEAD/tree/branches/tags and all 14 saved unpushed commits verified.
2. Stopped-app installation checkpoint: signed old app, actual Electron profile and runtime key, separate Firefox support key, native-host manifest and MongoDB archive. All 7,478 copied support/manifest files matched their originals.
3. Database archive restored into a uniquely named disposable database; collection identities/counts and complete document content matched. Only the disposable restoration database was removed.
4. Old app restored separately into a disposable private directory; deep/strict signature, designated requirement and app/server/source hashes verified. The installer also passed injected backup/verification-failure rollback tests.
5. Installed candidate preserves production profile/database identities. Existing data has not undergone a destructive schema migration. Keep the old bundle and data checkpoint for rollback; archive newer candidate data before any database restoration.

Continue development in `tempo-local` on `main`; the original checkout remains an untouched recovery/reference repository. No GitHub repository creation, remote configuration, push, author contact, Mozilla submission, Developer ID signing or notarization was performed. Remaining manual scenarios above must not be presented as passed; a material regression blocks an unconditional readiness claim.
