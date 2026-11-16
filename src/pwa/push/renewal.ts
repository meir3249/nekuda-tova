import type { PermissionState } from '../../core/index.ts'
import type { KeyValueStore } from '../state/local-cache.ts'

/** A short hash of the last endpoint sent to the server (never the endpoint itself, which is a capability URL). */
export const ENDPOINT_HASH_KEY = 'ntk.pushEndpointHash.v1'

/** FNV-1a (32-bit), hex. Change detection only; not a security measure. */
export function endpointHash(endpoint: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < endpoint.length; i++) {
    h ^= endpoint.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export function readEndpointHash(store: KeyValueStore): string | null {
  try {
    return store.getItem(ENDPOINT_HASH_KEY)
  } catch {
    return null
  }
}

export function writeEndpointHash(store: KeyValueStore, endpoint: string | null): void {
  try {
    if (endpoint === null) store.removeItem(ENDPOINT_HASH_KEY)
    else store.setItem(ENDPOINT_HASH_KEY, endpointHash(endpoint))
  } catch {
    /* storage unavailable: the next open simply re-sends the subscription */
  }
}

export interface RenewalInputs {
  serverEnabled: boolean
  serverTimezone: string
  deviceTimezone: string
  permission: PermissionState
  /** Endpoint of the browser's current subscription, or null if there is none. */
  localEndpoint: string | null
  /** Hash stored after the last successful send of a subscription. */
  lastSentHash: string | null
}

export type RenewalAction =
  /** Nothing to repair. */
  | { kind: 'none' }
  /** Enabled on the server, but this device can no longer show notifications: tell the server to stop. */
  | { kind: 'disable' }
  /** Enabled and permitted, but the browser lost its subscription: subscribe again (no prompt) and send it. */
  | { kind: 'resubscribe' }
  /** The browser's subscription differs from the one last sent (renewed by the browser): send it. */
  | { kind: 'send-subscription' }
  /** Only the device timezone changed: the same local time now applies in the new zone. */
  | { kind: 'timezone' }
  /** Disabled on the server, but a subscription is still lying around locally: remove it. */
  | { kind: 'drop-local' }

/** Repairs run silently on every open (spec 07, Renewal and revocation). Pure. */
export function planRenewal(i: RenewalInputs): RenewalAction {
  if (!i.serverEnabled) return i.localEndpoint !== null ? { kind: 'drop-local' } : { kind: 'none' }
  // 'default' means the permission was reset; asking again needs a tap, so stop sending into the void.
  if (i.permission !== 'granted') return { kind: 'disable' }
  if (i.localEndpoint === null) return { kind: 'resubscribe' }
  if (endpointHash(i.localEndpoint) !== i.lastSentHash) return { kind: 'send-subscription' }
  if (i.serverTimezone !== i.deviceTimezone) return { kind: 'timezone' }
  return { kind: 'none' }
}
