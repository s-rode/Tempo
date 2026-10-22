import { expect, test } from 'bun:test'
import { resolveRuntimeProfile } from '../src/main/runtimeProfile'

test('production keeps the existing data namespace, database and port', () => {
  expect(resolveRuntimeProfile({}, '/private/tempo')).toEqual({
    test: false,
    dataDir: '/private/tempo',
    runtimeDir: '/private/tempo/local-runtime',
    port: 3001,
    serverUrl: 'http://127.0.0.1:3001',
    mongoUri: 'mongodb://127.0.0.1:27017/tempo_local'
  })
})

test('an isolated profile cannot address production data or its port', () => {
  const env = { TEMPO_TEST_PROFILE_DIR: '/private/test', TEMPO_TEST_DATABASE: 'tempo_test_port' }
  expect(resolveRuntimeProfile(env, '/private/tempo').mongoUri).toEndWith('/tempo_test_port')
  expect(resolveRuntimeProfile(env, '/private/tempo').port).toBe(3301)
  expect(() =>
    resolveRuntimeProfile({ ...env, TEMPO_TEST_DATABASE: 'tempo_local' }, '/private/tempo')
  ).toThrow()
  expect(() =>
    resolveRuntimeProfile({ ...env, TEMPO_TEST_SERVER_PORT: '3001' }, '/private/tempo')
  ).toThrow()
  expect(() =>
    resolveRuntimeProfile({ TEMPO_TEST_PROFILE_DIR: 'relative' }, '/private/tempo')
  ).toThrow()
  expect(() =>
    resolveRuntimeProfile({ TEMPO_TEST_PROFILE_DIR: '/private/tempo' }, '/private/tempo')
  ).toThrow()
  expect(() =>
    resolveRuntimeProfile({ TEMPO_TEST_PROFILE_DIR: '/private/tempo/nested' }, '/private/tempo')
  ).toThrow()
})
