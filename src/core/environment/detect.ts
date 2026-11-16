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

export function detectEnvironment(i: EnvInputs): { state: EnvState; isIOSLike: boolean; permission: PermissionState } {
  const isIOSLike = /iPhone|iPad|iPod/.test(i.userAgent) || (i.platform === 'MacIntel' && i.maxTouchPoints > 1)

  let state: EnvState
  if (i.hasServiceWorker && i.hasPushManager && i.hasNotification) state = 'push_ready'
  else if (isIOSLike && !i.standalone) state = 'ios_needs_install'
  else state = 'unsupported'

  return { state, isIOSLike, permission: i.permission }
}
