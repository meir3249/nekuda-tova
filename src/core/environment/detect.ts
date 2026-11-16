export type PermissionState = 'default' | 'granted' | 'denied' | 'unavailable'

export interface EnvInputs {
  userAgent: string
  platform: string
  maxTouchPoints: number
  standalone: boolean
  hasServiceWorker: boolean
  hasPushManager: boolean
  hasNotification: boolean
  permission: PermissionState
}

export type EnvState = 'push_ready' | 'ios_needs_install' | 'unsupported'

/**
 * In-app browsers (Instagram, Facebook, Messenger, LINE, ...) are WebViews that can neither notify nor add to the
 * Home Screen, so "install" advice would be wrong there. A UA hint only, used after feature detection.
 */
const IN_APP_BROWSER = /\b(Instagram|FBAN|FBAV|FB_IAB|FBIOS|Messenger|Line\/|MicroMessenger|Snapchat|TikTok|musical_ly|Twitter|LinkedInApp|GSA\/)/i

export function detectEnvironment(i: EnvInputs): { state: EnvState; isIOSLike: boolean; permission: PermissionState } {
  const isIOSLike = /iPhone|iPad|iPod/.test(i.userAgent) || (i.platform === 'MacIntel' && i.maxTouchPoints > 1)

  let state: EnvState
  if (i.hasServiceWorker && i.hasPushManager && i.hasNotification) state = 'push_ready'
  else if (isIOSLike && !i.standalone && !IN_APP_BROWSER.test(i.userAgent)) state = 'ios_needs_install'
  else state = 'unsupported'

  return { state, isIOSLike, permission: i.permission }
}
