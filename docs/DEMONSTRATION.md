# Synthetic demonstration

Use an isolated profile for portfolio screenshots. Never photograph a daily-use profile, real browser page, task list or Reminders connection for the repository.

With MongoDB already available and the development app stopped, choose a new disposable database name:

```sh
bun server/scripts/seed-demo.ts --database=tempo_test_demo_portfolio
TEMPO_TEST_DATABASE=tempo_test_demo_portfolio bun run dev
```

The command refuses a populated database and cannot select `tempo_local`. It creates authored tasks and 50 minutes of sample activity, with matching lock/unlock boundaries. Tracking is paused for two hours and Reminders is disconnected. Before capturing, confirm the paused card and that only sample labels are visible. The regular app, production profile and Firefox registration remain separate.

Inspect Today, the week view, task estimates, and analytics. Keep tracking paused while capturing the demonstration. Resume only for deliberate runtime testing: real foreground activity can then enter the disposable database, so it is no longer a purely synthetic screenshot source. Do not connect Reminders or reuse a test profile containing personal activity.

To repeat the demonstration, select another empty `tempo_test_demo_` database and a new absolute `TEMPO_TEST_PROFILE_DIR` outside the production profile. The seed command never overwrites or deletes existing data.
