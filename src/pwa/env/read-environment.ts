import { detectEnvironment, type EnvInputs, type EnvState, type PermissionState } from '../../core/index.ts'

/** The globals the environment is read from (a real `window`, or a fake in tests). */
export interface EnvWindow {
  navigator: { userAgent: string; platform?: string; maxTouchPoints?: number; standalone?: boolean }
  matchMedia?: (query: string) => { matches: boolean }
  Notification?: { permission: string }
}

export interface DetectedEnvironment {
  state: EnvState
  permission: PermissionState
  isIOSLike: boolean
}

function permissionOf(w: EnvWindow, hasNotification: boolean): PermissionState {
  if (!hasNotification) return 'unavailable'
  try {
    const p = w.Notification?.permission
    return p === 'granted' || p === 'denied' || p === 'default' ? p : 'unavailable'
  } catch {
    return 'unavailable'
  }
}

/** Builds core `EnvInputs` from feature detection first; UA/platform are only hints (spec 07). Never throws. */
export function readEnvInputs(w: EnvWindow): EnvInputs {
  const nav = w.navigator
  let standalone = nav.standalone === true
  try {
    standalone = standalone || w.matchMedia?.('(display-mode: standalone)').matches === true
  } catch {
    /* matchMedia unavailable */
  }
  const hasNotification = 'Notification' in w && w.Notification !== undefined
  return {
    userAgent: nav.userAgent ?? '',
    platform: nav.platform ?? '',
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    standalone,
    hasServiceWorker: 'serviceWorker' in nav,
    hasPushManager: 'PushManager' in w,
    hasNotification,
    permission: permissionOf(w, hasNotification),
  }
}

export function readEnvironment(w: EnvWindow): DetectedEnvironment {
  const d = detectEnvironment(readEnvInputs(w))
  return { state: d.state, permission: d.permission, isIOSLike: d.isIOSLike }
}
