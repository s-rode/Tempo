import { beforeEach, expect, mock, test } from 'bun:test';

const findById = mock();
const findByIdAndUpdate = mock();
mock.module('../models/user', () => ({ User: { findById, findByIdAndUpdate } }));
mock.module('./auth', () => ({ verifyToken: () => ({ userId: 'sound-user' }) }));
const { userRouter } = await import('./user');
const caller = userRouter.createCaller({});

beforeEach(() => {
  findById.mockReset();
  findByIdAndUpdate.mockReset();
});

test('older preferences receive the new default without changing disabled alerts or cadence', async () => {
  findById.mockReturnValue({ select: () => ({ lean: async () => ({
    electronAppSettings: { playDistractionSound: false, distractionSoundInterval: 120 },
  }) }) });
  const settings = await caller.getElectronAppSettings({ token: 'fixture' });
  expect(settings.distractionSound).toBe('pop');
  expect(settings.playDistractionSound).toBe(false);
  expect(settings.distractionSoundInterval).toBe(120);
});

test('sound changes patch only the selected preference and reject arbitrary names', async () => {
  findByIdAndUpdate.mockResolvedValue({ electronAppSettings: { distractionSound: 'purr' } });
  await caller.updateElectronAppSettings({ token: 'fixture', distractionSound: 'purr' });
  expect(findByIdAndUpdate).toHaveBeenCalledWith('sound-user', {
    $set: { 'electronAppSettings.distractionSound': 'purr' },
  }, { new: true });
  await expect(caller.updateElectronAppSettings({ token: 'fixture', distractionSound: '../file' as 'pop' })).rejects.toThrow();
  expect(findByIdAndUpdate).toHaveBeenCalledTimes(1);
});
