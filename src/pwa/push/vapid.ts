/** Decodes a base64url VAPID public key into the bytes `pushManager.subscribe` expects. Throws on invalid input. */
export function base64UrlToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const trimmed = value.trim()
  if (trimmed === '' || !/^[A-Za-z0-9_-]+={0,2}$/.test(trimmed)) throw new Error('Invalid base64url value')
  const b64 = trimmed.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** An uncompressed P-256 public key is 65 bytes starting with 0x04. */
export function isValidVapidPublicKey(value: string): boolean {
  try {
    const bytes = base64UrlToUint8Array(value)
    return bytes.length === 65 && bytes[0] === 0x04
  } catch {
    return false
  }
}
