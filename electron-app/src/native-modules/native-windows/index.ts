import { app } from 'electron'
import path from 'path'
import { ActiveWindowDetails } from 'shared/dist/types.js'
import type { ReminderPermission, ReminderSnapshot } from '../../../../shared/reminders'

// Permission types enum to match native layer
export enum PermissionType {
  Accessibility = 0,
  AppleEvents = 1,
  ScreenRecording = 2
}

// Permission status enum to match native layer
export enum PermissionStatus {
  Denied = 0,
  Granted = 1,
  Pending = 2
}

interface Addon {
  getRemindersPermission: () => ReminderPermission
  requestRemindersAccess: (callback: (json: string) => void) => void
  fetchReminders: (callback: (json: string) => void) => void
  startRemindersObserver: (callback: () => void) => void
  startActiveWindowObserver: (callback: (jsonString: string) => void) => void
  stopActiveWindowObserver: () => void
  setActivityCapturePaused: (paused: boolean) => void
  refreshActiveWindow: () => boolean
  resumeAfterSystemSuspension: () => boolean
  getAppIconPath: (appName: string) => string | null
  setFirefoxNavigationState: (json: string) => void
  captureFirefoxNavigation: (json: string) => void
  setFirefoxCompanionConnected: (connected: boolean) => void
  setShouldRequestPermissions: (shouldRequest: boolean) => void
  getShouldRequestPermissions: () => boolean
  getPermissionStatus: (permissionType: number) => number
  hasPermissionsForTitleExtraction: () => boolean
  hasPermissionsForContentExtraction: () => boolean
  requestPermission: (permissionType: number) => void
}

const isDevelopment = !app.isPackaged

const addonPath = isDevelopment
  ? path.join(
      process.cwd(),
      'src',
      'native-modules',
      'native-windows',
      'build',
      'Release',
      'nativeWindows.node'
    )
  : path.join(process.resourcesPath, 'native', 'nativeWindows.node')

// eslint-disable-next-line @typescript-eslint/no-var-requires
const addon: Addon = require(addonPath)

class NativeWindows {
  public getRemindersPermission(): ReminderPermission {
    return addon.getRemindersPermission()
  }
  public requestRemindersAccess(): Promise<ReminderPermission> {
    return new Promise((resolve, reject) =>
      addon.requestRemindersAccess((json) => {
        try {
          resolve(JSON.parse(json).permission)
        } catch (error) {
          reject(error)
        }
      })
    )
  }
  public fetchReminders(): Promise<ReminderSnapshot> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('fetch_failed')), 30_000)
      timeout.unref()
      addon.fetchReminders((json) => {
        clearTimeout(timeout)
        try {
          const result = JSON.parse(json)
          if (result.error || !result.snapshot) reject(new Error(result.error || 'fetch_failed'))
          else resolve(result.snapshot)
        } catch (error) {
          reject(error)
        }
      })
    })
  }
  public startRemindersObserver(callback: () => void): void {
    addon.startRemindersObserver(callback)
  }
  /**
   * Subscribes to active window changes
   */
  public startActiveWindowObserver(callback: (details: ActiveWindowDetails | null) => void): void {
    addon.startActiveWindowObserver((jsonString: string) => {
      try {
        if (jsonString) {
          const detailsJson = JSON.parse(jsonString)
          // Ensure that the id field from the native module is mapped to windowId
          const details: ActiveWindowDetails = {
            ...detailsJson,
            windowId: detailsJson.id || 0 // Default to 0 if id is missing
          }
          delete (details as any).id // remove original id if it exists to avoid confusion
          callback(details)
        } else {
          callback(null)
        }
      } catch {
        console.error('Native activity capture could not be decoded.');
        callback(null)
      }
    })
  }

  public stopActiveWindowObserver(): void {
    addon.stopActiveWindowObserver()
  }

  /** Keeps lock/sleep observation alive while suspending all activity capture. */
  public setActivityCapturePaused(paused: boolean): void {
    addon.setActivityCapturePaused(paused)
  }

  /** Forces one safe, local re-read of the currently frontmost window. */
  public refreshActiveWindow(): boolean {
    return addon.refreshActiveWindow()
  }

  /**
   * Recovers only a stale native lock/sleep gate, then schedules the same
   * stability-filtered capture used for normal wake/unlock handling.
   */
  public resumeAfterSystemSuspension(): boolean {
    return addon.resumeAfterSystemSuspension()
  }

  public getAppIconPath(appName: string): string | null {
    return addon.getAppIconPath(appName)
  }

  public setFirefoxNavigationState(state: {
    windowId: number
    title: string
    navigationFingerprint: string
    pageCorrectionKey: string
  }): void {
    addon.setFirefoxNavigationState(JSON.stringify(state))
  }

  public captureFirefoxNavigation(state: {
    windowId: number
    title: string
    navigationFingerprint: string
  }): void {
    addon.captureFirefoxNavigation(JSON.stringify(state))
  }

  public setFirefoxCompanionConnected(connected: boolean): void {
    addon.setFirefoxCompanionConnected(connected)
  }

  /**
   * Controls whether permission dialogs should be shown to users
   * Call this with true after onboarding is complete
   */
  public setShouldRequestPermissions(shouldRequest: boolean): void {
    addon.setShouldRequestPermissions(shouldRequest)
  }

  /**
   * Returns whether permission requests are currently enabled
   */
  public getShouldRequestPermissions(): boolean {
    return addon.getShouldRequestPermissions()
  }

  /**
   * Gets the status of a specific permission
   * @param permissionType The permission type to check
   * @returns PermissionStatus enum value
   */
  public getPermissionStatus(permissionType: PermissionType): PermissionStatus {
    return addon.getPermissionStatus(permissionType) as PermissionStatus
  }

  /**
   * Checks if the app has permissions for title extraction
   */
  public hasPermissionsForTitleExtraction(): boolean {
    return addon.hasPermissionsForTitleExtraction()
  }

  /**
   * Checks if the app has permissions for content extraction
   */
  public hasPermissionsForContentExtraction(): boolean {
    return addon.hasPermissionsForContentExtraction()
  }

  /**
   * Manually requests a specific permission
   * @param permissionType The permission type to request
   */
  public requestPermission(permissionType: PermissionType): void {
    addon.requestPermission(permissionType)
  }
}

export const nativeWindows = new NativeWindows()
