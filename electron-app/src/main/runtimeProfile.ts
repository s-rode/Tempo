import { isAbsolute, join, resolve, sep } from 'path'

export function resolveRuntimeProfile(env: NodeJS.ProcessEnv, defaultDataDir: string) {
  const testDir = env.TEMPO_TEST_PROFILE_DIR
  if (testDir && !isAbsolute(testDir))
    throw new Error('The test profile directory must be absolute.')
  if (
    testDir &&
    (resolve(testDir) === resolve(defaultDataDir) ||
      resolve(testDir).startsWith(resolve(defaultDataDir) + sep))
  ) {
    throw new Error('A test profile must be outside the production data directory.')
  }
  const port = testDir ? Number(env.TEMPO_TEST_SERVER_PORT || 3301) : 3001
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || (testDir && port === 3001)) {
    throw new Error('A test profile requires its own unprivileged loopback port.')
  }
  const database = testDir ? env.TEMPO_TEST_DATABASE || 'tempo_test_publication' : 'tempo_local'
  if (testDir && !/^tempo_test_[a-zA-Z0-9_]+$/.test(database)) {
    throw new Error('A test database must use the tempo_test_ prefix.')
  }
  const dataDir = testDir || defaultDataDir
  return {
    test: Boolean(testDir),
    dataDir,
    port,
    serverUrl: `http://127.0.0.1:${port}`,
    mongoUri: `mongodb://127.0.0.1:27017/${database}`,
    runtimeDir: join(dataDir, 'local-runtime')
  }
}
