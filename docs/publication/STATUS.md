# Publication preparation status

**Not ready for publication or installed-app handoff.** This is an implementation checkpoint, not a completed migration.

## Verified so far

- Original checkout left unchanged; filesystem and all-ref bundle backups restored and verified, including all 14 commits ahead of the saved remote-tracking branch.
- All 620 licensed source blobs reverified against upstream tree metadata.
- Local-only route/auth/bootstrap cleanup; explicit non-destructive legacy import; isolated test-profile routing.
- 125 backend tests, 89 frontend/main/runtime tests and 3 installer rollback tests pass.
- Isolated Mongo integration: local authentication, classifier/corrections, system boundaries, Reminders and explicit legacy import pass.
- Native animation, interaction-layout and overlap policy tests pass.
- Native addon rebuild, shared/server builds, and Electron main/renderer type checks pass.
- Staged ARM64 app packages and passes deep/strict signing verification. Latest native source rebuild and inactive lifecycle smoke check pass. No candidate has been installed or launched as an app.

## Remaining gates

- Finish the integrated all-revision history audit; current source dispositions and exact dependency/asset notices are recorded.
- Reconstruct and audit meaningful original development commits; the history mapping is currently an inventory, not a completed replay.
- Fresh-clone dependency/build verification and execution of the CI-equivalent checks.
- Actual desktop/native/browser UI acceptance. Fixed live-local-model original/candidate comparisons passed all 120 standard and 15 adversarial fixtures; see `model-comparison.json`. Synthetic fixture success does not establish real-world accuracy.
- Consistent installed-app/data backup and verified restoration before any replacement.
- Installed-app interaction verification and primary-checkout handoff.

The original repository remains the primary daily-use/development reference until these gates pass. No GitHub repository, remote, push, author contact or Mozilla submission has been performed.
