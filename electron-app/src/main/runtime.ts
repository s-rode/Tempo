import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { resolveRuntimeProfile } from './runtimeProfile'

app.setName('Tempo')
// Electron has historically used the package name for this profile. The Tempo
// support folder separately holds Firefox identity material, not this profile.
export const runtime = resolveRuntimeProfile(
  process.env,
  join(app.getPath('appData'), 'tempo-electron-app')
)
mkdirSync(runtime.dataDir, { recursive: true, mode: 0o700 })
app.setPath('userData', runtime.dataDir)
