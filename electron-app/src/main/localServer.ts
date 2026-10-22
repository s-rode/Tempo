import { runtime } from './runtime'
import { ChildProcess, execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomBytes, createHmac } from 'crypto'
import {
  isCompatibleOwnedServer,
  TEMPO_LOCAL_SERVER_API_VERSION,
  type LocalServerHealth
} from './localServerProtocol'

let localServerProcess: ChildProcess | null = null
const execFileAsync = promisify(execFile)

function localRuntimeSecret(): string {
  const runtimeDir = runtime.runtimeDir
  const secretPath = join(runtimeDir, 'jwt-secret')
  if (existsSync(secretPath)) return readFileSync(secretPath, 'utf8').trim()

  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 })
  const secret = randomBytes(32).toString('base64url')
  writeFileSync(secretPath, `${secret}\n`, { mode: 0o600 })
  return secret
}

/** Same namespace as the local classifier, without disclosing its key or the hostname. */
export function localSiteIdentity(host: string): string | null {
  const normalized = host.replace(/\s+/g, ' ').trim().toLocaleLowerCase()
  return normalized
    ? createHmac('sha256', localRuntimeSecret())
        .update(`tempo-learning-site-v1\u0000${normalized}`)
        .digest('hex')
    : null
}

/** Never expose the internal authentication secret to renderer code. */
export async function tempoInternalRequest<T = { enabled: boolean }>(
  path: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(`${runtime.serverUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'x-tempo-migration-token': localRuntimeSecret(),
      'Content-Type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000)
  })
  if (!response.ok) throw new Error('Tempo could not synchronize reminders. Try refreshing again.')
  return response.json() as Promise<T>
}

async function readServiceHealth(): Promise<LocalServerHealth | null> {
  try {
    const response = await fetch(`${runtime.serverUrl}/health`)
    const health = (await response.json()) as LocalServerHealth
    return response.ok && health.service === 'tempo-local-server' && health.database === 'ready'
      ? health
      : null
  } catch (_error) {
    return null
  }
}

const serviceIsReady = async (): Promise<boolean> =>
  isCompatibleOwnedServer(await readServiceHealth(), TEMPO_LOCAL_SERVER_API_VERSION, process.pid)

async function waitForServerExit(): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!(await readServiceHealth())) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}

async function listenerPids(): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync('/usr/sbin/lsof', [
      '-nP',
      `-tiTCP:${runtime.port}`,
      '-sTCP:LISTEN'
    ])
    return stdout
      .split(/\s+/)
      .map(Number)
      .filter((pid) => Number.isInteger(pid) && pid > 1 && pid !== process.pid)
  } catch {
    return []
  }
}

/** Replace only a process already verified as Tempo's loopback service. */
async function stopIncompatibleServer(health: LocalServerHealth): Promise<boolean> {
  try {
    await fetch(`${runtime.serverUrl}/internal/tempo-runtime/shutdown`, {
      method: 'POST',
      headers: { 'x-tempo-migration-token': localRuntimeSecret() }
    })
  } catch {
    // Older packaged servers do not expose the authenticated shutdown route.
  }
  if (await waitForServerExit()) return true

  const verifiedPid = Number.isInteger(health.processId) ? health.processId! : null
  const pids = verifiedPid ? [verifiedPid] : await listenerPids()
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // A process that already exited is equivalent to a successful stop.
    }
  }
  return waitForServerExit()
}

export async function ensureLocalServer(): Promise<boolean> {
  const existing = await readServiceHealth()
  if (isCompatibleOwnedServer(existing, TEMPO_LOCAL_SERVER_API_VERSION, process.pid)) return true
  if (existing && !(await stopIncompatibleServer(existing))) {
    console.error('An outdated Tempo local server could not be replaced safely.')
    return false
  }

  const executable = app.isPackaged
    ? join(process.resourcesPath, 'local-server', 'tempo-local-server')
    : join(app.getAppPath(), 'build-resources', 'local-server', 'tempo-local-server')
  if (!existsSync(executable)) {
    console.error(`Local Tempo server is missing: ${executable}`)
    return false
  }

  localServerProcess = spawn(executable, [], {
    env: {
      ...process.env,
      TEMPO_LOCAL_MODE: 'true',
      TEMPO_OWNER_PID: String(process.pid),
      HOST: '127.0.0.1',
      PORT: String(runtime.port),
      MONGODB_URI: runtime.mongoUri,
      OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
      OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'qwen3:4b-instruct',
      OLLAMA_TIMEOUT_MS: process.env.OLLAMA_TIMEOUT_MS || '30000',
      OLLAMA_KEEP_ALIVE: process.env.OLLAMA_KEEP_ALIVE || '10m',
      OLLAMA_NUM_CTX: process.env.OLLAMA_NUM_CTX || '4096',
      OLLAMA_NUM_PREDICT: process.env.OLLAMA_NUM_PREDICT || '128',
      AUTH_SECRET: localRuntimeSecret(),
      REFRESH_SECRET: localRuntimeSecret(),
      TEMPO_MIGRATION_TOKEN: localRuntimeSecret()
    },
    stdio: 'pipe'
  })

  localServerProcess.stderr?.on('data', (data) => console.error(`[local-server] ${data}`))
  localServerProcess.on('exit', (code) => {
    console.error(`Local Tempo server exited with code ${code}`)
    localServerProcess = null
  })

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    if (await serviceIsReady()) return true
  }
  return false
}

export function stopLocalServer(): void {
  if (localServerProcess && !localServerProcess.killed) {
    localServerProcess.kill('SIGTERM')
  }
}
