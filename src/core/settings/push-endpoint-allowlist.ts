/** Push endpoint allowlist (P-08), expressed as data. Single source shared by server and sender. */
export interface PushEndpointAllowlist {
  /** Exact hostnames (lowercase). */
  hosts: readonly string[]
  /** Hostname suffixes including the leading dot (lowercase), e.g. ".push.apple.com". */
  hostSuffixes: readonly string[]
}

export const DEFAULT_PUSH_ENDPOINT_ALLOWLIST: PushEndpointAllowlist = {
  hosts: ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'],
  hostSuffixes: ['.push.apple.com', '.notify.windows.com'],
}

export function isAllowedPushHost(hostname: string, allowlist: PushEndpointAllowlist): boolean {
  const h = hostname.toLowerCase()
  return allowlist.hosts.includes(h) || allowlist.hostSuffixes.some((s) => h.length > s.length && h.endsWith(s))
}
