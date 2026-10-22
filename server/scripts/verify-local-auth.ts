import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { authRouter, verifyToken } from '../src/routers/auth';
import { User } from '../src/models/user';
import { CategoryModel } from '../src/models/category';

const database = `tempo_test_auth_${randomUUID().replaceAll('-', '')}`;
let connected = false;
try {
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`, { serverSelectionTimeoutMS: 3000 });
  connected = true;
  await Promise.all([User.init(), CategoryModel.init()]);
  const caller = authRouter.createCaller({});
  const sessions = await Promise.all(Array.from({ length: 8 }, () => caller.localLogin()));
  assert.equal(new Set(sessions.map(({ user }) => user.id)).size, 1);
  assert.equal(await User.countDocuments(), 1);
  assert.equal(await CategoryModel.countDocuments(), 2);
  const { accessToken, refreshToken, user } = sessions[0];
  assert.equal(verifyToken(accessToken).userId, user.id);
  assert.equal(verifyToken((await caller.refreshToken({ refreshToken })).accessToken).userId, user.id);
  await caller.markOnboardingComplete({ token: accessToken });
  await CategoryModel.findOneAndUpdate({ isProductive: true }, { $set: { name: 'Synthetic custom work' } });
  const next = await caller.localLogin();
  assert.equal(next.user.id, user.id);
  assert.equal(next.user.hasCompletedOnboarding, true);
  assert.equal(await CategoryModel.countDocuments(), 2);
  assert.equal(await CategoryModel.countDocuments({ name: 'Synthetic custom work' }), 1);
  console.log('PASS: overlapping first-run login, stable identity/categories, refresh and onboarding persistence');
} finally {
  if (connected) {
    assert.ok(database.startsWith('tempo_test_auth_'));
    await mongoose.connection.dropDatabase();
  }
  await mongoose.disconnect();
}
