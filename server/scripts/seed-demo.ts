/** Create authored demonstration data in a new, explicitly named test database. */
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

const database = process.argv.find((value) => value.startsWith('--database='))?.slice(11);
if (!database || !/^tempo_test_demo_[a-zA-Z0-9_]+$/.test(database))
  throw new Error('Choose a new database with --database=tempo_test_demo_NAME.');

const uri = 'mongodb://127.0.0.1:27017/' + database;
const check = new mongoose.mongo.MongoClient(uri);
try {
  await check.connect();
  if (await check.db(database).listCollections().hasNext())
    throw new Error('The demonstration database must be completely empty. Nothing was changed.');
} finally {
  await check.close();
}

await mongoose.connect(uri);
try {
  const [{ User }, { CategoryModel }, { GoalPlanModel }, { ActiveWindowEventModel },
    { FocusRuntimeModel }, { defaultCategoriesData }] = await Promise.all([
    import('../src/models/user'), import('../src/models/category'),
    import('../src/models/goalPlan'), import('../src/models/activeWindowEvent'),
    import('../src/models/focusRuntime'), import('../../shared/categories'),
  ]);
  const user = await User.create({
    googleId: 'tempo-local-user', email: 'local@tempo.invalid', name: 'Demo User',
    hasCompletedOnboarding: true,
  });
  const userId = String(user._id);
  const categories = await CategoryModel.insertMany(defaultCategoriesData(userId));
  const work = String(categories.find((category) => category.isProductive)!._id);
  const distraction = String(categories.find((category) => !category.isProductive)!._id);
  const now = Date.now();
  const day = new Date(now);
  const periodKey = [day.getFullYear(), String(day.getMonth() + 1).padStart(2, '0'),
    String(day.getDate()).padStart(2, '0')].join('-');
  await GoalPlanModel.create({
    userId, scope: 'daily', periodKey,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    tasks: [
      { id: randomUUID(), text: 'Build the sample dashboard', estimatedMinutes: 30,
        position: 0, completedAtMs: null },
      { id: randomUUID(), text: 'Review the demo notes', estimatedMinutes: 15,
        position: 1, completedAtMs: null },
    ],
  });
  const start = now - 60 * 60_000;
  await ActiveWindowEventModel.insertMany([
    { userId, ownerName: 'Visual Studio Code', title: 'Sample dashboard', type: 'window',
      timestamp: start, categoryId: work, classificationStatus: 'manual',
      activityLabel: 'Build a sample dashboard', activitySummary: 'Implement the synthetic demo layout.' },
    { userId, ownerName: 'Firefox', title: 'Demo documentation', type: 'browser', browser: 'firefox',
      timestamp: start + 30 * 60_000, categoryId: work, classificationStatus: 'manual',
      activityLabel: 'Read documentation', activitySummary: 'Review the public demo API guide.' },
    { userId, ownerName: 'Firefox', title: 'Sample break', type: 'browser', browser: 'firefox',
      timestamp: start + 45 * 60_000, categoryId: distraction, classificationStatus: 'manual',
      activityLabel: 'Take a short break', activitySummary: 'Synthetic break activity.' },
    { userId, ownerName: 'System Lock', title: 'System Lock', type: 'system',
      timestamp: start + 50 * 60_000, captureReason: 'system_lock' },
    { userId, ownerName: 'System Unlock', title: 'System Unlock', type: 'system',
      timestamp: start + 50 * 60_000 + 1, captureReason: 'system_unlock' },
  ]);
  // Pause before the first GUI launch. Capturing demonstrations must not start
  // recording whichever personal application happens to be in the foreground.
  await FocusRuntimeModel.create({
    userId, manualPausedAtMs: now, manualPauseUntilMs: now + 2 * 60 * 60_000,
  });
  console.log('Created synthetic demonstration database:', database);
  console.log('Launch with TEMPO_TEST_DATABASE=' + database + ' bun run dev');
  console.log('Keep tracking paused and Reminders disconnected when capturing public demonstrations.');
} finally {
  await mongoose.disconnect();
}
