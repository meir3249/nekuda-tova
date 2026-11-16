import type { PushPlatform } from './push-platform.ts'
import { unsubscribeQuietly } from './subscribe.ts'

/** Removes this device's local push subscription, if any (after the server was told `enabled: false`). Never throws. */
export async function unsubscribeLocal(platform: PushPlatform): Promise<void> {
  try {
    await unsubscribeQuietly(await platform.getSubscription())
  } catch {
    /* no service worker / not ready: nothing to remove */
  }
}
